// The run-level measurement: how far does a run get, and where does it stop?
//
// `src/sim/measure.ts` answers one question about one fight. This answers the
// three `ARCHITECTURE.md` names for a run - **win rate per act**, **where runs
// end**, and run length - plus the structural checks that say whether any of
// those numbers mean anything.
//
// Methodology, stated because getting it wrong makes the numbers worthless:
//
//   1. Every arm runs the same contiguous seed set, so comparisons are paired.
//   2. A route style and a placement style are separate dials. The routing
//      comparison holds placement fixed, so a gap between two route styles is
//      about routing and not about how the fights were played.
//   3. `--verify` re-checks determinism, replay, map structure and stream
//      separation against actual runs rather than trusting the argument for
//      them, and exits non-zero on any failure.
//
// **The bound on every win rate below.** A bot's run win rate is evidence about
// the bot. The greedy router is a hand-written heuristic reading Health and
// node type, and the placement bot is `bots.ts`'s greedy search; neither is a
// person. What these numbers support is "a run is winnable and losable at this
// content, and it ends in a spread of places", which is what makes the run
// measurable at all. They do not say the run is fun, well paced, or thirty
// minutes long.

import { pathToFileURL } from 'node:url';

import { runFight } from '../engine/fight.ts';
import { makeRng, nextU32 } from '../engine/rng.ts';
import { heroOf } from '../engine/state.ts';
import { RUN_CONTENT } from '../run/content.ts';
import { makeDeckCard, runPool } from '../run/deck.ts';
import { hashMaps, hashRun } from '../run/hash.ts';
import { branchingTypes, mapProblems } from '../run/map.ts';
import { drawDistinctCards, fightSeedFor } from '../run/nodes.ts';
import { replayRun, runRun, startRun } from '../run/run.ts';
import type {
  NodeType,
  RunContent,
  RunEncounter,
  RunEnding,
  RunLog,
  RunResult,
  RunState,
} from '../run/types.ts';
import { DEFAULT_LOOKAHEAD, lookaheadPlacer } from './bots.ts';
import { wilson } from './measure.ts';
import { type PlacementStyle, type RouteStyle, makeRunAgent } from './runbots.ts';

/**
 * Paired difference of two 0/1 series and its 95% interval.
 *
 * The same statistic `measure.ts`'s `pairedGap` computes, over win/loss series
 * rather than over its `ArmResult`. Written here rather than casting a run arm
 * into that shape: a cast that satisfies a type by lying about it is exactly
 * the sort of thing that survives review and then measures the wrong thing.
 */
export function pairedWinGap(
  a: readonly number[],
  b: readonly number[],
): { gap: number; ci95: [number, number] } {
  if (a.length !== b.length) {
    throw new Error(
      `runmeasure: a paired comparison needs two equal-length series, got ${a.length} and ` +
        `${b.length}. Both arms must run the same seeds.`,
    );
  }
  const n = a.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += a[i]! - b[i]!;
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]! - mean;
    varSum += d * d;
  }
  const sd = Math.sqrt(varSum / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  return { gap: mean, ci95: [mean - 1.96 * se, mean + 1.96 * se] };
}

export type RunOutcome = {
  readonly seed: number;
  readonly result: RunResult;
  readonly ending: RunEnding | null;
  /** Bosses beaten. 3 is a won run. */
  readonly actsCleared: number;
  /** Highest act the run reached, 0-based. */
  readonly reachedAct: number;
  readonly nodes: number;
  readonly fights: number;
  readonly rounds: number;
  readonly deckSize: number;
  readonly forges: number;
  readonly gold: number;
  readonly heroHealth: number;
  readonly hash: string;
  readonly log: RunLog;
};

export type RunArm = {
  readonly name: string;
  readonly route: RouteStyle;
  readonly placement: PlacementStyle;
  readonly outcomes: RunOutcome[];
};

function outcomeOf(content: RunContent, seed: number, run: RunState, log: RunLog): RunOutcome {
  return {
    seed,
    result: run.result,
    ending: run.ending,
    actsCleared: Math.min(run.act, content.acts.length),
    reachedAct: Math.min(run.act, content.acts.length - 1),
    nodes: run.nodesVisited,
    fights: run.fightsFought,
    rounds: run.roundsFought,
    deckSize: run.deck.length,
    forges: run.forgesApplied,
    gold: run.gold,
    heroHealth: run.hero.health,
    hash: hashRun(run),
    log,
  };
}

export function runArm(
  name: string,
  route: RouteStyle,
  placement: PlacementStyle,
  seeds: readonly number[],
  content: RunContent = RUN_CONTENT,
): RunArm {
  const outcomes: RunOutcome[] = [];
  for (const seed of seeds) {
    const agent = makeRunAgent({ route, placement, seed });
    const { run, log } = runRun(content, seed, agent);
    outcomes.push(outcomeOf(content, seed, run, log));
  }
  return { name, route, placement, outcomes };
}

// ---------------------------------------------------------------------------
// The three reports the architecture asks for
// ---------------------------------------------------------------------------

export type ActProgress = {
  readonly act: number;
  readonly entered: number;
  readonly cleared: number;
  readonly rate: number;
  readonly ci95: [number, number];
};

/**
 * Win rate per act: of the runs that *entered* act k, how many beat its boss.
 *
 * Conditioned on entry rather than on the whole population, because an
 * unconditional act-3 rate mostly reports how many runs got there and hides
 * whether act 3 itself is hard. `ARCHITECTURE.md` names this metric as the one
 * that catches "difficulty spikes and dead acts", and a spike is only visible
 * against the population that met it.
 */
export function actProgress(arm: RunArm, acts: number): ActProgress[] {
  const out: ActProgress[] = [];
  for (let a = 0; a < acts; a++) {
    let entered = 0;
    let cleared = 0;
    for (const o of arm.outcomes) {
      if (o.actsCleared >= a) entered++;
      if (o.actsCleared >= a + 1) cleared++;
    }
    out.push({
      act: a,
      entered,
      cleared,
      rate: entered === 0 ? 0 : cleared / entered,
      ci95: wilson(cleared, entered),
    });
  }
  return out;
}

export type EndingBucket = {
  readonly act: number;
  readonly cause: RunEnding['cause'];
  readonly nodeType: NodeType;
  count: number;
};

/** Where runs end, by act, node type and cause. Sorted for a stable report. */
export function endings(arm: RunArm): EndingBucket[] {
  const map = new Map<string, EndingBucket>();
  for (const o of arm.outcomes) {
    const e = o.ending;
    const key =
      e === null ? 'none' : `${e.act}|${e.cause}|${e.nodeType}`;
    const existing = map.get(key);
    if (existing !== undefined) {
      existing.count++;
      continue;
    }
    map.set(key, {
      act: e === null ? -1 : e.act,
      cause: e === null ? 'killed' : e.cause,
      nodeType: e === null ? 'fight' : e.nodeType,
      count: 1,
    });
  }
  return [...map.values()].sort(
    (x, y) => x.act - y.act || x.cause.localeCompare(y.cause) || x.nodeType.localeCompare(y.nodeType),
  );
}

export type LengthReport = {
  readonly meanFights: number;
  readonly medianFights: number;
  readonly p10Fights: number;
  readonly p90Fights: number;
  readonly meanNodes: number;
  readonly meanRoundsPerFight: number;
  readonly meanFightsWon: number;
};

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i]!;
}

/**
 * Run length in fights, which is the only handle a headless measurement has on
 * the design's 30-minute target. Minutes are not measurable here; fights and
 * the mean rounds inside them are, and they are what minutes would be made of.
 */
export function lengthReport(arm: RunArm, wonOnly: boolean = false): LengthReport {
  const pool = wonOnly ? arm.outcomes.filter((o) => o.result === 'won') : arm.outcomes;
  const n = Math.max(1, pool.length);
  const fights = pool.map((o) => o.fights).sort((a, b) => a - b);
  let rounds = 0;
  let fightTotal = 0;
  let nodes = 0;
  for (const o of pool) {
    rounds += o.rounds;
    fightTotal += o.fights;
    nodes += o.nodes;
  }
  const won = arm.outcomes.filter((o) => o.result === 'won');
  let wonFights = 0;
  for (const o of won) wonFights += o.fights;
  return {
    meanFights: fightTotal / n,
    medianFights: quantile(fights, 0.5),
    p10Fights: quantile(fights, 0.1),
    p90Fights: quantile(fights, 0.9),
    meanNodes: nodes / n,
    meanRoundsPerFight: fightTotal === 0 ? 0 : rounds / fightTotal,
    meanFightsWon: won.length === 0 ? 0 : wonFights / won.length,
  };
}

// ---------------------------------------------------------------------------
// Instrument checks
// ---------------------------------------------------------------------------

export type RunInstrument = {
  readonly determinismStable: boolean;
  readonly replayStable: boolean;
  readonly distinctHashes: number;
  readonly mapProblems: string[];
  readonly actsWithNoBranching: number;
  readonly mapsChecked: number;
  readonly meanBranchingTypes: number;
  readonly streamSeparation: string[];
  readonly sigilsGranted: number;
  readonly detail: string[];
};

/**
 * Determinism, replay, and the map's own structure, checked against real runs.
 *
 * `trials` reruns each seed from scratch with a fresh agent, which is also what
 * pins the agents as stateless: a router that carried a generator between runs
 * would answer the second rerun differently and the hash would move.
 */
export function checkRuns(
  seeds: readonly number[],
  trials: number,
  route: RouteStyle,
  placement: PlacementStyle,
  content: RunContent = RUN_CONTENT,
): RunInstrument {
  const detail: string[] = [];
  const hashes = new Set<string>();
  const problems: string[] = [];
  let determinismStable = true;
  let replayStable = true;
  let noBranching = 0;
  let mapsChecked = 0;
  let branchingTotal = 0;
  let sigilsGranted = 0;

  for (const seed of seeds) {
    const first = runRun(content, seed, makeRunAgent({ route, placement, seed }));
    const firstHash = hashRun(first.run);
    hashes.add(firstHash);
    sigilsGranted += first.run.sigils.length;

    for (let t = 1; t < trials; t++) {
      const again = runRun(content, seed, makeRunAgent({ route, placement, seed }));
      if (hashRun(again.run) !== firstHash) {
        determinismStable = false;
        detail.push(`seed ${seed}: rerun ${t} produced a different final run hash`);
      }
    }

    const replayed = replayRun(content, first.log);
    if (hashRun(replayed) !== firstHash) {
      replayStable = false;
      detail.push(`seed ${seed}: replay from the choice list diverged from the live run`);
    }

    for (const map of first.run.maps) {
      mapsChecked++;
      const found = mapProblems(map);
      for (const p of found) problems.push(`seed ${seed} act ${map.act + 1}: ${p}`);
      const branching = branchingTypes(map);
      branchingTotal += branching;
      if (branching === 0) {
        noBranching++;
        problems.push(
          `seed ${seed} act ${map.act + 1}: every path carries the same node types, so the ` +
            `branching is decorative`,
        );
      }
    }
  }

  return {
    determinismStable,
    replayStable,
    distinctHashes: hashes.size,
    mapProblems: problems,
    actsWithNoBranching: noBranching,
    mapsChecked,
    meanBranchingTypes: mapsChecked === 0 ? 0 : branchingTotal / mapsChecked,
    streamSeparation: checkStreamSeparation(seeds, content),
    sigilsGranted,
    detail,
  };
}

/**
 * The stream-separation invariant, stated as two checks a route change would
 * break if the run generator ever leaked into a fight:
 *
 *   1. Advancing the run generator by an arbitrary number of draws - which is
 *      exactly what taking a shop instead of a forge does - changes no fight
 *      seed anywhere on the map.
 *   2. Two runs of the same seed that route differently agree on the seed of
 *      every node they both visit.
 *
 * The second is the one that would catch a fight seeded off `run.rng` directly;
 * the first also catches a fight seeded off a *derivation* of the generator's
 * position, which the second would miss on a pair of routes that happen to
 * consume the same number of draws.
 */
export function checkStreamSeparation(
  seeds: readonly number[],
  content: RunContent = RUN_CONTENT,
): string[] {
  const problems: string[] = [];

  for (const seed of seeds) {
    const clean = startRun(content, seed);
    const perturbed = startRun(content, seed);
    // Burn draws on the run stream, standing in for a different route.
    for (let i = 0; i < 37; i++) nextU32(perturbed.rng);
    perturbed.gold += 999;
    perturbed.hero.health = Math.max(1, perturbed.hero.health - 7);

    if (hashMaps(clean) !== hashMaps(perturbed)) {
      problems.push(`seed ${seed}: the maps are not a function of the seed alone`);
    }

    for (const map of clean.maps) {
      clean.act = map.act;
      perturbed.act = map.act;
      for (const node of map.nodes) {
        if (node.type !== 'fight' && node.type !== 'elite' && node.type !== 'boss') continue;
        if (fightSeedFor(clean, node) !== fightSeedFor(perturbed, node)) {
          problems.push(
            `seed ${seed} act ${map.act + 1} node ${node.id}: the fight seed moved when the ` +
              `run stream did, so a routing choice can perturb a fight's internals`,
          );
        }
      }
    }
  }

  return problems;
}

/**
 * Fight seeds agreed on by two differently-routed runs of the same seed.
 *
 * Returns the number of shared nodes checked and the number that disagreed.
 * Zero shared nodes would make this vacuous, so the count is reported.
 */
export function checkRouteAgreement(
  seeds: readonly number[],
  content: RunContent = RUN_CONTENT,
): { shared: number; disagreed: number } {
  let shared = 0;
  let disagreed = 0;
  for (const seed of seeds) {
    const a = runRun(content, seed, makeRunAgent({ route: 'greedy', placement: 'right', seed }));
    const b = runRun(content, seed, makeRunAgent({ route: 'random', placement: 'right', seed }));
    const seen = new Map<string, number>();
    for (const rec of a.log.nodes) {
      if (rec.fightSeed !== null) seen.set(`${rec.act}:${rec.nodeId}`, rec.fightSeed);
    }
    for (const rec of b.log.nodes) {
      if (rec.fightSeed === null) continue;
      const hit = seen.get(`${rec.act}:${rec.nodeId}`);
      if (hit === undefined) continue;
      shared++;
      if (hit !== rec.fightSeed) disagreed++;
    }
  }
  return { shared, disagreed };
}

// ---------------------------------------------------------------------------
// Encounter calibration
// ---------------------------------------------------------------------------

export type EncounterReport = {
  readonly act: number;
  readonly kind: 'fight' | 'elite' | 'boss';
  readonly id: string;
  readonly name: string;
  readonly deckSize: number;
  readonly winRate: number;
  readonly timeouts: number;
  readonly meanRounds: number;
  /** Mean Health the hero lost in the fights it won. The attrition dial. */
  readonly healthLostOnWin: number;
};

/**
 * Every shipped encounter, fought on its own at full Health with the deck the
 * run is expected to hold when it arrives there.
 *
 * This exists so the win rates written into `src/run/content.ts`'s comments are
 * reproducible from a clean checkout rather than being a claim about a scratch
 * script that no longer exists. It is the instrument the act curve was tuned
 * on, and it is where to look first when a content change moves the run.
 *
 * The bound: an encounter in isolation is not an encounter in a run. A run
 * arrives hurt, and with whatever deck its own rewards gave it, so these are
 * upper bounds on the same fight in context. `deckSizeFor` is a stand-in for
 * the real distribution and is stated rather than hidden.
 */
export function calibrateEncounters(
  seeds: readonly number[],
  content: RunContent = RUN_CONTENT,
): EncounterReport[] {
  const out: EncounterReport[] = [];
  for (const act of content.acts) {
    const deck = calibrationDeck(content, act.act);
    const entries: { kind: EncounterReport['kind']; enc: RunEncounter }[] = [
      ...act.fights.map((enc) => ({ kind: 'fight' as const, enc })),
      ...act.elites.map((enc) => ({ kind: 'elite' as const, enc })),
      { kind: 'boss' as const, enc: act.boss },
    ];
    for (const { kind, enc } of entries) {
      let wins = 0;
      let timeouts = 0;
      let rounds = 0;
      let lostOnWin = 0;
      for (const seed of seeds) {
        const instances = deck.map((id, i) => makeDeckCard(id, i));
        const run = runFight(
          {
            seed,
            pool: runPool(content.pool, instances),
            playerDeck: instances.map((d) => d.instanceId),
            enemyDeck: enc.enemyDeck,
            enemyOpening: enc.opening,
            playerHero: content.hero,
            enemyHero: enc.enemyHero,
            maxRounds: content.maxRounds,
          },
          lookaheadPlacer(DEFAULT_LOOKAHEAD),
        );
        const left = Math.max(0, heroOf(run.fight.state, 'player').health);
        if (run.fight.result === 'playerWin') {
          wins++;
          lostOnWin += content.hero.health - left;
        }
        if (run.fight.result === 'timeout') timeouts++;
        rounds += run.fight.round;
      }
      out.push({
        act: act.act,
        kind,
        id: enc.id,
        name: enc.name,
        deckSize: deck.length,
        winRate: wins / seeds.length,
        timeouts,
        meanRounds: rounds / seeds.length,
        healthLostOnWin: wins === 0 ? 0 : lostOnWin / wins,
      });
    }
  }
  return out;
}

/**
 * The deck an act is calibrated against: the starting deck plus four cards an
 * act, drawn from the reward table on a fixed stream.
 *
 * A stand-in for the real distribution rather than a measurement of it. The
 * run's own report prints the mean end deck size, which is what to check it
 * against when the reward economy changes.
 */
function calibrationDeck(content: RunContent, act: number): string[] {
  const deck = content.startingDeck.slice();
  const rng = makeRng(0x0ca11b, 'calibration-deck');
  for (let i = 0; i < 4 * act; i++) {
    const drawn = drawDistinctCards(rng, content.rewards, 1)[0];
    if (drawn !== undefined) deck.push(drawn);
  }
  return deck;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Is this seed window measuring anything at all?
 *
 * A run that is never won and a run that is never lost both produce a clean,
 * stable, perfectly deterministic report that cannot detect any change to the
 * content. This is the run's counterpart to `measure.ts`'s "a constant hash
 * would pass determinism and mean nothing": the outcome distribution must be
 * non-degenerate, or the whole measurement is a fixed point.
 *
 * Deliberately *not* a win-rate band. A band is a balance claim, and a balance
 * claim about a hand-written router is a claim about the router; tightening one
 * here would make the gate go red on a content change that improved the game.
 * What is gated is that the instrument can still see a difference.
 */
export function degeneracy(arm: RunArm): string[] {
  const failures: string[] = [];
  const n = arm.outcomes.length;
  const wins = arm.outcomes.filter((o) => o.result === 'won').length;
  if (wins === 0) {
    failures.push(
      `no run in ${n} seeds was won, so this seed window cannot detect a change that makes ` +
        `the run easier and every "win rate per act" below act 1 is a floor reading. Either ` +
        `the content is unwinnable by this bot or the seed window is too small.`,
    );
  }
  if (wins === n) {
    failures.push(
      `every run in ${n} seeds was won, so this seed window cannot detect a change that makes ` +
        `the run harder.`,
    );
  }
  const distinctEndAct = new Set(arm.outcomes.map((o) => o.actsCleared)).size;
  if (distinctEndAct < 2) {
    failures.push(
      `every run in ${n} seeds ended after clearing the same number of acts ` +
        `(${arm.outcomes[0]?.actsCleared ?? 0}), so "where runs end" carries no information.`,
    );
  }
  return failures;
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

const pct = (x: number): string => `${(100 * x).toFixed(2)}%`;

function main(): void {
  const n = Number.parseInt(arg('seeds', '400'), 10);
  const first = Number.parseInt(arg('first-seed', '1'), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--seeds must be a positive integer, got "${arg('seeds', '400')}"`);
  }
  const seeds: number[] = [];
  for (let i = 0; i < n; i++) seeds.push(first + i);

  // Wall clock only for the elapsed line. Nothing in the run reads a clock.
  const started = Number(process.hrtime.bigint() / 1000000n);
  const content = RUN_CONTENT;
  const acts = content.acts.length;

  console.log('# How far does a run get, and where does it stop?');
  console.log('');
  console.log(`Seeds: ${n}, contiguous, ${first}..${first + n - 1}. Every arm ran every seed.`);
  console.log(
    `Content: ${acts} acts, ${content.mapShape.rows.length} rows an act, ` +
      `hero ${content.hero.health} Health, ${content.startingDeck.length}-card starting deck, ` +
      `max ${content.maxRounds} rounds a fight.`,
  );
  console.log(
    'A route style and a placement style are separate dials; the routing comparison holds ' +
      'placement fixed.',
  );
  console.log('');

  const armGL = runArm('greedy route / search placement', 'greedy', 'lookahead', seeds, content);
  const armRL = runArm('random route / search placement', 'random', 'lookahead', seeds, content);
  const armGR = runArm('greedy route / right placement', 'greedy', 'right', seeds, content);
  const armRR = runArm('random route / right placement', 'random', 'right', seeds, content);
  const arms = [armGL, armRL, armGR, armRR];

  console.log('| arm | runs won | win rate | 95% CI | mean acts cleared | mean fights | mean rounds/fight | mean end deck |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const a of arms) {
    const wins = a.outcomes.filter((o) => o.result === 'won').length;
    const [lo, hi] = wilson(wins, a.outcomes.length);
    const len = lengthReport(a);
    let clearedTotal = 0;
    let deckTotal = 0;
    for (const o of a.outcomes) {
      clearedTotal += o.actsCleared;
      deckTotal += o.deckSize;
    }
    console.log(
      `| ${a.name} | ${wins}/${a.outcomes.length} | ${pct(wins / a.outcomes.length)} | ` +
        `${pct(lo)}..${pct(hi)} | ${(clearedTotal / a.outcomes.length).toFixed(2)} | ` +
        `${len.meanFights.toFixed(2)} | ${len.meanRoundsPerFight.toFixed(2)} | ` +
        `${(deckTotal / a.outcomes.length).toFixed(1)} |`,
    );
  }
  console.log('');

  console.log('## Win rate per act');
  console.log('');
  console.log('Conditioned on entering the act, so a spike is visible against the population that met it.');
  console.log('');
  console.log('| arm | ' + Array.from({ length: acts }, (_, a) => `act ${a + 1}`).join(' | ') + ' |');
  console.log('|---|' + Array.from({ length: acts }, () => '---').join('|') + '|');
  for (const a of arms) {
    const prog = actProgress(a, acts);
    console.log(
      `| ${a.name} | ` +
        prog
          .map(
            (p) =>
              `${pct(p.rate)} (${p.cleared}/${p.entered}, ${pct(p.ci95[0])}..${pct(p.ci95[1])})`,
          )
          .join(' | ') +
        ' |',
    );
  }
  console.log('');

  console.log('## Where runs end');
  console.log('');
  console.log(`Arm: ${armGL.name}. One row per (act, cause, node type).`);
  console.log('');
  console.log('| act | cause | node | runs | share |');
  console.log('|---|---|---|---|---|');
  for (const b of endings(armGL)) {
    console.log(
      `| ${b.act + 1} | ${b.cause} | ${b.nodeType} | ${b.count} | ${pct(b.count / n)} |`,
    );
  }
  console.log('');

  console.log('## Run length in fights');
  console.log('');
  console.log('| arm | mean fights | median | p10 | p90 | mean nodes | mean rounds/fight | mean fights in a won run |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const a of arms) {
    const l = lengthReport(a);
    console.log(
      `| ${a.name} | ${l.meanFights.toFixed(2)} | ${l.medianFights} | ${l.p10Fights} | ` +
        `${l.p90Fights} | ${l.meanNodes.toFixed(2)} | ${l.meanRoundsPerFight.toFixed(2)} | ` +
        `${l.meanFightsWon.toFixed(2)} |`,
    );
  }
  console.log('');
  const wonLen = lengthReport(armGL, true);
  console.log(
    `A won run at the strongest arm is ${wonLen.meanFightsWon.toFixed(1)} fights of ` +
      `${wonLen.meanRoundsPerFight.toFixed(1)} rounds across ` +
      `${(acts * content.mapShape.rows.length).toFixed(0)} nodes. Minutes are not measurable ` +
      `headlessly; this is the fight count the 30-minute target has to fit into.`,
  );
  console.log('');

  console.log('## Does the route matter?');
  console.log('');
  console.log('Paired, same seeds, placement held fixed. A bot comparison, so it bounds itself.');
  console.log('');
  const wins = (a: RunArm): number[] => a.outcomes.map((o) => (o.result === 'won' ? 1 : 0));
  const gapSearch = pairedWinGap(wins(armGL), wins(armRL));
  const gapRight = pairedWinGap(wins(armGR), wins(armRR));
  console.log('| placement held at | greedy route | random route | gap | 95% CI |');
  console.log('|---|---|---|---|---|');
  const winRate = (a: RunArm): number =>
    a.outcomes.filter((o) => o.result === 'won').length / a.outcomes.length;
  console.log(
    `| search | ${pct(winRate(armGL))} | ${pct(winRate(armRL))} | ${pct(gapSearch.gap)} | ` +
      `${pct(gapSearch.ci95[0])}..${pct(gapSearch.ci95[1])} |`,
  );
  console.log(
    `| append right | ${pct(winRate(armGR))} | ${pct(winRate(armRR))} | ${pct(gapRight.gap)} | ` +
      `${pct(gapRight.ci95[0])}..${pct(gapRight.ci95[1])} |`,
  );
  console.log('');

  if (has('encounters')) {
    const encSeeds = seeds.slice(0, Math.min(200, n));
    console.log(`## Every shipped encounter on its own (${encSeeds.length} seeds each)`);
    console.log('');
    console.log(
      'The placement bot at full Health, against the deck an act is expected to hold. An ' +
        'encounter in isolation is an upper bound on the same fight in a run, which arrives hurt.',
    );
    console.log('');
    console.log('| act | kind | encounter | deck | win rate | timeouts | mean rounds | Health lost on a win |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const r of calibrateEncounters(encSeeds, content)) {
      console.log(
        `| ${r.act + 1} | ${r.kind} | ${r.name} | ${r.deckSize} | ${pct(r.winRate)} | ` +
          `${r.timeouts} | ${r.meanRounds.toFixed(1)} | ${r.healthLostOnWin.toFixed(1)} |`,
      );
    }
    console.log('');
  }

  const checkSeeds = seeds.slice(0, Math.min(Number.parseInt(arg('check-seeds', '30'), 10), n));
  const inst = checkRuns(checkSeeds, 3, 'greedy', 'lookahead', content);
  const agree = checkRouteAgreement(checkSeeds, content);

  console.log('## Instrument checks');
  console.log('');
  console.log(`- Seed population: ${n} contiguous seeds ${first}..${first + n - 1}, every arm.`);
  console.log(
    `- Run determinism: ${inst.determinismStable ? 'PASS' : 'FAIL'} over ${checkSeeds.length} ` +
      `seeds x 3 runs; replay from the choice list ${inst.replayStable ? 'PASS' : 'FAIL'}; ` +
      `${inst.distinctHashes} distinct final run hashes across those seeds (a constant hash ` +
      `would pass determinism and mean nothing).`,
  );
  console.log(
    `- Map structure: ${inst.mapProblems.length === 0 ? 'PASS' : 'FAIL'} over ${inst.mapsChecked} ` +
      `act maps - reachable both ways, planar, one type per node per row, one boss last.`,
  );
  console.log(
    `- The map is a map: ${inst.actsWithNoBranching === 0 ? 'PASS' : 'FAIL'}; ` +
      `${inst.meanBranchingTypes.toFixed(2)} of 7 node types are decided by the route on an ` +
      `average act map, and ${inst.actsWithNoBranching} map(s) had none.`,
  );
  console.log(
    `- Stream separation: ${inst.streamSeparation.length === 0 ? 'PASS' : 'FAIL'}; burning 37 ` +
      `draws on the run generator moved ` +
      `${inst.streamSeparation.length === 0 ? 'no fight seed and no map' : `${inst.streamSeparation.length} fight seed(s) or map(s)`}` +
      `. Two differently-routed runs agreed on ` +
      `${agree.shared - agree.disagreed}/${agree.shared} shared fight seeds.`,
  );
  console.log(
    `- Sigils stay out of scope: ${inst.sigilsGranted === 0 ? 'PASS' : 'FAIL'}; ` +
      `${inst.sigilsGranted} granted across ${checkSeeds.length} runs.`,
  );
  const degen = degeneracy(armGL);
  console.log(
    `- The instrument can see a difference: ${degen.length === 0 ? 'PASS' : 'FAIL'}; the ` +
      `strongest arm won ${armGL.outcomes.filter((o) => o.result === 'won').length}/${n} and ` +
      `runs ended after ${new Set(armGL.outcomes.map((o) => o.actsCleared)).size} distinct act ` +
      `counts. ${has('verify') ? 'Enforced: --verify exits non-zero.' : 'Reported only; --verify enforces it.'}`,
  );
  for (const d of inst.detail.slice(0, 5)) console.log(`  - ${d}`);
  for (const p of inst.mapProblems.slice(0, 5)) console.log(`  - ${p}`);
  for (const p of inst.streamSeparation.slice(0, 5)) console.log(`  - ${p}`);

  const elapsed = Number(process.hrtime.bigint() / 1000000n) - started;
  console.log('');
  console.log(`Elapsed: ${(elapsed / 1000).toFixed(1)}s`);

  if (has('verify')) {
    // Bound -- what a green run here does and does not prove:
    //
    //   Proves  that over THIS seed window, with THESE agents and THIS content,
    //           a whole run is a pure function of its seed and its choice list;
    //           that the run generator cannot reach a fight; that every act map
    //           is structurally sound and offers routing choices that change
    //           what a path contains; and that the outcome distribution is not
    //           a fixed point.
    //   Bound   to the shipped `RUN_CONTENT`. Nothing here says another content
    //           set generates sound maps, only that this one does.
    //   Bound   to bots. Every win rate printed above is evidence about the
    //           router and the placement bot, not about a person, and none of
    //           them is gated for that reason.
    //   Misses  a balance drift that keeps the run winnable and losable. This
    //           gate catches a run that has become a fixed point, not one that
    //           has quietly got harder; the printed tables are for that.
    const failures: string[] = [];
    if (!inst.determinismStable) failures.push('run determinism broke');
    if (!inst.replayStable) failures.push('a run did not replay from its own choice list');
    if (inst.distinctHashes <= 1) {
      failures.push(
        `only ${inst.distinctHashes} distinct run hash across ${checkSeeds.length} seeds; a ` +
          `constant hash passes determinism and measures nothing`,
      );
    }
    if (inst.mapProblems.length > 0) {
      failures.push(`${inst.mapProblems.length} map structure problem(s): ${inst.mapProblems[0]}`);
    }
    if (inst.actsWithNoBranching > 0) {
      failures.push(
        `${inst.actsWithNoBranching} act map(s) where every path carries the same node types - ` +
          `a map where every path is equivalent is not a map`,
      );
    }
    if (inst.streamSeparation.length > 0) {
      failures.push(`stream separation broke: ${inst.streamSeparation[0]}`);
    }
    if (agree.shared === 0) {
      failures.push(
        'no two differently-routed runs shared a fight node, so the route-agreement check was ' +
          'vacuous and cannot be reported as a pass',
      );
    }
    if (agree.disagreed > 0) {
      failures.push(
        `${agree.disagreed}/${agree.shared} shared fight nodes were seeded differently by two ` +
          `routes through the same seed`,
      );
    }
    if (inst.sigilsGranted > 0) {
      failures.push(
        `${inst.sigilsGranted} sigil(s) were granted; sigils are out of scope for this unit and ` +
          `the seam must stay inert until the unit that owns them lands`,
      );
    }
    for (const d of degen) failures.push(d);

    if (failures.length > 0) {
      console.error('');
      console.error(`FAIL: the run measurement is not trustworthy over ${n} seeds.`);
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    }
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
