// Sigils exist, a run grants them, and every grant is exactly what it claims.
//
// `docs/design/game.md` calls sigils "the run's progression system" and unit 5
// left an inert seam for them: a ledger that stayed empty, a hash that covered
// it, and a gate that failed if anything ever filled it. This file retires
// that gate and replaces it with the live one: the ledger fills, and every
// entry in it is consistent with the deck and the content.
//
// Bound of this file - what a green run does and does not prove:
//
//   Card sigils: a trait attached to one deck instance reaches the fight
//   through `runPool` as an ordinary word in `traits`, the other copies are
//   untouched, and a sigil for a trait the card already has is refused. The
//   resolver is not asked anything here - it cannot tell a sigil-granted Relay
//   from a printed one, and `test/resolver-order.test.ts` gates Relay.
//   Hero sigils: each of the four effects reaches a fight through the seam it
//   uses - `SideRules` on the hero, the pool's hand size, the run's Health bar
//   - at fixture numbers, and a side with no sigil fights at the engine's
//   defaults. Enemy Relays keep the default under a player Chain.
//   The run: over the fixture and the first shipped seeds, both kinds are
//   granted, every run replays from its log to the same hash, `sigilProblems`
//   is empty, and the population is asserted so a window that granted none
//   fails rather than passes.
//   Words: the shelf's names and the panel's names come from one table keyed
//   by the engine's `Trait` union, and a Relay under a Chain is explained at
//   +3 and not +2. Strings, never pixels.
//   Windows, not spaces: 30 fixture seeds x 2 route styles, 12 shipped seeds.
//
// Made to go red: see `docs/learning/gate-proofs.md` for the mutations.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runFight } from '../src/engine/fight.ts';
import { stateToCanonical } from '../src/engine/hash.ts';
import { RELAY_POWER, WAKE_POWER, drain, sideRulesOf } from '../src/engine/resolver.ts';
import { makeRng } from '../src/engine/rng.ts';
import {
  type CardPool,
  type GameState,
  type UnitCard,
  insertUnit,
  makeHero,
  makeUnit,
  unitCount,
} from '../src/engine/state.ts';
import { CARD_SIGILS, HERO_SIGILS, SIGILS } from '../src/content/sigils.ts';
import { RUN_CONTENT } from '../src/run/content.ts';
import { attachSigil, makeDeckCard, resolveDeckCard, runPool } from '../src/run/deck.ts';
import { hashRun, runToCanonical } from '../src/run/hash.ts';
import {
  attachCardSigil,
  attachOffers,
  fightSeedFor,
  grantHeroSigil,
  heroSigilOffer,
  rewardOffer,
} from '../src/run/nodes.ts';
import {
  type RunAgent,
  cloneRunState,
  fightSetupFor,
  replayRun,
  runChoices,
  runRun,
  startRun,
} from '../src/run/run.ts';
import { sigilProblems } from '../src/run/sigils.ts';
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
import {
  CARD_SIGIL_TERMS,
  heroEffectWords,
  ruleOverrideLines,
  traitTerm,
} from '../src/render/sigil-terms.ts';
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
const CHAIN: HeroSigilDef = { kind: 'hero', id: 'fx_chain', name: 'Chain', effect: { kind: 'relayPower', amount: 1 }, weight: 1 };
const OAK: HeroSigilDef = { kind: 'hero', id: 'fx_oak', name: 'Oak', effect: { kind: 'maxHealth', amount: 10 }, weight: 1 };
const HAND: HeroSigilDef = { kind: 'hero', id: 'fx_hand', name: 'Hand', effect: { kind: 'handSize', amount: 1 }, weight: 1 };
const VIGIL: HeroSigilDef = { kind: 'hero', id: 'fx_vigil', name: 'Vigil', effect: { kind: 'wakePower', amount: 1 }, weight: 1 };
const FIXTURE_SIGILS: readonly SigilDef[] = [RELAY, WAKE, GUARD, CHAIN, OAK, HAND, VIGIL];

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
  assert.ok(!('sigilTraits' in plain), 'a card with no sigil must resolve to the object it always did');

  attachSigil(POOL, deck, 0, { id: 'fx_relay', trait: 'relay' });
  const pool = runPool(POOL, deck);
  const relay = pool.card('t_grunt#0');
  assert.deepEqual(relay.traits, ['relay'], 'the sigil trait did not reach the fight');
  assert.deepEqual(relay.sigilTraits, ['relay'], 'the fight was not told the trait came from a sigil');
  // The other copy is untouched: a sigil attaches to a card, not a card id.
  assert.deepEqual(pool.card('t_grunt#1').traits, []);
  assert.ok(!('sigilTraits' in pool.card('t_grunt#1')));

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
  // one with it sigilled, must produce the same events.
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

test('a hero Chain makes Relay hand +3 on that side only, and the hash sees it', () => {
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  state.board.player.push(
    makeHero(state, 'player', { name: 'K', health: 30, power: 0, armour: 0, rules: { relayPower: RELAY_POWER + 1 } }),
  );
  state.board.enemy.push(makeHero(state, 'enemy', { name: 'E', health: 30, power: 0, armour: 0 }));
  assert.deepEqual(sideRulesOf(state, 'player'), { relayPower: RELAY_POWER + 1, wakePower: WAKE_POWER });
  assert.deepEqual(sideRulesOf(state, 'enemy'), { relayPower: RELAY_POWER, wakePower: WAKE_POWER });

  const relayCard: UnitCard = { ...POOL.card('t_grunt'), id: 'relay', traits: ['relay'] };
  const ours = makeUnit(state, 'player', relayCard);
  insertUnit(state, 'player', ours, 0);
  const theirs = makeUnit(state, 'enemy', relayCard);
  insertUnit(state, 'enemy', theirs, 0);

  const mine = drain(state, [{ kind: 'afterAct', uid: ours.uid }], makeRng(1, 'combat')).events;
  const gained = mine.find((e) => e.kind === 'powerGained');
  assert.ok(gained !== undefined && gained.kind === 'powerGained');
  assert.equal(gained.amount, RELAY_POWER + 1, 'the player Relay did not hand the bent amount');

  const enemy = drain(state, [{ kind: 'afterAct', uid: theirs.uid }], makeRng(2, 'combat')).events;
  const enemyGain = enemy.find((e) => e.kind === 'powerGained');
  assert.ok(enemyGain !== undefined && enemyGain.kind === 'powerGained');
  assert.equal(enemyGain.amount, RELAY_POWER, 'the enemy Relay was bent by the player hero sigil');

  // The digest names the bent rule on the hero and nothing on anyone else, and
  // a hero with no rules canonicalises exactly as before.
  const canon = stateToCanonical(state);
  assert.match(canon, /hero:K:player:1[^|]*:rules\(relay=3\)/);
  assert.doesNotMatch(canon, /hero:E:enemy:1[^|]*rules/);
  assert.doesNotMatch(canon, /relay:player:0[^|]*rules/);
});

test('each hero sigil reaches a fight through its seam, and none is there without it', () => {
  const content = fixtureContent();
  const run = startRun(content, 3);
  const node = firstNode(run);
  const bare = fightSetupFor(run, node);
  assert.ok(!('rules' in bare.playerHero), 'a run with no hero sigil handed the fight a rules key');
  assert.equal(bare.pool.handSize, POOL.handSize);
  assert.equal(run.hero.maxHealth, 40);

  grantHeroSigil(run, CHAIN);
  grantHeroSigil(run, VIGIL);
  const bent = fightSetupFor(run, node);
  assert.deepEqual(bent.playerHero.rules, { relayPower: RELAY_POWER + 1, wakePower: WAKE_POWER + 1 });
  assert.equal(bent.enemyHero.rules, undefined, 'the enemy hero was handed the player rules');

  run.hero.health = 25;
  grantHeroSigil(run, OAK);
  assert.equal(run.hero.maxHealth, 50, 'Oak did not raise the bar');
  assert.equal(run.hero.health, 35, 'Oak did not heal by its amount');

  grantHeroSigil(run, HAND);
  assert.equal(fightSetupFor(run, node).pool.handSize, POOL.handSize + 1);
  assert.throws(() => grantHeroSigil(run, HAND), /already holds "fx_hand"/);
  assert.deepEqual(sigilProblems(run), []);

  // The same sigil is never re-offered; with all four held there is nothing to offer.
  assert.deepEqual(heroSigilOffer(run), []);
});

test('a Wide Hand draws one more card in a real fight', () => {
  const run = startRun(RUN_CONTENT, 5);
  const node = firstNode(run);
  const before = runFight(fightSetupFor(run, node), makeRunAgent({ route: 'greedy', placement: 'right', seed: 5 }).placement);
  assert.equal(before.log[0]!.handBefore.length, RUN_CONTENT.pool.handSize);
  const hand = HERO_SIGILS.find((s) => s.effect.kind === 'handSize');
  assert.ok(hand !== undefined, 'the shipped content has no hand-size sigil');
  grantHeroSigil(run, hand);
  const after = runFight(fightSetupFor(run, node), makeRunAgent({ route: 'greedy', placement: 'right', seed: 5 }).placement);
  assert.equal(after.log[0]!.handBefore.length, RUN_CONTENT.pool.handSize + hand.effect.amount);
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
  // Measured at 18 attaches and 3 declines when this floor was set: the fixture
  // has few ordinary fights and the greedy bot prefers a Wall to a sigil.
  assert.ok(hero >= 40, `only ${hero} hero sigils granted across 60 runs; the offer path was barely walked`);
  assert.ok(card >= 15, `only ${card} card sigils attached across 60 runs; the attach path was barely walked`);
  assert.ok(declinedSigil >= 3, `only ${declinedSigil} hero sigil offers declined; the decline path was barely walked`);
});

test('the shipped run grants sigils and replays them', () => {
  let granted = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { run, log } = runRun(RUN_CONTENT, seed, agentFor('greedy', seed));
    assert.deepEqual(sigilProblems(run), [], `shipped seed ${seed}: the ledger and the deck disagree`);
    assert.equal(hashRun(replayRun(RUN_CONTENT, log)), hashRun(run), `shipped seed ${seed}: did not replay`);
    granted += run.sigils.length;
    for (const g of run.sigils) assert.ok(SIGILS.some((s) => s.id === g.sigilId), `unknown sigil ${g.sigilId}`);
  }
  assert.ok(granted >= 12, `only ${granted} sigils across 12 shipped runs`);
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
  grantHeroSigil(withHero, CHAIN);

  assert.notEqual(hashRun(onFirst), h0, 'attaching a sigil did not move the run hash');
  assert.notEqual(hashRun(onFirst), hashRun(onSecond), 'the hash does not see which card the sigil is on');
  assert.notEqual(hashRun(withHero), h0, 'a hero sigil did not move the run hash');
  assert.equal(hashRun(cloneRunState(base)), h0, 'cloning alone moved the hash');

  // The canonical form: a plain instance is exactly the string it always was.
  const deckOf = (s: string): string => /deck=\[([^\]]*)\]/.exec(s)![1]!;
  assert.doesNotMatch(deckOf(runToCanonical(base)), /~/);
  assert.match(deckOf(runToCanonical(onFirst)), /t_grunt#0\+0\/0\/0~fx_relay=relay,t_grunt#1\+0\/0\/0,/);
  assert.match(runToCanonical(withHero), /sigils=\[hero:fx_chain\]/);
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
});

test('the measurement instrument reports the sigil path as run only when it ran', () => {
  const seeds = [1, 2, 3, 4, 5];
  const live = checkRuns(seeds, 1, 'greedy', 'right', fixtureContent());
  assert.ok(live.sigilsGranted > 0, 'the fixture granted nothing, so the instrument cannot be checked');
  assert.deepEqual(live.sigilProblems, []);
  const inert = checkRuns(seeds, 1, 'greedy', 'right', fixtureContent({ sigils: [] }));
  assert.equal(inert.sigilsGranted, 0);
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

test('sigil offers draw from the run stream and nothing else', () => {
  const content = fixtureContent({ cardSigilChance: 1 });
  const run = startRun(content, 9);
  const fight = firstNode(run);
  const seedBefore = fightSeedFor(run, fight);

  const a = cloneRunState(run);
  heroSigilOffer(a);
  assert.equal(a.rng.n - run.rng.n, content.heroSigilOffers, 'a hero sigil offer is one draw per sigil offered');

  const b = cloneRunState(run);
  rewardOffer(b, nodeOfType(run, 'elite'));
  assert.equal(b.rng.n - run.rng.n, content.rewardOffers, 'an elite shelf drew more than its cards');

  const c = cloneRunState(run);
  rewardOffer(c, fight);
  assert.equal(c.rng.n - run.rng.n, content.rewardOffers + 2, 'a fight shelf at chance 1 is the cards, one roll, one sigil draw');

  const d = cloneRunState(startRun(fixtureContent({ cardSigilChance: 0 }), 9));
  const n0 = d.rng.n;
  rewardOffer(d, fight);
  assert.equal(d.rng.n - n0, content.rewardOffers, 'a fight shelf at chance 0 still rolled');

  // No fight seed moved for any of it.
  for (const r of [a, b, c]) assert.equal(fightSeedFor(r, fight), seedBefore);
});

// ---------------------------------------------------------------------------
// The log format
// ---------------------------------------------------------------------------

test('a log from before sigils is refused by name, not replayed into a different run', () => {
  const content = fixtureContent();
  const live = runRun(content, 5, agentFor('greedy', 5));
  assert.equal(live.log.format, RUN_LOG_FORMAT);

  const old = { seed: 5, nodes: live.log.nodes } as unknown as RunLog;
  assert.throws(() => replayRun(content, old), /written in format 1 and this code replays format 2/);
  assert.throws(() => createRunController(content, 5, old), /written in format 1/);

  const future: RunLog = { ...live.log, format: 99 };
  assert.throws(() => replayRun(content, future), /written in format 99/);

  // The current format replays, and an empty log of the current format is a fresh run.
  assert.equal(hashRun(replayRun(content, live.log)), hashRun(live.run));
  assert.equal(hashRun(replayRun(content, { seed: 5, format: RUN_LOG_FORMAT, nodes: [] })), hashRun(startRun(content, 5)));
  assert.ok(runChoices(live.log).some((c) => c.kind === 'sigil' || c.kind === 'attach'), 'the fixture run recorded no sigil choice at all');
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
    assert.ok(words.includes(String(s.effect.amount)) || words.includes(String(RELAY_POWER + s.effect.amount)), `${s.id}: "${words}" never says its number`);
  }
  assert.ok(HERO_SIGILS.length >= 2, 'at least two hero sigils are the assignment');
});

test('a trait is explained at the amount in force, and says a hero sigil moved it', () => {
  assert.deepEqual(traitTerm('relay', null), TRAIT_TERMS.relay);
  assert.deepEqual(traitTerm('relay', {}), TRAIT_TERMS.relay);
  assert.deepEqual(traitTerm('guard', { relayPower: 9 }), TRAIT_TERMS.guard);

  const bent = traitTerm('relay', { relayPower: RELAY_POWER + 1 });
  assert.ok(bent.line.includes(`+${RELAY_POWER + 1} Power`), `"${bent.line}" does not name the amount in force`);
  assert.ok(!bent.line.includes(`+${RELAY_POWER} Power`), `"${bent.line}" still names the default`);
  assert.match(bent.line, /hero sigil/);
  const woke = traitTerm('wake', { wakePower: WAKE_POWER + 2 });
  assert.ok(woke.line.includes(`+${WAKE_POWER + 2} Power`));

  assert.deepEqual(ruleOverrideLines(null), []);
  assert.equal(ruleOverrideLines({ relayPower: 3, wakePower: 4 }).length, 2);
  assert.match(heroEffectWords({ kind: 'relayPower', amount: 1 }), new RegExp(`\\+${RELAY_POWER + 1} Power instead of \\+${RELAY_POWER}`));
});

test('a sigilled card says so on the board and in the panel', () => {
  const deck = [makeDeckCard('t_grunt', 0)];
  attachSigil(POOL, deck, 0, { id: 'fx_relay', trait: 'relay' });
  const card = runPool(POOL, deck).card('t_grunt#0');
  const view = cardEntityView(card);
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

  // Under a Chain the same panel says +3, and the hero panel names the bent rule.
  const rules = { relayPower: RELAY_POWER + 1 };
  const bentHtml = explainCard(view, cardViewOf(view), { ...ctx, rules });
  assert.ok(bentHtml.includes(`+${RELAY_POWER + 1} Power`), 'the panel explains a bent Relay at the default');
  const hero = { ...cardEntityView(POOL.card('t_grunt')), isHero: true, tribe: 'hero', name: 'K', cardId: 'hero:K', traits: [] as const, sigilTraits: [] as const };
  const heroHtml = explainCard(hero, cardViewOf(hero), { ...ctx, rules });
  assert.ok(heroHtml.includes(ruleOverrideLines(rules)[0]!), 'the hero panel does not name the bent rule');
  assert.ok(!explainCard(hero, cardViewOf(hero), ctx).includes('not +'), 'a hero with no sigil recites a bent rule');
});
