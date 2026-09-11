// The fight state, and the accessors the resolver is allowed to use.
//
// Board layout, straight from `docs/design/game.md`:
//
//   "The hero stands immediately to the right of the last unit."
//
// So the hero is simply the last element of its side's board array. That makes
// "the unit to my right" reach the hero for free on the rightmost unit, and
// makes "the hero acts last" fall out of iterating the array left to right.
// Units are inserted at any index in [0, units], never after the hero.

export type Side = 'player' | 'enemy';

/**
 * The traits the resolver knows. Every one is read in `resolver.ts` and
 * nowhere else; `render/glossary.ts` keys its explanations by this union, so a
 * trait added here does not compile until it is explained.
 *
 * `volley` and `scorch` arrived with classes. They are how the design's three
 * hero attacks - "the Knight swings for 2, the Ranger for 1 twice, the Mage for
 * 1 with a rider" - are data on a `HeroSpec` rather than a switch on a class
 * name: a Ranger is a hero with `power: 1` and `volley`, a Mage is one with
 * `power: 1` and `scorch`, and a Knight is one with `power: 2` and nothing. A
 * unit may carry either too, and the resolver treats a hero and a unit the
 * same way, which is what lets a Volley archer exist in the Ranger's pool.
 */
export type Trait = 'guard' | 'relay' | 'wake' | 'volley' | 'scorch' | TribalTrait;

/**
 * The traits that read a race - `docs/design/game.md`'s "races are mechanical
 * tribes". Split out of `Trait` because two places have to word a claim about
 * exactly this set and neither may hardcode it:
 *
 *   - `render/glossary.ts` tells the player what being a dwarf does, by name.
 *     The sentence is built from `TRIBAL_TRAITS`, so deleting one re-words it
 *     and adding one adds itself. That is the same property that made deleting
 *     Ward a compile error instead of a lying tooltip.
 *   - `test/tribes.test.ts` fights the same board twice with one neighbour's
 *     race changed and nothing else, and asserts that exactly the traits in
 *     this union notice. A tribe-reading trait left out of it fails there, so
 *     the list cannot quietly go stale.
 *
 * All three obey the design's own bound: **a trait reads its neighbours, never
 * a total.** `adjacentAllies` is the only door to the board they have, and it
 * returns at most two entities whatever the line is doing.
 */
export type TribalTrait = 'kindle' | 'chorus' | 'banner';

/**
 * `TRIBAL_TRAITS`, spelled as a record so the type system fills it in: a member
 * added to `TribalTrait` and not to this object does not compile, and a key
 * here that is not in the union does not compile either. `Object.keys` on a
 * fully-specified `Record` is then the list, derived rather than retyped.
 */
const TRIBAL: Readonly<Record<TribalTrait, true>> = { kindle: true, chorus: true, banner: true };

export const TRIBAL_TRAITS: readonly TribalTrait[] = Object.keys(TRIBAL) as TribalTrait[];

export function isTribalTrait(t: Trait): t is TribalTrait {
  return t in TRIBAL;
}

export type Tribe = 'human' | 'dwarf' | 'elf' | 'orc' | 'beast' | 'hero';

export type UnitCard = {
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly power: number;
  readonly health: number;
  readonly armour: number;
  readonly tribe: Tribe;
  readonly traits: readonly Trait[];
};

// ---------------------------------------------------------------------------
// Spells and equipment.
//
// `docs/design/game.md` has three card types and only units existed. Both of
// the others are added here rather than folded into `UnitCard`, because a unit
// card literal must keep compiling unchanged - the render and run lanes are
// written against today's `UnitCard`.
//
// The two new card types carry an explicit `kind`; `UnitCard` does not, and is
// therefore the default when a lookup finds no castable. That asymmetry is
// deliberate: it is what makes the addition free for every existing literal.
// ---------------------------------------------------------------------------

/** The three fixed equipment slots, per `docs/design/game.md`. */
export type EquipSlot = 'weapon' | 'armour' | 'trinket';

/** The slots, in the order the design lists them. */
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'armour', 'trinket'];

/**
 * A piece of equipment. It amplifies an attack the hero already has, so it is
 * two numbers and a slot - never a trait, and never a body.
 *
 * A new piece replaces whatever is in that slot, and everything worn is taken
 * off at the end of the fight (`endFight`).
 */
export type EquipmentCard = {
  readonly kind: 'equipment';
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly slot: EquipSlot;
  /** Added to the hero's Power while worn. */
  readonly power: number;
  /** Added to the hero's Armour while worn. */
  readonly armour: number;
};

/**
 * What a spell does, as data. One entry per named verb in the resolver's effect
 * vocabulary; the numbers live here and nowhere else.
 *
 * `src/engine/cast.ts` binds these to `Effect`s. A new spell is a new row of
 * data; a new *shape* of spell is a new verb here and a new case in `apply`,
 * which is the `AGENTS.md` escalation.
 */
export type SpellEffectSpec =
  /** One random legal enemy target takes `amount`, less its Armour. */
  | { readonly kind: 'damageOne'; readonly amount: number }
  /** Every living enemy unit takes `amount`, less its own Armour. The AoE. */
  | { readonly kind: 'damageAll'; readonly amount: number }
  /** Every living entity on the caster's side gains `amount` Power this turn. */
  | { readonly kind: 'buffAll'; readonly amount: number }
  /** The caster gains `amount` Power this turn. Reuses the unit vocabulary. */
  | { readonly kind: 'gainPower'; readonly amount: number };

export type SpellCard = {
  readonly kind: 'spell';
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  /** Resolved in written order, all of it before the caster's line resolves. */
  readonly effects: readonly SpellEffectSpec[];
};

/** A card that is spent rather than placed. */
export type CastableCard = SpellCard | EquipmentCard;

/** What a hero is wearing. Units have no slots at all - see `Entity`. */
export type EquipmentSlots = {
  weapon: EquipmentCard | null;
  armour: EquipmentCard | null;
  trinket: EquipmentCard | null;
};

export function emptySlots(): EquipmentSlots {
  return { weapon: null, armour: null, trinket: null };
}

export type HeroSpec = {
  readonly name: string;
  readonly health: number;
  readonly power: number;
  readonly armour: number;
  /**
   * The class's attack, as traits. Absent means a plain swing, so every hero
   * literal written before classes existed still means what it meant; the
   * Knight is exactly that hero, and its canonical form is unchanged because
   * `makeHero` gives it the empty trait list it always had.
   */
  readonly traits?: readonly Trait[];
};

export type Entity = {
  uid: number;
  cardId: string;
  side: Side;
  isHero: boolean;
  /**
   * The card's race, carried onto the board so a trait can read it.
   *
   * Until tribal traits existed this field was not here at all, and that was
   * the whole of why race was decoration: `UnitCard` had a `tribe` and
   * `makeUnit` dropped it, so nothing in a fight could see one. A hero gets
   * `'hero'`, which `render/glossary.ts` words as "not a race" - and every
   * tribal count below excludes heroes for exactly that reason.
   *
   * It is deliberately **not** in `hash.ts`'s canonical form. A tribe is a
   * function of `cardId`, which that form already carries, and unlike a piece
   * of equipment's two numbers it is identity rather than a tuned value:
   * `AGENTS.md` says a rebalanced card keeps its id and a redesigned one gets
   * a new one, and changing a card's race is a redesign. So every hash
   * recorded before tribes existed still reproduces.
   */
  tribe: Tribe;
  /** Printed Power. Permanent growth would change this; nothing here does. */
  basePower: number;
  /** Buffs granted during resolution. Cleared at the start of the owner's turn. */
  bonusPower: number;
  health: number;
  maxHealth: number;
  armour: number;
  traits: Trait[];
  alive: boolean;
  /**
   * The three equipment slots, for a hero. `null` for a unit, which has no
   * slots at all rather than three empty ones - equipment attaches to the hero
   * and to nothing else.
   *
   * Added after units shipped. Nothing outside this file builds an `Entity`, so
   * this field costs no existing call site, and `hashFight` appends it only
   * when something is worn, which is why every hash recorded before equipment
   * existed still reproduces.
   */
  equipment: EquipmentSlots | null;
};

/**
 * The cards a fight is fought with, handed in by whoever starts the fight.
 *
 * `engine` depends on nothing and everything depends on `engine` -
 * ARCHITECTURE.md's module rule - so a fight is *given* its cards rather than
 * reaching into `src/content/` for them. A pool is data plus a lookup; the
 * engine never asks it for behaviour.
 */
export type CardPool = {
  /** Card data by id. Throws for an unknown id - the pool owns that message. */
  readonly card: (id: string) => UnitCard;
  /** Energy a side may spend on cards each round. */
  readonly energyPerTurn: number;
  /** The hand size a side draws up to at the start of its turn. */
  readonly handSize: number;
  /**
   * Spells and equipment by id, or `null` for an id that is not one. Optional,
   * so a unit-only pool - `test/fight.test.ts` has one - keeps compiling and
   * keeps behaving exactly as it did.
   *
   * It returns `null` rather than throwing because it is asked about every id
   * in a hand, most of which are units.
   */
  readonly castable?: (id: string) => CastableCard | null;
};

export type GameState = {
  board: { player: Entity[]; enemy: Entity[] };
  nextUid: number;
};

export function otherSide(side: Side): Side {
  return side === 'player' ? 'enemy' : 'player';
}

/** Power granted by everything worn. Zero for a unit, which wears nothing. */
export function equipPower(e: Entity): number {
  const s = e.equipment;
  if (s === null) return 0;
  return (s.weapon?.power ?? 0) + (s.armour?.power ?? 0) + (s.trinket?.power ?? 0);
}

/** Armour granted by everything worn. Zero for a unit. */
export function equipArmour(e: Entity): number {
  const s = e.equipment;
  if (s === null) return 0;
  return (s.weapon?.armour ?? 0) + (s.armour?.armour ?? 0) + (s.trinket?.armour ?? 0);
}

/**
 * Power an entity swings at: printed, plus this turn's buffs, plus everything
 * worn. The worked example's "2 base + 3 sword" is these three terms.
 *
 * Equipment is a summand rather than a write to `basePower`, so taking a piece
 * off is exact by construction and `basePower` keeps meaning "printed".
 */
export function power(e: Entity): number {
  return e.basePower + e.bonusPower + equipPower(e);
}

/**
 * Armour an incoming hit is reduced by: printed, plus everything worn.
 *
 * Every damage site reads this, never `e.armour`, so a worn shield covers an
 * attack and a spell alike.
 */
export function armourOf(e: Entity): number {
  return e.armour + equipArmour(e);
}

/** A spell or a piece of equipment by id, or `null` for anything else. */
export function castableById(pool: CardPool, id: string): CastableCard | null {
  return pool.castable === undefined ? null : pool.castable(id);
}

/**
 * What one card costs, whichever of the three types it is. Units, spells and
 * equipment all draw from the same energy, so one function answers for all
 * three.
 */
export function cardCost(pool: CardPool, id: string): number {
  const c = castableById(pool, id);
  return c === null ? pool.card(id).cost : c.cost;
}

export function makeHero(state: GameState, side: Side, spec: HeroSpec): Entity {
  return {
    uid: state.nextUid++,
    cardId: `hero:${spec.name}`,
    side,
    isHero: true,
    tribe: 'hero',
    basePower: spec.power,
    bonusPower: 0,
    health: spec.health,
    maxHealth: spec.health,
    armour: spec.armour,
    traits: spec.traits === undefined ? [] : spec.traits.slice(),
    alive: true,
    equipment: emptySlots(),
  };
}

export function makeUnit(state: GameState, side: Side, card: UnitCard): Entity {
  return {
    uid: state.nextUid++,
    cardId: card.id,
    side,
    isHero: false,
    tribe: card.tribe,
    basePower: card.power,
    bonusPower: 0,
    health: card.health,
    maxHealth: card.health,
    armour: card.armour,
    traits: card.traits.slice(),
    alive: true,
    equipment: null,
  };
}

/** Number of non-hero units on a side. Insertion indices are [0, unitCount]. */
export function unitCount(state: GameState, side: Side): number {
  return state.board[side].length - 1;
}

export function heroOf(state: GameState, side: Side): Entity {
  const board = state.board[side];
  const hero = board[board.length - 1];
  if (hero === undefined || !hero.isHero) {
    throw new Error(`state: ${side} board has no hero in its rightmost slot`);
  }
  return hero;
}

/**
 * Insert a unit at `index` among the side's units. `index` may equal the unit
 * count, which places it immediately left of the hero.
 */
export function insertUnit(state: GameState, side: Side, unit: Entity, index: number): void {
  const units = unitCount(state, side);
  if (!Number.isInteger(index) || index < 0 || index > units) {
    throw new Error(
      `state.insertUnit: index ${index} is not a legal slot for the ${side} line, ` +
        `which has ${units} unit(s) and accepts 0..${units}`,
    );
  }
  state.board[side].splice(index, 0, unit);
}

export function findEntity(state: GameState, uid: number): Entity | null {
  for (const side of ['player', 'enemy'] as const) {
    for (const e of state.board[side]) {
      if (e.uid === uid) return e;
    }
  }
  return null;
}

export function requireEntity(state: GameState, uid: number): Entity {
  const e = findEntity(state, uid);
  if (e === null) {
    throw new Error(`state: no entity with uid ${uid} is on the board`);
  }
  return e;
}

/** The entity immediately to the right on the same side, or null for the hero. */
export function rightNeighbour(state: GameState, e: Entity): Entity | null {
  const board = state.board[e.side];
  const i = board.indexOf(e);
  if (i < 0) return null;
  return board[i + 1] ?? null;
}

export function leftNeighbour(state: GameState, e: Entity): Entity | null {
  const board = state.board[e.side];
  const i = board.indexOf(e);
  if (i <= 0) return null;
  return board[i - 1] ?? null;
}

/**
 * The living **units** immediately left and right of `e` on its own side - at
 * most two entities, whatever the line is doing.
 *
 * This is the only door a tribal trait has to the board, and that is the
 * design's constraint made structural rather than remembered.
 * `docs/design/game.md`, "Why adjacency, and not counting":
 *
 *   > A trait that counts - "+1 Power for each friendly unit that acted before
 *   > me" - gives the Nth unit +N. On a five-slot board that caps at +4; here
 *   > the cap is whatever the deck economy currently allows [...] its ceiling
 *   > is **not a number anyone controls directly**.
 *
 * Two rules are in the return value rather than in a comment:
 *
 *   - **At most two.** Nothing here walks the array, so no tribal trait can
 *     scale with board width even by accident. Gated by "a tribal trait's
 *     grant does not move when the line grows" in `test/tribes.test.ts`, which
 *     fights the same trait at 2 and at 20 neighbours.
 *   - **Never a hero.** A hero's `tribe` is `'hero'`, which the glossary words
 *     as "Not a race". Counting it would make a race-matching trait see a
 *     stranger and a race-differing one see a friend, purely for standing at
 *     the right end of the line - a bonus for position rather than for race.
 *     Relay deliberately *does* reach the hero; a count of kin deliberately
 *     does not, and the two rules are different because one hands a neighbour
 *     Power and the other asks what the neighbour *is*.
 */
const ADJACENT: readonly ((state: GameState, e: Entity) => Entity | null)[] = [
  leftNeighbour,
  rightNeighbour,
];

/**
 * How many entities "adjacent" can mean: the number of directions
 * `adjacentAllies` actually looks in, not a 2 typed somewhere.
 *
 * `render/glossary.ts` tells the player "the most this can ever be is +2" and
 * builds that sentence from this, under the same rule that makes it build
 * "+2 Power" from `RELAY_POWER`: a number retyped in a tooltip is a number
 * that stops following the code. A third direction would move the behaviour
 * and the sentence in one edit, because it is the same list.
 */
export const MOST_ADJACENT = ADJACENT.length;

export function adjacentAllies(state: GameState, e: Entity): Entity[] {
  const out: Entity[] = [];
  for (const at of ADJACENT) {
    const n = at(state, e);
    if (n === null || !n.alive || n.isHero) continue;
    out.push(n);
  }
  return out;
}

/**
 * The adjacent allied units that share `e`'s race (`'same'`), or that do not
 * (`'different'`). 0, 1 or 2 of them - never more.
 *
 * **This is the only place in `src/engine/` where two races are compared.**
 * Both polarities live in one function because two shipped traits want
 * opposite answers - Kindle rewards a dwarf for standing among dwarves, Banner
 * rewards a human for standing between races - and one comparison site is what
 * `test/tribes.test.ts`'s "the engine compares two races in exactly one place"
 * check reads off the source. A second site is how a counting trait gets
 * written by accident.
 *
 * **A hero counts nothing, both ways round.** `adjacentAllies` already refuses
 * to return one, so a hero is never somebody else's kin; this refuses to
 * answer for one at all, so a hero is never anybody's counter either. Without
 * the second half the two halves disagree: `'same'` would be 0 for a hero
 * because no unit is of race `'hero'`, while `'different'` would be every unit
 * beside it - a free +1 or +2 to any hero carrying Banner, earned by standing
 * at the right end of the line rather than by any race. No hero carries a
 * tribal trait today; the rule is written here rather than left to that.
 * Gated by "a tribal count is bounded at MOST_ADJACENT on any board the
 * accessor can be handed" in `test/tribes.test.ts`, which is where the
 * disagreement was found.
 */
export function adjacentKinOf(
  state: GameState,
  e: Entity,
  match: 'same' | 'different',
): Entity[] {
  if (e.isHero) return [];
  return adjacentAllies(state, e).filter((a) => (a.tribe === e.tribe) === (match === 'same'));
}

/** How many of them there are: 0, 1 or 2. */
export function adjacentKin(state: GameState, e: Entity, match: 'same' | 'different'): number {
  return adjacentKinOf(state, e, match).length;
}

export function cloneEntity(e: Entity): Entity {
  return {
    uid: e.uid,
    cardId: e.cardId,
    side: e.side,
    isHero: e.isHero,
    tribe: e.tribe,
    basePower: e.basePower,
    bonusPower: e.bonusPower,
    health: e.health,
    maxHealth: e.maxHealth,
    armour: e.armour,
    traits: e.traits.slice(),
    alive: e.alive,
    // Copied, not shared: a lookahead rollout equips and un-equips on its own
    // clone, and the slots object is the only mutable part of an Entity that is
    // not a primitive besides `traits`. The cards inside it are immutable data.
    equipment: e.equipment === null ? null : { ...e.equipment },
  };
}

export function cloneState(state: GameState): GameState {
  return {
    board: {
      player: state.board.player.map(cloneEntity),
      enemy: state.board.enemy.map(cloneEntity),
    },
    nextUid: state.nextUid,
  };
}
