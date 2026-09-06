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
  const g1 = f.add('enemy', card('g1', 0, 20, 0, ['guard']));
  const g2 = f.add('enemy', card('g2', 0, 20, 0, ['guard']));
  f.add('enemy', card('soft', 0, 20, 0));

  const attacker = f.add('player', card('att', 1, 5, 0));
  const targets = legalTargets(f.state, attacker).map((e) => e.uid);
  assert.deepEqual(targets.sort(), [g1.uid, g2.uid].sort());

  // Over many rolls both Guards get picked and nothing else ever does.
  const seen = new Set<number>();
  const rng = makeRng(11, 'combat');
  for (let i = 0; i < 200; i++) {
    const t = legalTargets(f.state, attacker);
    seen.add(t[Math.floor((i * 7919) % t.length)]!.uid);
  }
  assert.equal(seen.size, 2);
  void rng;
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

test('no unit acts after dying', () => {
  const f = fixture(0);
  const doomed = f.add('player', card('doomed', 1, 1, 0));
  f.add('enemy', card('dummy', 0, 99, 0));
  doomed.health = 0;
  doomed.alive = false;
  f.state.board.player = f.state.board.player.filter((e) => e.alive || e.isHero);
  const events = resolvePhase(f.state, 'player', makeRng(8, 'combat'));
  assert.equal(events.some((e) => e.kind === 'attacked' && e.uid === doomed.uid), false);
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
