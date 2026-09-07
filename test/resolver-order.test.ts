// The resolver's ordering contract, made observable.
//
// ARCHITECTURE.md promises six things about the order things resolve in. Until
// this file existed every one of them was unfalsifiable: the suite stayed green
// with the trigger loop reversed, with the trigger loop ordered by uid, with the
// queue turned into a stack, with deaths deferred to the end of the drain, with
// the acting order read live instead of snapshotted, and with reactions queued
// ahead of direct continuations. Each test names the mutation it was watched
// failing under; the failures themselves are in docs/learning/gate-proofs.md.
//
// Bound of this file - what a green run does and does not prove:
//
//   These are fixtures, not cards. No id below exists in src/content, and this
//   file adds nothing to the pool.
//
//   Three of the six properties cannot be reached from the shipped traits at
//   all: every shipped trigger is keyed to one uid, so no event can match two
//   units, and the board-order loop then decides nothing. Those three hand
//   drain() a trigger rule of their own. They prove the loops order correctly
//   given a rule that fires for more than one unit - which is the day the
//   property starts mattering, and the day the mutations stop being harmless.
//
//   Order is asserted on the events and the effect trace, not only on final
//   state, because for two buffs landing on two different units the order IS
//   the observable: the state is the same either way, and the event stream is
//   what the animation layer replays.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/engine/rng.ts';
import {
  type Effect,
  type GameEvent,
  type TriggerRule,
  DEFAULT_MAX_ITERATIONS,
  drain,
  resolvePhase,
} from '../src/engine/resolver.ts';
import {
  type Entity,
  type GameState,
  type Side,
  type Trait,
  type UnitCard,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  unitCount,
} from '../src/engine/state.ts';

function card(
  id: string,
  power: number,
  health: number,
  armour: number,
  traits: readonly Trait[] = [],
): UnitCard {
  return { id, name: id, cost: 1, power, health, armour, tribe: 'human', traits };
}

type Fixture = {
  state: GameState;
  add: (side: Side, c: UnitCard, index?: number) => Entity;
};

/** Heroes swing for 0 by default here, so they add nothing to what is measured. */
function fixture(playerHeroPower = 0, enemyHeroPower = 0): Fixture {
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

const WATCHER = 'test:watcher';
const RIPOSTE = 'test:riposte';
const EAGER = 'test:eager';

/** Test-only trait: any death anywhere gives me +1 Power. Matches many units. */
const watchDeaths: TriggerRule = (_state, event, e) =>
  event.kind === 'died' && e.cardId === WATCHER
    ? [{ kind: 'gainPower', uid: e.uid, amount: 1, sourceUid: event.uid }]
    : [];

/** Test-only trait: when I am struck, I strike back out of turn. */
const riposte: TriggerRule = (_state, event, e) =>
  event.kind === 'attacked' && event.targetUid === e.uid && e.cardId === RIPOSTE
    ? [{ kind: 'attack', uid: e.uid }]
    : [];

/** Test-only trait: acting gives me +5 Power - a reaction to my own action. */
const eager: TriggerRule = (_state, event, e) =>
  event.kind === 'acted' && event.uid === e.uid && e.cardId === EAGER
    ? [{ kind: 'gainPower', uid: e.uid, amount: 5, sourceUid: e.uid }]
    : [];

function uidsOf(events: readonly GameEvent[], kind: GameEvent['kind']): number[] {
  return events.filter((e) => e.kind === kind).map((e) => e.uid);
}

test('trigger order is board order: the player line left to right, then the enemy line', () => {
  // Mutation watched going red: iterate the sides and each line in reverse.
  const f = fixture();
  const w1 = f.add('player', card(WATCHER, 0, 5, 0));
  const w2 = f.add('player', card(WATCHER, 0, 5, 0));
  const w3 = f.add('enemy', card(WATCHER, 0, 5, 0));
  const corpse = f.add('enemy', card('test:corpse', 0, 5, 0));
  // A unit at zero Health that has not reached a checkpoint yet: the state that
  // exists between damage landing and checkStateBased running.
  corpse.health = 0;

  const { events } = drain(
    f.state,
    [{ kind: 'afterAct', uid: w1.uid }],
    makeRng(1, 'combat'),
    DEFAULT_MAX_ITERATIONS,
    watchDeaths,
  );

  assert.equal(uidsOf(events, 'died').length, 1, 'the fixture must produce exactly one death');
  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [w1.uid, w2.uid, w3.uid],
    'three units answered one death; they answered in board order',
  );
});

test('trigger order is board index, not uid: a later-made unit standing left goes first', () => {
  // Mutation watched going red: order the line by uid instead of by index.
  const f = fixture();
  const low = f.add('player', card(WATCHER, 0, 5, 0), 0);
  const high = f.add('player', card(WATCHER, 0, 5, 0), 0);
  const corpse = f.add('enemy', card('test:corpse', 0, 5, 0));
  corpse.health = 0;

  assert.ok(high.uid > low.uid, 'the fixture needs uid order to disagree with board order');
  assert.deepEqual(
    f.state.board.player.map((e) => e.uid),
    [high.uid, low.uid, heroOf(f.state, 'player').uid],
    'the later-made unit stands to the left',
  );

  const { events } = drain(
    f.state,
    [{ kind: 'afterAct', uid: low.uid }],
    makeRng(1, 'combat'),
    DEFAULT_MAX_ITERATIONS,
    watchDeaths,
  );

  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [high.uid, low.uid],
    'where a unit stands decides, not when it was made',
  );
});

test('inside one unit, traits fire in the source order of the blocks: Relay before Ward', () => {
  // Mutation watched going red: move Ward's block above Relay's in triggersFor.
  // This is the only tie-break the resolver has for one unit with two triggering
  // traits, and triggersFor's comment is the only place it is written down.
  const f = fixture();
  const both = f.add('player', card('test:relay+ward', 1, 5, 0, ['relay', 'ward']));
  const right = f.add('player', card('test:right', 1, 5, 0));

  const { events, trace } = drain(
    f.state,
    [{ kind: 'afterAct', uid: both.uid }],
    makeRng(2, 'combat'),
  );

  assert.deepEqual(trace.map((e) => e.kind), ['afterAct', 'gainPower', 'grantWard']);
  assert.deepEqual(events.map((e) => e.kind), ['afterActed', 'powerGained', 'warded']);
  assert.equal(right.bonusPower, 2);
  assert.equal(right.warded, true);
});

test('it is a queue, not a stack: the first effect queued is the first applied', () => {
  // Mutation watched going red: queue.shift() -> queue.pop().
  const f = fixture();
  // The Guard is the only legal target on its side, so warding it leaves the
  // attacker nothing to hit - and whether that happens is purely a question of
  // which of these two effects is applied first.
  const guard = f.add('player', card('test:guard', 0, 5, 0, ['guard']));
  const attacker = f.add('enemy', card('test:attacker', 3, 5, 0));

  const queue: Effect[] = [
    { kind: 'grantWard', uid: guard.uid, sourceUid: guard.uid },
    { kind: 'attack', uid: attacker.uid },
  ];
  const { events, trace } = drain(f.state, queue, makeRng(3, 'combat'));

  assert.deepEqual(trace.map((e) => e.kind), ['grantWard', 'attack']);
  assert.equal(guard.health, 5, 'the ward was applied first, so the attack found no target');
  assert.equal(events.some((e) => e.kind === 'fizzled'), true);
});

test('deaths are batched after every effect, not once at the end of the drain', () => {
  // Mutation watched going red: run checkStateBased only when the queue empties.
  const f = fixture();
  const killer = f.add('player', card('test:killer', 5, 5, 0));
  const second = f.add('player', card('test:second', 4, 5, 0));
  const guard = f.add('enemy', card('test:guard', 0, 1, 0, ['guard']));
  const enemyHero = heroOf(f.state, 'enemy');

  const queue: Effect[] = [
    { kind: 'attack', uid: killer.uid },
    { kind: 'attack', uid: second.uid },
  ];
  const { events } = drain(f.state, queue, makeRng(4, 'combat'));

  assert.equal(guard.alive, false);
  assert.deepEqual(
    events.map((e) => e.kind),
    ['attacked', 'died', 'attacked'],
    'the death landed between the two attacks, not after both of them',
  );
  assert.equal(
    enemyHero.health,
    26,
    'the Guard left the board at the checkpoint, so the second attack reached the hero',
  );
});

test('the acting order is snapshotted: a unit removed mid-phase does not shift the line', () => {
  // Mutation watched going red: walk state.board[side] by live index instead of
  // resolving the uid list captured before the phase.
  const f = fixture(1);
  // The only Guard on its side, so the riposte below has no choice of target.
  const first = f.add('player', card('test:first', 1, 1, 0, ['guard']));
  const middle = f.add('player', card('test:middle', 1, 20, 0));
  const last = f.add('player', card('test:last', 1, 20, 0));
  // The only Guard on its side, so every player attack lands here.
  f.add('enemy', card(RIPOSTE, 5, 40, 0, ['guard']));

  const events = resolvePhase(
    f.state,
    'player',
    makeRng(7, 'combat'),
    DEFAULT_MAX_ITERATIONS,
    riposte,
  );

  assert.equal(first.alive, false, 'the riposte killed the leftmost unit during its own action');
  assert.equal(
    f.state.board.player.length,
    3,
    'exactly one unit left the line mid-phase',
  );
  const acted = uidsOf(events, 'acted');
  assert.deepEqual(
    acted,
    [first.uid, middle.uid, last.uid, heroOf(f.state, 'player').uid],
    'the line acts in the order it stood in when the phase began',
  );
  assert.equal(new Set(acted).size, acted.length, 'and no unit acts twice');
});

test('direct continuations are queued ahead of reactions to the same effect', () => {
  // Mutation watched going red: swap the two queue.push loops in drain.
  const f = fixture();
  const actor = f.add('player', card(EAGER, 1, 5, 0));
  const target = f.add('enemy', card('test:target', 0, 99, 0, ['guard']));

  const { events } = drain(
    f.state,
    [{ kind: 'act', uid: actor.uid }],
    makeRng(5, 'combat'),
    DEFAULT_MAX_ITERATIONS,
    eager,
  );

  const attacked = events.find((e) => e.kind === 'attacked');
  assert.ok(attacked !== undefined && attacked.kind === 'attacked');
  assert.equal(attacked.raw, 1, 'acting spawns the attack; the reaction to having acted queues behind it');
  assert.equal(target.health, 98);
  assert.equal(actor.bonusPower, 5, 'the reaction still lands - later, which is the whole point');
});
