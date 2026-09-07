// The board on screen is derived from the event stream, and it lands where the
// engine did.
//
// `ARCHITECTURE.md` forbids the shortcut this gate protects: render consumes
// the resolver's events and derives its own view state, and never adds a field
// to `GameState`. That means the view is a *second* implementation of what a
// turn does to the board - one that reads events rather than applying effects -
// and a second implementation drifts unless something compares the two.
//
// So this replays real fights, applies every beat to a view, and requires the
// view to agree with the engine's own state at the end of every phase. It also
// pins the buff attribution, which is the one thing the animation needs that
// the event stream does not carry outright: a Relay `+2` that does not visibly
// leave the card that granted it teaches the player nothing.
//
// Bound of this gate - what a green run does and does not prove:
//
//   Walks 80 seeds at `even` and 40 at `hard`, every round of every fight,
//   comparing health, bonus Power, alive and warded for every entity the engine
//   still has. Corpses are not compared: they leave the engine's board at the
//   state-based checkpoint and stay in the view so they can be seen dying.
//   Covers the four shipped traits, because the shipped decks contain them. It
//   says nothing about a trait that does not exist yet, and the attribution
//   assertion is exactly as strong as the trait set it ran against - a future
//   power source that is neither Relay nor Wake would come back `unknown` and
//   this gate would say so rather than mis-draw an arrow.
//   Says nothing about pixels, timing, or the DOM.
//
// Made to go red: deleting the `bonusPower` line from `applyBeat`'s `buff`
// case fails on seed 1 with "uid 5 bonusPower: view 0, engine 2"; dropping the
// Relay branch of `attributeBuff` fails the attribution test with a buff whose
// source is `unknown`. See `docs/learning/gate-proofs.md`.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  type Fight,
  type FightSetup,
  type Placement,
  selectPlays,
  setupFight,
} from '../src/engine/fight.ts';
import { type GameState, unitCount } from '../src/engine/state.ts';
import { makeRng, mixSeeds, nextInt } from '../src/engine/rng.ts';
import {
  CARD_POOL,
  ENEMY_DECK,
  MAX_ROUNDS,
  PLAYER_DECK,
  PLAYER_HERO,
  encounterById,
} from '../src/content/cards.ts';
import { beginRound, commitRound } from '../src/ui/session.ts';
import { applyBeat, buildBeats, snapshot, viewDrift } from '../src/render/view.ts';
import { fitWidth, CARD_GAP, MIN_CARD_W, MAX_CARD_W } from '../src/render/board.ts';
import { incomingOdds, projectOwnPhase } from '../src/render/odds.ts';
import { blazonFor } from '../src/render/blazons.ts';
import { parseBlazon, blazonWarnings } from '../src/render/heraldry/blazon.ts';

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

/** A human-ish turn: play everything affordable, scattered across the line. */
function decide(f: Fight): Placement[] {
  const chosen = selectPlays(f.player.hand, f.pool.energyPerTurn, f.pool).map(
    (i) => f.player.hand[i]!,
  );
  const rng = makeRng(mixSeeds(f.seed, f.round), 'view-gate');
  let units = unitCount(f.state, 'player');
  return chosen.map((cardId) => {
    const index = nextInt(rng, units + 1);
    units++;
    return { cardId, index };
  });
}

type Walk = { rounds: number; beats: number; buffs: number; attributed: number; deaths: number };

function walkFight(seed: number, encounter: string, acc: Walk): void {
  const f = setupFight(setup(seed, encounter));
  while (beginRound(f)) {
    const committed = commitRound(f, decide(f));
    acc.rounds++;

    let view = snapshot(committed.stateAtStart, CARD_POOL);
    let from: GameState = committed.stateAtStart;

    for (const segment of committed.segments) {
      if (segment.kind === 'spawns') {
        view = snapshot(segment.stateAfter, CARD_POOL);
        from = segment.stateAfter;
        continue;
      }
      const beats = buildBeats(snapshot(from, CARD_POOL), segment.events);
      for (const beat of beats) {
        applyBeat(view, beat);
        acc.beats++;
        if (beat.kind === 'death') acc.deaths++;
        if (beat.kind === 'buff') {
          acc.buffs++;
          if (beat.source.via !== 'unknown') acc.attributed++;
          assert.notEqual(
            beat.source.via,
            'unknown',
            `seed ${seed}/${encounter} round ${f.round}: a +${beat.amount} buff on uid ` +
              `${beat.uid} could not be attributed to the card that granted it, so the ` +
              `animation would have nothing to draw an arrow from`,
          );
          assert.notEqual(beat.source.sourceUid, null);
          assert.notEqual(beat.source.sourceUid, beat.uid, 'a buff cannot come from its own target');
        }
      }
      const drift = viewDrift(view, segment.stateAfter);
      assert.deepEqual(
        drift,
        [],
        `seed ${seed}/${encounter} round ${f.round}: the view derived from the ${segment.side} ` +
          `phase's events disagrees with the engine's state`,
      );
      view = snapshot(segment.stateAfter, CARD_POOL);
      from = segment.stateAfter;
    }
    if (committed.result !== 'ongoing') break;
  }
}

test('the view derived from the event stream matches the engine, every phase', () => {
  const acc: Walk = { rounds: 0, beats: 0, buffs: 0, attributed: 0, deaths: 0 };
  for (let seed = 1; seed <= 80; seed++) walkFight(seed, 'even', acc);
  for (let seed = 1; seed <= 40; seed++) walkFight(seed, 'hard', acc);

  // The instrument, before the measurement: a walk that saw no buffs and no
  // deaths would pass every assertion above without exercising either.
  assert.ok(acc.rounds > 300, `expected a real corpus, walked ${acc.rounds} rounds`);
  assert.ok(acc.beats > 3000, `expected a real corpus, applied ${acc.beats} beats`);
  assert.ok(acc.buffs > 100, `expected Relay and Wake to fire, saw ${acc.buffs} buffs`);
  assert.ok(acc.deaths > 100, `expected units to die, saw ${acc.deaths} deaths`);
  assert.equal(acc.attributed, acc.buffs);
});

test('target odds are exactly the engine’s uniform pick', () => {
  // The fairness claim on screen is "each attack is 1/N onto each of N
  // targets", and it has to be the same N the resolver picks from.
  for (let seed = 1; seed <= 40; seed++) {
    const f = setupFight(setup(seed, 'hard'));
    let guarded = 0;
    while (beginRound(f)) {
      for (const side of ['player', 'enemy'] as const) {
        const odds = incomingOdds(f.state, side);
        const total = [...odds.chance.values()].reduce((a, b) => a + b, 0);
        if (odds.poolSize > 0) {
          assert.ok(
            Math.abs(total - 1) < 1e-9,
            `seed ${seed}: the shown chances sum to ${total}, not 1`,
          );
          for (const p of odds.chance.values()) {
            assert.ok(Math.abs(p - 1 / odds.poolSize) < 1e-9, 'targets are not uniform');
          }
        }
        if (odds.guarded) guarded++;
      }
      const committed = commitRound(f, decide(f));
      if (committed.result !== 'ongoing') break;
    }
    if (seed === 1) assert.ok(guarded > 0, 'seed 1 should reach a board where Guard narrows the pool');
  }
});

test('the Wards and Relays shown before commit are the ones that land', () => {
  // The odds on screen are computed against a *projection* of the player's own
  // phase, because a Ward granted during that phase changes who can be targeted
  // afterwards - and in the worst case removes every legal target, turning a
  // displayed "100% onto your Guard" into an actual "nothing can be hit". The
  // projection has to be exactly right or it has replaced one wrong number with
  // another.
  //
  // Made to go red: dropping the `right.warded = true` line makes the very
  // first fight that plays an Elf Warden fail with a missing uid.
  let phases = 0;
  let wardedSeen = 0;
  let relayedSeen = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const f = setupFight(setup(seed, 'even'));
    while (beginRound(f)) {
      const placements = decide(f);
      const committed = commitRound(f, placements);
      const playerPhase = committed.segments[0]!;
      if (playerPhase.kind !== 'phase') throw new Error('fixture: first segment is the player phase');

      // The one case the projection deliberately does not model: `resolvePhase`
      // stops the moment a hero dies, so units to the right of the killing blow
      // never act and never grant their Ward. The projection is for deciding
      // what the enemy will do to you next turn, and there is no next turn in a
      // round that ends the fight.
      if (committed.result !== 'ongoing') break;

      const predicted = projectOwnPhase(committed.stateAtStart, 'player');
      const predictedUids = new Set(
        predicted.board.player.filter((e) => e.warded).map((e) => e.uid),
      );
      const actualUids = new Set(
        playerPhase.stateAfter.board.player.filter((e) => e.warded).map((e) => e.uid),
      );
      assert.deepEqual(
        [...predictedUids].sort((a, b) => a - b),
        [...actualUids].sort((a, b) => a - b),
        `seed ${seed} round ${f.round}: the Wards shown before commit are not the Wards that landed`,
      );
      // Relay's half of the same projection. Wake cannot contaminate this: it
      // answers a death on your own side, and your own side cannot lose a unit
      // during its own phase.
      const predictedPower = new Map(
        predicted.board.player.map((e) => [e.uid, e.bonusPower] as const),
      );
      for (const e of playerPhase.stateAfter.board.player) {
        assert.equal(
          predictedPower.get(e.uid) ?? 0,
          e.bonusPower,
          `seed ${seed} round ${f.round}: uid ${e.uid} was shown ` +
            `${predictedPower.get(e.uid) ?? 0} bonus Power before commit and ended on ` +
            `${e.bonusPower}`,
        );
        if (e.bonusPower > 0) relayedSeen++;
      }

      wardedSeen += actualUids.size;
      phases++;
    }
  }
  assert.ok(phases > 200, `expected a real corpus, checked ${phases} phases`);
  assert.ok(wardedSeen > 40, `expected Ward to actually fire, saw ${wardedSeen} warded units`);
  assert.ok(relayedSeen > 40, `expected Relay to actually fire, saw ${relayedSeen} buffed units`);
});

test('the board compresses and never needs a second row', () => {
  // The layout rule ARCHITECTURE.md calls unplayable to break. `fitWidth` must
  // fit the row whenever it returns a width above the legibility floor, and
  // must bottom out at the floor rather than shrinking to nothing.
  const available = 1300;
  let hitFloor = false;
  for (let n = 1; n <= 40; n++) {
    const w = fitWidth(available, n);
    assert.ok(w >= MIN_CARD_W, `width ${w} at ${n} cards is below the reviewed floor`);
    assert.ok(w <= MAX_CARD_W, `width ${w} at ${n} cards is above the cap`);
    const used = n * w + (n - 1) * CARD_GAP;
    if (w > MIN_CARD_W) {
      assert.ok(
        used <= available,
        `${n} cards at ${w}px need ${used}px of ${available}px: the row would wrap or scroll ` +
          `while cards could still have shrunk`,
      );
    } else {
      hitFloor = true;
    }
  }
  assert.ok(hitFloor, 'the sweep never reached the floor, so the floor was not exercised');
  assert.equal(fitWidth(available, 0), MAX_CARD_W);
});

test('every shipped card has a blazon that parses and respects the rule of tincture', () => {
  const ids = [...PLAYER_DECK, ...ENEMY_DECK];
  assert.ok(ids.length > 0);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const card = CARD_POOL.card(id);
    const guard = card.traits.includes('guard');
    const blazon = blazonFor(card.id, card.tribe, guard);
    const parsed = parseBlazon(blazon);
    assert.equal(
      parsed.bordure !== undefined,
      guard,
      `${card.id}: the bordure is the Guard channel, so it must be present exactly when Guard is`,
    );
    assert.deepEqual(
      blazonWarnings(parsed),
      [],
      `${card.id}: ${blazon} breaks the rule of tincture, which is what keeps a device legible ` +
        `at seventy pixels`,
    );
  }
  assert.ok(seen.size >= 15, `expected the whole pool, saw ${seen.size} cards`);
  // An id the pool has never seen still renders, because the card pool is
  // growing under this file.
  const unknown = blazonFor('u_not_a_real_card', 'human', false);
  assert.doesNotThrow(() => parseBlazon(unknown));
  assert.equal(blazonFor('u_squire_nc', 'human', false), blazonFor('u_squire', 'human', false));
});
