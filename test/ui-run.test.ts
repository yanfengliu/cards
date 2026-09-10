// The run a person plays is the run `replayRun` replays, and the offers they
// see are the offers `visit` computes.
//
// `src/ui/run.ts` cannot use `runRun` - it plays the fights itself - so it
// advances the run by appending records and re-replaying from the seed, and it
// *previews* each offer by cloning the canonical state and calling the same
// `nodes.ts` function `visit` calls. That preview duplicates one fact per node
// type: which draw comes when. Two drivers that disagree about that are two
// different runs, and the one with a screen is the one a person plays.
//
// Bound of this gate - what a green run does and does not prove:
//
//   Drives the controller with the decisions a bot made inside `runRun`, on the
//   same seed, and compares every previewed offer with the offer `runRun`
//   handed the bot: travel options, reward cards, forge offers, shop shelf and
//   event. The final `hashRun` must agree, and the controller's log must
//   replay to it with no controller in the loop.
//   Fights are played by `runFight` with the bot's own placement policy, which
//   is what `runRun` does; the screen's driver is `src/ui/session.ts`, gated
//   separately by `test/ui-session.test.ts`. A fight the screen plays
//   differently from the engine is that gate's failure, not this one's.
//   Runs 12 shipped-content seeds and 30 fixture seeds, each under two route
//   styles - greedy, which never declines, and random, which does - and asserts
//   the population it walked: every decision kind compared, at least one
//   decline, at least one lost fight and one won run. A window, not the space.
//   Proves nothing about the DOM, timing, or what the screens say.
//
// Made to go red: previewing the shop shelf from a clone advanced by one draw
// fails at "fixture seed 1 random: shop shelf previewed [t_grunt,t_wall], runRun
// offered [t_wall,t_grunt]"; previewing the reward on the live state instead
// of a clone fails the same seed's next fight. See `docs/learning/gate-proofs.md`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runFight, setupFight } from '../src/engine/fight.ts';
import type { CardPool, UnitCard } from '../src/engine/state.ts';
import { RUN_CONTENT } from '../src/run/content.ts';
import { makeDeckCard } from '../src/run/deck.ts';
import { hashRun } from '../src/run/hash.ts';
import { type RunAgent, replayRun, runChoices, runRun, travelOptions } from '../src/run/run.ts';
import type { ForgeOffer, RunContent, ShopItem } from '../src/run/types.ts';
import { makeRunAgent } from '../src/sim/runbots.ts';
import { blazonFor } from '../src/render/blazons.ts';
import { createRunController } from '../src/ui/run.ts';

// ---------------------------------------------------------------------------
// A fixture run: three cards, five rows holding every node type, one enemy
// with a boss that kills often enough for both endings to occur.
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

function fixtureContent(): RunContent {
  const enemy = {
    id: 'fx_enemy',
    name: 'Mooks',
    enemyHero: { name: 'Mooks', health: 6, power: 2, armour: 0 },
    enemyDeck: ['t_mook', 't_mook', 't_mook'],
    opening: [] as readonly string[],
  };
  return {
    pool: POOL,
    hero: { name: 'Knight', health: 24, power: 2, armour: 0 },
    startingDeck: ['t_grunt', 't_grunt', 't_wall', 't_grunt'],
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
        {
          minWidth: 2,
          maxWidth: 3,
          weights: [
            { type: 'rest', weight: 1 },
            { type: 'forge', weight: 1 },
            { type: 'event', weight: 1 },
          ],
        },
        {
          minWidth: 2,
          maxWidth: 3,
          weights: [
            { type: 'shop', weight: 1 },
            { type: 'event', weight: 1 },
            { type: 'fight', weight: 1 },
          ],
        },
        {
          minWidth: 2,
          maxWidth: 2,
          weights: [
            { type: 'elite', weight: 1 },
            { type: 'rest', weight: 1 },
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
          { label: 'a card', effects: [{ kind: 'card' }] },
        ],
      },
    ],
    rewardOffers: 2,
    shopStock: 2,
    shopBasePrice: 10,
    shopPricePerCost: 5,
    startingGold: 0,
    restHealFraction: 0.25,
    maxRounds: 20,
  };
}

// ---------------------------------------------------------------------------
// A bot that remembers what it was shown, so the controller can be checked
// against it decision by decision.
// ---------------------------------------------------------------------------

type Seen =
  | { kind: 'travel'; options: number[]; pick: number }
  | { kind: 'reward'; offer: string[]; pick: number }
  | { kind: 'forge'; offers: ForgeOffer[]; pick: number }
  | { kind: 'shop'; stock: ShopItem[]; pick: number }
  | { kind: 'event'; defId: string; options: string[]; pick: number };

function recording(base: RunAgent): { agent: RunAgent; seen: Seen[] } {
  const seen: Seen[] = [];
  const agent: RunAgent = {
    placement: base.placement,
    travel(run, options) {
      const pick = base.travel(run, options);
      seen.push({ kind: 'travel', options: options.map((o) => o.id), pick });
      return pick;
    },
    reward(run, offer) {
      const pick = base.reward(run, offer);
      seen.push({ kind: 'reward', offer: offer.slice(), pick });
      return pick;
    },
    forge(run, offers) {
      const pick = base.forge(run, offers);
      seen.push({ kind: 'forge', offers: offers.map((o) => ({ ...o })), pick });
      return pick;
    },
    shop(run, stock) {
      const pick = base.shop(run, stock);
      seen.push({ kind: 'shop', stock: stock.map((s) => ({ ...s })), pick });
      return pick;
    },
    event(run, def) {
      const pick = base.event(run, def);
      seen.push({ kind: 'event', defId: def.id, options: def.options.map((o) => o.label), pick });
      return pick;
    },
  };
  return { agent, seen };
}

type Tally = Record<Seen['kind'], number> & {
  declines: number;
  lostFights: number;
  wonRuns: number;
  runs: number;
};

/**
 * Play one seed twice - once inside `runRun`, once through the controller with
 * the same decisions - and require them to be the same run.
 */
function drive(content: RunContent, seed: number, base: RunAgent, tally: Tally, label: string): void {
  const { agent, seen } = recording(base);
  const live = runRun(content, seed, agent);

  const ctl = createRunController(content, seed);
  let cursor = 0;
  const next = (): Seen => {
    const s = seen[cursor];
    cursor++;
    assert.ok(s !== undefined, `${label}: the controller asked for a decision runRun never made`);
    return s;
  };

  let guard = 0;
  while (ctl.phase.kind !== 'over') {
    assert.ok(guard++ < 500, `${label}: the controller never reached the end of the run`);
    const p = ctl.phase;
    switch (p.kind) {
      case 'travel': {
        const s = next();
        assert.equal(s.kind, 'travel', `${label}: runRun decided ${s.kind} where the controller travels`);
        assert.deepEqual(
          travelOptions(ctl.state).map((o) => o.id),
          s.options,
          `${label}: travel options differ`,
        );
        ctl.travel(s.options[s.pick]!);
        tally.travel++;
        break;
      }
      case 'fight': {
        const { fight, log } = runFight(p.setup, base.placement);
        if (fight.result !== 'playerWin') tally.lostFights++;
        ctl.finishFight({ fight, rounds: log });
        break;
      }
      case 'reward': {
        const s = next();
        assert.equal(s.kind, 'reward', `${label}: runRun decided ${s.kind} where the controller rewards`);
        assert.deepEqual(
          p.offer,
          s.offer,
          `${label}: reward previewed [${p.offer.join(',')}], runRun offered [${s.offer.join(',')}]`,
        );
        if (s.pick < 0) tally.declines++;
        ctl.pickReward(s.pick);
        tally.reward++;
        break;
      }
      case 'forge': {
        const s = next();
        assert.equal(s.kind, 'forge', `${label}: runRun decided ${s.kind} where the controller forges`);
        assert.deepEqual(p.offers, s.offers, `${label}: forge offers differ`);
        const chosen = s.offers[s.pick]!;
        ctl.forge(chosen.deckIndex, chosen.mode);
        tally.forge++;
        break;
      }
      case 'shop': {
        const s = next();
        assert.equal(s.kind, 'shop', `${label}: runRun decided ${s.kind} where the controller shops`);
        assert.deepEqual(
          p.stock,
          s.stock,
          `${label}: shop shelf previewed [${p.stock.map((i) => i.cardId).join(',')}], runRun offered ` +
            `[${s.stock.map((i) => i.cardId).join(',')}]`,
        );
        if (s.pick < 0) tally.declines++;
        ctl.buy(s.pick);
        tally.shop++;
        break;
      }
      case 'event': {
        const s = next();
        assert.equal(s.kind, 'event', `${label}: runRun decided ${s.kind} where the controller events`);
        assert.equal(p.def.id, s.defId, `${label}: event differs`);
        assert.deepEqual(p.def.options.map((o) => o.label), s.options);
        ctl.chooseEvent(s.pick);
        tally.event++;
        break;
      }
    }
  }

  assert.equal(cursor, seen.length, `${label}: runRun made ${seen.length} decisions, the controller used ${cursor}`);
  assert.equal(ctl.hash(), hashRun(live.run), `${label}: the controller's run is not runRun's run`);
  assert.equal(ctl.state.result, live.run.result);
  assert.deepEqual(runChoices(ctl.log), runChoices(live.log), `${label}: the choice lists differ`);
  assert.equal(
    hashRun(replayRun(content, ctl.log)),
    ctl.hash(),
    `${label}: the controller's own log does not replay to its state`,
  );
  if (live.run.result === 'won') tally.wonRuns++;
  tally.runs++;
}

test('the controller previews what visit computes and its log replays to runRun\'s hash', () => {
  const tally: Tally = {
    travel: 0,
    reward: 0,
    forge: 0,
    shop: 0,
    event: 0,
    declines: 0,
    lostFights: 0,
    wonRuns: 0,
    runs: 0,
  };
  const fixture = fixtureContent();
  for (let seed = 1; seed <= 30; seed++) {
    for (const route of ['greedy', 'random'] as const) {
      drive(fixture, seed, makeRunAgent({ route, placement: 'random', seed }), tally, `fixture seed ${seed} ${route}`);
    }
  }
  for (let seed = 1; seed <= 12; seed++) {
    for (const route of ['greedy', 'random'] as const) {
      drive(RUN_CONTENT, seed, makeRunAgent({ route, placement: 'right', seed }), tally, `shipped seed ${seed} ${route}`);
    }
  }

  // The population, so "did not run" cannot come back as "passed".
  const summary = JSON.stringify(tally);
  assert.equal(tally.runs, 84, summary);
  assert.ok(tally.travel >= 300, `too few travel decisions compared: ${summary}`);
  assert.ok(tally.reward >= 100, `too few reward offers compared: ${summary}`);
  assert.ok(tally.forge >= 10, `too few forge offers compared: ${summary}`);
  assert.ok(tally.shop >= 10, `too few shop shelves compared: ${summary}`);
  assert.ok(tally.event >= 10, `too few events compared: ${summary}`);
  assert.ok(tally.declines >= 5, `the decline path was barely exercised: ${summary}`);
  assert.ok(tally.lostFights >= 5, `too few lost fights, the losing branch was barely exercised: ${summary}`);
  assert.ok(tally.wonRuns >= 5, `too few won runs, the winning branch was barely exercised: ${summary}`);
});

test('the controller refuses what the run would refuse, and says why', () => {
  const content = fixtureContent();
  const ctl = createRunController(content, 3);

  assert.throws(() => ctl.pickReward(0), /cannot pick a reward now - the run is waiting for a node to travel to/);
  assert.throws(() => ctl.travel(999), /node 999 is not reachable from here\. The map offers \[0 \(fight\)\]/);

  ctl.travel(0);
  assert.equal(ctl.phase.kind, 'fight');
  assert.throws(() => ctl.travel(0), /cannot travel now - a fight is being fought/);

  const p = ctl.phase;
  assert.ok(p.kind === 'fight');
  const foreign = runFight({ ...p.setup, seed: p.setup.seed + 1 }, makeRunAgent({ route: 'greedy', placement: 'right', seed: 1 }).placement);
  assert.throws(
    () => ctl.finishFight({ fight: foreign.fight, rounds: foreign.log }),
    /was seeded \d+ and this node's fight is seeded \d+/,
  );
  const unfinished = setupFight(p.setup);
  assert.throws(() => ctl.finishFight({ fight: unfinished, rounds: [] }), /still ongoing/);

  // A shop that cannot be afforded refuses the purchase before the replay
  // would. Not every seed's map puts a shop on the route, so walk seeds until
  // one does, and say so if none did.
  let shops = 0;
  for (let seed = 1; seed <= 12 && shops === 0; seed++) {
    const poor = createRunController({ ...content, shopBasePrice: 999 }, seed);
    const placement = makeRunAgent({ route: 'greedy', placement: 'right', seed }).placement;
    let steps = 0;
    while (poor.phase.kind !== 'over' && poor.phase.kind !== 'shop' && steps++ < 40) {
      const ph = poor.phase;
      if (ph.kind === 'travel') {
        const options = travelOptions(poor.state);
        const shop = options.find((o) => o.type === 'shop');
        poor.travel((shop ?? options[0]!).id);
      } else if (ph.kind === 'fight') {
        const { fight, log } = runFight(ph.setup, placement);
        poor.finishFight({ fight, rounds: log });
      } else if (ph.kind === 'reward') poor.pickReward(-1);
      else if (ph.kind === 'forge') poor.forge(0, 'power');
      else if (ph.kind === 'event') poor.chooseEvent(0);
    }
    if (poor.phase.kind !== 'shop') continue;
    shops++;
    assert.throws(() => poor.buy(0), /costs \d+ gold and the run holds \d+\. Buy something cheaper, or leave with -1/);
    assert.throws(() => poor.buy(7), /shop item 7 is not one of the 2 option\(s\) on offer \(or -1 to decline\)/);
    poor.buy(-1);
    assert.equal(poor.phase.kind, 'travel');
  }
  assert.equal(shops, 1, 'no fixture seed in 1..12 reached a shop, so the refusal was never exercised');
});

test('a run resumes from its log to the same hash, and refuses a log from another seed', () => {
  // The saved game is the log. A controller built from it must stand exactly
  // where the one that wrote it stood, and a log carried to the wrong seed
  // must be refused before it can replay into a different run.
  const content = fixtureContent();
  const placement = makeRunAgent({ route: 'greedy', placement: 'right', seed: 4 }).placement;
  const live = createRunController(content, 4);
  let steps = 0;
  // Stop between nodes: a node in progress is not in the log, by design.
  while (live.phase.kind !== 'over' && (live.phase.kind !== 'travel' || steps < 6)) {
    steps++;
    const p = live.phase;
    if (p.kind === 'travel') live.travel(travelOptions(live.state)[0]!.id);
    else if (p.kind === 'fight') {
      const { fight, log } = runFight(p.setup, placement);
      live.finishFight({ fight, rounds: log });
    } else if (p.kind === 'reward') live.pickReward(0);
    else if (p.kind === 'forge') live.forge(0, 'health');
    else if (p.kind === 'shop') live.buy(-1);
    else live.chooseEvent(0);
  }
  assert.ok(live.log.nodes.length >= 2, 'the fixture walk completed too few nodes to resume anything');

  const resumed = createRunController(content, 4, live.log);
  assert.equal(resumed.hash(), live.hash(), 'the resumed run is not the run that was saved');
  assert.equal(resumed.phase.kind, live.phase.kind);
  assert.equal(resumed.log.nodes.length, live.log.nodes.length);

  assert.throws(
    () => createRunController(content, 5, live.log),
    /cannot resume a run seeded 4 as seed 5\. A log replays only on its own seed/,
  );
});

test('a deck instance keeps its card\'s device: the blazon strips the instance number', () => {
  // The screen draws run deck cards by their instance id (`u_squire#3`), and a
  // renderer that hashed that id into a fallback device would draw every
  // player card in a run as a stranger. The separator is `deck.ts`'s, reached
  // through `makeDeckCard` so the two cannot drift apart.
  for (const [id, tribe, guard] of [
    ['u_squire', 'human', false],
    ['u_shieldbearer', 'dwarf', true],
    ['u_sentinel', 'elf', true],
  ] as const) {
    const instance = makeDeckCard(id, 17).instanceId;
    assert.notEqual(instance, id, 'the fixture instance id must differ from the base id');
    assert.equal(blazonFor(instance, tribe, guard), blazonFor(id, tribe, guard), `${instance} lost its device`);
  }
  // And an unknown id still derives something rather than throwing.
  assert.ok(blazonFor('u_nobody#2', 'human', false).length > 0);
});
