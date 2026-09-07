// The worked example from `docs/design/game.md` is the specification. This
// walks it through the engine and checks every number in it.
//
// One substitution: the design's Knight is wearing an Iron Sword (Equipment,
// hero +3 Power), and this file gives the Knight base Power 5 instead of
// 2-plus-a-sword. The arithmetic the example proves - armour subtracted per
// attack, retaliation coming back on the same exchange, Wake answering a death
// inside your own phase, the hero swinging last - is unchanged, and folding the
// sword in keeps one thing under test per file. The real card at its printed
// numbers is run against a Troll by "the worked example's Iron Sword" in
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

const AVENGER: UnitCard = {
  id: 'u_avenger',
  name: 'Dwarf Avenger',
  cost: 2,
  power: 2,
  health: 3,
  armour: 0,
  tribe: 'dwarf',
  traits: ['wake'],
};

// The example's Troll carries Guard, and that is a fix rather than a flourish.
// The document used to say "Enemy board - one Stone Troll" and then have every
// player attack land on it, while its own targeting rule puts the enemy hero in
// the pool alongside every unit - so the arithmetic was not reproducible as
// written. Guard supplies the missing constraint and is now stated in the
// document itself. The test below named "the worked example under-specifies its
// own targeting" is what shows the example without it.
const TROLL: UnitCard = {
  id: 'e_troll',
  name: 'Stone Troll',
  cost: 3,
  power: 3,
  health: 7,
  armour: 2,
  tribe: 'beast',
  traits: ['guard'],
};

/** Knight with the Iron Sword already accounted for: 30 Health, 5 Power. */
function board(order: readonly UnitCard[]): GameState {
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  state.board.player.push(
    makeHero(state, 'player', { name: 'Knight', health: 30, power: 5, armour: 0 }),
  );
  state.board.enemy.push(
    makeHero(state, 'enemy', { name: 'Warchief', health: 30, power: 2, armour: 0 }),
  );
  for (const card of order) {
    insertUnit(state, 'player', makeUnit(state, 'player', card), unitCount(state, 'player'));
  }
  insertUnit(state, 'enemy', makeUnit(state, 'enemy', TROLL), unitCount(state, 'enemy'));
  return state;
}

function troll(state: GameState) {
  return state.board.enemy.find((e) => e.cardId === 'e_troll') ?? null;
}

test('arrangement A: Squire then Avenger deals 5, because Wake answers the Squire’s death', () => {
  const state = board([SQUIRE, AVENGER]);
  const events = resolvePhase(state, 'player', makeRng(1, 'combat'));
  const attacks = events.filter((e) => e.kind === 'attacked');

  // 1. Squire: 1 Power - 2 armour = 0. Takes 3 back and dies at 2 Health, so it
  //    never reaches afterAct and Relay does not fire.
  // 2. The checkpoint announces the death; the Avenger is to its right and has
  //    Wake: +2 Power, now 4.
  // 3. Avenger: 4 - 2 = 2 damage. Takes 3 back and dies at 3 Health.
  // 4. Hero: 2 base + 3 sword = 5 - 2 = 3 damage. A hero takes nothing back.
  assert.deepEqual(
    attacks.map((a) => (a.kind === 'attacked' ? [a.raw, a.dealt] : null)),
    [
      [1, 0],
      [4, 2],
      [5, 3],
    ],
  );
  assert.equal(
    events.some((e) => e.kind === 'powerGained' && e.amount === 2),
    true,
    'Wake fired inside the player’s own phase - which is the whole point of mutual damage',
  );
  assert.equal(troll(state)!.health, 2, 'Troll takes 5 and drops to 2');
  assert.deepEqual(
    state.board.player.filter((e) => !e.isHero).map((e) => e.cardId),
    [],
    'both bodies died to retaliation, in the player’s own phase',
  );
});

test('arrangement B: Avenger then Squire deals 3, because nothing answers the death', () => {
  const state = board([AVENGER, SQUIRE]);
  const events = resolvePhase(state, 'player', makeRng(1, 'combat'));
  const attacks = events.filter((e) => e.kind === 'attacked');

  // 1. Avenger: 2 - 2 = 0. Takes 3 back and dies. Its right-hand neighbour is
  //    the Squire, which has no Wake, so nothing answers the death.
  // 2. Squire: 1 - 2 = 0. Takes 3 back and dies; Relay never fires.
  // 3. Hero: 5 - 2 = 3.
  assert.deepEqual(
    attacks.map((a) => (a.kind === 'attacked' ? [a.raw, a.dealt] : null)),
    [
      [2, 0],
      [1, 0],
      [5, 3],
    ],
  );
  assert.equal(
    events.some((e) => e.kind === 'powerGained'),
    false,
    'no trait fired: Wake read a neighbour that had not died',
  );
  assert.equal(troll(state)!.health, 4, 'Troll takes 3 and drops to 4');
});

test('every attack in both arrangements draws retaliation back on the same exchange', () => {
  for (const order of [
    [SQUIRE, AVENGER],
    [AVENGER, SQUIRE],
  ]) {
    const state = board(order);
    const events = resolvePhase(state, 'player', makeRng(1, 'combat'));
    const attacks = events.filter((e) => e.kind === 'attacked');
    const backs = events.filter((e) => e.kind === 'retaliated');
    // Two unit attacks draw retaliation; the hero's does not.
    assert.equal(attacks.length, 3);
    assert.equal(backs.length, 2, 'a hero takes nothing back when it attacks');
    for (const b of backs) {
      assert.ok(b.kind === 'retaliated');
      assert.equal(b.raw, 3, 'the Troll hits back at its own printed Power');
      assert.equal(b.dealt, 3, 'neither body carries armour');
    }
  }
});

test('the worked example under-specifies its own targeting without Guard', () => {
  // Taken literally - a lone Troll with no Guard - the enemy hero is in the
  // pool and some of those attacks land on it instead, so the example's numbers
  // hold only under a constraint the document has to state. It now does.
  const plain: UnitCard = { ...TROLL, traits: [] };
  const heroHit = new Set<boolean>();
  for (let seed = 0; seed < 20; seed++) {
    const trial = board([]);
    trial.board.enemy = trial.board.enemy.filter((e) => e.isHero);
    insertUnit(trial, 'enemy', makeUnit(trial, 'enemy', plain), 0);
    insertUnit(trial, 'player', makeUnit(trial, 'player', SQUIRE), 0);
    insertUnit(trial, 'player', makeUnit(trial, 'player', AVENGER), 1);
    const events = resolvePhase(trial, 'player', makeRng(seed, 'combat'));
    const enemyHeroUid = heroOf(trial, 'enemy').uid;
    heroHit.add(events.some((e) => e.kind === 'attacked' && e.targetUid === enemyHeroUid));
  }
  assert.equal(heroHit.has(true), true, 'the enemy hero is reachable in the example as written');
});

test('the enemy turn: the Knight hits back, and in A that finishes the Troll', () => {
  // The other half of mutual damage, and the reason the two arrangements differ
  // by more than three points of Health. A defender always retaliates, hero
  // included - so the Troll striking a Knight that swings at 5 takes 5 - 2 = 3
  // back. In A the Troll is on 2 and dies on its own turn; in B it is on 4 and
  // survives on 1.
  const outcome = (order: readonly UnitCard[]): { troll: number | null; hero: number } => {
    const state = board(order);
    resolvePhase(state, 'player', makeRng(1, 'combat'));
    startTurn(state, 'enemy');
    resolvePhase(state, 'enemy', makeRng(7, 'combat'));
    const t = troll(state);
    return { troll: t === null ? null : t.health, hero: heroOf(state, 'player').health };
  };

  const a = outcome([SQUIRE, AVENGER]);
  assert.equal(a.troll, null, 'the Troll took 3 back onto 2 Health and left the board');
  assert.equal(a.hero, 25, 'the Knight took 3 from the Troll and 2 from the Warchief');

  const b = outcome([AVENGER, SQUIRE]);
  assert.equal(b.troll, 1, 'in B the Troll started the exchange on 4 and survives on 1');
  assert.equal(b.hero, 25, 'the Knight took the same 5 either way');
});
