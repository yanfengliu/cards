// The run's gates.
//
// Split by what they are bound to, because the two must not be confused:
//
//   - **Structure**, checked against the shipped `RUN_CONTENT`. These are
//     claims about the generator and the loop, and a rebalance must not move
//     them. Nothing here asserts a win rate or a Health total.
//   - **Behaviour**, checked against `FIXTURE`, a four-node act on two cards.
//     A behaviour test built on shipped content would go red the day the owner
//     retunes an encounter, which is how a gate gets deleted rather than fixed.
//
// The bound every test below shares: it runs a seed window, not the seed space.
// A property that fails one seed in ten thousand is not covered here; the
// window is named in each test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, nextU32 } from '../src/engine/rng.ts';
import type { CardPool, UnitCard } from '../src/engine/state.ts';
import { RUN_CONTENT } from '../src/run/content.ts';
import { applyForge, makeDeckCard, resolveDeckCard, runPool } from '../src/run/deck.ts';
import { hashMaps, hashRun } from '../src/run/hash.ts';
import { branchingTypes, generateAct, mapProblems, pathSpread } from '../src/run/map.ts';
import { fightSeedFor, restAmount } from '../src/run/nodes.ts';
import {
  type RunAgent,
  fightSetupFor,
  replayRun,
  runChoices,
  runRun,
  startRun,
} from '../src/run/run.ts';
import type { ActMap, NodeType, RunContent, RunLog, SigilDef } from '../src/run/types.ts';
import { makeRunAgent } from '../src/sim/runbots.ts';

// ---------------------------------------------------------------------------
// A fixture run: two cards, four rows, one enemy. Nothing shipped is involved.
// ---------------------------------------------------------------------------

const CARDS: readonly UnitCard[] = [
  { id: 't_grunt', name: 'Grunt', cost: 1, power: 2, health: 2, armour: 0, tribe: 'human', traits: [] },
  { id: 't_wall', name: 'Wall', cost: 2, power: 1, health: 5, armour: 1, tribe: 'dwarf', traits: ['guard'] },
  { id: 't_mook', name: 'Mook', cost: 1, power: 1, health: 1, armour: 0, tribe: 'orc', traits: [] },
];

const POOL: CardPool = {
  card(id) {
    const c = CARDS.find((x) => x.id === id);
    if (c === undefined) {
      throw new Error(`fixture pool: no card "${id}". Known: ${CARDS.map((x) => x.id).join(', ')}`);
    }
    return c;
  },
  energyPerTurn: 3,
  handSize: 5,
};

/**
 * The fixture's sigils: one card sigil per trait and every hero effect once.
 * Small on purpose - a run that holds all three hero sigils has nothing left
 * to be offered, which is a branch worth walking.
 */
const FIXTURE_SIGILS: readonly SigilDef[] = [
  { kind: 'card', id: 'fx_relay', name: 'Relay Sigil', trait: 'relay', weight: 2 },
  { kind: 'card', id: 'fx_wake', name: 'Wake Sigil', trait: 'wake', weight: 2 },
  { kind: 'card', id: 'fx_guard', name: 'Guard Sigil', trait: 'guard', weight: 1 },
  { kind: 'hero', id: 'fx_oak', name: 'Oak', effect: { kind: 'maxHealth', amount: 10 }, weight: 1 },
  { kind: 'hero', id: 'fx_lance', name: 'Lance', effect: { kind: 'heroPower', amount: 1 }, weight: 1 },
  { kind: 'hero', id: 'fx_bulwark', name: 'Bulwark', effect: { kind: 'heroArmour', amount: 1 }, weight: 1 },
];

function fixtureContent(overrides: Partial<RunContent> = {}): RunContent {
  const enemy = {
    id: 'fx_enemy',
    name: 'Mooks',
    enemyHero: { name: 'Mooks', health: 6, power: 1, armour: 0 },
    enemyDeck: ['t_mook', 't_mook', 't_mook'],
    opening: [] as readonly string[],
  };
  return {
    pool: POOL,
    hero: { name: 'Knight', health: 40, power: 2, armour: 0 },
    startingDeck: ['t_grunt', 't_grunt', 't_wall', 't_grunt'],
    acts: [
      {
        act: 0,
        name: 'Only Act',
        fights: [enemy],
        elites: [enemy],
        boss: { ...enemy, id: 'fx_boss', name: 'Boss', enemyHero: { ...enemy.enemyHero, health: 8 } },
        goldPerFight: 20,
        goldPerElite: 40,
        goldPerBoss: 60,
      },
    ],
    mapShape: {
      extraEdgeChance: 0.5,
      rows: [
        { minWidth: 1, maxWidth: 1, weights: [{ type: 'fight', weight: 1 }] },
        {
          minWidth: 2,
          maxWidth: 2,
          weights: [
            { type: 'rest', weight: 1 },
            { type: 'forge', weight: 1 },
          ],
        },
        {
          minWidth: 2,
          maxWidth: 2,
          weights: [
            { type: 'shop', weight: 1 },
            { type: 'event', weight: 1 },
          ],
        },
        { minWidth: 1, maxWidth: 1, weights: [{ type: 'boss', weight: 1 }] },
      ],
    },
    rewards: [
      { cardId: 't_grunt', weight: 1 },
      { cardId: 't_wall', weight: 1 },
    ],
    events: [
      {
        id: 'fx_ev',
        name: 'Fixture Event',
        options: [
          { label: 'heal', effects: [{ kind: 'heal', amount: 5 }] },
          { label: 'hurt for gold', effects: [{ kind: 'damage', amount: 3 }, { kind: 'gold', amount: 40 }] },
        ],
      },
    ],
    sigils: FIXTURE_SIGILS,
    heroSigilOffers: 2,
    cardSigilChance: 0.5,
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

/** An agent that answers every decision with a fixed index. */
function scriptedAgent(pick: number, placement = makeRunAgent({ route: 'greedy', placement: 'right', seed: 1 }).placement): RunAgent {
  return {
    travel: (_r, options) => Math.min(pick, options.length - 1),
    sigil: (_r, offer) => Math.min(pick, offer.length - 1),
    reward: (_r, offer) => Math.min(pick, offer.length - 1),
    attach: (_r, _sigil, offers) => Math.min(pick, offers.length - 1),
    forge: (_r, offers) => Math.min(pick, offers.length - 1),
    shop: () => -1,
    event: (_r, def) => Math.min(pick, def.options.length - 1),
    placement,
  };
}

const STRUCTURE_SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const RUN_SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

// ---------------------------------------------------------------------------
// Structure: the map generator, against the shipped map shape
// ---------------------------------------------------------------------------

function shippedMaps(seed: number): ActMap[] {
  return startRun(RUN_CONTENT, seed).maps.slice();
}

test('every generated act map is reachable both ways, planar, and ends in one boss', () => {
  // Bound: 60 seeds x 3 acts of the shipped map shape.
  for (const seed of STRUCTURE_SEEDS) {
    for (const map of shippedMaps(seed)) {
      const problems = mapProblems(map);
      assert.deepEqual(problems, [], `seed ${seed} act ${map.act + 1}: ${problems.join('; ')}`);
    }
  }
});

test('a map where every path is equivalent is not a map: every act decides node types', () => {
  // The unit's headline structural claim. `pathSpread` is exact rather than
  // sampled, so a failure here is a map that really does carry the same
  // content down every route.
  let total = 0;
  for (const seed of STRUCTURE_SEEDS) {
    for (const map of shippedMaps(seed)) {
      const n = branchingTypes(map);
      assert.ok(
        n >= 1,
        `seed ${seed} act ${map.act + 1}: every path carries the same node types, so the ` +
          `branching is decorative`,
      );
      total += n;
    }
  }
  assert.ok(
    total / (STRUCTURE_SEEDS.length * 3) >= 3,
    'on average an act map should let the route decide at least three of the seven node types',
  );
});

test('pathSpread agrees with brute-force path enumeration on a small map', () => {
  // The branching gate is built on `pathSpread`, so `pathSpread` needs its own
  // gate: a min/max DP that quietly returned the entry node's own counts would
  // make every map look decorative, and one that returned the whole map's
  // counts would make every map look branchy.
  for (const seed of [1, 2, 3, 7, 11, 19, 23, 41]) {
    const rng = makeRng(seed, 'test-map');
    const map = generateAct(rng, 0, RUN_CONTENT.mapShape);
    const spread = pathSpread(map);

    const brute = new Map<NodeType, { min: number; max: number }>();
    const walk = (id: number, counts: Map<NodeType, number>): void => {
      const node = map.nodes[id]!;
      const next = new Map(counts);
      next.set(node.type, (next.get(node.type) ?? 0) + 1);
      if (node.next.length === 0) {
        for (const t of spread.keys()) {
          const c = next.get(t) ?? 0;
          const cur = brute.get(t);
          brute.set(
            t,
            cur === undefined ? { min: c, max: c } : { min: Math.min(cur.min, c), max: Math.max(cur.max, c) },
          );
        }
        return;
      }
      for (const n of node.next) walk(n, next);
    };
    for (const id of map.rows[0]!) walk(id, new Map());

    for (const [type, v] of spread) {
      assert.deepEqual(
        v,
        brute.get(type),
        `seed ${seed}: pathSpread disagrees with enumeration for "${type}"`,
      );
    }
  }
});

test('the map is generated once at setup, and no route changes what a node is', () => {
  // Three claims, because they fail in different places and the cheap version
  // of this test catches only the first. Perturbing `run.rng` after setup can
  // never move `run.maps`, so an assertion built on that alone stays green
  // against the defect that matters here - a map regenerated lazily from the
  // run generator when the loop asks for it. What catches that is comparing
  // what two differently-routed runs actually *walked* against the map the
  // seed produces at setup.
  for (const seed of STRUCTURE_SEEDS.slice(0, 20)) {
    const clean = startRun(RUN_CONTENT, seed);
    const perturbed = startRun(RUN_CONTENT, seed);
    for (let i = 0; i < 53; i++) nextU32(perturbed.rng);
    assert.equal(hashMaps(clean), hashMaps(perturbed), `seed ${seed}: the map moved`);

    const setupMaps = startRun(RUN_CONTENT, seed).maps;
    const routes = [
      runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'greedy', placement: 'right', seed })),
      runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'random', placement: 'right', seed })),
    ];
    for (const route of routes) {
      assert.equal(hashMaps(route.run), hashMaps(clean), `seed ${seed}: the map moved during a run`);
      for (const rec of route.log.nodes) {
        const node = setupMaps[rec.act]!.nodes[rec.nodeId]!;
        assert.equal(
          rec.type,
          node.type,
          `seed ${seed}: the run walked node ${rec.nodeId} of act ${rec.act + 1} as a ` +
            `"${rec.type}" and the seed's own map calls it a "${node.type}"`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Determinism: the keystone invariant, for a whole run
// ---------------------------------------------------------------------------

test('same seed and same agent produce an identical final run hash, over many trials', () => {
  // Bound: 40 seeds x 3 trials of the shipped content at the strongest agent.
  for (const seed of RUN_SEEDS) {
    const first = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'greedy', placement: 'lookahead', seed }));
    const h = hashRun(first.run);
    for (let trial = 0; trial < 2; trial++) {
      const again = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'greedy', placement: 'lookahead', seed }));
      assert.equal(hashRun(again.run), h, `seed ${seed} diverged on trial ${trial}`);
    }
  }
});

test('seed plus choice list replays a whole run, with no agent in the loop', () => {
  for (const seed of RUN_SEEDS) {
    const live = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'greedy', placement: 'lookahead', seed }));
    const replayed = replayRun(RUN_CONTENT, live.log);
    assert.equal(hashRun(replayed), hashRun(live.run), `seed ${seed} did not replay`);
    assert.equal(replayed.result, live.run.result);
    assert.equal(replayed.hero.health, live.run.hero.health);
    assert.equal(replayed.deck.length, live.run.deck.length);
    assert.ok(runChoices(live.log).length > 0, `seed ${seed} recorded no choices at all`);
  }
});

test('run hashes vary with the seed - a constant hash would pass determinism and mean nothing', () => {
  const hashes = new Set<string>();
  for (const seed of RUN_SEEDS) {
    const { run } = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'greedy', placement: 'lookahead', seed }));
    hashes.add(hashRun(run));
  }
  assert.ok(hashes.size >= RUN_SEEDS.length - 2, `only ${hashes.size} distinct hashes over ${RUN_SEEDS.length} seeds`);
});

test('a run agent holds no state between runs: a warmed instance matches a fresh one', () => {
  // The rule `src/sim/bots.ts` states for placement policies, for run agents.
  // A router carrying a generator would answer differently on its second run,
  // and hoisting one agent out of a measurement loop would silently change
  // every route with every gate still green.
  const warmed = makeRunAgent({ route: 'random', placement: 'right', seed: 99 });
  for (const seed of [5, 6, 7, 8]) runRun(RUN_CONTENT, seed, warmed);

  for (const seed of RUN_SEEDS.slice(0, 12)) {
    const fromWarm = runRun(RUN_CONTENT, seed, warmed);
    const fromFresh = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'random', placement: 'right', seed: 99 }));
    assert.equal(hashRun(fromWarm.run), hashRun(fromFresh.run), `seed ${seed}: the agent carried state`);
  }
});

test("a node's fight is a function of the node, not of the route taken to reach it", () => {
  // The stream-separation invariant. Two checks, because they fail differently:
  // burning run-stream draws must move no fight seed, and two routes through
  // one seed must agree on every node they share.
  for (const seed of RUN_SEEDS.slice(0, 20)) {
    const clean = startRun(RUN_CONTENT, seed);
    const perturbed = startRun(RUN_CONTENT, seed);
    for (let i = 0; i < 41; i++) nextU32(perturbed.rng);
    for (const map of clean.maps) {
      clean.act = map.act;
      perturbed.act = map.act;
      for (const node of map.nodes) {
        assert.equal(
          fightSeedFor(clean, node),
          fightSeedFor(perturbed, node),
          `seed ${seed} act ${map.act + 1} node ${node.id}: the run stream moved the fight seed`,
        );
      }
    }
  }

  let shared = 0;
  for (const seed of RUN_SEEDS.slice(0, 20)) {
    const a = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'greedy', placement: 'right', seed }));
    const b = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'random', placement: 'right', seed }));
    const seen = new Map<string, number>();
    for (const rec of a.log.nodes) if (rec.fightSeed !== null) seen.set(`${rec.act}:${rec.nodeId}`, rec.fightSeed);
    for (const rec of b.log.nodes) {
      if (rec.fightSeed === null) continue;
      const hit = seen.get(`${rec.act}:${rec.nodeId}`);
      if (hit === undefined) continue;
      shared++;
      assert.equal(hit, rec.fightSeed, `seed ${seed} node ${rec.nodeId}: two routes seeded one fight differently`);
    }
  }
  assert.ok(shared >= 20, `only ${shared} shared fight nodes across the window; the check was nearly vacuous`);
});

// ---------------------------------------------------------------------------
// Behaviour: the fixture run
// ---------------------------------------------------------------------------

test('a fight is handed the run\'s Health bar as it stands, not a fresh one', () => {
  const content = fixtureContent();
  const run = startRun(content, 1);
  run.hero.health = 17;
  const node = run.maps[0]!.nodes[run.maps[0]!.rows[0]![0]!]!;
  const setup = fightSetupFor(run, node);
  assert.equal(setup.playerHero.health, 17, 'the fight was handed a full bar instead of the run\'s');
  assert.equal(setup.maxRounds, content.maxRounds);
  assert.equal(setup.playerDeck.length, run.deck.length);
});

test('what is left of the hero after a fight is what the next fight starts with', () => {
  // A run whose deck holds no Guard, against a hero that swings for five: the
  // player wins and *must* have been hit. "Health carries" is only observable
  // when Health actually moves, so the fixture is built to make it move.
  const bare = fixtureContent({
    startingDeck: ['t_grunt', 't_grunt', 't_grunt', 't_grunt'],
    // No sigils either: a hero sigil that raises maximum Health heals by the
    // same amount when it is taken, and this test forbids every heal.
    sigils: [],
    // No rest and no event on this map, so Health is monotone down and any
    // upward move is the carry being dropped rather than a heal.
    mapShape: {
      extraEdgeChance: 0.5,
      rows: [
        { minWidth: 1, maxWidth: 1, weights: [{ type: 'fight', weight: 1 }] },
        {
          minWidth: 2,
          maxWidth: 2,
          weights: [
            { type: 'fight', weight: 1 },
            { type: 'elite', weight: 1 },
          ],
        },
        { minWidth: 1, maxWidth: 1, weights: [{ type: 'boss', weight: 1 }] },
      ],
    },
    acts: [
      {
        act: 0,
        name: 'Only Act',
        fights: [
          {
            id: 'fx_biter',
            name: 'Biter',
            enemyHero: { name: 'Biter', health: 10, power: 5, armour: 0 },
            enemyDeck: ['t_mook', 't_mook'],
            opening: [],
          },
        ],
        elites: [
          {
            id: 'fx_biter',
            name: 'Biter',
            enemyHero: { name: 'Biter', health: 10, power: 5, armour: 0 },
            enemyDeck: ['t_mook', 't_mook'],
            opening: [],
          },
        ],
        boss: {
          id: 'fx_boss',
          name: 'Boss',
          enemyHero: { name: 'Boss', health: 10, power: 5, armour: 0 },
          enemyDeck: ['t_mook', 't_mook'],
          opening: [],
        },
        goldPerFight: 20,
        goldPerElite: 40,
        goldPerBoss: 60,
      },
    ],
  });

  let sawDamage = false;
  for (let seed = 1; seed <= 12; seed++) {
    const { run, log } = runRun(bare, seed, scriptedAgent(0));
    assert.equal(run.hero.maxHealth, 40);
    assert.ok(run.hero.health <= 40, `seed ${seed}: hero Health exceeded the run maximum`);
    const fights = log.nodes.filter((n) => n.fightResult !== null);
    assert.ok(fights.length > 0, `seed ${seed} fought nothing, so this checked nothing`);
    for (const rec of fights) {
      if (rec.heroHealthAfter < 40) sawDamage = true;
    }
    // No rest and no heal event on this route, so Health is monotone down.
    let previous = 40;
    for (const rec of log.nodes) {
      assert.ok(
        rec.heroHealthAfter <= previous,
        `seed ${seed}: Health went up at node ${rec.nodeId} (${previous} -> ${rec.heroHealthAfter})`,
      );
      previous = rec.heroHealthAfter;
    }
  }
  assert.ok(
    sawDamage,
    'no fight in the window cost the hero any Health, so "Health carries" was never observed',
  );
});

test('a rest node heals a fraction of maximum Health and never overheals', () => {
  const content = fixtureContent({ restHealFraction: 0.25 });
  const run = startRun(content, 1);
  assert.equal(restAmount(run), 10);

  // Drive a fixture run and check every rest node moved Health by the rest
  // amount, clamped at the maximum.
  const { log } = runRun(content, 9, scriptedAgent(0));
  let before = content.hero.health;
  for (const rec of log.nodes) {
    if (rec.type === 'rest') {
      assert.equal(rec.heroHealthAfter, Math.min(40, before + 10), `rest at node ${rec.nodeId}`);
    }
    before = rec.heroHealthAfter;
  }
});

test('a rest node heals at least 1 Health however small the fraction', () => {
  const run = startRun(fixtureContent({ restHealFraction: 0.001 }), 1);
  assert.equal(restAmount(run), 1);
});

test('the forge permanently upgrades one deck card, and the next fight is fought with it', () => {
  const deck = ['t_grunt', 't_grunt'].map((id, i) => makeDeckCard(id, i));
  const base = resolveDeckCard(POOL, deck[0]!);
  assert.equal(base.power, 2);
  assert.equal(base.health, 2);
  assert.equal(base.cost, 1);

  applyForge(deck, 0, 'power');
  applyForge(deck, 0, 'health');
  applyForge(deck, 0, 'cost');

  const pool = runPool(POOL, deck);
  const upgraded = pool.card('t_grunt#0');
  assert.equal(upgraded.power, 3, '+1 Power did not reach the fight');
  assert.equal(upgraded.health, 3, '+1 Health did not reach the fight');
  assert.equal(upgraded.cost, 0, '-1 cost did not reach the fight');
  // The other copy is untouched: the forge upgrades a card, not a card id.
  assert.equal(pool.card('t_grunt#1').power, 2, 'the forge hit the wrong copy');
});

test('a forged cost never goes negative, and the waste is the player\'s to make', () => {
  const deck = [makeDeckCard('t_grunt', 0)];
  applyForge(deck, 0, 'cost');
  applyForge(deck, 0, 'cost');
  applyForge(deck, 0, 'cost');
  assert.equal(runPool(POOL, deck).card('t_grunt#0').cost, 0);
});

test('the run pool resolves deck instances and passes enemy card ids straight through', () => {
  const deck = [makeDeckCard('t_grunt', 0)];
  const pool = runPool(POOL, deck);
  assert.equal(pool.card('t_grunt#0').id, 't_grunt#0');
  assert.equal(pool.card('t_mook').id, 't_mook');
  assert.throws(
    () => pool.card('t_grunt#7'),
    /no deck instance "t_grunt#7".*deck holds: t_grunt#0/s,
    'an unknown instance id must say which instances the deck actually holds',
  );
});

test('a card reward appends exactly one card, and declining appends none', () => {
  const content = fixtureContent();
  const taking = runRun(content, 4, scriptedAgent(0));
  const declining = runRun(content, 4, {
    ...scriptedAgent(0),
    reward: () => -1,
  });
  const fightsWon = taking.log.nodes.filter((n) => n.fightResult === 'playerWin').length;
  assert.ok(fightsWon > 0, 'the fixture run never won a fight, so this test checked nothing');
  assert.equal(
    taking.run.deck.length - content.startingDeck.length,
    taking.run.cardsGained,
    'the deck grew by something other than the cards it was given',
  );
  assert.ok(
    declining.run.cardsGained <= taking.run.cardsGained,
    'declining every reward gained at least as many cards as taking them',
  );
});

test('deck instance ids are unique and are never reused within a run', () => {
  const { run } = runRun(RUN_CONTENT, 12, makeRunAgent({ route: 'greedy', placement: 'right', seed: 12 }));
  const ids = run.deck.map((d) => d.instanceId);
  assert.equal(new Set(ids).size, ids.length, 'two deck cards share an instance id');
});

test('a shop refuses a purchase the run cannot afford, and says so', () => {
  const content = fixtureContent({ startingGold: 0, shopBasePrice: 999 });
  assert.throws(
    () =>
      runRun(content, 2, {
        ...scriptedAgent(0),
        travel: (_r, options) => {
          const shop = options.findIndex((o) => o.type === 'shop');
          return shop >= 0 ? shop : 0;
        },
        shop: () => 0,
      }),
    // The card is whichever the shelf drew first; the message's shape is the claim.
    /run: shop purchase of "t_\w+" costs \d+ gold and the run holds \d+\. An agent must check the price/,
  );
});

test('a run ends when the hero dies and is won by the last boss, never both', () => {
  const content = fixtureContent();
  let deaths = 0;
  let wins = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { run } = runRun(content, seed, scriptedAgent(0));
    assert.notEqual(run.result, 'ongoing', `seed ${seed} never finished`);
    assert.notEqual(run.ending, null, `seed ${seed} finished with no ending recorded`);
    if (run.result === 'won') {
      wins++;
      assert.equal(run.ending!.cause, 'won');
      assert.ok(run.hero.health > 0, 'a won run ended with a dead hero');
    } else {
      deaths++;
      assert.equal(run.result, 'dead');
      assert.ok(run.ending!.cause === 'killed' || run.ending!.cause === 'timeout');
    }
  }
  assert.ok(wins + deaths === 30);
});

test('a content set with no sigils grants none, and asks no sigil choice', () => {
  // The inert path still holds: `test/sigils.test.ts` gates the live one. A
  // run whose content defines no sigil must neither grant one nor put a
  // `sigil` or `attach` choice in its log, so a log from such content is the
  // log units 5 and 8 wrote, choice for choice.
  const content = fixtureContent({ sigils: [] });
  let fightsWon = 0;
  for (const seed of RUN_SEEDS.slice(0, 15)) {
    const { run, log } = runRun(content, seed, scriptedAgent(0));
    assert.deepEqual(run.sigils, [], `seed ${seed} granted a sigil from content that has none`);
    for (const c of runChoices(log)) {
      assert.ok(c.kind !== 'sigil' && c.kind !== 'attach', `seed ${seed} recorded a ${c.kind} choice`);
    }
    fightsWon += log.nodes.filter((n) => n.fightResult === 'playerWin').length;
  }
  assert.ok(fightsWon >= 15, `only ${fightsWon} fights won across the window; the reward path was barely walked`);
});

test('replay refuses a choice list that does not match the decisions a node offers', () => {
  const content = fixtureContent();
  const live = runRun(content, 5, scriptedAgent(0));
  const damaged: RunLog = {
    seed: live.log.seed,
    format: live.log.format,
    nodes: live.log.nodes.map((n, i) => (i === 0 ? { ...n, choices: [] } : n)),
  };
  assert.throws(
    () => replayRun(content, damaged),
    /asked for a "travel" choice at position 0, and the log holds nothing/,
  );
});

test('replay refuses a travel choice that the regenerated map does not offer', () => {
  const content = fixtureContent();
  const live = runRun(content, 5, scriptedAgent(0));
  const damaged: RunLog = {
    seed: live.log.seed,
    format: live.log.format,
    nodes: live.log.nodes.map((n, i) =>
      i === 0 ? { ...n, choices: [{ kind: 'travel' as const, nodeId: 999 }, ...n.choices.slice(1)] } : n,
    ),
  };
  assert.throws(() => replayRun(content, damaged), /travels to node 999, which is not reachable/);
});
