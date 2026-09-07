// Data only, no logic: what the shipped run is made of.
//
// Same role as `src/content/cards.ts` and the same discipline - "numbers live
// in data, not in code" (`AGENTS.md`). It sits under `src/run/` rather than
// `src/content/` only because `src/content/` belongs to another work unit while
// this one is being written; moving it is a file move and an import line, and
// `docs/work/5_run-structure/plan.md` flags it for the integration owner.
//
// Every number here is a starting guess with a reason, not a balanced value.
// `src/sim/runmeasure.ts` is what says whether any of them is right.
//
// The card ids are the shipped pool's. Difficulty scales on the two dials the
// existing content already uses - the enemy hero's Health and the bodies it
// opens with - plus the enemy deck, which gets heavier per act. No new card is
// invented here, because inventing cards is unit 4's job.

import { CARD_POOL, ENEMY_CARDS, PLAYER_CARDS, PLAYER_HERO } from '../content/cards.ts';
import type { HeroSpec } from '../engine/state.ts';
import type {
  ActContent,
  MapShape,
  RewardEntry,
  RunContent,
  RunEncounter,
  RunEventDef,
} from './types.ts';

/**
 * The run's life bar.
 *
 * `docs/design/game.md` says hero Health "persists across the whole run" and
 * gives no number for it; the 30 in `src/content/cards.ts` is a single-fight
 * probe value. 80 is calibrated rather than guessed: a won act-1 fight costs
 * the placement bot 5-20 Health and a won act-3 fight 25-35, so 80 is about
 * three act-3 fights between rests. Flagged in the plan as a number the owner
 * should set.
 */
export const RUN_HERO: HeroSpec = { ...PLAYER_HERO, health: 80 };

/**
 * Rounds a run fight may take before it is called off.
 *
 * Higher than the 12 `src/content/cards.ts` uses for the single-fight probe.
 * Neither deck reshuffles - `drawTo` in `src/engine/fight.ts` stops when a deck
 * runs out, and the design's "cycled roughly once a fight" says that is
 * intended - so once both decks are dry a fight is two heroes and the survivors
 * trading, and it needs the rounds to finish. At 12 rounds nine per cent of run
 * fights timed out; at 20 it is under one per cent, and the mean is unmoved at
 * about nine rounds because the extra rounds are only used by the fights that
 * needed them.
 */
export const RUN_MAX_ROUNDS = 20;

function repeat(id: string, n: number): string[] {
  return new Array<string>(n).fill(id);
}

/**
 * Sixteen cards, against the twenty of `PLAYER_DECK`, growing to roughly
 * twenty-five by the Black Gate.
 *
 * The design calls for "a small curated deck" that grows; a run starting at the
 * mid-run size has nothing to build. Sixteen rather than ten because **neither
 * deck reshuffles inside a fight**, so deck size is a hard cap on how many
 * cards a side can play, and a ten-card deck stops playing around round four
 * while the enemy keeps going. That is a real constraint the design already
 * states - "cycled roughly once a fight" - and it inverts the intuition about
 * deck thinning: a smaller deck is a smaller resource budget, not a more
 * consistent one. Flagged in the plan.
 *
 * The curve matters more than the count. An all-1-cost deck of Squires,
 * Shieldbearers and Pikemen tops out at 2 Power a body, and every enemy from
 * the Shieldwall up carries Armour 1, so it deals nothing at all: two
 * Berserkers and an Ironguard are what make the starting deck able to hurt
 * anything. That was measured, not assumed - the flat version won 0 of 200
 * runs.
 */
export const STARTING_DECK: readonly string[] = [
  ...repeat('u_squire', 3),
  ...repeat('u_shieldbearer', 3),
  ...repeat('u_pikeman', 4),
  ...repeat('u_berserker', 2),
  ...repeat('u_warden', 2),
  ...repeat('u_ironguard', 1),
  ...repeat('u_avenger', 1),
];

/** Common cards are commoner. Weights, not a rarity system. */
export const REWARD_TABLE: readonly RewardEntry[] = [
  { cardId: 'u_squire', weight: 10 },
  { cardId: 'u_shieldbearer', weight: 10 },
  { cardId: 'u_pikeman', weight: 10 },
  { cardId: 'u_hornblower', weight: 8 },
  { cardId: 'u_ironguard', weight: 8 },
  { cardId: 'u_warden', weight: 8 },
  { cardId: 'u_avenger', weight: 8 },
  { cardId: 'u_berserker', weight: 8 },
  { cardId: 'u_captain', weight: 4 },
  { cardId: 'u_sentinel', weight: 4 },
  { cardId: 'u_champion', weight: 4 },
];

/**
 * Each act's enemy deck as a repeating pattern; an encounter takes the first
 * `size` cards of it.
 *
 * **Deck size is this game's real difficulty dial, and the enemy hero's Health
 * is very nearly a no-op.** That was measured across 250 seeds a cell and it
 * was a surprise: an act-1 elite runs 38.7 / 36.7 / 36.3 per cent at 16 / 18 /
 * 20 enemy Health, and an act-3 boss runs 29 / 29 / 29 at 30 / 34 / 40. Once
 * the boards have settled the hero is a formality, so what decides the fight is
 * how many bodies the enemy can field - which, with no reshuffle, is its deck.
 * Between eight and ten cards the bot's win rate falls off a cliff: at act 1,
 * 100 per cent at eight cards, 97 at ten, 87 at twelve, 70 at eighteen.
 *
 * `src/content/cards.ts` calls the enemy hero's Health "this probe's difficulty
 * dial", which is true of that probe - it has no enemy-deck axis - and is worth
 * the owner knowing is not true of the run. Enemy Health is still what a fight
 * is *won* by, so it is still the length dial.
 */
const ENEMY_CYCLE: Record<0 | 1 | 2, readonly string[]> = {
  0: ['e_goblin', 'e_goblin', 'e_shieldwall', 'e_goblin', 'e_ogre', 'e_goblin', 'e_shieldwall'],
  1: ['e_goblin', 'e_shieldwall', 'e_ogre', 'e_goblin', 'e_shieldwall', 'e_troll', 'e_ogre'],
  2: ['e_shieldwall', 'e_ogre', 'e_troll', 'e_goblin', 'e_ogre', 'e_shieldwall', 'e_troll'],
};

function enemyDeck(act: 0 | 1 | 2, size: number): string[] {
  const cycle = ENEMY_CYCLE[act];
  return Array.from({ length: size }, (_, i) => cycle[i % cycle.length]!);
}

function encounter(
  act: 0 | 1 | 2,
  id: string,
  name: string,
  health: number,
  power: number,
  size: number,
  opening: readonly string[],
): RunEncounter {
  return {
    id,
    name,
    enemyHero: { name, health, power, armour: 0 },
    enemyDeck: enemyDeck(act, size),
    opening,
  };
}

/**
 * The three acts.
 *
 * The two numbers on each line are the placement bot's win rate and the mean
 * Health it loses in the fights it wins, at full Health against the deck the
 * run is expected to hold when it gets there - sixteen cards in act 1, twenty
 * in act 2, twenty-four in act 3. **They are reproducible**: `npm run
 * measure:run -- --encounters` prints exactly this table, and it is what these
 * numbers were tuned on. They are evidence about the bot, not about a person.
 *
 * The shape of the curve is the content decision, and it is this: **normal
 * fights are meant to be won and to cost Health**, and it is the Health, not
 * the losses, that ends most runs. A lost fight ends a run outright, so a 70
 * per cent normal fight would end three runs in ten on its own; a 99 per cent
 * act-3 fight that costs 20 Health ends none directly and two in ten by
 * arithmetic, three fights later. The boss is the exception and is the hardest
 * single fight of its act by design - 81.5, 66.0 and 66.0 per cent.
 */
export const ACTS: readonly ActContent[] = [
  {
    act: 0,
    name: 'The Marches',
    fights: [
      // 100.0% / 4.7 Health   100.0% / 8.1   96.0% / 16.0
      encounter(0, 'a1_raiders', 'Goblin Raiders', 12, 2, 8, []),
      encounter(0, 'a1_scouts', 'Orc Scouts', 12, 2, 9, ['e_goblin']),
      encounter(0, 'a1_wall', 'Shieldwall Patrol', 14, 2, 8, ['e_shieldwall']),
    ],
    elites: [
      // 92.5% / 16.8 Health   90.5% / 21.1
      encounter(0, 'a1e_pack', 'Goblin Pack', 18, 3, 8, ['e_goblin', 'e_goblin']),
      encounter(0, 'a1e_ogre', 'Ogre Bully', 18, 3, 8, ['e_shieldwall']),
    ],
    // 81.5% / 27.1 Health - the hardest single fight in the act, as a boss should be
    boss: encounter(0, 'a1b_warchief', 'Warchief', 22, 3, 7, ['e_shieldwall', 'e_goblin']),
    goldPerFight: 25,
    goldPerElite: 55,
    goldPerBoss: 90,
  },
  {
    act: 1,
    name: 'The Ashen Road',
    fights: [
      // 97.0% / 14.3 Health   97.0% / 15.1   96.5% / 13.8
      encounter(1, 'a2_warband', 'Orc Warband', 18, 3, 7, ['e_goblin']),
      encounter(1, 'a2_line', 'Shield Line', 20, 3, 6, ['e_shieldwall']),
      encounter(1, 'a2_ogres', 'Ogre Kin', 20, 3, 6, ['e_goblin', 'e_goblin']),
    ],
    elites: [
      // 76.0% / 21.1 Health   77.0% / 26.9
      encounter(1, 'a2e_troll', 'Stone Troll', 24, 3, 6, ['e_shieldwall', 'e_goblin']),
      encounter(1, 'a2e_ogres', 'Ogre Pair', 24, 3, 6, ['e_ogre']),
    ],
    // 66.0% / 19.8 Health
    boss: encounter(1, 'a2b_chieftain', 'Ash Chieftain', 30, 4, 6, ['e_shieldwall', 'e_goblin']),
    goldPerFight: 35,
    goldPerElite: 70,
    goldPerBoss: 120,
  },
  {
    act: 2,
    name: 'The Black Gate',
    fights: [
      // 99.5% / 18.4 Health   100.0% / 20.2   100.0% / 19.1
      encounter(2, 'a3_host', 'Orc Host', 24, 4, 6, ['e_goblin']),
      encounter(2, 'a3_gate', 'Gate Guard', 26, 4, 5, ['e_shieldwall']),
      encounter(2, 'a3_trolls', 'Troll Kin', 26, 4, 5, ['e_goblin', 'e_goblin']),
    ],
    elites: [
      // 88.5% / 29.3 Health   85.5% / 33.4
      encounter(2, 'a3e_warlord', 'Warlord', 30, 4, 6, ['e_shieldwall', 'e_goblin']),
      encounter(2, 'a3e_trolls', 'Troll Pair', 30, 4, 6, ['e_ogre']),
    ],
    // 66.0% / 25.9 Health
    boss: encounter(2, 'a3b_king', 'Gate King', 38, 4, 7, ['e_shieldwall', 'e_goblin']),
    goldPerFight: 45,
    goldPerElite: 90,
    goldPerBoss: 150,
  },
];

/**
 * Eight rows an act, so a path visits eight nodes and a run twenty-four.
 *
 * Row 0 is always a fight, so an act opens the same way every time and the
 * first decision is a real one rather than a coin flip about where to stand.
 * Row 6 is the run-up to the boss: heal, buy or forge, never fight. Row 7 is
 * the boss.
 *
 * `map.ts` gives every row distinct node types, so a row of three is a choice
 * between three different things. Widths are the dial that decides how wide
 * that choice is; the target-run-length dial is the row count.
 */
export const MAP_SHAPE: MapShape = {
  extraEdgeChance: 0.5,
  rows: [
    { minWidth: 1, maxWidth: 1, weights: [{ type: 'fight', weight: 1 }] },
    {
      minWidth: 2,
      maxWidth: 2,
      weights: [
        { type: 'fight', weight: 6 },
        { type: 'event', weight: 4 },
      ],
    },
    ...[2, 3, 4, 5].map(() => ({
      minWidth: 2,
      maxWidth: 4,
      weights: [
        { type: 'fight' as const, weight: 30 },
        { type: 'elite' as const, weight: 14 },
        { type: 'event' as const, weight: 18 },
        { type: 'shop' as const, weight: 12 },
        { type: 'forge' as const, weight: 12 },
        { type: 'rest' as const, weight: 14 },
      ],
    })),
    {
      minWidth: 2,
      maxWidth: 3,
      weights: [
        { type: 'rest', weight: 50 },
        { type: 'shop', weight: 25 },
        { type: 'forge', weight: 25 },
      ],
    },
    { minWidth: 1, maxWidth: 1, weights: [{ type: 'boss', weight: 1 }] },
  ],
};

/**
 * Three events, each a real trade with two sides.
 *
 * Minimal on purpose - the design does not specify any event, and inventing an
 * event system inside the run-structure unit would be the same mistake as
 * building sigils here. What matters is that an event node moves run state, so
 * routing past one costs something.
 */
export const EVENTS: readonly RunEventDef[] = [
  {
    id: 'ev_shrine',
    name: 'Wayside Shrine',
    options: [
      { label: 'Kneel and rest', effects: [{ kind: 'heal', amount: 8 }] },
      { label: 'Take the offerings', effects: [{ kind: 'gold', amount: 30 }] },
    ],
  },
  {
    id: 'ev_battlefield',
    name: 'Old Battlefield',
    options: [
      {
        label: 'Loot the dead',
        effects: [
          { kind: 'damage', amount: 6 },
          { kind: 'gold', amount: 55 },
        ],
      },
      { label: 'Bury them', effects: [{ kind: 'heal', amount: 5 }] },
    ],
  },
  {
    id: 'ev_swordsman',
    name: 'Wandering Swordsman',
    options: [
      { label: 'Recruit', effects: [{ kind: 'card' }] },
      { label: 'Sell him your map', effects: [{ kind: 'gold', amount: 35 }] },
    ],
  },
];

/** The shipped run. Handed to `startRun`; nothing in `src/run/` imports it. */
export const RUN_CONTENT: RunContent = {
  pool: CARD_POOL,
  hero: RUN_HERO,
  startingDeck: STARTING_DECK,
  acts: ACTS,
  mapShape: MAP_SHAPE,
  rewards: REWARD_TABLE,
  events: EVENTS,
  rewardOffers: 3,
  shopStock: 3,
  shopBasePrice: 30,
  shopPricePerCost: 25,
  startingGold: 0,
  restHealFraction: 0.4,
  maxRounds: RUN_MAX_ROUNDS,
};

/**
 * Every card id this content names, checked once at module load.
 *
 * A typo in a reward table is otherwise a crash two hundred nodes into a
 * measurement run, which is a bad place to learn about it.
 */
const KNOWN = new Set<string>([
  ...PLAYER_CARDS.map((c) => c.id),
  ...ENEMY_CARDS.map((c) => c.id),
]);

for (const entry of REWARD_TABLE) {
  if (!KNOWN.has(entry.cardId)) {
    throw new Error(`run content: reward table names unknown card "${entry.cardId}"`);
  }
}
for (const id of STARTING_DECK) {
  if (!KNOWN.has(id)) {
    throw new Error(`run content: starting deck names unknown card "${id}"`);
  }
}
for (const act of ACTS) {
  for (const enc of [...act.fights, ...act.elites, act.boss]) {
    for (const id of [...enc.enemyDeck, ...enc.opening]) {
      if (!KNOWN.has(id)) {
        throw new Error(
          `run content: encounter "${enc.id}" in act ${act.act + 1} names unknown card "${id}"`,
        );
      }
    }
  }
}
