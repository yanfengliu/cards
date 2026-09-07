// Combat is mutual, and decks reshuffle. The two rules this round added, each
// on its own, plus the one they were added to fix.
//
// `docs/design/game.md`:
//
//   "When a unit attacks, the defender simultaneously deals its own Power back
//    to the attacker, less the attacker's Armour."
//   "When a deck is empty and a card must be drawn, the discard is shuffled and
//    becomes the new deck."
//
// What each test here is bound to is stated in the test. The two that are worth
// naming up front:
//
//   - "Wake reaches a swing" runs the shipped deck through real fights rather
//     than a fixture, because the defect it retires was invisible to every
//     fixture: Wake fired correctly and the buff was cleared before it could be
//     spent. A fixture proving Wake fires proves nothing about that.
//   - The reshuffle tests are bound to `handSize` 5 and to decks larger than a
//     hand. A deck smaller than the hand is covered separately, and it is the
//     case that can make `drawTo` spin.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  type CastAction,
  type FightSetup,
  type Placement,
  type SideState,
  drawTo,
  replayFight,
  runFight,
  runRound,
  setupFight,
} from '../src/engine/fight.ts';
import { hashFight } from '../src/engine/hash.ts';
import { makeRng } from '../src/engine/rng.ts';
import { drain, resolvePhase, startTurn } from '../src/engine/resolver.ts';
import {
  type CardPool,
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
import {
  CARD_POOL,
  ENEMY_DECK,
  MAX_ROUNDS,
  PLAYER_DECK,
  PLAYER_HERO,
  encounterById,
} from '../src/content/cards.ts';
import { ablatedPool } from '../src/sim/ablate.ts';
import { appendRightPlacer, randomPlacer } from '../src/sim/bots.ts';

// ---------------------------------------------------------------- fixtures

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

// ------------------------------------------------------- mutual damage

test('an attack is a trade: the defender deals its own Power back', () => {
  // Mutation watched going red: drop `e.health -= dealtBack` from apply's
  // attack case.
  const f = fixture(0);
  const attacker = f.add('player', card('att', 3, 9, 0));
  const defender = f.add('enemy', card('def', 4, 9, 0, ['guard']));

  const { events } = drain(f.state, [{ kind: 'attack', uid: attacker.uid }], makeRng(1, 'combat'));

  assert.deepEqual(events.map((e) => e.kind), ['attacked', 'retaliated']);
  assert.equal(defender.health, 6, 'the attacker dealt its 3');
  assert.equal(attacker.health, 5, 'and took the defender’s 4 back');

  const back = events.find((e) => e.kind === 'retaliated');
  assert.ok(back !== undefined && back.kind === 'retaliated');
  assert.equal(back.uid, defender.uid, 'the defender is the one dealing');
  assert.equal(back.targetUid, attacker.uid, 'and the attacker is the one taking');
});

test('the attacker’s Armour blunts retaliation exactly as it blunts any hit', () => {
  // Mutation watched going red: read `back` straight, without armourOf(e).
  const f = fixture(0);
  const plated = f.add('player', card('plated', 1, 9, 2));
  f.add('enemy', card('def', 5, 9, 0, ['guard']));

  drain(f.state, [{ kind: 'attack', uid: plated.uid }], makeRng(2, 'combat'));
  assert.equal(plated.health, 6, '5 Power against Armour 2 comes back as 3');
});

test('a 0-Power defender retaliates for 0, so a high-Health wall is free to attack into', () => {
  // The design object this creates, stated as a test because it is a decision
  // and not an accident: Power is now a defensive stat too, and a body with
  // none can be hit forever at no cost to whoever is hitting it.
  const f = fixture(0);
  const attacker = f.add('player', card('att', 2, 4, 0));
  const wall = f.add('enemy', card('wall', 0, 40, 0, ['guard']));

  const { events } = drain(f.state, [{ kind: 'attack', uid: attacker.uid }], makeRng(3, 'combat'));
  const back = events.find((e) => e.kind === 'retaliated');
  assert.ok(back !== undefined && back.kind === 'retaliated');
  assert.equal(back.raw, 0, 'a blow that bounced is still a blow: the event is emitted');
  assert.equal(back.dealt, 0);
  assert.equal(attacker.health, 4, 'and the attacker is untouched');
  assert.equal(wall.health, 38);
});

test('a hero retaliates when struck and takes nothing back when it attacks', () => {
  // Both halves of the one asymmetry in the rule, because they are separate
  // decisions and a single test that mixed them could pass with either broken.
  // Mutation watched going red: delete the `e.isHero ? 0 :` guard.
  const f = fixture(6, 5);

  // Half one: a unit attacking a hero takes the hero's Power back.
  const unit = f.add('player', card('unit', 1, 9, 0));
  const enemyHero = heroOf(f.state, 'enemy');
  drain(f.state, [{ kind: 'attack', uid: unit.uid }], makeRng(4, 'combat'));
  assert.equal(enemyHero.health, 29, 'the hero took the unit’s 1');
  assert.equal(unit.health, 4, 'and dealt its own 5 back');

  // Half two: a hero attacking a unit takes nothing back.
  const g = fixture(6, 5);
  const brute = g.add('enemy', card('brute', 7, 9, 0, ['guard']));
  const playerHero = heroOf(g.state, 'player');
  const { events } = drain(
    g.state,
    [{ kind: 'attack', uid: playerHero.uid }],
    makeRng(5, 'combat'),
  );
  assert.equal(brute.health, 3, 'the hero dealt its 6');
  assert.equal(playerHero.health, 30, 'and took none of the brute’s 7 back');
  assert.deepEqual(events.map((e) => e.kind), ['attacked'], 'no retaliation event at all');
});

test('both blows land before either is checked, so neither death cancels the other', () => {
  // ARCHITECTURE.md batches deaths precisely so "A kills B, B's death trigger
  // kills A" does not depend on evaluation order, and mutual damage is the
  // first shipped effect where a player can watch it. Both are lethal to the
  // other; both must die, at one checkpoint, and the attacker's death is
  // announced first because the player line is walked first.
  //
  // Mutation watched going red: guard the retaliation with
  // `if (target.health > 0)`.
  const f = fixture(0);
  const attacker = f.add('player', card('att', 5, 3, 0));
  const defender = f.add('enemy', card('def', 4, 2, 0, ['guard']));

  const { events } = drain(f.state, [{ kind: 'attack', uid: attacker.uid }], makeRng(6, 'combat'));

  assert.deepEqual(
    events.map((e) => e.kind),
    ['attacked', 'retaliated', 'died', 'died'],
    'one effect, one checkpoint, both deaths together',
  );
  assert.deepEqual(
    events.filter((e) => e.kind === 'died').map((e) => (e.kind === 'died' ? e.uid : 0)),
    [attacker.uid, defender.uid],
    'player line first, then enemy - checkStateBased’s own order',
  );
  assert.equal(attacker.alive, false);
  assert.equal(defender.alive, false);
});

test('both blows are computed from Power read before either lands', () => {
  // The other half of "simultaneous". Nothing in the shipped pool changes Power
  // when Health moves, so this is written to hold the property rather than to
  // catch a live defect: the numbers on both events are the pre-hit numbers.
  const f = fixture(0);
  const attacker = f.add('player', card('att', 4, 10, 0));
  f.add('enemy', card('def', 6, 10, 0, ['guard']));

  const { events } = drain(f.state, [{ kind: 'attack', uid: attacker.uid }], makeRng(7, 'combat'));
  const hit = events.find((e) => e.kind === 'attacked');
  const back = events.find((e) => e.kind === 'retaliated');
  assert.ok(hit !== undefined && hit.kind === 'attacked');
  assert.ok(back !== undefined && back.kind === 'retaliated');
  assert.equal(hit.raw, 4);
  assert.equal(back.raw, 6);
});

test('retaliation is not an action: the defender fires no after-acting trait', () => {
  // Mutation watched going red: emit `afterActed` for the defender alongside
  // `retaliated`. A Relay defender would then buff its right-hand neighbour
  // every time anything hit it.
  const f = fixture(0);
  const attacker = f.add('player', card('att', 1, 9, 0));
  // Guard as well as Relay, so the attack has exactly one legal target and the
  // test is not measuring a targeting roll.
  const relayDefender = f.add('enemy', card('relayer', 1, 9, 0, ['relay', 'guard']));
  const rightOfIt = f.add('enemy', card('right', 1, 9, 0));

  const { events } = drain(f.state, [{ kind: 'attack', uid: attacker.uid }], makeRng(8, 'combat'));

  assert.equal(events.some((e) => e.kind === 'afterActed'), false);
  assert.equal(events.some((e) => e.kind === 'powerGained'), false);
  assert.equal(rightOfIt.bonusPower, 0, 'the defender did not act, so its Relay did not fire');
  assert.equal(relayDefender.health, 8);
});

test('a unit that dies to retaliation never reaches its after-acting trait', () => {
  // The existing "no unit acts after dying" rule meeting the new trade, and it
  // is a real cost on a fragile Relay body rather than a special case. Stated
  // as a test because it is the single most consequential thing mutual damage
  // does to the cascade, and a later change that lets the buff land anyway must
  // go red here rather than pass quietly.
  const f = fixture(0);
  const fragile = f.add('player', card('fragile', 1, 2, 0, ['relay']));
  const right = f.add('player', card('right', 1, 9, 0));
  f.add('enemy', card('brute', 4, 9, 0, ['guard']));

  const { events, trace } = drain(
    f.state,
    [{ kind: 'act', uid: fragile.uid }],
    makeRng(9, 'combat'),
  );

  assert.deepEqual(trace.map((e) => e.kind), ['act', 'attack', 'afterAct']);
  assert.equal(fragile.alive, false, 'it died to the retaliation its own attack drew');
  assert.equal(
    events.some((e) => e.kind === 'afterActed'),
    false,
    'the afterAct effect came up against a dead entity and was skipped',
  );
  assert.equal(right.bonusPower, 0, 'so the +2 never landed');
});

// ------------------------------------------------------------ Wake is live

test('Wake reaches a swing: the +2 is spent inside the same phase it was granted', () => {
  // The defect this retires, from docs/devlog: "ablating Wake changed the
  // outcome of not one fight in 20,000, because a player unit can only die
  // while the enemy is attacking and the enemy attacks after the player's whole
  // line has resolved."
  //
  // Mutual damage is the fix, and this test is the proof, in the exact shape
  // the defect had: the woken unit must SWING at its raised Power. Asserting
  // that Wake fires is what the old suite already did, and it passed while the
  // trait was inert.
  const f = fixture(0);
  const doomed = f.add('player', card('doomed', 1, 2, 0));
  const waker = f.add('player', card('waker', 2, 9, 0, ['wake']));
  f.add('enemy', card('brute', 4, 40, 0, ['guard']));

  startTurn(f.state, 'player');
  const events = resolvePhase(f.state, 'player', makeRng(11, 'combat'));

  assert.equal(doomed.alive, false, 'the left-hand body died in its own side’s phase');
  const swings = events
    .filter((e) => e.kind === 'attacked' && e.uid === waker.uid)
    .map((e) => (e.kind === 'attacked' ? e.raw : 0));
  assert.deepEqual(swings, [4], 'the woken unit swung at 2 printed + 2 from Wake');
});

test('Wake changes the outcome of real fights, which is the defect it retires', () => {
  // The corpus half, and it is an ablation rather than an observation on
  // purpose. From docs/devlog, 2026-09-06: "ablating Wake changed the outcome
  // of not one fight in 20,000, because a player unit can only die while the
  // enemy is attacking and the enemy attacks after the player's whole line has
  // resolved." A test that merely watches Wake fire passed against that defect;
  // this one cannot, because it compares the shipped deck against the same deck
  // with Wake stripped and requires some fight to come out differently.
  //
  // Outcomes and round counts are compared, never `hashFight`: the hash
  // serialises an entity's trait list, so it differs across any ablation
  // whether or not the trait did anything.
  //
  // Bound: 200 seeds at `even`, one bot. It says Wake is not inert; it does not
  // say how much it is worth. `npm run measure:ablate` answers that.
  const enc = encounterById('even');
  const intact = ablatedPool([]);
  const noWake = ablatedPool(['wake']);
  const pool = (p: ReturnType<typeof ablatedPool>): CardPool => ({
    card: p.card,
    energyPerTurn: CARD_POOL.energyPerTurn,
    handSize: CARD_POOL.handSize,
  });

  let differed = 0;
  let compared = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const base = {
      seed,
      enemyDeck: ENEMY_DECK,
      enemyOpening: enc.opening,
      playerHero: PLAYER_HERO,
      enemyHero: enc.enemyHero,
      maxRounds: MAX_ROUNDS,
    };
    const a = runFight(
      { ...base, pool: pool(intact), playerDeck: intact.deck },
      appendRightPlacer(),
    );
    const b = runFight(
      { ...base, pool: pool(noWake), playerDeck: noWake.deck },
      appendRightPlacer(),
    );
    compared++;
    if (a.fight.result !== b.fight.result || a.fight.round !== b.fight.round) differed++;
  }
  assert.equal(compared, 200);
  assert.ok(
    differed > 0,
    `stripping Wake changed nothing in ${compared} fights, so it is inert again - the exact ` +
      `state it was in before combat became mutual`,
  );
});

// -------------------------------------------------------------- reshuffle

test('a deck that runs out reshuffles its discard and keeps drawing', () => {
  // Mutation watched going red: restore `side.cursor < side.deck.length` as a
  // loop condition, i.e. stop drawing instead of reshuffling.
  const side: SideState = { deck: ['a', 'b', 'c', 'd', 'e', 'f'], cursor: 0, hand: [] };
  const rng = makeRng(1, 'deck');

  drawTo(side, 5, rng);
  assert.equal(side.hand.length, 5);
  assert.equal(side.cursor, 5);

  // Play four. The sixth card is still undrawn, so the top-up takes that first
  // and only then runs out and reshuffles.
  side.hand.splice(0, 4);
  drawTo(side, 5, rng);
  assert.equal(side.hand.length, 5, 'the last undrawn card plus three from the reshuffle');
  assert.equal(
    side.deck.length,
    4,
    'the reshuffled pile is the six cards minus the two that were in hand at the time',
  );
  assert.equal(side.cursor, 3, 'and three of those four have since been drawn');
});

test('the reshuffled pile is the deck minus the hand, one instance per held card', () => {
  // The whole reason there is no `discard` field. A deck of three identical
  // cards with one in hand must reshuffle two, not zero and not three.
  const side: SideState = { deck: ['x', 'x', 'x'], cursor: 3, hand: ['x'] };
  drawTo(side, 3, makeRng(2, 'deck'));
  assert.deepEqual(side.hand, ['x', 'x', 'x']);
  assert.equal(side.deck.length, 2, 'two went back in, and both came straight back out');
  assert.equal(side.cursor, 2);
});

test('a deck smaller than the hand stops rather than spinning', () => {
  // The one case that can make the loop fail to terminate: every card is in
  // hand, so the reshuffle produces nothing and there is nothing left to draw.
  const side: SideState = { deck: ['a', 'b'], cursor: 0, hand: [] };
  drawTo(side, 5, makeRng(3, 'deck'));
  assert.deepEqual(side.hand.slice().sort(), ['a', 'b']);
  assert.equal(side.deck.length, 0, 'the pile emptied and the draw stopped');
});

test('the reshuffle runs on the deck stream, never on the combat stream', () => {
  // Stream separation is what keeps the A/B measurement paired: a placement
  // that changes how many targeting rolls a round consumes must not shift the
  // draw order. Reading the two generators' draw counts is how that is checked
  // rather than argued.
  const side: SideState = { deck: ['a', 'b', 'c', 'd', 'e', 'f'], cursor: 0, hand: [] };
  const rngDeck = makeRng(4, 'deck');
  const rngCombat = makeRng(4, 'combat');
  drawTo(side, 5, rngDeck);
  assert.equal(rngDeck.n, 0, 'drawing off the top of the deck takes no randomness at all');

  side.hand.splice(0, 4);
  const combatDrawsBefore = rngCombat.n;
  drawTo(side, 5, rngDeck);
  assert.ok(rngDeck.n > 0, 'the reshuffle took draws from the deck stream');
  assert.equal(rngCombat.n, combatDrawsBefore, 'and none at all from the combat stream');
});

test('a fight long enough to reshuffle still replays byte-identically', () => {
  // The determinism claim, over fights that actually reach a reshuffle. A
  // 12-round fight with an 18-card deck and a 5-card hand draws past the end of
  // the deck routinely; the assertion below refuses to report success unless
  // some fight in the window did.
  const enc = encounterById('hard');
  let reshuffled = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const setup: FightSetup = {
      seed,
      pool: CARD_POOL,
      playerDeck: PLAYER_DECK,
      enemyDeck: ENEMY_DECK,
      enemyOpening: enc.opening,
      playerHero: PLAYER_HERO,
      enemyHero: enc.enemyHero,
      maxRounds: MAX_ROUNDS,
    };
    const live = runFight(setup, randomPlacer(seed, 'placement-a'));
    const replayed = replayFight(setup, live.log);
    assert.equal(
      hashFight(replayed),
      hashFight(live.fight),
      `seed ${seed}: replay from the action list diverged from the live run`,
    );
    // A reshuffle is the only thing that moves the deck generator after setup,
    // which is two shuffles and nothing else.
    if (live.fight.rngDeck.n > setup.playerDeck.length + setup.enemyDeck.length) reshuffled++;
  }
  assert.ok(
    reshuffled > 0,
    'no fight in the window reshuffled, so this proves nothing about the reshuffle',
  );
});

test('a hand-built round replays through the same reshuffle', () => {
  // The bot path and the hand-built path are the same code path, and this is
  // what says so for the reshuffle specifically: a recorded action list drives
  // `runRound` directly, with no policy in the loop.
  const enc = encounterById('hard');
  const setup: FightSetup = {
    seed: 7,
    pool: CARD_POOL,
    playerDeck: PLAYER_DECK,
    enemyDeck: ENEMY_DECK,
    enemyOpening: enc.opening,
    playerHero: PLAYER_HERO,
    enemyHero: enc.enemyHero,
    maxRounds: MAX_ROUNDS,
  };
  const live = runFight(setup, appendRightPlacer());
  const f = setupFight(setup);
  for (const rec of live.log) {
    if (f.result !== 'ongoing') break;
    const placements: Placement[] = rec.placements.slice();
    const casts: CastAction[] = (rec.casts ?? []).slice();
    runRound(
      f,
      () => placements,
      () => casts,
    );
  }
  assert.equal(hashFight(f), hashFight(live.fight));
});
