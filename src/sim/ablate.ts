// The per-trait ablation: what is each cascade trait actually worth?
//
// `npm run measure` answers "is placement a decision" at four preset
// encounters. It cannot answer "which trait carries it", because removing a
// trait also changes how hard the fight is, and a win-rate gap is squeezed by
// the floor and the ceiling. Comparing an ablated deck's gap against the intact
// deck's gap at the same preset encounter compares two different operating
// points and reads as a finding.
//
// So this file does what the 2026-09-06 ablation did and could not be re-run,
// because it lived in untracked scratch under `.probe/`:
//
//   1. Treat the enemy hero's Health as a **continuous** difficulty dial rather
//      than picking whichever of four presets lands nearest.
//   2. For each card set, calibrate on Bot B alone - the random-placement arm -
//      to find the two Health values that bracket a chosen baseline win rate.
//   3. Run A, B and B2 at those two Health values, on the same seeds, and
//      report the gap at each. The pair brackets the matched-baseline gap and
//      shows how much of it is the operating point.
//
// The calibration arm is Bot B and never Bot A, because Bot A is the arm under
// test: calibrating on it would tune the difficulty until the thing being
// measured had a chosen value.
//
// Bound this probe carries, stated where a green run cannot hide it: every
// number here is about bots, about the shipped deck, and about the seed window
// named in the header of the run. Bot B places uniformly at random and no human
// does. Nothing here says the game is fun.

import { pathToFileURL } from 'node:url';

import { type FightSetup, runFight } from '../engine/fight.ts';
import type { HeroSpec, Trait, UnitCard } from '../engine/state.ts';
import {
  CARD_POOL,
  ENEMY_DECK,
  ENERGY_PER_TURN,
  ENEMY_CARDS,
  HAND_SIZE,
  MAX_ROUNDS,
  PLAYER_CARDS,
  PLAYER_DECK,
  PLAYER_HERO,
  encounterById,
} from '../content/cards.ts';
import { BOTS, pairedGap, type ArmResult } from './measure.ts';

/** Every trait an ablation may strip. Guard is not one: it reads no neighbour. */
export const ABLATABLE: readonly Trait[] = ['relay', 'wake'];

/**
 * The card set with `strip` removed from every card, and the deck that goes
 * with it.
 *
 * Ids are suffixed so the ablated Squire is a different card from the real one
 * and the two can never be confused in a pool. That matters for more than
 * tidiness: `hashFight` serialises an entity's trait list, so a hash comparison
 * across an ablation measures whether the ablated card was alive at the end
 * rather than whether the trait did anything.
 */
export function ablatedPool(strip: readonly Trait[]): {
  card: (id: string) => UnitCard;
  deck: string[];
  label: string;
} {
  const suffix = strip.length === 0 ? '_ab0' : `_ab${strip.join('')}`;
  const byId = new Map<string, UnitCard>();
  for (const c of PLAYER_CARDS) {
    byId.set(`${c.id}${suffix}`, {
      ...c,
      id: `${c.id}${suffix}`,
      traits: c.traits.filter((t) => !strip.includes(t)),
    });
  }
  for (const c of ENEMY_CARDS) byId.set(c.id, c);
  return {
    card(id: string): UnitCard {
      const hit = byId.get(id);
      if (hit === undefined) {
        throw new Error(
          `ablate: no card "${id}" in the ${suffix} pool. Every player card in an ablated ` +
            `pool carries that suffix; enemy cards keep their own ids.`,
        );
      }
      return hit;
    },
    deck: PLAYER_DECK.map((id) => `${id}${suffix}`),
    label: strip.length === 0 ? 'intact' : `no ${strip.join(' + ')}`,
  };
}

function setupWith(
  seed: number,
  pool: ReturnType<typeof ablatedPool>,
  enemyHealth: number,
  opening: readonly string[],
): FightSetup {
  const enemyHero: HeroSpec = { name: 'Warchief', health: enemyHealth, power: 2, armour: 0 };
  return {
    seed,
    pool: {
      card: pool.card,
      energyPerTurn: ENERGY_PER_TURN,
      handSize: HAND_SIZE,
      castable: CARD_POOL.castable ?? (() => null),
    },
    playerDeck: pool.deck,
    enemyDeck: ENEMY_DECK,
    enemyOpening: opening,
    playerHero: PLAYER_HERO,
    enemyHero,
    maxRounds: MAX_ROUNDS,
  };
}

function arm(
  name: string,
  bot: keyof typeof BOTS,
  seeds: readonly number[],
  pool: ReturnType<typeof ablatedPool>,
  enemyHealth: number,
  opening: readonly string[],
): ArmResult {
  let wins = 0;
  const outcomes: number[] = [];
  for (const seed of seeds) {
    const run = runFight(setupWith(seed, pool, enemyHealth, opening), BOTS[bot]!(seed));
    const won = run.fight.result === 'playerWin';
    if (won) wins++;
    outcomes.push(won ? 1 : 0);
  }
  return {
    name,
    wins,
    losses: seeds.length - wins,
    timeouts: 0,
    n: seeds.length,
    winRate: wins / seeds.length,
    meanRounds: 0,
    outcomes,
    logs: [],
  };
}

/**
 * The two enemy-hero Health values bracketing `target` on Bot B, found by
 * bisection over an integer dial.
 *
 * Win rate falls as Health rises, so the search is monotone in expectation but
 * not exactly: it is a sampled win rate over `seeds`, and two adjacent Health
 * values can swap by a fraction of a point. Bisection is still the right tool -
 * it converges to a *pair* of adjacent values and both are reported, so a local
 * inversion shows up as a bracket rather than being hidden by a single answer.
 */
export function bracket(
  pool: ReturnType<typeof ablatedPool>,
  seeds: readonly number[],
  opening: readonly string[],
  target: number,
  lo: number,
  hi: number,
): { lo: number; hi: number; loRate: number; hiRate: number } {
  let a = lo;
  let b = hi;
  let aRate = arm('cal', 'random', seeds, pool, a, opening).winRate;
  let bRate = arm('cal', 'random', seeds, pool, b, opening).winRate;
  while (b - a > 1) {
    const mid = Math.floor((a + b) / 2);
    const midRate = arm('cal', 'random', seeds, pool, mid, opening).winRate;
    if (midRate > target) {
      a = mid;
      aRate = midRate;
    } else {
      b = mid;
      bRate = midRate;
    }
  }
  return { lo: a, hi: b, loRate: aRate, hiRate: bRate };
}

const pct = (x: number): string => `${(100 * x).toFixed(2)}%`;
const pp = (x: number): string => `${(100 * x).toFixed(2)}`;

function argOf(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]!;
  return fallback;
}

function main(): void {
  const n = Number.parseInt(argOf('seeds', '4000'), 10);
  const calN = Number.parseInt(argOf('cal-seeds', '600'), 10);
  const target = Number.parseFloat(argOf('baseline', '0.40'));
  const first = Number.parseInt(argOf('first-seed', '1'), 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--seeds must be a positive integer`);
  if (!Number.isFinite(target) || target <= 0 || target >= 1) {
    throw new Error(`--baseline must be strictly between 0 and 1, got "${argOf('baseline', '')}"`);
  }
  const seeds: number[] = [];
  for (let i = 0; i < n; i++) seeds.push(first + i);
  const calSeeds = seeds.slice(0, Math.min(calN, n));
  const opening = encounterById('even').opening;

  const sets: readonly Trait[][] = [[], ['relay'], ['wake'], ['relay', 'wake']];

  console.log('# What is each cascade trait worth, at a matched baseline?');
  console.log('');
  console.log(
    `Seeds: ${n}, contiguous, ${first}..${first + n - 1}. Calibration uses the first ` +
      `${calSeeds.length}.`,
  );
  console.log(
    `Enemy hero Health is a continuous dial; each card set is calibrated on Bot B alone to ` +
      `bracket a ${pct(target)} random-placement baseline. Enemy opening: ` +
      `[${opening.join(', ')}].`,
  );
  console.log('');
  console.log('| card set | enemy Health | A optimal | B random | gap (pp) | 95% CI | B - B2 |');
  console.log('|---|---|---|---|---|---|---|');

  const gapAt = new Map<string, number[]>();
  for (const strip of sets) {
    const pool = ablatedPool(strip);
    const br = bracket(pool, calSeeds, opening, target, 4, 60);
    for (const health of [br.lo, br.hi]) {
      const a = arm('A', 'lookahead', seeds, pool, health, opening);
      const b = arm('B', 'random', seeds, pool, health, opening);
      const b2 = arm('B2', 'randomB', seeds, pool, health, opening);
      const g = pairedGap(a, b);
      const c = pairedGap(b, b2);
      console.log(
        `| ${pool.label} | ${health} | ${pct(a.winRate)} | ${pct(b.winRate)} | ${pp(g.gap)} | ` +
          `${pp(g.ci95[0])}..${pp(g.ci95[1])} | ${pp(c.gap)} |`,
      );
      const key = pool.label;
      const acc = gapAt.get(key) ?? [];
      acc.push(g.gap);
      gapAt.set(key, acc);
    }
  }

  console.log('');
  console.log('## What each trait carries');
  console.log('');
  const mean = (xs: readonly number[] | undefined): number =>
    xs === undefined || xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
  const intact = mean(gapAt.get('intact'));
  const noRelay = mean(gapAt.get('no relay'));
  const noWake = mean(gapAt.get('no wake'));
  const stripped = mean(gapAt.get('no relay + wake'));
  console.log(
    `- Intact ${pp(intact)} pp, mean of the two bracketing Health values. The cascade-stripped ` +
      `control is ${pp(stripped)} pp, which is this measurement's own floor.`,
  );
  console.log(
    `- Removing Relay costs ${pp(intact - noRelay)} pp; removing Wake costs ` +
      `${pp(intact - noWake)} pp.`,
  );
  console.log(
    `- With the other already gone: Relay is worth ${pp(noWake - stripped)} pp and Wake ` +
      `${pp(noRelay - stripped)} pp, so the two interact by ` +
      `${pp(intact - noRelay - noWake + stripped)} pp.`,
  );
  console.log('');
  console.log(
    'Bound: bots, the shipped deck, this seed window, and the `even` opening. A trait worth ' +
      'nothing here may still be worth something in a deck built around it.',
  );
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
