// The spend phase with all three card types in it.
//
// `docs/design/game.md`: "Units, spells and equipment all draw from the same
// three points." That is one sentence and it is the whole reason the round loop
// had to change at all - a vocabulary nothing can spend energy on is not a card
// type. So this file is about the round rather than about any one verb: what a
// turn may spend, what a record of that turn looks like, and whether it replays.
//
// Bound of this file - what a green run does and does not prove:
//
//   The replay tests run the shipped pool over a deck that holds all three
//   types (`PLAYER_DECK_MIXED`). That deck is deliberately NOT the one
//   `npm run verify` measures, so nothing here is evidence about balance, and
//   the placement measurement's numbers are untouched by it. It is evidence
//   that the three-type path is reachable from a real fight and replays.
//
//   "An older record still loads" is checked against a record built by hand
//   with the field absent, because there is no older log on disk to load - the
//   format has never been written to a file. What it pins is the reader's rule,
//   `rec.casts ?? []`, not a real migration.
//
//   The energy check is on the round. It does not check that a bot spends its
//   energy well, or at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_POOL,
  ENCOUNTERS,
  MAX_ROUNDS,
  PLAYER_DECK_MIXED,
  PLAYER_HERO,
  ENEMY_DECK,
  encounterById,
} from '../src/content/cards.ts';
import {
  type CastAction,
  type FightSetup,
  type RoundRecord,
  replayFight,
  runFight,
  runRound,
  setupFight,
  splitPlays,
} from '../src/engine/fight.ts';
import { fightToCanonical, hashFight } from '../src/engine/hash.ts';
import { randomPlacer } from '../src/sim/bots.ts';
import type { CardPool, UnitCard } from '../src/engine/state.ts';
import { heroOf, power } from '../src/engine/state.ts';

// --- a two-card pool of this file's own, for the rules that need exact numbers

const CARDS: readonly UnitCard[] = [
  { id: 'test:grunt', name: 'Grunt', cost: 1, power: 1, health: 4, armour: 0, tribe: 'human', traits: [] },
  { id: 'test:big', name: 'Big', cost: 3, power: 1, health: 9, armour: 0, tribe: 'human', traits: [] },
];

const POOL: CardPool = {
  card(id) {
    const c = CARDS.find((x) => x.id === id);
    if (c === undefined) {
      throw new Error(`test pool: no unit with id "${id}". Known ids: ${CARDS.map((x) => x.id).join(', ')}`);
    }
    return c;
  },
  energyPerTurn: 3,
  handSize: 5,
  castable(id) {
    if (id === 's:rally') {
      return { kind: 'spell', id, name: 'Rally', cost: 2, effects: [{ kind: 'buffAll', amount: 2 }] };
    }
    if (id === 's:wipe') {
      return { kind: 'spell', id, name: 'Wipe', cost: 3, effects: [{ kind: 'damageAll', amount: 5 }] };
    }
    if (id === 'q:sword') {
      return { kind: 'equipment', id, name: 'Sword', cost: 1, slot: 'weapon', power: 3, armour: 0 };
    }
    return null;
  },
};

function setup(overrides: Partial<FightSetup> = {}): FightSetup {
  return {
    seed: 1,
    pool: POOL,
    playerDeck: ['test:grunt', 's:rally', 'q:sword', 'test:big', 's:wipe'],
    enemyDeck: ['test:grunt'],
    enemyOpening: [],
    playerHero: { name: 'Knight', health: 30, power: 2, armour: 0 },
    enemyHero: { name: 'Warchief', health: 40, power: 0, armour: 0 },
    maxRounds: 12,
    ...overrides,
  };
}

test('units, spells and equipment all draw from the same three energy', () => {
  // Mutation watched going red: delete the checkEnergy call from runRound.
  //
  // ARCHITECTURE.md lists conservation - energy spent never exceeds energy
  // available - among the invariants that should hold over every game. A bot
  // never breaks it because selectPlays caps the spend; a hand-built round is
  // where it can be broken, and a UI is a hand-built round.
  const f = setupFight(setup());

  assert.throws(
    () =>
      runRound(
        f,
        () => [{ cardId: 'test:grunt', index: 0 }],
        () => [{ cardId: 's:rally' }, { cardId: 'q:sword' }],
      ),
    /spends 4 energy on 1 unit\(s\) and 2 cast\(s\), but a side has 3 per turn\. Units, spells and equipment all draw from the same pool\./,
  );
});

test('a round may spend its three energy across all three card types at once', () => {
  // The other side of the boundary: 1 + 2 is legal and both land. Without this
  // the test above would pass just as happily on a check that rejects every
  // round.
  const f = setupFight(setup());
  const hero = heroOf(f.state, 'player');

  const record = runRound(
    f,
    () => [{ cardId: 'test:grunt', index: 0 }],
    () => [{ cardId: 'q:sword' }],
  );

  assert.ok(record !== null);
  assert.deepEqual(record.placements, [{ cardId: 'test:grunt', index: 0 }]);
  assert.deepEqual(record.casts, [{ cardId: 'q:sword' }]);
  assert.equal(hero.equipment?.weapon?.id, 'q:sword');
  assert.equal(
    f.state.board.player.filter((e) => e.cardId === 'test:grunt').length,
    1,
    'the body was placed and the sword was worn on the same three energy',
  );
});

test('placements land before casts, so a board-wide buff reaches the bodies played that turn', () => {
  // Mutation watched going red: swap the applyCasts and applyPlacements calls
  // in runRound.
  //
  // The design leaves the order inside the spend phase to the player; this is
  // the order the engine offers, and it is the one that makes a turn's own
  // placements count.
  const f = setupFight(
    setup({ playerDeck: ['test:grunt', 's:rally', 'test:grunt'], enemyDeck: [] }),
  );

  runRound(
    f,
    () => [{ cardId: 'test:grunt', index: 0 }],
    () => [{ cardId: 's:rally' }],
  );

  const placed = f.state.board.player.find((e) => e.cardId === 'test:grunt');
  assert.ok(placed !== undefined, 'the body was placed');
  // The player's buffs live until the player's next startTurn, so they are
  // still readable here. The hero would be buffed either way - it was on the
  // line before the round began - so the body played this turn is the one that
  // separates the two orders.
  assert.equal(power(placed), 3, 'the body played this turn was reached: 1 + 2');
  assert.equal(power(heroOf(f.state, 'player')), 4, 'and so was the hero: 2 + 2');
});

test('casting says which input was wrong: not in hand, not castable, or not a card at all', () => {
  // Error messages are a product surface, and all three of these are reachable
  // from a UI. Each names what happened and which input caused it.
  const notHeld = setupFight(setup({ playerDeck: ['test:grunt', 's:rally'] }));
  assert.throws(
    () => runRound(notHeld, () => [], () => [{ cardId: 's:wipe' }]),
    /cannot cast "s:wipe" - it is not in hand \[test:grunt, s:rally\]/,
  );

  const aUnit = setupFight(setup());
  assert.throws(
    () => runRound(aUnit, () => [], () => [{ cardId: 'test:grunt' }]),
    /"test:grunt" is not a spell or a piece of equipment in this pool.*A unit is placed into the line instead\./s,
  );

  // An id the pool has never heard of is the pool's message, not the fight's -
  // it surfaces from the energy accounting, which has to price the card first.
  const unknown = setupFight(setup());
  assert.throws(
    () => runRound(unknown, () => [], () => [{ cardId: 's:nonesuch' }]),
    /test pool: no unit with id "s:nonesuch"\. Known ids: test:grunt, test:big/,
  );
});

test('splitPlays routes by card type, and a unit-only pool routes everything to the line', () => {
  // Mutation watched going red: `if (castableById(pool, id) !== null)` in
  // splitPlays, i.e. the branch inverted - which turns every unit into a cast
  // and is invisible to a pool that has no castables.
  assert.deepEqual(
    splitPlays(POOL, ['test:grunt', 's:rally', 'q:sword', 'test:big']),
    {
      units: ['test:grunt', 'test:big'],
      casts: [{ cardId: 's:rally' }, { cardId: 'q:sword' }],
    },
  );

  const unitOnly: CardPool = { card: POOL.card, energyPerTurn: 3, handSize: 5 };
  assert.deepEqual(splitPlays(unitOnly, ['test:grunt', 'test:big']), {
    units: ['test:grunt', 'test:big'],
    casts: [],
  });
});

test('the enemy spends on spells too, not only on bodies', () => {
  // The enemy side of the same path. docs/design/game.md's top open risk is
  // enemy AoE against a wide board, and telegraphing it is the mitigation to
  // try first - which needs the enemy to be able to cast one at all.
  const f = setupFight(
    setup({
      enemyDeck: ['s:wipe'],
      playerDeck: ['test:grunt', 'test:grunt', 'test:grunt'],
      enemyHero: { name: 'Warchief', health: 40, power: 0, armour: 0 },
    }),
  );

  runRound(f, () => [
    { cardId: 'test:grunt', index: 0 },
    { cardId: 'test:grunt', index: 1 },
    { cardId: 'test:grunt', index: 2 },
  ]);

  assert.equal(
    f.state.board.player.filter((e) => !e.isHero).length,
    0,
    'three 4-Health bodies met a 5-point wipe cast by the enemy hero',
  );
  assert.equal(heroOf(f.state, 'player').health, 30, 'and the wipe did not touch the hero');
});

// --- replay, over the shipped pool and a deck holding all three types

function mixedSetup(seed: number): FightSetup {
  const encounter = encounterById('even');
  return {
    seed,
    pool: CARD_POOL,
    playerDeck: PLAYER_DECK_MIXED,
    enemyDeck: ENEMY_DECK,
    enemyOpening: encounter.opening,
    playerHero: PLAYER_HERO,
    enemyHero: encounter.enemyHero,
    maxRounds: MAX_ROUNDS,
  };
}

test('a fight that casts replays byte-identically from its recorded action list', () => {
  // Mutation watched going red: drop the `casts` argument from replayFight's
  // runRound call, so the replay places the same bodies and casts nothing.
  let roundsWithCasts = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const live = runFight(mixedSetup(seed), randomPlacer(seed, 'placement-a'));
    for (const rec of live.log) if ((rec.casts ?? []).length > 0) roundsWithCasts++;

    const replayed = replayFight(mixedSetup(seed), live.log);
    assert.equal(hashFight(replayed), hashFight(live.fight), `seed ${seed} did not replay`);
    assert.equal(fightToCanonical(replayed), fightToCanonical(live.fight));
    assert.equal(replayed.result, live.fight.result);
  }
  // Without this the test would pass on a deck that never drew a spell, which
  // is a green run that measured nothing.
  assert.ok(roundsWithCasts > 20, `only ${roundsWithCasts} rounds cast anything across 25 fights`);
});

test('a unit-only round records no casts field at all, and a record without one still replays', () => {
  // The whole migration story for the record format, in one test.
  //
  // `casts` is absent rather than empty when a round casts nothing, so a record
  // from a unit-only fight is exactly the record it was before spells existed.
  // The reader's rule is `rec.casts ?? []`, and these two logs must replay to
  // the same state.
  const unitOnly: FightSetup = {
    ...setup({ playerDeck: ['test:grunt', 'test:big', 'test:grunt'], enemyDeck: ['test:grunt'] }),
  };
  const live = runFight(unitOnly, randomPlacer(7, 'placement-a'));
  for (const rec of live.log) {
    assert.equal('casts' in rec, false, 'a unit-only record carries no casts field');
  }

  const older: RoundRecord[] = live.log.map((r) => ({
    round: r.round,
    handBefore: r.handBefore.slice(),
    placements: r.placements.slice(),
  }));
  const newer: RoundRecord[] = older.map((r) => ({ ...r, casts: [] as CastAction[] }));

  assert.equal(hashFight(replayFight(unitOnly, older)), hashFight(live.fight));
  assert.equal(
    hashFight(replayFight(unitOnly, newer)),
    hashFight(replayFight(unitOnly, older)),
    'an absent casts field and an empty one are the same round',
  );
});

test('a fight over the mixed deck is deterministic across runs, and its hashes are not degenerate', () => {
  const hashes = new Set<string>();
  for (let seed = 1; seed <= 25; seed++) {
    const a = runFight(mixedSetup(seed), randomPlacer(seed, 'placement-a'));
    const b = runFight(mixedSetup(seed), randomPlacer(seed, 'placement-a'));
    assert.equal(hashFight(b.fight), hashFight(a.fight), `seed ${seed} diverged`);
    hashes.add(hashFight(a.fight));
  }
  assert.ok(hashes.size > 20, `expected mostly distinct hashes over 25 seeds, got ${hashes.size}`);
  assert.ok(ENCOUNTERS.length > 0);
});
