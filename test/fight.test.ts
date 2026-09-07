// The fight shell: what a fight is handed, and what a clone of one shares.
//
// The pool below is this file's own. That is the point of the seam: the engine
// takes its cards as an argument, so a test can hand it two cards and never
// touch `src/content` at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type FightSetup, cloneFight, setupFight } from '../src/engine/fight.ts';
import type { CardPool, UnitCard } from '../src/engine/state.ts';

const CARDS: readonly UnitCard[] = [
  { id: 'test:grunt', name: 'Grunt', cost: 1, power: 2, health: 2, armour: 0, tribe: 'human', traits: [] },
  { id: 'test:wall', name: 'Wall', cost: 2, power: 1, health: 5, armour: 1, tribe: 'dwarf', traits: ['guard'] },
];

const POOL: CardPool = {
  card(id) {
    const c = CARDS.find((x) => x.id === id);
    if (c === undefined) {
      const known = CARDS.map((x) => x.id).join(', ');
      throw new Error(`test pool: no card with id "${id}". Known ids: ${known}`);
    }
    return c;
  },
  energyPerTurn: 3,
  handSize: 5,
};

function setup(overrides: Partial<FightSetup> = {}): FightSetup {
  return {
    seed: 1,
    pool: POOL,
    playerDeck: ['test:grunt', 'test:wall', 'test:grunt'],
    enemyDeck: ['test:grunt', 'test:grunt'],
    enemyOpening: ['test:grunt'],
    playerHero: { name: 'Knight', health: 30, power: 2, armour: 0 },
    enemyHero: { name: 'Warchief', health: 18, power: 2, armour: 0 },
    maxRounds: 12,
    ...overrides,
  };
}

test('a fight is handed its cards, and the pool owns the unknown-id message', () => {
  const f = setupFight(setup());
  assert.equal(f.state.board.enemy.length, 2, 'the opening body, then the hero');
  assert.equal(f.pool, POOL);

  assert.throws(
    () => setupFight(setup({ enemyOpening: ['test:nonesuch'] })),
    /test pool: no card with id "test:nonesuch"\. Known ids: test:grunt, test:wall/,
  );
});

test('a cloned fight shares no mutable state with the live one', () => {
  const live = setupFight(setup());
  const clone = cloneFight(live);

  // The decks were the hole: they were passed by reference, so
  // `clone.player.deck === live.player.deck` and every lookahead rollout held a
  // handle on the live fight's deck. Nothing writes to a deck today. The first
  // mill, shuffle-in or tutor effect does.
  assert.notEqual(clone.player.deck, live.player.deck, 'the player deck is a copy');
  assert.notEqual(clone.enemy.deck, live.enemy.deck, 'the enemy deck is a copy');
  assert.notEqual(clone.player.hand, live.player.hand);
  assert.notEqual(clone.state, live.state);
  assert.notEqual(clone.state.board.player[0], live.state.board.player[0]);
  assert.notEqual(clone.rngCombat, live.rngCombat);

  const playerDeckBefore = live.player.deck.slice();
  const enemyDeckBefore = live.enemy.deck.slice();

  clone.player.deck.push('test:wall');
  clone.player.deck[0] = 'test:wall';
  clone.enemy.deck.length = 0;
  clone.player.hand.push('test:grunt');
  clone.state.board.player[0]!.health = 1;
  clone.rngCombat.s = 12345;

  assert.deepEqual(
    live.player.deck,
    playerDeckBefore,
    'writing to the clone did not reach the live deck',
  );
  assert.deepEqual(live.enemy.deck, enemyDeckBefore);
  assert.deepEqual(live.player.hand, []);
  assert.equal(live.state.board.player[0]!.health, 30);
  assert.notEqual(live.rngCombat.s, 12345);

  // The pool is immutable data every fight reads, so sharing the reference is
  // the copy. Nothing in the engine writes to it.
  assert.equal(clone.pool, live.pool);
});
