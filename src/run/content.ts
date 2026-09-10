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
import { SIGIL_CONTENT } from '../content/sigils.ts';
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
 * probe value. It is calibrated rather than guessed, by the same rule both
 * times: about three or four act-3 fights between rests.
 *
 * **It moved from 80 to 200 when combat became mutual and decks began to
 * reshuffle, and it had to.** Both rules push in the same direction. Your
 * bodies now die to the retaliation their own attacks draw, so the line
 * protecting the hero thins faster; and the enemy's deck no longer runs dry, so
 * it keeps fielding bodies for the whole fight instead of stopping around round
 * four. At 80 the run was **unwinnable - 0 of 1000** - while every individual
 * encounter still won 87-100% of the time in isolation. Nothing was too hard;
 * the Health economy had simply stopped adding up.
 *
 * The measured cost of a won fight roughly doubled, which is where the number
 * comes from: at 200 Health a won act-3 fight costs the placement bot about
 * 35-55 and the act-3 boss about 80. Flagged in the plan as a number the owner
 * should set, along with the act curve it does not fix - act 1 now clears 100%
 * of the time and every run that ends does so in act 2 or 3.
 */
export const RUN_HERO: HeroSpec = { ...PLAYER_HERO, health: 200 };

/**
 * Rounds a run fight may take before it is called off.
 *
 * Higher than the 12 `src/content/cards.ts` uses for the single-fight probe.
 * The reason it was raised is now gone: decks used to run dry and never
 * reshuffle, so a late fight was two heroes and the survivors trading and it
 * needed the rounds to finish. `drawTo` now shuffles the discard back in, so
 * both sides keep playing bodies for the whole fight. The number is left at 20
 * rather than retuned here, because a round cap is a balance dial and this
 * round changed three rules at once; it is flagged in
 * `docs/work/6_trade-and-thin/plan.md` with the new timeout rate.
 */
export const RUN_MAX_ROUNDS = 20;

function repeat(id: string, n: number): string[] {
  return new Array<string>(n).fill(id);
}

/**
 * Fourteen cards, against the eighteen of `PLAYER_DECK`, growing to roughly
 * twenty-three by the Black Gate.
 *
 * The design calls for "a small curated deck" that grows; a run starting at the
 * mid-run size has nothing to build. It was sixteen, and the two that left were
 * the Elf Wardens, removed with Ward.
 *
 * Sixteen had been chosen because **neither deck reshuffled inside a fight**,
 * so deck size was a hard cap on how many cards a side could play and a
 * ten-card deck stopped playing around round four while the enemy kept going.
 * That inverted the design's own "deck thinning as a skill", and `drawTo` now
 * reshuffles the discard back in, so the reason for the floor is gone: deck
 * size is a consistency dial again rather than a budget. The count is left at
 * what removing Ward leaves it rather than retuned, because retuning it is a
 * balance decision and this round already moved three rules.
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
 * **Both claims this comment used to make were measured under rules that no
 * longer hold, and neither has been re-tested.** They are left here as history
 * because a later balance pass needs to know they are stale rather than
 * inherit them:
 *
 *   - "Deck size is this game's real difficulty dial." It was, because with no
 *     reshuffle a deck was a hard cap on how many bodies a side could field -
 *     at act 1 the bot won 100 per cent against eight cards, 97 against ten, 87
 *     against twelve and 70 against eighteen. `drawTo` now reshuffles, so an
 *     enemy deck no longer runs out at all. Its size decides the *mix* the
 *     enemy fields, not how long it can field anything, and that cliff is gone.
 *   - "The enemy hero's Health is very nearly a no-op." It measured 38.7 / 36.7
 *     / 36.3 per cent at 16 / 18 / 20 Health on an act-1 elite. A hero now
 *     retaliates when it is struck, so its Power is live in a way it was not,
 *     and `src/sim/ablate.ts` - which bisects on enemy Health as a continuous
 *     dial - sees the random arm move 5 to 7 points per point of Health at the
 *     `even` opening. Whatever the run's version of that number is, it is not
 *     "a no-op".
 *
 * What is measured under the current rules is in
 * `docs/work/6_trade-and-thin/plan.md`, and the act curve it reports is the
 * open question: act 1 clears 100 per cent of the time and act 3 ends 71 per
 * cent of runs, 27 per cent of those on a timeout rather than a kill.
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
 * run is expected to hold when it gets there - fourteen cards in act 1,
 * eighteen in act 2, twenty-two in act 3. **They are reproducible**: `npm run
 * measure:run -- --encounters` prints exactly this table, over 200 seeds a
 * cell. They are evidence about the bot, not about a person.
 *
 * The shape of the curve is the content decision, and it was this: **normal
 * fights are meant to be won and to cost Health**, and it is the Health, not
 * the losses, that ends most runs. A lost fight ends a run outright, so a 70
 * per cent normal fight would end three runs in ten on its own; a 99 per cent
 * act-3 fight that costs 20 Health ends none directly and two in ten by
 * arithmetic, three fights later.
 *
 * **The numbers below were re-measured after combat became mutual and decks
 * began to reshuffle, and the curve they describe is no longer the curve that
 * was tuned.** Every encounter but two is now won in isolation - the exceptions
 * are the act-3 Gate Guard at 94.0 per cent and the act-3 boss at 86.5 - while
 * the Health each one costs roughly doubled. The difficulty has moved out of
 * "can this fight be won" and entirely into "what does winning it cost", which
 * is why the run clears act 1 100 per cent of the time and ends 71 per cent of
 * runs in act 3, a quarter of those on a timeout rather than a kill. Re-tuning
 * it is the balance node's job and was deliberately not done in the round that
 * changed the rules; see `docs/work/6_trade-and-thin/plan.md`.
 */
export const ACTS: readonly ActContent[] = [
  {
    act: 0,
    name: 'The Marches',
    fights: [
      // 100.0% / 9.9 Health   100.0% / 12.3   100.0% / 14.7
      encounter(0, 'a1_raiders', 'Goblin Raiders', 12, 2, 8, []),
      encounter(0, 'a1_scouts', 'Orc Scouts', 12, 2, 9, ['e_goblin']),
      encounter(0, 'a1_wall', 'Shieldwall Patrol', 14, 2, 8, ['e_shieldwall']),
    ],
    elites: [
      // 100.0% / 26.1 Health   100.0% / 24.3
      encounter(0, 'a1e_pack', 'Goblin Pack', 18, 3, 8, ['e_goblin', 'e_goblin']),
      encounter(0, 'a1e_ogre', 'Ogre Bully', 18, 3, 8, ['e_shieldwall']),
    ],
    // 100.0% / 31.4 Health - no longer the hardest fight in its act, which is a finding
    boss: encounter(0, 'a1b_warchief', 'Warchief', 22, 3, 7, ['e_shieldwall', 'e_goblin']),
    goldPerFight: 25,
    goldPerElite: 55,
    goldPerBoss: 90,
  },
  {
    act: 1,
    name: 'The Ashen Road',
    fights: [
      // 99.5% / 32.6 Health   100.0% / 39.8   100.0% / 38.5
      encounter(1, 'a2_warband', 'Orc Warband', 18, 3, 7, ['e_goblin']),
      encounter(1, 'a2_line', 'Shield Line', 20, 3, 6, ['e_shieldwall']),
      encounter(1, 'a2_ogres', 'Ogre Kin', 20, 3, 6, ['e_goblin', 'e_goblin']),
    ],
    elites: [
      // 100.0% / 50.1 Health   100.0% / 57.2
      encounter(1, 'a2e_troll', 'Stone Troll', 24, 3, 6, ['e_shieldwall', 'e_goblin']),
      encounter(1, 'a2e_ogres', 'Ogre Pair', 24, 3, 6, ['e_ogre']),
    ],
    // 100.0% / 69.6 Health
    boss: encounter(1, 'a2b_chieftain', 'Ash Chieftain', 30, 4, 6, ['e_shieldwall', 'e_goblin']),
    goldPerFight: 35,
    goldPerElite: 70,
    goldPerBoss: 120,
  },
  {
    act: 2,
    name: 'The Black Gate',
    fights: [
      // 100.0% / 53.2 Health   94.0% / 31.8 (12 timeouts)   98.0% / 33.7 (4 timeouts)
      encounter(2, 'a3_host', 'Orc Host', 24, 4, 6, ['e_goblin']),
      encounter(2, 'a3_gate', 'Gate Guard', 26, 4, 5, ['e_shieldwall']),
      encounter(2, 'a3_trolls', 'Troll Kin', 26, 4, 5, ['e_goblin', 'e_goblin']),
    ],
    elites: [
      // 100.0% / 65.8 Health   100.0% / 75.5
      encounter(2, 'a3e_warlord', 'Warlord', 30, 4, 6, ['e_shieldwall', 'e_goblin']),
      encounter(2, 'a3e_trolls', 'Troll Pair', 30, 4, 6, ['e_ogre']),
    ],
    // 86.5% / 129.2 Health, 18 timeouts - the only fight in the run that is still hard
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
  ...SIGIL_CONTENT,
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
