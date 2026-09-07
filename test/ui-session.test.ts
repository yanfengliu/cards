// The UI's fight driver plays the same game as the engine's own.
//
// `src/ui/session.ts` exists because `runRound` throws away the event stream
// the animation needs. To do that it re-runs the round out of exported engine
// pieces, and it carries two small replications of logic `engine/fight.ts`
// keeps private: `settle`, and the enemy's draw-select-append turn. Two drivers
// that drift apart are two different games, and the one with a screen is the
// one nobody measured.
//
// Bound of this gate - what a green run does and does not prove:
//
//   Compares `hashFight` after **every round**, not only at the end, over 120
//   contiguous seeds at the primary encounter and 40 at `hard`. `hashFight`
//   covers the whole board, both hands, both deck cursors and both generator
//   states, so a driver that reached the same board through a different number
//   of rolls fails.
//   Drives both with the same recorded placements, so the only variable is the
//   driver.
//   Proves nothing about a placement the bots never make: the log comes from
//   `appendRightPlacer` and `randomPlacer`, so an index no bot produces is not
//   covered here - `placementsFrom` below covers the index arithmetic the
//   screen actually generates.
//   Proves nothing about timing, animation or the DOM.
//
// Made to go red: changing `insertUnit(..., unitCount(...))` to
// `insertUnit(..., 0)` in `session.ts`'s `enemyPlays` fails at round 2 of seed
// 1 with two different hashes; see `docs/learning/gate-proofs.md`.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type FightSetup,
  type Placement,
  applyPlacements,
  runFight,
  runRound,
  setupFight,
} from '../src/engine/fight.ts';
import { hashFight } from '../src/engine/hash.ts';
import { unitCount } from '../src/engine/state.ts';
import { appendRightPlacer, randomPlacer } from '../src/sim/bots.ts';
import {
  CARD_POOL,
  ENEMY_DECK,
  MAX_ROUNDS,
  PLAYER_DECK,
  PLAYER_HERO,
  encounterById,
} from '../src/content/cards.ts';
import { type LineItem, beginRound, commitRound, lineCost, placementsFrom } from '../src/ui/session.ts';

function setup(seed: number, encounterId: string): FightSetup {
  const encounter = encounterById(encounterId);
  return {
    seed,
    pool: CARD_POOL,
    playerDeck: PLAYER_DECK,
    enemyDeck: ENEMY_DECK,
    enemyOpening: encounter.opening,
    playerHero: PLAYER_HERO,
    enemyHero: encounter.enemyHero,
    maxRounds: MAX_ROUNDS,
  };
}

test('the UI driver and runRound agree on every round, for every seed', () => {
  const cases: Array<{ encounter: string; seeds: number[] }> = [
    { encounter: 'even', seeds: Array.from({ length: 120 }, (_v, i) => i + 1) },
    { encounter: 'hard', seeds: Array.from({ length: 40 }, (_v, i) => i + 1) },
  ];

  let roundsCompared = 0;
  for (const { encounter, seeds } of cases) {
    for (const seed of seeds) {
      const s = setup(seed, encounter);
      // The action list, produced by a bot so the comparison has something to
      // replay. Alternating policies so both extremes of the line are used.
      const { log } = runFight(s, seed % 2 === 0 ? appendRightPlacer() : randomPlacer(seed, 'ui-gate'));

      const engine = setupFight(s);
      const ui = setupFight(s);
      for (const record of log) {
        const before = hashFight(ui);
        runRound(engine, () => record.placements.slice());
        const opened = beginRound(ui);
        assert.equal(
          opened,
          engine.round === ui.round + 1 || engine.round === ui.round,
          `seed ${seed}/${encounter}: the two drivers disagree about whether round ` +
            `${record.round} happens at all`,
        );
        if (opened) commitRound(ui, record.placements);
        assert.notEqual(hashFight(ui), before, 'a round that changed nothing is a broken fixture');
        assert.equal(
          hashFight(ui),
          hashFight(engine),
          `seed ${seed}/${encounter}: the UI driver and runRound diverged after round ${record.round}`,
        );
        roundsCompared++;
      }
      assert.equal(ui.result, engine.result, `seed ${seed}/${encounter}: different results`);
    }
  }
  // A gate that cannot tell "passed" from "did not run" reports the second as
  // the first, so the population it walked is asserted too.
  assert.ok(roundsCompared > 700, `expected a real corpus, compared only ${roundsCompared} rounds`);
});

test('a built line reproduces itself through applyPlacements', () => {
  // The screen builds a line by splicing ghosts into it wherever the player
  // clicks, and `placementsFrom` claims the resulting positions *are* the
  // insertion indices. That claim is only true because ghosts are emitted left
  // to right; if it were false, the committed board would silently differ from
  // the one the player arranged and every odds figure shown would have been
  // about a board that never existed.
  const s = setup(4, 'even');
  const f = setupFight(s);
  beginRound(f);

  const hand = f.player.hand.slice();
  assert.ok(hand.length >= 3, 'fixture needs at least three cards in hand');

  // Every ordering of three placements into a two-unit line, including indices
  // that push earlier ghosts to the right.
  for (const positions of [
    [0, 0, 0],
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [2, 1, 0],
  ]) {
    const trial = setupFight(s);
    beginRound(trial);
    const line: LineItem[] = trial.state.board.player
      .filter((e) => !e.isHero)
      .map((e) => ({ kind: 'real', uid: e.uid }) as LineItem);

    const wanted: string[] = [];
    positions.forEach((at, i) => {
      const cardId = hand[i]!;
      const index = Math.min(at, line.length);
      line.splice(index, 0, { kind: 'ghost', id: i, cardId });
    });
    for (const item of line) {
      wanted.push(item.kind === 'ghost' ? item.cardId : `uid:${item.uid}`);
    }

    const placements: Placement[] = placementsFrom(line);
    applyPlacements(trial, placements);

    const got = trial.state.board.player
      .filter((e) => !e.isHero)
      .map((e, i) => (i < wanted.length && wanted[i]!.startsWith('uid:') ? `uid:${e.uid}` : e.cardId));
    assert.deepEqual(
      got,
      wanted,
      `placements ${JSON.stringify(placements)} did not reproduce the arranged line`,
    );
    assert.equal(unitCount(trial.state, 'player'), line.length);
  }
});

test('lineCost adds up only the cards not yet committed', () => {
  const s = setup(9, 'even');
  const f = setupFight(s);
  beginRound(f);
  const first = f.player.hand[0]!;
  const line: LineItem[] = [
    { kind: 'real', uid: 999 },
    { kind: 'ghost', id: 1, cardId: first },
  ];
  assert.equal(lineCost(line, CARD_POOL), CARD_POOL.card(first).cost);
  assert.equal(lineCost([{ kind: 'real', uid: 1 }], CARD_POOL), 0);
});
