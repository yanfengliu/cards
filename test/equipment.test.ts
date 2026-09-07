// Equipment: three fixed slots on the hero, replaced rather than stacked, and
// taken off at the end of every fight.
//
// `docs/design/game.md` is specific about all three of those, and about what
// equipment is for: "equipment amplifies an attack that already exists rather
// than switching one on". So a piece of equipment is two numbers and a slot,
// and the worked example's own third card - Iron Sword, weapon, hero +3 Power -
// is now runnable as written instead of being folded into the hero's base
// Power, which is what `test/worked-example.test.ts` had to do.
//
// Bound of this file - what a green run does and does not prove:
//
//   The slot behaviour is checked with the three shipped pieces and with
//   fixtures. It says nothing about a fourth slot, which the design does not
//   have, and nothing about equipment that grants a trait, which no card does -
//   see `src/content/cards.ts` for why not.
//
//   "Resets at the end of every fight" is checked at all three ways a fight can
//   end (either hero dying, and the round cap) plus directly through
//   `endFight`. It is not checked across fights, because a run is not built
//   yet: `src/run/` is another unit's.
//
//   The canonical-form test pins that an entity wearing nothing serialises
//   exactly as it did before equipment existed. That is what makes every hash
//   recorded before this round still reproduce, and it is the reason
//   `npm run verify` could be shown to hold still.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { equipItem } from '../src/engine/cast.ts';
import { EQUIPMENT_CARDS } from '../src/content/cards.ts';
import {
  type FightSetup,
  cloneFight,
  runRound,
  setupFight,
} from '../src/engine/fight.ts';
import { fightToCanonical, hashFight, stateToCanonical } from '../src/engine/hash.ts';
import { makeRng } from '../src/engine/rng.ts';
import { drain, endFight, resolvePhase } from '../src/engine/resolver.ts';
import {
  type CardPool,
  type Entity,
  type EquipmentCard,
  type GameState,
  type Side,
  type Trait,
  type UnitCard,
  armourOf,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  power,
  unitCount,
} from '../src/engine/state.ts';

function card(
  id: string,
  pow: number,
  health: number,
  armour: number,
  traits: readonly Trait[] = [],
): UnitCard {
  return { id, name: id, cost: 1, power: pow, health, armour, tribe: 'human', traits };
}

function item(
  id: string,
  slot: EquipmentCard['slot'],
  pow: number,
  armour: number,
): EquipmentCard {
  return { kind: 'equipment', id, name: id, cost: 1, slot, power: pow, armour };
}

function shipped(id: string): EquipmentCard {
  const c = EQUIPMENT_CARDS.find((x) => x.id === id);
  assert.ok(c !== undefined, `the shipped pool has ${id}`);
  return c;
}

type Fixture = {
  state: GameState;
  add: (side: Side, c: UnitCard, index?: number) => Entity;
};

function fixture(playerHeroPower = 2, enemyHeroPower = 0): Fixture {
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  state.board.player.push(
    makeHero(state, 'player', { name: 'Knight', health: 30, power: playerHeroPower, armour: 0 }),
  );
  state.board.enemy.push(
    makeHero(state, 'enemy', { name: 'Warchief', health: 30, power: enemyHeroPower, armour: 0 }),
  );
  return {
    state,
    add(side, c, index) {
      const u = makeUnit(state, side, c);
      insertUnit(state, side, u, index ?? unitCount(state, side));
      return u;
    },
  };
}

test('the worked example’s Iron Sword: the Knight swings at 2 base + 3 sword, for 3 through Armour 2', () => {
  // docs/design/game.md, "Worked example": Knight, base attack 2, Iron Sword
  // (weapon, hero +3 Power), against a Stone Troll with Armour 2. The example
  // says 5 Power - 2 armour = 3 damage, and until equipment existed that line
  // could only be run by giving the Knight base Power 5.
  //
  // Mutation watched going red: drop `equipPower(e)` from `power()`.
  const f = fixture(2);
  const troll = f.add('enemy', card('e_troll', 4, 10, 2, ['guard']));
  const hero = heroOf(f.state, 'player');

  equipItem(f.state, 'player', shipped('q_iron_sword'), makeRng(41, 'combat'));
  assert.equal(power(hero), 5, '2 base + 3 sword');

  const events = resolvePhase(f.state, 'player', makeRng(42, 'combat'));
  const swing = events.find((e) => e.kind === 'attacked');
  assert.ok(swing !== undefined && swing.kind === 'attacked');
  assert.deepEqual([swing.raw, swing.dealt], [5, 3]);
  assert.equal(troll.health, 7);
});

test('a new piece replaces what is in that slot, and the replaced piece stops counting', () => {
  // Mutation watched going red: `if (replaced === null) e.equipment[slot] = item`,
  // i.e. refuse to overwrite - the plausible mistake, and one that leaves every
  // other test in this file green.
  const f = fixture(2);
  const hero = heroOf(f.state, 'player');

  const first = equipItem(f.state, 'player', item('test:dagger', 'weapon', 1, 0), makeRng(43, 'combat'));
  assert.deepEqual(
    first.map((e) => (e.kind === 'equipped' ? [e.slot, e.itemId, e.replacedId] : null)),
    [['weapon', 'test:dagger', null]],
  );
  assert.equal(power(hero), 3);

  const second = equipItem(f.state, 'player', item('test:greatsword', 'weapon', 6, 0), makeRng(44, 'combat'));
  assert.deepEqual(
    second.map((e) => (e.kind === 'equipped' ? [e.slot, e.itemId, e.replacedId] : null)),
    [['weapon', 'test:greatsword', 'test:dagger']],
    'the event names what was taken off, so the swap can be animated',
  );
  assert.equal(power(hero), 8, '2 base + 6, never 2 + 1 + 6');
  assert.equal(hero.equipment?.weapon?.id, 'test:greatsword');
});

test('the three slots are independent and their numbers add up', () => {
  // Mutation watched going red: `e.equipment.weapon = effect.item` in apply's
  // equip case, ignoring the item's own slot.
  const f = fixture(2);
  const hero = heroOf(f.state, 'player');
  const rng = makeRng(45, 'combat');

  for (const id of ['q_iron_sword', 'q_chain_mail', 'q_oath_ring']) {
    equipItem(f.state, 'player', shipped(id), rng);
  }

  assert.deepEqual(
    [hero.equipment?.weapon?.id, hero.equipment?.armour?.id, hero.equipment?.trinket?.id],
    ['q_iron_sword', 'q_chain_mail', 'q_oath_ring'],
    'one piece per slot, each in its own',
  );
  assert.equal(power(hero), 6, '2 base + 3 sword + 0 mail + 1 ring');
  assert.equal(armourOf(hero), 3, '0 printed + 0 sword + 2 mail + 1 ring');
  assert.equal(hero.basePower, 2, 'and `basePower` still means printed Power');
  assert.equal(hero.armour, 0, 'as `armour` still means printed Armour');
});

test('worn Armour reduces an incoming hit, an attack and a spell alike', () => {
  // Mutation watched going red: `target.armour` restored in place of
  // `armourOf(target)` in apply's attack case.
  const f = fixture(0, 5);
  const hero = heroOf(f.state, 'player');
  equipItem(f.state, 'player', shipped('q_chain_mail'), makeRng(46, 'combat'));

  const events = resolvePhase(f.state, 'enemy', makeRng(47, 'combat'));
  const hit = events.find((e) => e.kind === 'attacked');
  assert.ok(hit !== undefined && hit.kind === 'attacked');
  assert.deepEqual([hit.raw, hit.dealt], [5, 3], '5 Power against Armour 2');
  assert.equal(hero.health, 27);
});

test('a unit has no slots at all, so equipping one is skipped rather than thrown at', () => {
  // Mutation watched going red: drop `|| e.equipment === null` from apply's
  // equip case, which then writes a slot onto `null` and crashes.
  //
  // Equipment attaches to the hero. A unit is not a hero with three empty
  // slots - it has none, which is why `Entity.equipment` is nullable rather
  // than always an object.
  const f = fixture(2);
  const unit = f.add('player', card('test:grunt', 1, 5, 0));
  assert.equal(unit.equipment, null);

  const { events } = drain(
    f.state,
    [{ kind: 'equip', uid: unit.uid, item: shipped('q_iron_sword') }],
    makeRng(48, 'combat'),
  );
  assert.deepEqual(events, [], 'nothing happened, and nothing threw');
  assert.equal(power(unit), 1);
});

test('everything worn comes off at the end of the fight', () => {
  // Mutation watched going red: delete `endFight(f.state)` from settleResult.
  const f = fixture(2);
  const hero = heroOf(f.state, 'player');
  const rng = makeRng(49, 'combat');
  for (const c of EQUIPMENT_CARDS) equipItem(f.state, 'player', c, rng);
  equipItem(f.state, 'enemy', shipped('q_iron_sword'), rng);
  assert.equal(power(hero), 6);

  endFight(f.state);

  assert.deepEqual(hero.equipment, { weapon: null, armour: null, trinket: null });
  assert.equal(power(hero), 2, 'back to the printed number');
  assert.equal(armourOf(hero), 0);
  assert.deepEqual(
    heroOf(f.state, 'enemy').equipment,
    { weapon: null, armour: null, trinket: null },
    'both sides, not just the player’s',
  );
});

// ---------------------------------------------------------------------------
// The same rule reached through a real fight rather than through `endFight`.
// ---------------------------------------------------------------------------

const CARDS: readonly UnitCard[] = [
  { id: 'test:grunt', name: 'Grunt', cost: 1, power: 2, health: 2, armour: 0, tribe: 'human', traits: [] },
];

const SWORD = item('test:sword', 'weapon', 3, 0);

const POOL: CardPool = {
  card(id) {
    const c = CARDS.find((x) => x.id === id);
    if (c === undefined) throw new Error(`test pool: no unit with id "${id}"`);
    return c;
  },
  energyPerTurn: 3,
  handSize: 5,
  castable: (id) => (id === SWORD.id ? SWORD : null),
};

function setup(overrides: Partial<FightSetup> = {}): FightSetup {
  return {
    seed: 1,
    pool: POOL,
    playerDeck: [SWORD.id, 'test:grunt', 'test:grunt'],
    enemyDeck: ['test:grunt'],
    enemyOpening: [],
    playerHero: { name: 'Knight', health: 30, power: 2, armour: 0 },
    enemyHero: { name: 'Warchief', health: 4, power: 1, armour: 0 },
    maxRounds: 12,
    ...overrides,
  };
}

test('a fight that ends with the hero armed leaves it unarmed', () => {
  // Mutation watched going red: delete `endFight(f.state)` from settleResult.
  // Reached through runRound, the one round code path, rather than by calling
  // endFight directly - so this also pins that the reset is wired in at all.
  const f = setupFight(setup());
  const hero = heroOf(f.state, 'player');

  const record = runRound(
    f,
    () => [],
    () => [{ cardId: SWORD.id }],
  );

  assert.ok(record !== null);
  assert.deepEqual(record.casts, [{ cardId: SWORD.id }], 'the cast is in the record');
  assert.equal(f.result, 'playerWin', '2 base + 3 sword against a 4-Health hero');
  assert.deepEqual(
    hero.equipment,
    { weapon: null, armour: null, trinket: null },
    'the fight is over, so the sword is off',
  );
});

test('a cloned fight’s equipment slots are a copy, so a rollout cannot disarm the live hero', () => {
  // Mutation watched going red: `equipment: e.equipment` in cloneEntity, i.e.
  // the slots object shared by reference. `Entity.equipment` is the second
  // mutable object on an entity after `traits`, and the existing clone test
  // says in its own body that it does not enumerate future fields.
  const live = setupFight(setup());
  equipItem(live.state, 'player', SWORD, makeRng(50, 'combat'));
  const clone = cloneFight(live);

  assert.notEqual(
    clone.state.board.player[clone.state.board.player.length - 1]!.equipment,
    live.state.board.player[live.state.board.player.length - 1]!.equipment,
  );

  endFight(clone.state);

  assert.equal(heroOf(clone.state, 'player').equipment?.weapon, null);
  assert.equal(
    heroOf(live.state, 'player').equipment?.weapon?.id,
    SWORD.id,
    'the live hero is still armed',
  );
  assert.equal(power(heroOf(live.state, 'player')), 5);
});

test('an entity wearing nothing serialises exactly as it did before equipment existed', () => {
  // Mutation watched going red: append the equipment segment unconditionally.
  //
  // This is the property the whole additive story rests on. Every hash recorded
  // before this round - and every number `npm run verify` prints - is a claim
  // about a fight in which nothing was equipped, and those fights must hash to
  // what they hashed to. So the segment is appended only when something is
  // worn, and an empty set of slots is the same string as no slots at all.
  const f = setupFight(setup());
  const before = fightToCanonical(f);
  assert.equal(
    before.includes(':eq('),
    false,
    'nothing is worn, so nothing about equipment is in the canonical form',
  );
  // A hero with three empty slots and a unit with no slots at all are the same
  // shape here: 12 colon-separated fields each.
  for (const e of f.state.board.player) {
    const rendered = stateToCanonical({ board: { player: [e], enemy: [] }, nextUid: 0 });
    assert.equal(rendered.split('|').length, 1);
    assert.equal(rendered.includes('eq('), false);
  }

  const hash = hashFight(f);
  equipItem(f.state, 'player', SWORD, makeRng(51, 'combat'));

  assert.equal(fightToCanonical(f).includes(':eq(weapon=test:sword/3/0,armour=-,trinket=-)'), true);
  assert.notEqual(hashFight(f), hash, 'and once something is worn the hash notices');

  endFight(f.state);
  assert.equal(fightToCanonical(f), before, 'taking it off returns the fight to its old form');
  assert.equal(hashFight(f), hash);
});
