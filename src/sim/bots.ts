// The bots.
//
// Every bot here shares one card-selection policy - `selectPlays` in
// `engine/fight.ts`, a pure function of hand and energy. A bot is handed the
// cards it is playing this round and returns one insertion index per card.
// It cannot add, drop or reorder a card. Placement is the only variable.

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

/** Uniform over legal insertion indices, one draw per card. */
export function randomPlacer(seed: number, stream: string): PlacementPolicy {
  const rng: Rng = makeRng(seed, stream);
  return (f, plays) => {
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
 * Score one candidate arrangement: clone the fight, place the cards, roll the
 * round forward `rollouts` times and average.
 *
 * The rollouts use their own generators, seeded from the fight seed and the
 * search coordinates. They never touch `rngCombat`, so the search cannot see
 * the targeting rolls the real round is about to make - it is a bot, not an
 * oracle - and running the search consumes no fight randomness at all.
 */
function scoreCandidate(
  f: Fight,
  plays: readonly string[],
  indices: readonly number[],
  opts: LookaheadOptions,
  salt: number,
): number {
  const placements: Placement[] = plays.map((cardId, i) => ({ cardId, index: indices[i]! }));
  let total = 0;
  for (let r = 0; r < opts.rollouts; r++) {
    const trial = cloneFight(f);
    applyPlacements(trial, placements);
    const evalRng = rngFromSeedValue(mixSeeds(f.seed, f.round, salt, r, 0x51ed));
    simulateRoundForEval(trial, evalRng);
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
 */
export function lookaheadPlacer(opts: LookaheadOptions = DEFAULT_LOOKAHEAD): PlacementPolicy {
  let salt = 0;
  return (f, plays) => {
    if (plays.length === 0) return [];
    const startUnits = unitCount(f.state, 'player');

    let candidateCount = 1;
    for (let i = 0; i < plays.length; i++) candidateCount *= startUnits + i + 1;

    if (opts.mode === 'exhaustive' && candidateCount <= opts.exhaustiveLimit) {
      let best = rightEndIndices(startUnits, plays.length);
      let bestScore = -Infinity;
      const current: number[] = new Array<number>(plays.length).fill(0);
      const walk = (depth: number): void => {
        if (depth === plays.length) {
          const s = scoreCandidate(f, plays, current, opts, salt++);
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
    const decided: number[] = [];
    for (let c = 0; c < plays.length; c++) {
      let bestIdx = startUnits + c;
      let bestScore = -Infinity;
      for (let idx = 0; idx <= startUnits + c; idx++) {
        const trial = decided.slice();
        trial.push(idx);
        for (let rest = c + 1; rest < plays.length; rest++) trial.push(startUnits + rest);
        const s = scoreCandidate(f, plays, trial, opts, salt++);
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
