// The worked example from `docs/design/game.md` is the specification. This
// walks it through the engine and checks every number in it.
//
// One substitution: the design's third card is an Iron Sword (Equipment,
// hero +3 Power) and equipment did not exist when this was written, so the
// Knight is given base Power 5 instead of 2. The arithmetic the example is
// proving - armour subtracted per attack, Relay's flat +2 landing on whoever is
// to the right, the hero swinging last - is unchanged.
//
// Equipment exists now, and the substitution is kept rather than undone: this
// file is about the cascade and the packaging, and folding the sword in keeps
// one thing under test per file. The real card, at its printed numbers, is run
// against the example's own Troll by "the worked example's Iron Sword" in
// `test/equipment.test.ts`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/engine/rng.ts';
import { resolvePhase, startTurn } from '../src/engine/resolver.ts';
import {
  type GameState,
  type UnitCard,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  unitCount,
} from '../src/engine/state.ts';

const SQUIRE: UnitCard = {
  id: 'u_squire',
  name: 'Human Squire',
  cost: 1,
  power: 1,
  health: 2,
  armour: 0,
  tribe: 'human',
  traits: ['relay'],
};

const SHIELDBEARER: UnitCard = {
  id: 'u_shieldbearer',
  name: 'Dwarf Shieldbearer',
  cost: 1,
  power: 1,
  health: 3,
  armour: 0,
  tribe: 'dwarf',
  traits: ['guard'],
};

// The design's example says "Enemy board - one Stone Troll" and then has every
// player attack land on it. It never says what keeps those attacks off the
// enemy hero, which is a legal target by the same document's targeting rule.
// The Guard here supplies the missing constraint so the example's arithmetic
// can be checked at all; Guard changes nothing else in the walk-through. The
// gap is recorded in docs/work/1_turn-prototype/plan.md, and the test below
// named "the worked example under-specifies its own targeting" shows what the
// example does without it.
const TROLL: UnitCard = {
  id: 'e_troll',
  name: 'Stone Troll',
  cost: 3,
  power: 4,
  health: 10,
  armour: 2,
  tribe: 'beast',
  traits: ['guard'],
};

/** Knight with the Iron Sword already accounted for: 30 Health, 5 Power. */
function board(order: readonly UnitCard[]): GameState {
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  state.board.player.push(makeHero(state, 'player', { name: 'Knight', health: 30, power: 5, armour: 0 }));
  state.board.enemy.push(makeHero(state, 'enemy', { name: 'Warchief', health: 30, power: 0, armour: 0 }));
  for (const card of order) {
    insertUnit(state, 'player', makeUnit(state, 'player', card), unitCount(state, 'player'));
  }
  insertUnit(state, 'enemy', makeUnit(state, 'enemy', TROLL), unitCount(state, 'enemy'));
  return state;
}

function troll(state: GameState) {
  const t = state.board.enemy.find((e) => e.cardId === 'e_troll');
  assert.ok(t, 'the troll should still be on the board');
  return t;
}

test('arrangement A: Squire then Shieldbearer deals 4 to the Troll', () => {
  const state = board([SQUIRE, SHIELDBEARER]);
  const rng = makeRng(1, 'combat');

  const events = resolvePhase(state, 'player', rng);
  const attacks = events.filter((e) => e.kind === 'attacked');

  // 1. Squire: 1 Power - 2 armour = 0 damage. Relay fires on the Shieldbearer.
  // 2. Shieldbearer: 1 + 2 = 3 Power - 2 armour = 1 damage.
  // 3. Hero: 5 Power - 2 armour = 3 damage.
  assert.deepEqual(
    attacks.map((a) => (a.kind === 'attacked' ? [a.raw, a.dealt] : null)),
    [
      [1, 0],
      [3, 1],
      [5, 3],
    ],
  );
  assert.equal(troll(state).health, 6, 'Troll takes 4 and drops to 6');
});

test('arrangement B: Shieldbearer then Squire deals 5, because Relay reaches the hero', () => {
  const state = board([SHIELDBEARER, SQUIRE]);
  const rng = makeRng(1, 'combat');

  const events = resolvePhase(state, 'player', rng);
  const attacks = events.filter((e) => e.kind === 'attacked');

  // 1. Shieldbearer: 1 - 2 = 0.
  // 2. Squire: 1 - 2 = 0. Relay fires on the hero: +2 Power.
  // 3. Hero: 5 + 2 = 7 - 2 = 5.
  assert.deepEqual(
    attacks.map((a) => (a.kind === 'attacked' ? [a.raw, a.dealt] : null)),
    [
      [1, 0],
      [1, 0],
      [7, 5],
    ],
  );
  assert.equal(troll(state).health, 5, 'Troll takes 5 and drops to 5');
});

test('both arrangements deal the same raw total; only the packaging differs', () => {
  const rawTotal = (order: readonly UnitCard[]): number => {
    const state = board(order);
    const events = resolvePhase(state, 'player', makeRng(1, 'combat'));
    return events.reduce((sum, e) => (e.kind === 'attacked' ? sum + e.raw : sum), 0);
  };
  assert.equal(rawTotal([SQUIRE, SHIELDBEARER]), rawTotal([SHIELDBEARER, SQUIRE]));
  assert.equal(rawTotal([SQUIRE, SHIELDBEARER]), 9);
});

test('the worked example under-specifies its own targeting', () => {
  // Taken literally - a lone Troll with no Guard - the enemy hero is in the
  // pool and some of those attacks land on it instead, so the example's "Troll
  // takes 4" holds only under a constraint the document does not state.
  const plain: UnitCard = { ...TROLL, traits: [] };
  const state = board([]);
  state.board.enemy = state.board.enemy.filter((e) => e.isHero);
  insertUnit(state, 'enemy', makeUnit(state, 'enemy', plain), 0);
  insertUnit(state, 'player', makeUnit(state, 'player', SQUIRE), 0);
  insertUnit(state, 'player', makeUnit(state, 'player', SHIELDBEARER), 1);

  const heroHit = new Set<boolean>();
  for (let seed = 0; seed < 20; seed++) {
    const trial = board([]);
    trial.board.enemy = trial.board.enemy.filter((e) => e.isHero);
    insertUnit(trial, 'enemy', makeUnit(trial, 'enemy', plain), 0);
    insertUnit(trial, 'player', makeUnit(trial, 'player', SQUIRE), 0);
    insertUnit(trial, 'player', makeUnit(trial, 'player', SHIELDBEARER), 1);
    const events = resolvePhase(trial, 'player', makeRng(seed, 'combat'));
    const enemyHeroUid = heroOf(trial, 'enemy').uid;
    heroHit.add(events.some((e) => e.kind === 'attacked' && e.targetUid === enemyHeroUid));
  }
  assert.equal(heroHit.has(true), true, 'the enemy hero is reachable in the example as written');
});

test('the enemy turn is identical in both: Guard forces the hit, the hero takes nothing', () => {
  for (const order of [
    [SQUIRE, SHIELDBEARER],
    [SHIELDBEARER, SQUIRE],
  ]) {
    const state = board(order);
    // Give the Troll its real Power for the counter-attack.
    resolvePhase(state, 'player', makeRng(1, 'combat'));
    startTurn(state, 'enemy');
    resolvePhase(state, 'enemy', makeRng(7, 'combat'));

    const hero = heroOf(state, 'player');
    assert.equal(hero.health, 30, 'the hero is unreachable while a Guard lives');
    assert.equal(
      state.board.player.some((e) => e.cardId === 'u_shieldbearer'),
      false,
      '4 Power against 3 Health kills the Shieldbearer',
    );
    assert.equal(
      state.board.player.some((e) => e.cardId === 'u_squire'),
      true,
      'the Squire is not a Guard, so it cannot be hit while one lives',
    );
  }
});
