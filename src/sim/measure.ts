// The measurement: is placement a decision?
//
//   Run the same decks with a bot that places optimally and a bot that places
//   randomly. If their win rates are the same, placement is not a decision and
//   the central claim of the design is false.   -- ARCHITECTURE.md
//
// Methodology, stated here because getting it wrong makes the number worthless:
//
//   1. Card selection is shared. Both arms call the same `selectPlays`, a pure
//      function of hand and energy that never reads the board. The bots receive
//      the already-chosen card list and return insertion indices only.
//   2. Decks are shuffled from the `deck` stream, which is separate from the
//      `combat` stream, so a different number of targeting rolls cannot shift
//      the draw order.
//   3. Both arms run the same seed set, so the comparison is paired.
//   4. `--verify` re-checks all of that against the actual runs rather than
//      trusting the argument above.

import { pathToFileURL } from 'node:url';

import {
  type FightRun,
  type FightSetup,
  type PlacementPolicy,
  type RoundRecord,
  replayFight,
  runFight,
} from '../engine/fight.ts';
import { hashFight } from '../engine/hash.ts';
import {
  ENCOUNTERS,
  ENEMY_DECK,
  MAX_ROUNDS,
  PLAYER_DECK,
  PLAYER_DECK_NO_CASCADE,
  PLAYER_HERO,
  PRIMARY_ENCOUNTER,
  encounterById,
} from '../content/cards.ts';
import {
  type LookaheadOptions,
  DEFAULT_LOOKAHEAD,
  appendLeftPlacer,
  appendRightPlacer,
  lookaheadPlacer,
  randomPlacer,
} from './bots.ts';

export function setupFor(
  seed: number,
  encounterId: string = PRIMARY_ENCOUNTER,
  cascade: boolean = true,
): FightSetup {
  const enc = encounterById(encounterId);
  return {
    seed,
    playerDeck: cascade ? PLAYER_DECK : PLAYER_DECK_NO_CASCADE,
    enemyDeck: ENEMY_DECK,
    enemyOpening: enc.opening,
    playerHero: PLAYER_HERO,
    enemyHero: enc.enemyHero,
    maxRounds: MAX_ROUNDS,
  };
}

export type ArmResult = {
  name: string;
  wins: number;
  losses: number;
  timeouts: number;
  n: number;
  winRate: number;
  meanRounds: number;
  outcomes: number[];
  logs: RoundRecord[][];
};

export type BotFactory = (seed: number) => PlacementPolicy;

export const BOTS: Record<string, BotFactory> = {
  lookahead: () => lookaheadPlacer(DEFAULT_LOOKAHEAD),
  lookaheadExhaustive: () =>
    lookaheadPlacer({ ...DEFAULT_LOOKAHEAD, mode: 'exhaustive' } as LookaheadOptions),
  random: (seed) => randomPlacer(seed, 'placement-a'),
  randomB: (seed) => randomPlacer(seed, 'placement-b'),
  right: () => appendRightPlacer(),
  left: () => appendLeftPlacer(),
};

export function runArm(
  name: string,
  factory: BotFactory,
  seeds: readonly number[],
  encounterId: string = PRIMARY_ENCOUNTER,
  cascade: boolean = true,
): ArmResult {
  let wins = 0;
  let losses = 0;
  let timeouts = 0;
  let rounds = 0;
  const outcomes: number[] = [];
  const logs: RoundRecord[][] = [];

  for (const seed of seeds) {
    const run: FightRun = runFight(setupFor(seed, encounterId, cascade), factory(seed));
    if (run.fight.result === 'playerWin') {
      wins++;
      outcomes.push(1);
    } else {
      if (run.fight.result === 'timeout') timeouts++;
      else losses++;
      outcomes.push(0);
    }
    rounds += run.fight.round;
    logs.push(run.log);
  }

  return {
    name,
    wins,
    losses,
    timeouts,
    n: seeds.length,
    winRate: wins / seeds.length,
    meanRounds: rounds / seeds.length,
    outcomes,
    logs,
  };
}

/** Paired difference and its 95% interval. Both arms saw the same seeds. */
export function pairedGap(a: ArmResult, b: ArmResult): {
  gap: number;
  se: number;
  ci95: [number, number];
  aWonBLost: number;
  bWonALost: number;
  agreed: number;
} {
  const n = a.outcomes.length;
  let sum = 0;
  let aWonBLost = 0;
  let bWonALost = 0;
  let agreed = 0;
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = a.outcomes[i]! - b.outcomes[i]!;
    diffs.push(d);
    sum += d;
    if (d > 0) aWonBLost++;
    else if (d < 0) bWonALost++;
    else agreed++;
  }
  const mean = sum / n;
  let varSum = 0;
  for (const d of diffs) varSum += (d - mean) * (d - mean);
  const sd = Math.sqrt(varSum / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  return {
    gap: mean,
    se,
    ci95: [mean - 1.96 * se, mean + 1.96 * se],
    aWonBLost,
    bWonALost,
    agreed,
  };
}

/** Wilson interval on a single arm's win rate. */
export function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}

const pct = (x: number): string => `${(100 * x).toFixed(2)}%`;

// ---------------------------------------------------------------------------
// Instrument checks. Verify the instrument before trusting the measurement.
// ---------------------------------------------------------------------------

export type InstrumentReport = {
  seedCount: number;
  seedRange: string;
  cardsIdentical: boolean;
  cardMismatches: string[];
  roundsCompared: number;
  placementsDiffered: number;
  placementOpportunities: number;
  determinismTrials: number;
  determinismStable: boolean;
  replayStable: boolean;
  distinctHashes: number;
};

/**
 * Check that the two arms really played the same cards, round by round, over
 * the rounds both fights reached. If this fails the measurement is about card
 * choice and the win-rate gap means nothing.
 */
export function checkSameCards(a: ArmResult, b: ArmResult): {
  ok: boolean;
  mismatches: string[];
  roundsCompared: number;
  placementsDiffered: number;
  placementOpportunities: number;
} {
  const mismatches: string[] = [];
  let roundsCompared = 0;
  let placementsDiffered = 0;
  let placementOpportunities = 0;

  for (let i = 0; i < a.logs.length; i++) {
    const la = a.logs[i]!;
    const lb = b.logs[i]!;
    const common = Math.min(la.length, lb.length);
    for (let r = 0; r < common; r++) {
      const ra = la[r]!;
      const rb = lb[r]!;
      roundsCompared++;
      const handA = ra.handBefore.slice().sort().join(',');
      const handB = rb.handBefore.slice().sort().join(',');
      if (handA !== handB) {
        mismatches.push(`seed idx ${i} round ${ra.round}: hands differ [${handA}] vs [${handB}]`);
        continue;
      }
      const cardsA = ra.placements.map((p) => p.cardId).join(',');
      const cardsB = rb.placements.map((p) => p.cardId).join(',');
      if (cardsA !== cardsB) {
        mismatches.push(
          `seed idx ${i} round ${ra.round}: cards played differ [${cardsA}] vs [${cardsB}]`,
        );
        continue;
      }
      for (let p = 0; p < ra.placements.length; p++) {
        placementOpportunities++;
        if (ra.placements[p]!.index !== rb.placements[p]!.index) placementsDiffered++;
      }
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
    roundsCompared,
    placementsDiffered,
    placementOpportunities,
  };
}

/** Same seed and same action list, many times: one hash or the measurement is fiction. */
export function checkDeterminism(seeds: readonly number[], trials: number): {
  stable: boolean;
  replayStable: boolean;
  distinctHashes: number;
  detail: string[];
} {
  const detail: string[] = [];
  const hashes = new Set<string>();
  let stable = true;
  let replayStable = true;

  for (const seed of seeds) {
    const first = runFight(setupFor(seed), BOTS.lookahead!(seed));
    const firstHash = hashFight(first.fight);
    hashes.add(firstHash);

    for (let t = 1; t < trials; t++) {
      const again = runFight(setupFor(seed), BOTS.lookahead!(seed));
      if (hashFight(again.fight) !== firstHash) {
        stable = false;
        detail.push(`seed ${seed}: rerun ${t} produced a different final state hash`);
      }
    }

    const replayed = replayFight(setupFor(seed), first.log);
    if (hashFight(replayed) !== firstHash) {
      replayStable = false;
      detail.push(`seed ${seed}: replay from the action list diverged from the live run`);
    }
  }

  return { stable, replayStable, distinctHashes: hashes.size, detail };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]!;
  return fallback;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function main(): void {
  const n = Number.parseInt(arg('seeds', '2000'), 10);
  const first = Number.parseInt(arg('first-seed', '1'), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--seeds must be a positive integer, got "${arg('seeds', '2000')}"`);
  }
  const seeds: number[] = [];
  for (let i = 0; i < n; i++) seeds.push(first + i);

  // Wall-clock only for the progress line at the end. Nothing in the engine
  // reads a clock; `Math.random`, `Date.now` and `performance.now` appear
  // nowhere in this repo.
  const started = Number(process.hrtime.bigint() / 1000000n);

  const encounter = arg('encounter', PRIMARY_ENCOUNTER);
  const enc = encounterById(encounter);

  console.log('# Is placement a decision?');
  console.log('');
  console.log(`Seeds: ${n}, contiguous, ${first}..${first + n - 1}. Every arm ran every seed.`);
  console.log(`Encounter: ${enc.id} - ${enc.name}.`);
  console.log(
    `Bot A places by greedy search over insertion positions, ` +
      `${DEFAULT_LOOKAHEAD.rollouts} rollouts per candidate through the real resolver.`,
  );
  console.log('Bot B places uniformly at random. Card selection is identical in both.');
  console.log('');

  const armA = runArm('A optimal placement', BOTS.lookahead!, seeds, encounter);
  const armB = runArm('B random placement', BOTS.random!, seeds, encounter);
  const armB2 = runArm('B2 random placement (control)', BOTS.randomB!, seeds, encounter);
  const armR = runArm('C append right', BOTS.right!, seeds, encounter);
  const armL = runArm('D append left', BOTS.left!, seeds, encounter);

  const arms = [armA, armB, armB2, armR, armL];
  console.log('| arm | wins | losses | timeouts | win rate | 95% CI | mean rounds |');
  console.log('|---|---|---|---|---|---|---|');
  for (const a of arms) {
    const [lo, hi] = wilson(a.wins, a.n);
    console.log(
      `| ${a.name} | ${a.wins} | ${a.losses} | ${a.timeouts} | ${pct(a.winRate)} | ` +
        `${pct(lo)}..${pct(hi)} | ${a.meanRounds.toFixed(2)} |`,
    );
  }
  console.log('');

  const gapAB = pairedGap(armA, armB);
  const gapControl = pairedGap(armB, armB2);
  const gapAR = pairedGap(armA, armR);

  console.log('| paired comparison | gap | 95% CI | X-only wins | Y-only wins | agreed |');
  console.log('|---|---|---|---|---|---|');
  const row = (label: string, g: ReturnType<typeof pairedGap>): void => {
    console.log(
      `| ${label} | ${pct(g.gap)} | ${pct(g.ci95[0])}..${pct(g.ci95[1])} | ` +
        `${g.aWonBLost} | ${g.bWonALost} | ${g.agreed} |`,
    );
  };
  row('A optimal - B random', gapAB);
  row('B random - B2 random (noise floor)', gapControl);
  row('A optimal - C append right', gapAR);
  console.log('');

  // The same measurement across three difficulty points. A win-rate gap is
  // squeezed by the floor and the ceiling, so a single operating point cannot
  // say whether the gap is real or an artifact of where the dial was set.
  const sweepSeeds = seeds.slice(0, Math.min(seeds.length, Number.parseInt(arg('sweep-seeds', '4000'), 10)));
  console.log(`## The same measurement across difficulty (${sweepSeeds.length} seeds each)`);
  console.log('');
  console.log('| encounter | A optimal | B random | gap | 95% CI | noise floor (B - B2) |');
  console.log('|---|---|---|---|---|---|');
  for (const e of ENCOUNTERS) {
    const a = runArm('A', BOTS.lookahead!, sweepSeeds, e.id);
    const b = runArm('B', BOTS.random!, sweepSeeds, e.id);
    const b2 = runArm('B2', BOTS.randomB!, sweepSeeds, e.id);
    const g = pairedGap(a, b);
    const c = pairedGap(b, b2);
    console.log(
      `| ${e.id} | ${pct(a.winRate)} | ${pct(b.winRate)} | ${pct(g.gap)} | ` +
        `${pct(g.ci95[0])}..${pct(g.ci95[1])} | ${pct(c.gap)} |`,
    );
  }
  console.log('');

  // The negative control. Strip Relay, Ward and Wake - every trait that reads
  // a neighbour - and run the identical comparison. What is left that placement
  // can still touch is act order alone: who swings before the last enemy Guard
  // dies. If the gap does not shrink here, the headline number is not measuring
  // the cascade and should not be believed.
  console.log(`## Negative control: the same cards with the cascade removed (${sweepSeeds.length} seeds each)`);
  console.log('');
  console.log('Run at every difficulty, because a gap shrinks near a floor for');
  console.log('reasons that have nothing to do with the cascade.');
  console.log('');
  console.log('| encounter | card set | A optimal | B random | gap | 95% CI |');
  console.log('|---|---|---|---|---|---|');
  for (const e of ENCOUNTERS) {
    for (const cascade of [true, false]) {
      const a = runArm('A', BOTS.lookahead!, sweepSeeds, e.id, cascade);
      const b = runArm('B', BOTS.random!, sweepSeeds, e.id, cascade);
      const g = pairedGap(a, b);
      console.log(
        `| ${e.id} | ${cascade ? 'Relay/Ward/Wake intact' : 'cascade stripped'} | ` +
          `${pct(a.winRate)} | ${pct(b.winRate)} | ${pct(g.gap)} | ` +
          `${pct(g.ci95[0])}..${pct(g.ci95[1])} |`,
      );
    }
  }
  console.log('');

  // Bot A searches greedily, one card at a time. If exhaustive search over the
  // whole product of insertion positions found a materially better arrangement,
  // the headline gap would be an understatement and the bot would be the bound.
  const searchN = Math.min(seeds.length, Number.parseInt(arg('search-check', '600'), 10));
  if (searchN > 0) {
    const s = seeds.slice(0, searchN);
    const greedy = runArm('greedy', BOTS.lookahead!, s, encounter);
    const exhaustive = runArm('exhaustive', BOTS.lookaheadExhaustive!, s, encounter);
    const g = pairedGap(exhaustive, greedy);
    console.log(`## Is greedy search leaving anything on the table? (${searchN} seeds)`);
    console.log('');
    console.log(
      `- greedy ${pct(greedy.winRate)}, exhaustive ${pct(exhaustive.winRate)}, ` +
        `exhaustive - greedy ${pct(g.gap)} (CI ${pct(g.ci95[0])}..${pct(g.ci95[1])}).`,
    );
    console.log('');
  }

  const same = checkSameCards(armA, armB);
  const det = checkDeterminism(seeds.slice(0, Math.min(40, seeds.length)), 3);

  console.log('## Instrument checks');
  console.log('');
  console.log(`- Seed population: ${n} contiguous seeds ${first}..${first + n - 1}, both arms.`);
  console.log(
    `- Same cards, same rounds: ${same.ok ? 'PASS' : 'FAIL'} over ${same.roundsCompared} ` +
      `compared rounds${same.ok ? '' : `; first mismatch: ${same.mismatches[0]}`}.`,
  );
  console.log(
    `- Placement actually differed: ${same.placementsDiffered}/${same.placementOpportunities} ` +
      `placed cards went to a different slot in the two arms ` +
      `(${pct(same.placementsDiffered / Math.max(1, same.placementOpportunities))}).`,
  );
  console.log(
    `- Determinism: ${det.stable ? 'PASS' : 'FAIL'} over ` +
      `${Math.min(40, seeds.length)} seeds x 3 runs; replay from the action list ` +
      `${det.replayStable ? 'PASS' : 'FAIL'}; ${det.distinctHashes} distinct final hashes ` +
      `across those seeds (a constant hash would pass determinism and mean nothing).`,
  );
  if (det.detail.length > 0) {
    for (const d of det.detail.slice(0, 5)) console.log(`  - ${d}`);
  }
  console.log(
    `- Control reproduces: two random-placement bots on different placement streams ` +
      `differ by ${pct(gapControl.gap)} (CI ${pct(gapControl.ci95[0])}..${pct(gapControl.ci95[1])}).`,
  );

  const elapsed = Number(process.hrtime.bigint() / 1000000n) - started;
  console.log('');
  console.log(`Elapsed: ${(elapsed / 1000).toFixed(1)}s`);

  if (has('verify')) {
    if (!same.ok) {
      console.error('\nFAIL: the two arms did not play the same cards. The gap is meaningless.');
      process.exitCode = 1;
    }
    if (!det.stable || !det.replayStable) {
      console.error('\nFAIL: determinism check failed.');
      process.exitCode = 1;
    }
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
