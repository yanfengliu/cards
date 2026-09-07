// Data only, no logic. Twenty-three hand-authored cards across the design's
// three types: eleven units the player can place, four the enemy fields, five
// spells and three pieces of equipment. Enough traits and verbs to make
// placement and spending mean something and no more - this is a vocabulary, not
// the card pool.
//
// Numbers are starting guesses tuned once, to land the baseline win rate near
// 50% so the A/B measurement is not compressed against a floor or a ceiling.
// They are not balance claims. The spells and equipment are not tuned at all:
// they are absent from `PLAYER_DECK`, so no measured number depends on them
// yet, and what they cost is the balance node's question.

import type {
  CardPool,
  CastableCard,
  EquipmentCard,
  HeroSpec,
  SpellCard,
  Trait,
  UnitCard,
} from '../engine/state.ts';

export const PLAYER_CARDS: readonly UnitCard[] = [
  { id: 'u_squire', name: 'Human Squire', cost: 1, power: 1, health: 2, armour: 0, tribe: 'human', traits: ['relay'] },
  { id: 'u_shieldbearer', name: 'Dwarf Shieldbearer', cost: 1, power: 1, health: 3, armour: 0, tribe: 'dwarf', traits: ['guard'] },
  { id: 'u_pikeman', name: 'Dwarf Pikeman', cost: 1, power: 2, health: 2, armour: 0, tribe: 'dwarf', traits: [] },
  { id: 'u_hornblower', name: 'Human Hornblower', cost: 2, power: 1, health: 4, armour: 0, tribe: 'human', traits: ['relay'] },
  { id: 'u_ironguard', name: 'Dwarf Ironguard', cost: 2, power: 2, health: 4, armour: 1, tribe: 'dwarf', traits: ['guard'] },
  { id: 'u_warden', name: 'Elf Warden', cost: 2, power: 1, health: 3, armour: 0, tribe: 'elf', traits: ['ward'] },
  { id: 'u_avenger', name: 'Dwarf Avenger', cost: 2, power: 2, health: 3, armour: 0, tribe: 'dwarf', traits: ['wake'] },
  { id: 'u_berserker', name: 'Human Berserker', cost: 2, power: 4, health: 2, armour: 0, tribe: 'human', traits: [] },
  { id: 'u_captain', name: 'Human Captain', cost: 3, power: 3, health: 4, armour: 1, tribe: 'human', traits: ['relay'] },
  { id: 'u_sentinel', name: 'Elf Sentinel', cost: 3, power: 2, health: 6, armour: 1, tribe: 'elf', traits: ['guard'] },
  { id: 'u_champion', name: 'Human Champion', cost: 3, power: 5, health: 4, armour: 0, tribe: 'human', traits: [] },
];

export const ENEMY_CARDS: readonly UnitCard[] = [
  { id: 'e_goblin', name: 'Goblin', cost: 1, power: 2, health: 2, armour: 0, tribe: 'orc', traits: [] },
  { id: 'e_shieldwall', name: 'Orc Shieldwall', cost: 2, power: 1, health: 5, armour: 1, tribe: 'orc', traits: ['guard'] },
  { id: 'e_ogre', name: 'Ogre', cost: 3, power: 4, health: 5, armour: 1, tribe: 'orc', traits: [] },
  { id: 'e_troll', name: 'Stone Troll', cost: 3, power: 3, health: 7, armour: 2, tribe: 'beast', traits: [] },
];

/**
 * The negative control for the whole measurement.
 *
 * The same eleven cards with every trait that reads a neighbour - Relay, Ward,
 * Wake - removed. Guard stays, because Guard does not care where it stands.
 *
 * If the optimal-placement bot still beats the random one by as much on this
 * set, the measurement is picking up something other than the cascade and the
 * headline number should not be trusted.
 */
const POSITIONAL: readonly Trait[] = ['relay', 'ward', 'wake'];

export const PLAYER_CARDS_NO_CASCADE: readonly UnitCard[] = PLAYER_CARDS.map((c) => ({
  ...c,
  id: `${c.id}_nc`,
  name: `${c.name} (no cascade)`,
  traits: c.traits.filter((t) => !POSITIONAL.includes(t)),
}));

/**
 * Spells: a vocabulary, not a pool. One card per verb, plus a second AoE at a
 * different number to say out loud that the number is data.
 *
 * The two AoE cards are the point of this set. `docs/design/game.md` names AoE
 * as the only designated counter to a wide board, and going wide is the
 * strongest thing the deck economy currently allows, so until these existed the
 * design had no answer to its own dominant strategy.
 *
 * Costs are starting guesses on the design's stated 3-energy turn, tuned by
 * nothing yet. They are not balance claims, and they are deliberately absent
 * from `PLAYER_DECK`: putting them in the measured deck would move the
 * placement measurement, which is a balance decision and not this unit's.
 */
export const SPELL_CARDS: readonly SpellCard[] = [
  {
    kind: 'spell',
    id: 's_bolt',
    name: 'Searing Bolt',
    cost: 1,
    effects: [{ kind: 'damageOne', amount: 3 }],
  },
  {
    kind: 'spell',
    id: 's_volley',
    name: 'Arrow Volley',
    cost: 2,
    effects: [{ kind: 'damageAll', amount: 2 }],
  },
  {
    kind: 'spell',
    id: 's_firestorm',
    name: 'Firestorm',
    cost: 3,
    effects: [{ kind: 'damageAll', amount: 4 }],
  },
  {
    kind: 'spell',
    id: 's_rally',
    name: 'Rally',
    cost: 2,
    effects: [{ kind: 'buffAll', amount: 2 }],
  },
  {
    kind: 'spell',
    id: 's_focus',
    name: 'Focus',
    cost: 1,
    effects: [{ kind: 'gainPower', amount: 3 }],
  },
];

/**
 * Equipment: one piece per slot, numeric only.
 *
 * The Iron Sword is the worked example's own third card, at its own numbers, so
 * `docs/design/game.md`'s walk-through can now be run with the card it is
 * written with instead of a hero given +3 base Power to stand in for it.
 *
 * Nothing here grants a trait. Relay and Ward both read the unit to the right
 * and the hero has none; Guard on a hero would force attacks onto it; Wake's
 * rule is an open question with the owner. Two numbers and a slot is the whole
 * card type, which is also what "equipment amplifies an attack that already
 * exists" asks for.
 */
export const EQUIPMENT_CARDS: readonly EquipmentCard[] = [
  {
    kind: 'equipment',
    id: 'q_iron_sword',
    name: 'Iron Sword',
    cost: 1,
    slot: 'weapon',
    power: 3,
    armour: 0,
  },
  {
    kind: 'equipment',
    id: 'q_chain_mail',
    name: 'Chain Mail',
    cost: 2,
    slot: 'armour',
    power: 0,
    armour: 2,
  },
  {
    kind: 'equipment',
    id: 'q_oath_ring',
    name: 'Oath Ring',
    cost: 1,
    slot: 'trinket',
    power: 1,
    armour: 1,
  },
];

const BY_ID = new Map<string, UnitCard>();
const CASTABLE_BY_ID = new Map<string, CastableCard>();

/** One card, one entry, one id - and an id is unique across all three types. */
function claimId(id: string): void {
  if (BY_ID.has(id) || CASTABLE_BY_ID.has(id)) {
    throw new Error(`content: duplicate card id ${id}; ids are unique and stable forever`);
  }
}

for (const c of [...PLAYER_CARDS, ...PLAYER_CARDS_NO_CASCADE, ...ENEMY_CARDS]) {
  claimId(c.id);
  BY_ID.set(c.id, c);
}

for (const c of [...SPELL_CARDS, ...EQUIPMENT_CARDS]) {
  claimId(c.id);
  CASTABLE_BY_ID.set(c.id, c);
}

export function cardById(id: string): UnitCard {
  const c = BY_ID.get(id);
  if (c === undefined) {
    const castable = CASTABLE_BY_ID.get(id);
    if (castable !== undefined) {
      throw new Error(
        `content: "${id}" is a ${castable.kind} card, not a unit. ` +
          `A spell is cast and a piece of equipment is worn; neither is placed into the line. ` +
          `Look it up with castableById.`,
      );
    }
    const known = [...BY_ID.keys()].join(', ');
    throw new Error(`content: no card with id "${id}". Known ids: ${known}`);
  }
  return c;
}

/**
 * A spell or a piece of equipment by id, or `null` for anything else.
 *
 * `null` rather than a throw because the fight asks this about every id in a
 * hand in order to decide which of the three types it is holding, and most of
 * them are units. `cardById` owns the message for a genuinely unknown id.
 */
export function castableById(id: string): CastableCard | null {
  return CASTABLE_BY_ID.get(id) ?? null;
}

/**
 * Knight: 30 Health, swings for 2. No equipment in this probe.
 *
 * Hero health persists across a whole run in the design, so the player's bar is
 * larger than any single encounter's. The enemy hero's health is this probe's
 * difficulty dial - see `ENCOUNTERS`.
 */
export const PLAYER_HERO: HeroSpec = { name: 'Knight', health: 30, power: 2, armour: 0 };

function repeat(id: string, n: number): string[] {
  return new Array<string>(n).fill(id);
}

/** Twenty cards, roughly the mid-run deck size the design assumes. */
export const PLAYER_DECK: readonly string[] = [
  ...repeat('u_squire', 3),
  ...repeat('u_shieldbearer', 2),
  ...repeat('u_pikeman', 2),
  ...repeat('u_hornblower', 2),
  ...repeat('u_ironguard', 2),
  ...repeat('u_warden', 2),
  ...repeat('u_avenger', 2),
  ...repeat('u_berserker', 2),
  ...repeat('u_captain', 1),
  ...repeat('u_sentinel', 1),
  ...repeat('u_champion', 1),
];

/** The same twenty cards with the cascade traits stripped. */
export const PLAYER_DECK_NO_CASCADE: readonly string[] = PLAYER_DECK.map((id) => `${id}_nc`);

/**
 * Twenty cards of all three types: fourteen bodies, four spells, two pieces of
 * equipment.
 *
 * It is deliberately not the deck the measurement runs. `npm run verify`'s
 * numbers are a claim about placement, and changing the deck changes every one
 * of them for a reason that has nothing to do with placement; which spells
 * belong in a measured deck is a balance question for the content-and-balance
 * node, which owns the whole pool. What this deck is for is exercising the
 * three-card-type path end to end - draw, spend, cast, replay - so the new card
 * types are reachable from a real fight rather than only from a fixture.
 */
export const PLAYER_DECK_MIXED: readonly string[] = [
  ...repeat('u_squire', 2),
  ...repeat('u_shieldbearer', 2),
  ...repeat('u_pikeman', 2),
  ...repeat('u_hornblower', 1),
  ...repeat('u_ironguard', 2),
  ...repeat('u_warden', 1),
  ...repeat('u_avenger', 1),
  ...repeat('u_berserker', 1),
  ...repeat('u_captain', 1),
  ...repeat('u_champion', 1),
  ...repeat('s_bolt', 2),
  ...repeat('s_volley', 1),
  ...repeat('s_rally', 1),
  ...repeat('q_iron_sword', 1),
  ...repeat('q_chain_mail', 1),
];

export const ENEMY_DECK: readonly string[] = [
  ...repeat('e_goblin', 8),
  ...repeat('e_shieldwall', 4),
  ...repeat('e_ogre', 3),
  ...repeat('e_troll', 3),
];

export type Encounter = {
  readonly id: string;
  readonly name: string;
  readonly enemyHero: HeroSpec;
  /** Bodies already on the enemy line, so turn one is not a free hit. */
  readonly opening: readonly string[];
};

/**
 * Three difficulty points, differing only in the enemy hero's Health and the
 * enemy's opening board. The card sets and both decks are identical across all
 * three, so a gap that moves between them moves because of difficulty and not
 * because the content changed.
 *
 * `even` is the primary operating point: it was chosen before the headline
 * measurement so that both arms straddle a 50% win rate, where a win-rate gap
 * is least compressed by the floor and the ceiling. `hard` and `easy` exist to
 * show how much of the gap is an artifact of that choice.
 */
export const ENCOUNTERS: readonly Encounter[] = [
  {
    id: 'hard',
    name: 'Warchief, 26 Health, two bodies out',
    enemyHero: { name: 'Warchief', health: 26, power: 2, armour: 0 },
    opening: ['e_goblin', 'e_shieldwall'],
  },
  {
    id: 'even',
    name: 'Warchief, 18 Health, one body out',
    enemyHero: { name: 'Warchief', health: 18, power: 2, armour: 0 },
    opening: ['e_goblin'],
  },
  {
    id: 'easy',
    name: 'Warchief, 12 Health, empty board',
    enemyHero: { name: 'Warchief', health: 12, power: 2, armour: 0 },
    opening: [],
  },
  {
    // Exists so the negative control can be run at a baseline that is nowhere
    // near the floor, where a small gap cannot be dismissed as compression.
    id: 'trivial',
    name: 'Warchief, 8 Health, empty board',
    enemyHero: { name: 'Warchief', health: 8, power: 2, armour: 0 },
    opening: [],
  },
];

export const PRIMARY_ENCOUNTER = 'even';

export function encounterById(id: string): Encounter {
  const e = ENCOUNTERS.find((x) => x.id === id);
  if (e === undefined) {
    throw new Error(
      `content: no encounter "${id}". Known: ${ENCOUNTERS.map((x) => x.id).join(', ')}`,
    );
  }
  return e;
}

export const ENERGY_PER_TURN = 3;
export const HAND_SIZE = 5;
export const MAX_ROUNDS = 12;

/**
 * This module's whole contribution to a fight, in the shape the engine takes.
 *
 * The engine imports nothing from here: a caller hands this to `setupFight`.
 * The type comes from `engine/state.ts`, which is the allowed direction -
 * content depends on engine, never the reverse.
 */
export const CARD_POOL: CardPool = {
  card: cardById,
  energyPerTurn: ENERGY_PER_TURN,
  handSize: HAND_SIZE,
  castable: castableById,
};
