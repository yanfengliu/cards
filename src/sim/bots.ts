// The bots.
//
// Every bot here shares one card-selection policy - `selectPlays` in
// `engine/fight.ts`, a pure function of hand and energy. A bot is handed the
// cards it is playing this round and returns one insertion index per card.
// It cannot add, drop or reorder a card. Placement is the only variable.
//
// Every policy in this file is a **pure function of the fight state it is
// handed**. None of them keeps a counter, a generator, or any other value that
// survives a call. That is deliberate and it is load-bearing:
//
//   A policy that carries state makes its own decisions depend on how many
//   fights the instance has already seen. `measure.ts` happens to build a
//   fresh policy for every fight, so the earlier stateful version reproduced -
//   but only by convention. Hoisting the policy out of the loop for speed, or
//   reusing one instance across a sweep, would have silently changed every
//   placement and every final hash while every gate stayed green.
//
// So the randomness each policy needs is *derived* from `(fight seed, round,
// and whatever else identifies the decision)` rather than carried forward.
// `src/sim/bots.test.ts` pins this: a warmed instance and a fresh one must
// produce identical placements and identical final hashes.

import {
  type Fight,
  type Placement,
  type PlacementPolicy,
  applyPlacements,
  cloneFight,
  simulateRoundForEval,
} from '../engine/fight.ts';
import { type Rng, makeRng, mixSeeds, nextInt, rngFromSeedValue } from '../engine/rng.ts';
import { heroOf, unitCount } from '../engine/state.ts';

/**
 * Uniform over legal insertion indices, one draw per card.
 *
 * The generator is rebuilt on every call from `(seed, fight seed, round)` and
 * the stream name, so this policy holds nothing between rounds or between
 * fights. `seed` is the constructor's own seed - normally the fight's, but the
 * fight's is mixed in as well, so a policy instance shared across a sweep still
 * places differently in every fight.
 */
export function randomPlacer(seed: number, stream: string): PlacementPolicy {
  return (f, plays) => {
    const rng: Rng = makeRng(mixSeeds(seed, f.seed, f.round), stream);
    const indices: number[] = [];
    let units = unitCount(f.state, 'player');
    for (let i = 0; i < plays.length; i++) {
      indices.push(nextInt(rng, units + 1));
      units++;
    }
    return indices;
  };
}

/** Always append immediately left of the hero. A fixed rule, no search. */
export function appendRightPlacer(): PlacementPolicy {
  return (f, plays) => {
    const indices: number[] = [];
    let units = unitCount(f.state, 'player');
    for (let i = 0; i < plays.length; i++) {
      indices.push(units);
      units++;
    }
    return indices;
  };
}

/** Always insert at the far left of the line. The other fixed extreme. */
export function appendLeftPlacer(): PlacementPolicy {
  return (_f, plays) => plays.map(() => 0);
}

export type LookaheadOptions = {
  /** Rollouts averaged per candidate. Random targeting makes one rollout noisy. */
  rollouts: number;
  /**
   * `greedy` decides one card at a time, undecided cards sitting at the right
   * end. `exhaustive` searches the full product of insertion indices.
   */
  mode: 'greedy' | 'exhaustive';
  /** Above this many candidates, `exhaustive` falls back to `greedy`. */
  exhaustiveLimit: number;
};

export const DEFAULT_LOOKAHEAD: LookaheadOptions = {
  rollouts: 4,
  mode: 'greedy',
  exhaustiveLimit: 4000,
};

/** Board value used to score a rollout. Printed Power and Health only; this-turn
 * buffs are excluded because they expire before they can be banked. */
function boardValue(f: Fight, side: 'player' | 'enemy'): number {
  let v = 0;
  for (const e of f.state.board[side]) {
    if (!e.alive || e.isHero) continue;
    v += e.basePower + 0.7 * e.health;
  }
  return v;
}

function scoreFight(f: Fight): number {
  const ph = heroOf(f.state, 'player');
  const eh = heroOf(f.state, 'enemy');
  let s = 3 * ph.health - 3 * eh.health + boardValue(f, 'player') - boardValue(f, 'enemy');
  if (!eh.alive) s += 1000;
  if (!ph.alive) s -= 1000;
  return s;
}

/**
 * The rollout generator for one decision.
 *
 * **Common random numbers.** The seed depends on the fight, the round, which
 * decision is being made and which rollout it is - and deliberately *not* on
 * which candidate is being scored. Every candidate in one decision is therefore
 * rolled out against the same targeting draws, so the comparison between them
 * measures the arrangement rather than the luck. That is the standard
 * variance-reduction technique for a search that ranks candidates under noise,
 * and with only four rollouts per candidate it is not a refinement: an earlier
 * version salted the seed per candidate, and the search was picking noise often
 * enough to cost the measured optimal-vs-random gap two whole points.
 *
 * `decision` is what separates one comparison from the next - the greedy loop
 * passes the index of the card it is placing, the exhaustive search passes 0
 * because it makes a single decision over the whole product. It is not a search
 * coordinate: two candidates inside one decision must share it, or common
 * random numbers is exactly what is lost.
 *
 * The bound: candidates share the *seed*, not the whole draw sequence. A
 * placement that changes how many targeting rolls the round consumes puts the
 * streams out of step from that point on, so the pairing is tight early in the
 * rollout and decays through it. Fixing that needs pre-drawn randomness in the
 * resolver, which is an engine change.
 *
 * These generators never touch `rngCombat`, so the search cannot see the
 * targeting rolls the real round is about to make - it is a bot, not an oracle
 * - and running the search consumes no fight randomness at all.
 */
function rolloutRng(f: Fight, decision: number, rollout: number): Rng {
  return rngFromSeedValue(mixSeeds(f.seed, f.round, decision, rollout, 0x51ed));
}

/**
 * Score one candidate arrangement: clone the fight, place the cards, roll the
 * round forward `rollouts` times and average.
 */
function scoreCandidate(
  f: Fight,
  plays: readonly string[],
  indices: readonly number[],
  opts: LookaheadOptions,
  decision: number,
): number {
  const placements: Placement[] = plays.map((cardId, i) => ({ cardId, index: indices[i]! }));
  let total = 0;
  for (let r = 0; r < opts.rollouts; r++) {
    const trial = cloneFight(f);
    applyPlacements(trial, placements);
    simulateRoundForEval(trial, rolloutRng(f, decision, r));
    total += scoreFight(trial);
  }
  return total / opts.rollouts;
}

/** Indices that put every card at the right end, given a starting unit count. */
function rightEndIndices(startUnits: number, k: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(startUnits + i);
  return out;
}

/**
 * Bot A. Searches insertion positions for the cards it is already committed to
 * playing, scoring each arrangement by rolling the round forward through the
 * real engine.
 *
 * Holds no state between calls: every rollout generator is derived from the
 * fight it was handed.
 */
export function lookaheadPlacer(opts: LookaheadOptions = DEFAULT_LOOKAHEAD): PlacementPolicy {
  return (f, plays) => {
    if (plays.length === 0) return [];
    const startUnits = unitCount(f.state, 'player');

    let candidateCount = 1;
    for (let i = 0; i < plays.length; i++) candidateCount *= startUnits + i + 1;

    if (opts.mode === 'exhaustive' && candidateCount <= opts.exhaustiveLimit) {
      // One decision over the whole product, so every candidate shares the
      // rollout stream keyed by decision 0.
      let best = rightEndIndices(startUnits, plays.length);
      let bestScore = -Infinity;
      const current: number[] = new Array<number>(plays.length).fill(0);
      const walk = (depth: number): void => {
        if (depth === plays.length) {
          const s = scoreCandidate(f, plays, current, opts, 0);
          if (s > bestScore) {
            bestScore = s;
            best = current.slice();
          }
          return;
        }
        for (let idx = 0; idx <= startUnits + depth; idx++) {
          current[depth] = idx;
          walk(depth + 1);
        }
      };
      walk(0);
      return best;
    }

    // Greedy: fix one card's slot at a time; undecided cards sit at the right
    // end so every rollout scores the same bodies, only differently arranged.
    // Card `c` is one decision, and its candidates share one rollout stream.
    const decided: number[] = [];
    for (let c = 0; c < plays.length; c++) {
      let bestIdx = startUnits + c;
      let bestScore = -Infinity;
      for (let idx = 0; idx <= startUnits + c; idx++) {
        const trial = decided.slice();
        trial.push(idx);
        for (let rest = c + 1; rest < plays.length; rest++) trial.push(startUnits + rest);
        const s = scoreCandidate(f, plays, trial, opts, c);
        if (s > bestScore) {
          bestScore = s;
          bestIdx = idx;
        }
      }
      decided.push(bestIdx);
    }
    return decided;
  };
}
