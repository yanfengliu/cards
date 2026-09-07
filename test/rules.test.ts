// The combat rules from `docs/design/game.md`, each one on its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/engine/rng.ts';
import {
  type Effect,
  ResolverLoopError,
  drain,
  legalTargets,
  resolvePhase,
  startTurn,
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

function fixture(playerHeroPower = 2, enemyHeroPower = 2): Fixture {
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

test('the hero is the rightmost entity and therefore acts last', () => {
  const f = fixture();
  f.add('player', card('a', 1, 5, 0));
  f.add('player', card('b', 1, 5, 0));
  f.add('enemy', card('dummy', 0, 99, 0));

  const events = resolvePhase(f.state, 'player', makeRng(3, 'combat'));
  const actors = events.filter((e) => e.kind === 'attacked').map((e) => e.uid);
  const heroUid = heroOf(f.state, 'player').uid;
  assert.equal(actors[actors.length - 1], heroUid);
  assert.equal(actors.length, 3);
});

test('armour is flat per attack and never heals', () => {
  const f = fixture(1);
  const tough = f.add('enemy', card('tough', 0, 10, 5));
  resolvePhase(f.state, 'player', makeRng(4, 'combat'));
  assert.equal(tough.health, 10, '1 Power against Armour 5 deals zero, not minus four');
});

test('damage does not carry: overkill is wasted', () => {
  const f = fixture(7);
  const small = f.add('enemy', card('small', 0, 2, 0));
  const other = f.add('enemy', card('other', 0, 9, 0));
  resolvePhase(f.state, 'player', makeRng(5, 'combat'));
  const survivors = f.state.board.enemy.filter((e) => !e.isHero).map((e) => e.cardId);
  // Exactly one of the two died and the other is untouched at full health.
  assert.equal(survivors.length, 1);
  const alive = f.state.board.enemy.find((e) => !e.isHero)!;
  assert.equal(alive.health, alive.maxHealth, 'excess damage did not spill onto the next unit');
  assert.ok(small.health <= 0 || other.health <= 0);
});

test('Guard forces attacks onto Guards, randomly among them', () => {
  const f = fixture();
  // Health well above the 200 points of damage this test deals, so nothing dies
  // and the target pool is the same on every one of the rolls below.
  const g1 = f.add('enemy', card('g1', 0, 400, 0, ['guard']));
  const g2 = f.add('enemy', card('g2', 0, 400, 0, ['guard']));
  const soft = f.add('enemy', card('soft', 0, 400, 0));

  const attacker = f.add('player', card('att', 1, 5, 0));
  const targets = legalTargets(f.state, attacker).map((e) => e.uid);
  assert.deepEqual(targets.sort(), [g1.uid, g2.uid].sort());

  // The randomness half has to go through `pick`, on one real combat stream,
  // and read the targets back out of the events. Indexing the target list with
  // arithmetic of the test's own would measure the arithmetic: `i * 7919 % 2`
  // alternates whatever the resolver does, and passes with `pick` deleted.
  const rng = makeRng(11, 'combat');
  const struck = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const { events } = drain(f.state, [{ kind: 'attack', uid: attacker.uid }], rng);
    for (const e of events) if (e.kind === 'attacked') struck.add(e.targetUid);
  }
  const ascending = (a: number, b: number): number => a - b;
  assert.deepEqual(
    [...struck].sort(ascending),
    [g1.uid, g2.uid].sort(ascending),
    'both Guards were struck and nothing else ever was',
  );
  assert.equal(struck.has(soft.uid), false, 'the unguarded unit is never in the pool');
  assert.ok(g1.health < g1.maxHealth, 'the first Guard actually took hits');
  assert.ok(g2.health < g2.maxHealth, 'so did the second - a stuck picker fails here');
});

test('the hero is a legal target once the last Guard dies', () => {
  const f = fixture();
  const attacker = f.add('player', card('att', 1, 5, 0));
  const guard = f.add('enemy', card('g', 0, 1, 0, ['guard']));

  assert.deepEqual(
    legalTargets(f.state, attacker).map((e) => e.cardId),
    ['g'],
    'the hero is unreachable while a Guard lives',
  );

  guard.health = 0;
  guard.alive = false;
  f.state.board.enemy = f.state.board.enemy.filter((e) => e.alive || e.isHero);

  assert.deepEqual(
    legalTargets(f.state, attacker).map((e) => e.isHero),
    [true],
    'the hero sits in the pool alongside every unit',
  );
});

test('Relay grants a flat +2 to the right and does not compound down a line', () => {
  const f = fixture(0);
  f.add('player', card('r1', 1, 5, 0, ['relay']));
  f.add('player', card('r2', 1, 5, 0, ['relay']));
  f.add('player', card('r3', 1, 5, 0, ['relay']));
  f.add('enemy', card('dummy', 0, 99, 0));

  const events = resolvePhase(f.state, 'player', makeRng(6, 'combat'));
  const raws = events.filter((e) => e.kind === 'attacked').map((e) => (e.kind === 'attacked' ? e.raw : 0));
  // First unit is unbuffed; every later one receives exactly +2, never +2N.
  assert.deepEqual(raws, [1, 3, 3, 2]);
});

test('Relay from the rightmost unit reaches the hero', () => {
  const f = fixture(2);
  f.add('player', card('r', 1, 5, 0, ['relay']));
  f.add('enemy', card('dummy', 0, 99, 0));
  const events = resolvePhase(f.state, 'player', makeRng(6, 'combat'));
  const raws = events.filter((e) => e.kind === 'attacked').map((e) => (e.kind === 'attacked' ? e.raw : 0));
  assert.deepEqual(raws, [1, 4], 'the hero swings at 2 + 2');
});

test('buffs expire at the start of the owner’s next turn', () => {
  const f = fixture(2);
  f.add('player', card('r', 1, 5, 0, ['relay']));
  f.add('enemy', card('dummy', 0, 99, 0));
  resolvePhase(f.state, 'player', makeRng(6, 'combat'));
  assert.equal(heroOf(f.state, 'player').bonusPower, 2);
  startTurn(f.state, 'player');
  assert.equal(heroOf(f.state, 'player').bonusPower, 0);
});

test('Wake fires when the unit to my left dies', () => {
  const f = fixture(0);
  // The victim is the only Guard, so the killer has no choice of target.
  const victim = f.add('player', card('victim', 0, 1, 0, ['guard']));
  const waker = f.add('player', card('waker', 1, 5, 0, ['wake']));
  f.add('enemy', card('killer', 5, 20, 0));

  startTurn(f.state, 'enemy');
  resolvePhase(f.state, 'enemy', makeRng(9, 'combat'));

  assert.equal(victim.alive, false, 'Guard forced the hit onto the victim');
  assert.equal(waker.alive, true);
  assert.equal(waker.bonusPower, 2, 'the unit to the right of the dead one woke');
  assert.equal(
    f.state.board.player.some((e) => e.uid === victim.uid),
    false,
    'dead units leave the line',
  );
});

test('KNOWN DEFECT: Wake is inert - the +2 is always cleared before it can swing', () => {
  // This records current behaviour. It does not endorse it, and the rule is the
  // owner's to decide - see docs/work/1_turn-prototype/plan.md, which found Wake
  // dead for the side that resolves first and left the rule alone.
  //
  // The mechanism: `startTurn` clears bonusPower at the start of a side's own
  // phase, and a side's units only die during the opponent's phase. So the +2
  // Wake grants is always wiped before the woken unit next acts, and deleting
  // the trait from the resolver moves no row in any measurement.
  //
  // Both directions are gated here. Delete Wake and the first assertion fails;
  // make the buff survive to the swing and the last two fail. Either way this
  // test goes red, which is the point: a fix must be noticed, not silently
  // absorbed by a green suite.
  const f = fixture(0);
  const victim = f.add('player', card('victim', 0, 1, 0, ['guard']));
  const waker = f.add('player', card('waker', 1, 5, 0, ['wake']));
  // The only Guard on its side, so the woken unit's swing has one legal target.
  f.add('enemy', card('killer', 5, 40, 0, ['guard']));

  startTurn(f.state, 'enemy');
  resolvePhase(f.state, 'enemy', makeRng(9, 'combat'));
  assert.equal(victim.alive, false);
  assert.equal(waker.bonusPower, 2, 'Wake fired: the unit to the right of the dead one woke');

  // The player's next turn is the earliest the woken unit can spend it.
  startTurn(f.state, 'player');
  assert.equal(waker.bonusPower, 0, 'and the buff is gone before the unit can spend it');

  const events = resolvePhase(f.state, 'player', makeRng(10, 'combat'));
  const swing = events.find((e) => e.kind === 'attacked' && e.uid === waker.uid);
  assert.ok(swing !== undefined && swing.kind === 'attacked', 'the woken unit swung');
  assert.equal(swing.raw, 1, 'at its printed Power. Wake never reaches a swing.');
});

test('Wake does not fire for a death that is not my left neighbour', () => {
  const f = fixture(0);
  const victim = f.add('player', card('victim', 0, 1, 0, ['guard']));
  const spacer = f.add('player', card('spacer', 0, 9, 0));
  const waker = f.add('player', card('waker', 1, 5, 0, ['wake']));
  f.add('enemy', card('killer', 5, 20, 0));

  startTurn(f.state, 'enemy');
  resolvePhase(f.state, 'enemy', makeRng(9, 'combat'));

  assert.equal(victim.alive, false);
  assert.equal(spacer.bonusPower, 0, 'the spacer has no Wake');
  assert.equal(waker.bonusPower, 0, 'Wake reads its neighbour, never the whole line');
});

test('Ward removes the unit to my right from the target pool', () => {
  const f = fixture(0);
  f.add('player', card('warden', 0, 5, 0, ['ward']));
  const protectedUnit = f.add('player', card('soft', 0, 1, 0));
  const attacker = f.add('enemy', card('att', 5, 5, 0));

  assert.equal(
    legalTargets(f.state, attacker).some((e) => e.uid === protectedUnit.uid),
    true,
    'before the Warden acts, the unit to its right is a legal target',
  );

  resolvePhase(f.state, 'player', makeRng(2, 'combat'));
  assert.equal(protectedUnit.warded, true);
  assert.equal(
    legalTargets(f.state, attacker).some((e) => e.uid === protectedUnit.uid),
    false,
    'once the Warden has acted, its right neighbour cannot be struck',
  );
});

test('an attack with no legal target fizzles rather than throwing', () => {
  const f = fixture(0);
  f.add('player', card('warden', 0, 5, 0, ['ward']));
  f.add('player', card('onlyGuard', 0, 5, 0, ['guard']));
  const attacker = f.add('enemy', card('att', 5, 5, 0));

  resolvePhase(f.state, 'player', makeRng(2, 'combat'));
  assert.deepEqual(legalTargets(f.state, attacker), []);

  startTurn(f.state, 'enemy');
  const events = resolvePhase(f.state, 'enemy', makeRng(2, 'combat'));
  assert.equal(events.some((e) => e.kind === 'fizzled'), true);
});

test('no unit acts after dying, even with its action already queued', () => {
  // The guard being exercised is the `!e.alive` check in `apply`'s `act` case.
  // Taking the unit off the board before the phase starts does not reach it -
  // the phase loop skips what it cannot find, and the guard can be deleted
  // outright with the suite still green. So the unit has to be on the board,
  // alive when its action is queued, and dead when that action comes up.
  const f = fixture(0);
  const first = f.add('player', card('first', 1, 5, 0));
  f.add('enemy', card('dummy', 0, 99, 0));
  const hero = heroOf(f.state, 'player');
  // Zero Health and not yet through a checkpoint: the state anything is in
  // between taking a lethal hit and the resolver noticing. A hero stays on the
  // board when it dies, so the queued action still finds it.
  hero.health = 0;

  const { events } = drain(
    f.state,
    [
      { kind: 'act', uid: first.uid },
      { kind: 'act', uid: hero.uid },
    ],
    makeRng(8, 'combat'),
  );

  assert.equal(hero.alive, false, 'the checkpoint after the first action killed the hero');
  assert.equal(events.some((e) => e.kind === 'died' && e.uid === hero.uid), true);
  assert.equal(
    events.some((e) => e.uid === hero.uid && (e.kind === 'acted' || e.kind === 'attacked')),
    false,
    'an entity that died before its queued action came up does not act',
  );
});

test('the resolver caps its loop and throws with the queue trace', () => {
  const f = fixture(1);
  f.add('enemy', card('dummy', 0, 99, 0));
  const queue: Effect[] = [{ kind: 'act', uid: heroOf(f.state, 'player').uid }];
  assert.throws(
    () => drain(f.state, queue, makeRng(1, 'combat'), 1),
    (err: unknown) => {
      assert.ok(err instanceof ResolverLoopError);
      assert.match(err.message, /exceeded 1 iterations/);
      assert.match(err.message, /Last effects applied: act#/);
      assert.ok(err.trace.length > 0);
      return true;
    },
  );
});

test('insertUnit rejects an illegal slot and says what would be legal', () => {
  const f = fixture();
  assert.throws(
    () => insertUnit(f.state, 'player', makeUnit(f.state, 'player', card('x', 1, 1, 0)), 3),
    /index 3 is not a legal slot for the player line, which has 0 unit\(s\) and accepts 0\.\.0/,
  );
});
