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

export type Trait = 'guard' | 'relay' | 'wake' | 'ward';

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

export type HeroSpec = {
  readonly name: string;
  readonly health: number;
  readonly power: number;
  readonly armour: number;
};

export type Entity = {
  uid: number;
  cardId: string;
  side: Side;
  isHero: boolean;
  /** Printed Power. Permanent growth would change this; nothing here does. */
  basePower: number;
  /** Buffs granted during resolution. Cleared at the start of the owner's turn. */
  bonusPower: number;
  health: number;
  maxHealth: number;
  armour: number;
  traits: Trait[];
  alive: boolean;
  /** Set by a Ward on my left when it acts. Cleared at the start of my side's turn. */
  warded: boolean;
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
};

export type GameState = {
  board: { player: Entity[]; enemy: Entity[] };
  nextUid: number;
};

export function otherSide(side: Side): Side {
  return side === 'player' ? 'enemy' : 'player';
}

export function power(e: Entity): number {
  return e.basePower + e.bonusPower;
}

export function makeHero(state: GameState, side: Side, spec: HeroSpec): Entity {
  return {
    uid: state.nextUid++,
    cardId: `hero:${spec.name}`,
    side,
    isHero: true,
    basePower: spec.power,
    bonusPower: 0,
    health: spec.health,
    maxHealth: spec.health,
    armour: spec.armour,
    traits: [],
    alive: true,
    warded: false,
  };
}

export function makeUnit(state: GameState, side: Side, card: UnitCard): Entity {
  return {
    uid: state.nextUid++,
    cardId: card.id,
    side,
    isHero: false,
    basePower: card.power,
    bonusPower: 0,
    health: card.health,
    maxHealth: card.health,
    armour: card.armour,
    traits: card.traits.slice(),
    alive: true,
    warded: false,
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

export function cloneEntity(e: Entity): Entity {
  return {
    uid: e.uid,
    cardId: e.cardId,
    side: e.side,
    isHero: e.isHero,
    basePower: e.basePower,
    bonusPower: e.bonusPower,
    health: e.health,
    maxHealth: e.maxHealth,
    armour: e.armour,
    traits: e.traits.slice(),
    alive: e.alive,
    warded: e.warded,
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
