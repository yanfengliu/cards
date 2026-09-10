// Sigils exist, a run grants them, and every grant is exactly what it claims.
//
// `docs/design/game.md` calls sigils "the run's progression system" and unit 5
// left an inert seam for them: a ledger that stayed empty, a hash that covered
// it, and a gate that failed if anything ever filled it. This file retires
// that gate and replaces it with the live one: the ledger fills, every entry
// in it is consistent with the deck and the content, and the fight the run
// hands the engine carries what the ledger says it should.
//
// **Nothing under `src/engine/` changed for sigils, and that is a claim this
// file holds.** A card sigil is the trait's own word merged into a deck
// instance by `resolveDeckCard`, so `runPool` hands `makeUnit` an ordinary
// card; a hero sigil is a number on the `HeroSpec` the run already handed in,
// or the run's own Health bar. The resolver cannot tell a sigil-granted Relay
// from a printed one, and the test below that fights both proves it.
//
// Bound of this file - what a green run does and does not prove:
//
//   Card sigils: a trait attached to one deck instance reaches the fight
//   through `runPool` as an ordinary word in `traits`, the other copies are
//   untouched, and a sigil for a trait the card already has is refused.
//   Hero sigils: each of the three effects reaches a fight through the seam it
//   uses - the `HeroSpec`'s Power and Armour, and the run's Health bar - at
//   fixture numbers, and the enemy hero is untouched by all of them.
//   The run: over the fixture and the first shipped seeds, both kinds are
//   granted, every run replays from its log to the same hash, `sigilProblems`
//   and `fightSigilProblems` are empty, and the population is asserted so a
//   window that granted none fails rather than passes.
//   The log format: a format 1 log recorded before sigils existed upgrades to
//   the current format and replays to the hash it had then. The two goldens
//   are the bound - two seeds, two route styles, `RUN_CONTENT` as it stood.
//   Words: the shelf's names and the panel's names come from one table keyed
//   by the engine's `Trait` union. Strings, never pixels.
//   Windows, not spaces: 30 fixture seeds x 2 route styles, 12 shipped seeds.
//
// Made to go red: see `docs/learning/gate-proofs.md` for the mutations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runFight } from '../src/engine/fight.ts';
import { hashString } from '../src/engine/hash.ts';
import { drain } from '../src/engine/resolver.ts';
import { makeRng } from '../src/engine/rng.ts';
import {
  type CardPool,
  type GameState,
  type Trait,
  type UnitCard,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  unitCount,
} from '../src/engine/state.ts';
import { CARD_SIGILS, HERO_SIGILS, SIGILS } from '../src/content/sigils.ts';
import { RUN_CONTENT } from '../src/run/content.ts';
import {
  attachSigil,
  grantedTraits,
  makeDeckCard,
  resolveDeckCard,
  runPool,
} from '../src/run/deck.ts';
import { hashRun, runToCanonical } from '../src/run/hash.ts';
import {
  attachCardSigil,
  attachOffers,
  fightSeedFor,
  grantHeroSigil,
  heldHeroSigils,
  heroSigilOffer,
  heroSpecFor,
  rewardOffer,
} from '../src/run/nodes.ts';
import {
  type RunAgent,
  cloneRunState,
  fightSetupFor,
  migrateRunLog,
  replayRun,
  runChoices,
  runRun,
  startRun,
} from '../src/run/run.ts';
import { fightSigilProblems, sigilProblems } from '../src/run/sigils.ts';
import {
  RUN_LOG_FORMAT,
  type CardSigilDef,
  type HeroSigilDef,
  type RunContent,
  type RunLog,
  type SigilDef,
} from '../src/run/types.ts';
import { checkRuns } from '../src/sim/runmeasure.ts';
import { makeRunAgent } from '../src/sim/runbots.ts';
import { TRAIT_TERMS } from '../src/render/glossary.ts';
import { CARD_SIGIL_TERMS, heroEffectWords, heroSigilTerm } from '../src/render/sigil-terms.ts';
import { cardViewOf, traitPips } from '../src/render/board.ts';
import { explainCard } from '../src/render/inspect.ts';
import { cardEntityView } from '../src/render/view.ts';
import { pct } from '../src/render/odds.ts';
import { createRunController } from '../src/ui/run.ts';

// ---------------------------------------------------------------------------
// The fixture: three cards, every sigil once, a five-row act with elites
// ---------------------------------------------------------------------------

const CARDS: readonly UnitCard[] = [
  { id: 't_grunt', name: 'Grunt', cost: 1, power: 2, health: 2, armour: 0, tribe: 'human', traits: [] },
  { id: 't_wall', name: 'Wall', cost: 2, power: 1, health: 5, armour: 1, tribe: 'dwarf', traits: ['guard'] },
  { id: 't_mook', name: 'Mook', cost: 1, power: 1, health: 1, armour: 0, tribe: 'orc', traits: [] },
];

const POOL: CardPool = {
  card(id) {
    const c = CARDS.find((x) => x.id === id);
    if (c === undefined) throw new Error(`fixture pool: no card "${id}"`);
    return c;
  },
  energyPerTurn: 3,
  handSize: 5,
};

const RELAY: CardSigilDef = { kind: 'card', id: 'fx_relay', name: 'Relay Sigil', trait: 'relay', weight: 2 };
const WAKE: CardSigilDef = { kind: 'card', id: 'fx_wake', name: 'Wake Sigil', trait: 'wake', weight: 2 };
const GUARD: CardSigilDef = { kind: 'card', id: 'fx_guard', name: 'Guard Sigil', trait: 'guard', weight: 1 };
const OAK: HeroSigilDef = { kind: 'hero', id: 'fx_oak', name: 'Oak', effect: { kind: 'maxHealth', amount: 10 }, weight: 1 };
const LANCE: HeroSigilDef = { kind: 'hero', id: 'fx_lance', name: 'Lance', effect: { kind: 'heroPower', amount: 1 }, weight: 1 };
const BULWARK: HeroSigilDef = { kind: 'hero', id: 'fx_bulwark', name: 'Bulwark', effect: { kind: 'heroArmour', amount: 1 }, weight: 1 };
const FIXTURE_SIGILS: readonly SigilDef[] = [RELAY, WAKE, GUARD, OAK, LANCE, BULWARK];

function fixtureContent(overrides: Partial<RunContent> = {}): RunContent {
  const enemy = {
    id: 'fx_enemy',
    name: 'Mooks',
    enemyHero: { name: 'Mooks', health: 6, power: 2, armour: 0 },
    enemyDeck: ['t_mook', 't_mook', 't_mook'],
    opening: [] as readonly string[],
  };
  return {
    pool: POOL,
    hero: { name: 'Knight', health: 40, power: 2, armour: 0 },
    startingDeck: ['t_grunt', 't_grunt', 't_wall', 't_grunt', 't_grunt', 't_wall'],
    acts: [
      {
        act: 0,
        name: 'Only Act',
        fights: [enemy],
        elites: [{ ...enemy, id: 'fx_elite', name: 'Big Mooks', enemyHero: { ...enemy.enemyHero, health: 9 } }],
        boss: { ...enemy, id: 'fx_boss', name: 'Boss', enemyHero: { name: 'Boss', health: 12, power: 4, armour: 0 } },
        goldPerFight: 20,
        goldPerElite: 40,
        goldPerBoss: 60,
      },
    ],
    mapShape: {
      extraEdgeChance: 0.5,
      rows: [
        { minWidth: 1, maxWidth: 1, weights: [{ type: 'fight', weight: 1 }] },
        { minWidth: 2, maxWidth: 2, weights: [{ type: 'elite', weight: 1 }, { type: 'fight', weight: 1 }] },
        { minWidth: 2, maxWidth: 2, weights: [{ type: 'fight', weight: 1 }, { type: 'elite', weight: 1 }] },
        { minWidth: 1, maxWidth: 2, weights: [{ type: 'rest', weight: 1 }, { type: 'forge', weight: 1 }] },
        { minWidth: 1, maxWidth: 1, weights: [{ type: 'boss', weight: 1 }] },
      ],
    },
    rewards: [
      { cardId: 't_grunt', weight: 1 },
      { cardId: 't_wall', weight: 1 },
    ],
    events: [{ id: 'fx_ev', name: 'Fixture Event', options: [{ label: 'heal', effects: [{ kind: 'heal', amount: 5 }] }] }],
    sigils: FIXTURE_SIGILS,
    heroSigilOffers: 2,
    // Every ordinary fight offers a card sigil, so the attach path is walked
    // often enough to assert a population over; the tests about the roll
    // itself override this.
    cardSigilChance: 1,
    rewardOffers: 2,
    shopStock: 2,
    shopBasePrice: 10,
    shopPricePerCost: 5,
    startingGold: 0,
    restHealFraction: 0.25,
    maxRounds: 20,
    ...overrides,
  };
}

/** The first node of the fixture map: always a fight. */
function firstNode(run: ReturnType<typeof startRun>): ReturnType<typeof startRun>['maps'][number]['nodes'][number] {
  const map = run.maps[0]!;
  return map.nodes[map.rows[0]![0]!]!;
}

function nodeOfType(run: ReturnType<typeof startRun>, type: 'fight' | 'elite' | 'boss'): ReturnType<typeof firstNode> {
  const node = run.maps[0]!.nodes.find((n) => n.type === type);
  assert.ok(node !== undefined, `the fixture map has no ${type} node`);
  return node;
}

// ---------------------------------------------------------------------------
// The seam into the fight
// ---------------------------------------------------------------------------

test('a card sigil is a trait on one deck instance, and the fight sees it there', () => {
  const deck = ['t_grunt', 't_grunt'].map((id, i) => makeDeckCard(id, i));
  const plain = resolveDeckCard(POOL, deck[0]!);
  assert.deepEqual(plain.traits, []);
  assert.deepEqual(grantedTraits(POOL, deck[0]!), []);

  attachSigil(POOL, deck, 0, { id: 'fx_relay', trait: 'relay' });
  const pool = runPool(POOL, deck);
  const relay = pool.card('t_grunt#0');
  assert.deepEqual(relay.traits, ['relay'], 'the sigil trait did not reach the fight');
  assert.deepEqual(grantedTraits(POOL, deck[0]!), ['relay'], 'the run cannot say the trait came from a sigil');
  // The engine's card gains no field: a fight's card is an ordinary card, and
  // where a trait came from is the run's question, never the resolver's.
  assert.ok(!('sigilTraits' in relay), 'the engine card grew a sigil field');
  // The other copy is untouched: a sigil attaches to a card, not a card id.
  assert.deepEqual(pool.card('t_grunt#1').traits, []);
  assert.deepEqual(grantedTraits(POOL, deck[1]!), []);

  // A second sigil for a different trait stacks; one for the same trait is refused.
  attachSigil(POOL, deck, 0, { id: 'fx_wake', trait: 'wake' });
  assert.deepEqual(runPool(POOL, deck).card('t_grunt#0').traits, ['relay', 'wake']);
  assert.throws(
    () => attachSigil(POOL, deck, 0, { id: 'fx_relay', trait: 'relay' }),
    /"fx_relay" grants relay and t_grunt#0 already has it, so attaching it would change nothing/,
  );
  // A trait the card prints is "already has it" too.
  const walls = [makeDeckCard('t_wall', 0)];
  assert.throws(() => attachSigil(POOL, walls, 0, { id: 'fx_guard', trait: 'guard' }), /already has it/);
  assert.throws(() => attachSigil(POOL, walls, 3, { id: 'fx_guard', trait: 'guard' }), /deck index 3 is not a card/);
});

test('a sigil-granted Relay hands Power exactly as a printed one does', () => {
  // The resolver is not consulted about provenance: both Relays are the word
  // `relay` in `traits`. Two identical fights, one with the Relay printed and
  // one with it sigilled, must produce the same events. This is what "no
  // engine change was needed" means as a check rather than as a sentence.
  const printedPool: CardPool = {
    ...POOL,
    card: (id) => (id === 't_grunt' ? { ...POOL.card('t_grunt'), traits: ['relay'] } : POOL.card(id)),
  };
  const deck = [makeDeckCard('t_grunt', 0)];
  attachSigil(POOL, deck, 0, { id: 'fx_relay', trait: 'relay' });
  const outcomes = [runPool(POOL, deck), runPool(printedPool, [makeDeckCard('t_grunt', 0)])].map((pool) => {
    const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
    state.board.player.push(makeHero(state, 'player', { name: 'K', health: 30, power: 0, armour: 0 }));
    state.board.enemy.push(makeHero(state, 'enemy', { name: 'E', health: 30, power: 0, armour: 0 }));
    const u = makeUnit(state, 'player', pool.card('t_grunt#0'));
    insertUnit(state, 'player', u, unitCount(state, 'player'));
    const { events } = drain(state, [{ kind: 'afterAct', uid: u.uid }], makeRng(1, 'combat'));
    return events.filter((e) => e.kind === 'powerGained').map((e) => JSON.stringify(e));
  });
  assert.ok(outcomes[0]!.length === 1, 'the sigilled Relay fired nothing');
  assert.deepEqual(outcomes[0], outcomes[1], 'a sigilled Relay and a printed one differ in the resolver');
});

// ---------------------------------------------------------------------------
// Hero sigils reach the fight through the seams the engine already has
// ---------------------------------------------------------------------------

test('each hero sigil reaches a fight through its seam, and none is there without it', () => {
  const content = fixtureContent();
  const run = startRun(content, 3);
  const node = firstNode(run);
  const bare = fightSetupFor(run, node);
  assert.equal(bare.playerHero.power, content.hero.power, 'a run with no hero sigil moved the hero’s Power');
  assert.equal(bare.playerHero.armour, content.hero.armour);
  assert.equal(run.hero.maxHealth, 40);
  assert.deepEqual(fightSigilProblems(run), []);

  grantHeroSigil(run, LANCE);
  grantHeroSigil(run, BULWARK);
  const bent = fightSetupFor(run, node);
  assert.equal(bent.playerHero.power, content.hero.power + 1, 'the Lance did not reach the fight');
  assert.equal(bent.playerHero.armour, content.hero.armour + 1, 'the Bulwark did not reach the fight');
  assert.equal(bent.enemyHero.power, 2, 'a hero sigil reached the enemy hero');
  assert.equal(bent.enemyHero.armour, 0);

  run.hero.health = 25;
  grantHeroSigil(run, OAK);
  assert.equal(run.hero.maxHealth, 50, 'Oak did not raise the bar');
  assert.equal(run.hero.health, 35, 'Oak did not heal by its amount');
  assert.equal(fightSetupFor(run, node).playerHero.health, 35, 'the fight opened on a different bar');

  assert.throws(() => grantHeroSigil(run, OAK), /already holds "fx_oak"/);
  assert.deepEqual(sigilProblems(run), []);
  assert.deepEqual(fightSigilProblems(run), []);

  // The same sigil is never re-offered; with all three held there is nothing to offer.
  assert.deepEqual(heroSigilOffer(run, node), []);
  // `heroSpecFor` is the one place the numbers are assembled, and the setup is
  // built from it rather than from a second sum written somewhere else.
  assert.deepEqual(heroSpecFor(run), fightSetupFor(run, node).playerHero);
});

test('a hero sigil changes the fights the engine actually resolves', () => {
  // The check above reads a setup. This one runs two real fights per seed and
  // requires the *outcomes* to differ, so "the number reached the fight" is
  // not a claim about a field nothing consumes.
  //
  // What is compared is deliberately downstream of the sigil. The hero's own
  // Power is in `stateToCanonical`, so comparing digests would go green on a
  // hero spec that was built correctly and then ignored. Rounds taken and the
  // Health the hero finishes on are things only the resolver produces.
  //
  // Bound: the shipped `RUN_CONTENT`, the first act's first node, twelve
  // seeds, the greedy router's placement bot. The floors are half the window
  // and were measured at 6 and 7; they are floors so that a content change
  // which made the difference smaller still fails loudly rather than quietly.
  const lance = HERO_SIGILS.find((s) => s.effect.kind === 'heroPower');
  assert.ok(lance !== undefined, 'the shipped content has no Power sigil to check with');
  let fewerRounds = 0;
  let healthier = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const node = firstNode(startRun(RUN_CONTENT, seed));
    const play = (run: ReturnType<typeof startRun>): { round: number; health: number } => {
      const { fight } = runFight(
        fightSetupFor(run, node),
        makeRunAgent({ route: 'greedy', placement: 'right', seed }).placement,
      );
      return { round: fight.round, health: heroOf(fight.state, 'player').health };
    };
    const plain = play(startRun(RUN_CONTENT, seed));
    const armed = startRun(RUN_CONTENT, seed);
    grantHeroSigil(armed, lance);
    const strong = play(armed);
    assert.ok(strong.round <= plain.round, `seed ${seed}: +1 hero Power made the fight longer`);
    assert.ok(strong.health >= plain.health, `seed ${seed}: +1 hero Power cost the hero Health`);
    if (strong.round < plain.round) fewerRounds++;
    if (strong.health > plain.health) healthier++;
  }
  assert.ok(fewerRounds >= 4, `+1 hero Power shortened only ${fewerRounds} of 12 fights`);
  assert.ok(healthier >= 4, `+1 hero Power saved Health in only ${healthier} of 12 fights`);
});

// ---------------------------------------------------------------------------
// The run grants them, and every grant is consistent
// ---------------------------------------------------------------------------

function agentFor(route: 'greedy' | 'random', seed: number): RunAgent {
  return makeRunAgent({ route, placement: 'right', seed });
}

test('a run grants both kinds, replays them byte-identically, and the ledger agrees with the deck', () => {
  const content = fixtureContent();
  let hero = 0;
  let card = 0;
  let declinedSigil = 0;
  for (let seed = 1; seed <= 30; seed++) {
    for (const route of ['greedy', 'random'] as const) {
      const { run, log } = runRun(content, seed, agentFor(route, seed));
      const label = `fixture seed ${seed} ${route}`;
      assert.deepEqual(sigilProblems(run), [], `${label}: the ledger and the deck disagree`);
      assert.deepEqual(fightSigilProblems(run), [], `${label}: the fight and the ledger disagree`);
      assert.equal(hashRun(replayRun(content, log)), hashRun(run), `${label}: did not replay`);
      hero += run.sigils.filter((g) => g.target === 'hero').length;
      card += run.sigils.filter((g) => g.target !== 'hero').length;

      // The choice list has the shape `visit` writes: a sigil choice only at an
      // elite or boss, an attach only after a reward that picked a sigil.
      for (const rec of log.nodes) {
        const kinds = rec.choices.map((c) => c.kind);
        if (kinds.includes('sigil')) {
          assert.ok(rec.type === 'elite' || rec.type === 'boss', `${label}: a sigil choice at a ${rec.type}`);
          assert.equal(kinds[1], 'sigil', `${label}: the sigil choice is not the node's second choice`);
        }
        if (kinds.includes('attach')) {
          assert.equal(kinds[kinds.indexOf('attach') - 1], 'reward', `${label}: an attach not after a reward`);
        }
        for (const c of rec.choices) if (c.kind === 'sigil' && c.pick < 0) declinedSigil++;
      }
    }
  }
  // Floors, not targets: measured well above each when they were set, and they
  // exist so a window that stopped walking a path fails instead of passing.
  assert.ok(hero >= 40, `only ${hero} hero sigils granted across 60 runs; the offer path was barely walked`);
  assert.ok(card >= 15, `only ${card} card sigils attached across 60 runs; the attach path was barely walked`);
  assert.ok(declinedSigil >= 3, `only ${declinedSigil} hero sigil offers declined; the decline path was barely walked`);
});

test('the shipped run grants sigils and replays them', () => {
  let granted = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { run, log } = runRun(RUN_CONTENT, seed, agentFor('greedy', seed));
    assert.deepEqual(sigilProblems(run), [], `shipped seed ${seed}: the ledger and the deck disagree`);
    assert.deepEqual(fightSigilProblems(run), [], `shipped seed ${seed}: the fight and the ledger disagree`);
    assert.equal(hashRun(replayRun(RUN_CONTENT, log)), hashRun(run), `shipped seed ${seed}: did not replay`);
    granted += run.sigils.length;
    for (const g of run.sigils) assert.ok(SIGILS.some((s) => s.id === g.sigilId), `unknown sigil ${g.sigilId}`);
  }
  assert.ok(granted >= 12, `only ${granted} sigils across 12 shipped runs`);
});

test('fightSigilProblems compares the ledger with the fight, in both directions', () => {
  // What this can prove by moving state, and what it cannot. The expected side
  // is read off `run.sigils` and `content.sigils`; the subject side is the
  // pool and hero spec the run hands the engine. So a disagreement between the
  // ledger and the *deck* shows up here, in both directions. A hero number is
  // a different case - `heroSpecFor` reads the same ledger, so no state moves
  // them apart, and the red-proof for that half is a source mutation recorded
  // in `docs/learning/gate-proofs.md`.
  const content = fixtureContent();
  const run = startRun(content, 6);
  attachCardSigil(run, 0, RELAY);
  grantHeroSigil(run, LANCE);
  assert.deepEqual(fightSigilProblems(run), []);

  // The ledger says the Relay is on the card and the deck card has lost it, so
  // the pool the fight resolves no longer carries it.
  const lost = cloneRunState(run);
  lost.deck[0] = { ...lost.deck[0]!, sigils: [] };
  assert.match(
    fightSigilProblems(lost).join('\n'),
    /the fight resolves t_grunt#0 with traits \[\] and the ledger says it should be \[relay\]/,
  );

  // The other direction, which is the "one that was never granted never does"
  // half: the deck card carries a trait the ledger never granted.
  const ungranted = cloneRunState(run);
  ungranted.sigils = ungranted.sigils.filter((g) => g.target === 'hero');
  assert.match(
    fightSigilProblems(ungranted).join('\n'),
    /the fight resolves t_grunt#0 with traits \[relay\] and the ledger says it should be \[\]/,
  );

  // A grant recorded against a card that never received it.
  const misplaced = cloneRunState(run);
  misplaced.sigils = [{ target: { instanceId: 't_grunt#1' }, sigilId: RELAY.id }];
  const said = fightSigilProblems(misplaced).join('\n');
  assert.match(said, /t_grunt#1/, 'the card the ledger names was not checked');
  assert.match(said, /t_grunt#0/, 'the card that actually carries it was not checked');
});

test('the run hash moves with a sigil, and with which card it went on', () => {
  const content = fixtureContent();
  const base = startRun(content, 7);
  const h0 = hashRun(base);

  const onFirst = cloneRunState(base);
  attachCardSigil(onFirst, 0, RELAY);
  const onSecond = cloneRunState(base);
  attachCardSigil(onSecond, 1, RELAY);
  const withHero = cloneRunState(base);
  grantHeroSigil(withHero, LANCE);

  assert.notEqual(hashRun(onFirst), h0, 'attaching a sigil did not move the run hash');
  assert.notEqual(hashRun(onFirst), hashRun(onSecond), 'the hash does not see which card the sigil is on');
  assert.notEqual(hashRun(withHero), h0, 'a hero sigil did not move the run hash');
  assert.equal(hashRun(cloneRunState(base)), h0, 'cloning alone moved the hash');

  // Two hero sigils in a different order are a different ledger and hash apart,
  // because the ledger is a history and not a set.
  const oakFirst = cloneRunState(base);
  grantHeroSigil(oakFirst, OAK);
  grantHeroSigil(oakFirst, LANCE);
  const lanceFirst = cloneRunState(base);
  grantHeroSigil(lanceFirst, LANCE);
  grantHeroSigil(lanceFirst, OAK);
  assert.notEqual(hashRun(oakFirst), hashRun(lanceFirst), 'the hash does not see the order they were taken in');

  // The canonical form: a plain instance is exactly the string it always was.
  const deckOf = (s: string): string => /deck=\[([^\]]*)\]/.exec(s)![1]!;
  assert.doesNotMatch(deckOf(runToCanonical(base)), /~/);
  assert.match(deckOf(runToCanonical(onFirst)), /t_grunt#0\+0\/0\/0~fx_relay=relay,t_grunt#1\+0\/0\/0,/);
  assert.match(runToCanonical(withHero), /sigils=\[hero:fx_lance\]/);
  assert.match(runToCanonical(onFirst), /sigils=\[t_grunt#0:fx_relay\]/);
});

test('sigilProblems sees a ledger that drifted from the deck', () => {
  const content = fixtureContent();
  const run = startRun(content, 2);
  attachCardSigil(run, 0, RELAY);
  grantHeroSigil(run, OAK);
  assert.deepEqual(sigilProblems(run), []);

  const orphanLedger = cloneRunState(run);
  orphanLedger.deck[0] = { ...orphanLedger.deck[0]!, sigils: [] };
  assert.match(sigilProblems(orphanLedger).join('\n'), /the deck card does not carry it/);

  const orphanDeck = cloneRunState(run);
  orphanDeck.sigils = orphanDeck.sigils.filter((g) => g.target === 'hero');
  assert.match(sigilProblems(orphanDeck).join('\n'), /the ledger never granted it/);

  const unknown = cloneRunState(run);
  unknown.sigils.push({ target: 'hero', sigilId: 'fx_nothing' });
  assert.match(sigilProblems(unknown).join('\n'), /"fx_nothing", which the content does not define/);

  const twice = cloneRunState(run);
  twice.sigils.push({ target: 'hero', sigilId: 'fx_oak' });
  assert.match(sigilProblems(twice).join('\n'), /holds "fx_oak" twice/);

  // The Health bar is the one hero effect with a second record to drift from.
  const shortBar = cloneRunState(run);
  shortBar.hero = { ...shortBar.hero, maxHealth: content.hero.health };
  assert.match(sigilProblems(shortBar).join('\n'), /the hero's maximum Health is/);
});

test('the measurement instrument reports the sigil path as run only when it ran', () => {
  const seeds = [1, 2, 3, 4, 5];
  const live = checkRuns(seeds, 1, 'greedy', 'right', fixtureContent());
  assert.ok(live.sigilsGranted > 0, 'the fixture granted nothing, so the instrument cannot be checked');
  assert.deepEqual(live.sigilProblems, []);
  assert.deepEqual(live.fightSigilProblems, []);
  const inert = checkRuns(seeds, 1, 'greedy', 'right', fixtureContent({ sigils: [] }));
  assert.equal(inert.sigilsGranted, 0);
  assert.deepEqual(inert.fightSigilProblems, [], 'a run that granted nothing must still agree with its fights');
});

// ---------------------------------------------------------------------------
// Offers: what is put on a shelf, and what is not
// ---------------------------------------------------------------------------

test('a card sigil is offered only at an ordinary fight, only on the roll, and only with somewhere to go', () => {
  const always = fixtureContent({ cardSigilChance: 1 });
  const run = startRun(always, 4);
  const fight = firstNode(run);
  const atFight = rewardOffer(cloneRunState(run), fight);
  assert.equal(atFight.length, always.rewardOffers + 1, 'a fight at chance 1 did not put a sigil on the shelf');
  assert.equal(atFight[atFight.length - 1]!.kind, 'sigil');
  assert.ok(atFight.slice(0, -1).every((o) => o.kind === 'card'));

  const atElite = rewardOffer(cloneRunState(run), nodeOfType(run, 'elite'));
  assert.equal(atElite.length, always.rewardOffers, 'an elite put a card sigil on the shelf');
  assert.ok(atElite.every((o) => o.kind === 'card'));

  const never = startRun(fixtureContent({ cardSigilChance: 0 }), 4);
  assert.ok(rewardOffer(never, firstNode(never)).every((o) => o.kind === 'card'));

  // Every deck card is a Wall and the only card sigil grants Guard, which a
  // Wall prints: nothing can take it, so nothing is offered.
  const walls = startRun(fixtureContent({ cardSigilChance: 1, sigils: [GUARD], startingDeck: ['t_wall', 't_wall'] }), 4);
  assert.deepEqual(attachOffers(walls, GUARD), []);
  assert.ok(rewardOffer(walls, firstNode(walls)).every((o) => o.kind === 'card'), 'a sigil nobody could take was offered');
});

test('the attach shelf lists every card without the trait, in deck order, and refuses the rest', () => {
  const run = startRun(fixtureContent(), 4);
  // Deck: grunt, grunt, wall, grunt, grunt, wall. A Guard Sigil skips the Walls.
  assert.deepEqual(attachOffers(run, GUARD), [0, 1, 3, 4]);
  assert.deepEqual(attachOffers(run, RELAY), [0, 1, 2, 3, 4, 5]);
  attachCardSigil(run, 1, RELAY);
  assert.deepEqual(attachOffers(run, RELAY), [0, 2, 3, 4, 5]);
  assert.throws(() => attachCardSigil(run, 1, RELAY), /already has it/);
});

test('a sigil offer is drawn from the node, moves no run draw, and moves no fight seed', () => {
  // This is what lets a log recorded before sigils existed replay under this
  // code: every shelf such a log indexed is drawn from exactly the run draws
  // it was drawn from then. `nodes.ts` states it; this is where it is held.
  const content = fixtureContent({ cardSigilChance: 1 });
  const run = startRun(content, 9);
  const fight = firstNode(run);
  const elite = nodeOfType(run, 'elite');
  const seedBefore = fightSeedFor(run, fight);

  const a = cloneRunState(run);
  heroSigilOffer(a, elite);
  assert.equal(a.rng.n - run.rng.n, 0, 'a hero sigil offer took a run draw');

  const b = cloneRunState(run);
  rewardOffer(b, elite);
  assert.equal(b.rng.n - run.rng.n, content.rewardOffers, 'an elite shelf drew more than its cards');

  const c = cloneRunState(run);
  rewardOffer(c, fight);
  assert.equal(c.rng.n - run.rng.n, content.rewardOffers, 'a fight shelf at chance 1 took extra run draws for its sigil');

  const d = startRun(fixtureContent({ cardSigilChance: 0 }), 9);
  const n0 = d.rng.n;
  rewardOffer(d, fight);
  assert.equal(d.rng.n - n0, content.rewardOffers, 'a fight shelf at chance 0 drew a different number of cards');

  // The same node offers the same thing however the run got there.
  assert.deepEqual(
    heroSigilOffer(cloneRunState(run), elite).map((s) => s.id),
    heroSigilOffer(a, elite).map((s) => s.id),
  );
  // No fight seed moved for any of it.
  for (const r of [a, b, c]) assert.equal(fightSeedFor(r, fight), seedBefore);
});

// ---------------------------------------------------------------------------
// The log format
// ---------------------------------------------------------------------------

test('a log from before sigils is upgraded and refused unupgraded, never replayed as if it were current', () => {
  const content = fixtureContent();
  const live = runRun(content, 5, agentFor('greedy', 5));
  assert.equal(live.log.format, RUN_LOG_FORMAT);

  const old = { seed: 5, nodes: live.log.nodes } as unknown as RunLog;
  assert.throws(() => replayRun(content, old), /written in format 1 and this code replays format 2/);
  assert.throws(() => createRunController(content, 5, { resume: old }), /written in format 1/);

  const future: RunLog = { ...live.log, format: 99 };
  assert.throws(() => replayRun(content, future), /written in format 99/);
  assert.throws(() => migrateRunLog(future), /written in format 99, and this code reads formats 1 and 2/);
  assert.throws(() => migrateRunLog(null), /not a run log - it is not an object/);
  assert.throws(() => migrateRunLog({ nodes: [] }), /it has no integer `seed`/);
  assert.throws(() => migrateRunLog({ seed: 1 }), /has no `nodes` list/);

  // A current-format log comes back unchanged, class and all.
  const same = migrateRunLog(live.log);
  assert.equal(same.format, RUN_LOG_FORMAT);
  assert.equal(same.classId, live.log.classId);

  // The current format replays, and an empty log of the current format is a fresh run.
  assert.equal(hashRun(replayRun(content, live.log)), hashRun(live.run));
  assert.equal(hashRun(replayRun(content, { seed: 5, format: RUN_LOG_FORMAT, nodes: [] })), hashRun(startRun(content, 5)));
  assert.ok(runChoices(live.log).some((c) => c.kind === 'sigil' || c.kind === 'attach'), 'the fixture run recorded no sigil choice at all');
});

/**
 * The reward table `RUN_CONTENT` had at `c13a0cc`, the revision the two golden
 * logs under `test/golden/` were recorded at.
 *
 * It is pinned here because a recorded log is a list of *indices into offers*,
 * and an offer is drawn from the reward table: change the table and every
 * `reward` pick in every old log names a different card. Unit 10 changed it -
 * `REWARD_TABLE`'s ten entries became the Knight's fifteen in
 * `src/content/classes.ts` - so replaying these logs against today's shipped
 * content throws on the first fight after a reward, naming a deck instance the
 * deck does not hold. That is a content change retiring a save, not a broken
 * migration, and pinning the table is what separates the two questions.
 *
 * The consequence, stated so the next author is not surprised: this pin is a
 * standing cost. A future change to any other piece of content these two runs
 * touch - a card's stats, an act's encounters, the round cap - needs the same
 * pin or the goldens retired and re-recorded.
 */
const LEGACY_REWARDS = [
  { cardId: 'u_squire', weight: 10 },
  { cardId: 'u_shieldbearer', weight: 10 },
  { cardId: 'u_pikeman', weight: 10 },
  { cardId: 'u_hornblower', weight: 8 },
  { cardId: 'u_ironguard', weight: 8 },
  { cardId: 'u_avenger', weight: 8 },
  { cardId: 'u_berserker', weight: 8 },
  { cardId: 'u_captain', weight: 4 },
  { cardId: 'u_sentinel', weight: 4 },
  { cardId: 'u_champion', weight: 4 },
] as const;

test('the two golden format 1 logs replay to the runs they recorded', () => {
  // **The bound of this gate.** Two whole-run choice lists produced by code
  // that had no concept of a sigil, at `c13a0cc`, one random-routed and one
  // greedy, against `RUN_CONTENT` with the reward table pinned above. It
  // proves that a log a player already has still loads and reaches the run it
  // recorded, node for node. It proves nothing about a third seed, another
  // class, or a content change that moves a card the run did not draw.
  // `AGENTS.md`: "a format change ships with a migration and a fixture of the
  // old format that still loads."
  //
  // **The hash is compared against the pre-class canonical string, not the
  // current one, and that is the point rather than a dodge.** Unit 10 put
  // `class=<id>` into `runToCanonical` on purpose - `test/classes.test.ts`
  // states why - so every run hash recorded before classes moved. Removing
  // that one line and rehashing asks the only question this gate is about:
  // is the rest of the run byte-identical to the run this log recorded? A
  // re-recorded hash would have answered a different question, and would have
  // answered it by agreeing with itself.
  const legacy: RunContent = { ...RUN_CONTENT, rewards: LEGACY_REWARDS.map((r) => ({ ...r })) };
  delete (legacy as { classes?: unknown }).classes;

  const goldens = [
    'test/golden/run-log-format-1-seed-6-random.json',
    'test/golden/run-log-format-1-seed-7-greedy.json',
  ];
  for (const path of goldens) {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const fixture = raw as {
      hash: string;
      result: string;
      recordedAt: string;
      log: { seed: number; nodes: unknown[]; format?: number };
    };
    assert.equal(fixture.log.format, undefined, `${path} is not a format 1 log`);
    assert.equal(fixture.recordedAt, 'c13a0cc', `${path} was not recorded where this test says it was`);
    assert.ok(
      !JSON.stringify(fixture.log).includes('"sigil"'),
      `${path} holds a sigil choice, so it was not recorded before sigils existed`,
    );

    // Unupgraded it is refused, by name, rather than replayed as if current.
    assert.throws(() => replayRun(legacy, fixture.log as unknown as RunLog), /written in format 1/);

    const upgraded = migrateRunLog(fixture.log);
    assert.equal(upgraded.format, RUN_LOG_FORMAT);
    assert.equal(upgraded.seed, fixture.log.seed);
    // The upgrade inserts declines and touches nothing else.
    assert.equal(
      upgraded.nodes.reduce((n, r) => n + r.choices.filter((c) => c.kind === 'sigil').length, 0),
      upgraded.nodes.filter((r) => (r.type === 'elite' || r.type === 'boss') && r.fightResult === 'playerWin').length,
      `${path}: the upgrade did not insert exactly one sigil choice per won elite or boss`,
    );

    const replayed = replayRun(legacy, upgraded);
    assert.equal(replayed.result, fixture.result, `${path}: the run ended somewhere else`);
    const preClass = runToCanonical(replayed).replace(/;class=[a-z]+;/, ';');
    assert.notEqual(preClass, runToCanonical(replayed), `${path}: the class line was not found to strip`);
    assert.equal(
      hashString(preClass),
      fixture.hash,
      `${path}: the recorded run no longer replays to the run it recorded`,
    );
    // The upgrade adds declines and nothing else, so no sigil is held.
    assert.deepEqual(replayed.sigils, [], `${path}: an upgraded log granted a sigil`);
    assert.deepEqual(sigilProblems(replayed), []);
  }
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

test('the shipped sigils are sound: unique ids, engine traits, names the glossary agrees with', () => {
  const ids = SIGILS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate sigil id');
  for (const id of ids) assert.ok(!id.includes('#'), `${id} contains the instance separator`);
  for (const s of CARD_SIGILS) {
    assert.ok(s.trait in TRAIT_TERMS, `${s.id} grants "${s.trait}", which the engine has no trait for`);
    assert.equal(
      s.name,
      CARD_SIGIL_TERMS[s.trait].name,
      `${s.id} is called "${s.name}" on the shelf and "${CARD_SIGIL_TERMS[s.trait].name}" in the panel`,
    );
  }
  for (const s of HERO_SIGILS) {
    const words = heroEffectWords(s.effect);
    assert.ok(words.includes(String(s.effect.amount)), `${s.id}: "${words}" never says its number`);
  }
  assert.ok(HERO_SIGILS.length >= 2, 'at least two hero sigils are the assignment');
  assert.ok(CARD_SIGILS.length >= 2, 'at least two card sigils are the assignment');
});

test('every trait the engine has can be named as a sigil, and the naming is derived and not typed twice', () => {
  // The compile-time half of this is `CARD_SIGIL_TERMS: Record<Trait, Term>`,
  // which is why adding `volley` and `scorch` to the engine's union stopped
  // this file's own imports compiling until they had words. The runtime half
  // is here: every trait has a term, every term names its trait's own rule
  // source, and no sigil word is a second copy of a rule.
  for (const trait of Object.keys(TRAIT_TERMS) as Trait[]) {
    const term = CARD_SIGIL_TERMS[trait];
    assert.ok(term.name.length > 0, `${trait} has no sigil name`);
    assert.ok(term.line.includes('rest of the run'), `${trait}'s sigil line does not say a sigil is permanent`);
    // The sigil's own sentence must not restate the trait's rule: the panel
    // prints `TRAIT_TERMS[trait].line` beside it, and two wordings of one rule
    // is how they drift.
    assert.ok(!term.line.includes(TRAIT_TERMS[trait].line), `${trait}'s sigil line restates the trait rule`);
  }
});

test('a sigilled card says so on the board and in the panel', () => {
  const deck = [makeDeckCard('t_grunt', 0)];
  attachSigil(POOL, deck, 0, { id: 'fx_relay', trait: 'relay' });
  const card = runPool(POOL, deck).card('t_grunt#0');
  const view = cardEntityView(card, 'player', grantedTraits(POOL, deck[0]!));
  assert.deepEqual(view.sigilTraits, ['relay']);

  const pips = traitPips(view.traits, view.sigilTraits);
  assert.equal(pips.length, 1);
  assert.equal(pips[0]!.sigil, true);
  assert.ok(pips[0]!.title.includes(CARD_SIGIL_TERMS.relay.name), `the pip does not name the sigil: ${pips[0]!.title}`);
  assert.ok(pips[0]!.title.includes(TRAIT_TERMS.relay.line), 'the pip lost the trait rule');
  // A printed Relay is not a sigil pip.
  const printed = traitPips(['relay'], []);
  assert.equal(printed[0]!.sigil, false);
  assert.ok(!printed[0]!.title.includes('Sigil'));

  const ctx = { chance: 0.5, pendingPower: 0, hatch: false, pct } as const;
  const html = explainCard(view, cardViewOf(view), ctx);
  assert.ok(html.includes(CARD_SIGIL_TERMS.relay.name), 'the panel does not name the sigil');
  assert.ok(html.includes(TRAIT_TERMS.relay.line), 'the panel does not give the trait rule');

  // The same card without the sigil says the rule and never the sigil.
  const plain = cardEntityView(POOL.card('t_grunt'));
  const plainHtml = explainCard({ ...plain, traits: ['relay'] }, cardViewOf(plain), ctx);
  assert.ok(plainHtml.includes(TRAIT_TERMS.relay.line));
  assert.ok(!plainHtml.includes(CARD_SIGIL_TERMS.relay.name), 'a printed Relay is explained as a sigil');
});

test('the hero panel lists the run’s hero sigils, in the words the offer used', () => {
  const content = fixtureContent();
  const run = startRun(content, 8);
  const ctx = { chance: null, pendingPower: 0, hatch: false, pct } as const;
  const hero = {
    ...cardEntityView(POOL.card('t_grunt')),
    isHero: true,
    tribe: 'hero',
    name: 'K',
    cardId: 'hero:K',
    traits: [] as const,
  };

  assert.equal(heldHeroSigils(run).length, 0);
  const bare = explainCard(hero, cardViewOf(hero), { ...ctx, heroSigils: heldHeroSigils(run).map(heroSigilTerm) });
  assert.ok(!bare.includes(LANCE.name), 'a hero with no sigil listed one');

  grantHeroSigil(run, LANCE);
  grantHeroSigil(run, OAK);
  const terms = heldHeroSigils(run).map(heroSigilTerm);
  assert.deepEqual(terms.map((t) => t.name), [LANCE.name, OAK.name]);
  const armed = explainCard(hero, cardViewOf(hero), { ...ctx, heroSigils: terms });
  for (const t of terms) {
    assert.ok(armed.includes(t.name), `the hero panel does not name ${t.name}`);
    assert.ok(armed.includes(t.line.slice(0, 24)), `the hero panel does not say what ${t.name} does`);
  }
  // The words are the offer's: one function makes both.
  assert.equal(terms[0]!.line, heroEffectWords(LANCE.effect));
});
