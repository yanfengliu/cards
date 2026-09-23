// Every number a won fight's screens state about the hero is the number the
// replay sets, and the HUD says the same.
//
// The defect this file exists for. Between a won fight and its commit the run
// state is stale by design: `src/ui/run.ts` moves the state when a node
// commits, so while the hero sigil offer, the reward shelf and the attach
// screen are up, `state.hero` still holds the Health the hero carried into the
// fight and the maximum from before any hero sigil. The shelf's opening line
// read its maximum from there. After the Sigil of the Oak, a hand-played Ranger
// run on seed 2 read "146 of 180 Health" under a HUD reading 146/210, and it did
// so at every elite or boss where the Oak was taken. No test read that sentence:
// it was written inside `startRunApp`, which needs a document.
//
// The class, and so the claim: anything a screen in that window says about the
// hero's Health, maximum Health or gold is what the replay sets. Not what the
// phase promises and not what `heroNow` returns - those are the code under
// test - but what a second controller reaches when it replays the same node
// through `replayRun` and walks away from every choice still open. The HUD
// reads `heroNow`, so it must say the same thing, and that includes its hero
// sigil chips: they read `state.sigils` too, so the Oak that had just made the
// bar 210 had no chip beside it until the shelf was answered. Found by the
// same screenshot, and the same class.
//
// Bound of this gate - what a green run does and does not prove:
//
//   Shipped `RUN_CONTENT`, every class it lists, seeds 1..4, the greedy and the
//   random route, append-right placement. The greedy route takes the Oak
//   whenever it is offered, which is what makes the window's maximum differ
//   from the state's; the random route declines some offers. Every sigil,
//   reward and attach screen those runs reach is rendered through the function
//   `runapp.ts` calls for it - `heroSigilOfferHtml`, `rewardHtml`,
//   `attachHtml` - with a stand-in card button, because the real one paints
//   with the document.
//
//   It reads statements of two shapes: "<n> of <m> Health", and the gold line
//   "+<pay> gold ... you now have <gold>". A screen that states the hero's
//   numbers in another shape is not read. A screen in the window that states
//   none (attach, today) passes by saying nothing, which is why the population
//   check requires the sigil and reward screens to have stated Health every
//   time they were drawn, and requires a reward screen where the maximum really
//   had moved - per class - so the Oak case cannot quietly fall out of the
//   window.
//
//   It proves nothing about the wiring from `renderNode` to these functions,
//   or about the pixels. That is `tools/ui-probe/run.ts`, which reads the same
//   line off the page, holds it to the HUD beside it and to the run, and needs
//   Chrome.
//
// Made to go red: see `docs/learning/gate-proofs.md`, entry of 2026-09-22.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runFight } from '../src/engine/fight.ts';
import type { UnitCard } from '../src/engine/state.ts';
import { RUN_CONTENT } from '../src/run/content.ts';
import { heldHeroSigils } from '../src/run/nodes.ts';
import { travelOptions } from '../src/run/run.ts';
import type { RunContent, RunState } from '../src/run/types.ts';
import { makeRunAgent } from '../src/sim/runbots.ts';
import { STAT_TERMS } from '../src/render/glossary.ts';
import {
  type FightOutcome,
  type RunController,
  type WonPhase,
  createRunController,
  heroNow,
} from '../src/ui/run.ts';
import { attachHtml, heroSigilOfferHtml, rewardHtml } from '../src/ui/sigils.ts';

/** The run screen's card button without the paint. The screens only need a button. */
function stubButton(card: UnitCard, attrs: string): string {
  return `<button type="button" class="runcard" ${attrs}>${card.name}</button>`;
}

/** What `runapp.ts` draws for each phase of a won fight, through the same functions. */
function screenFor(p: WonPhase, state: RunState): string {
  switch (p.kind) {
    case 'sigil':
      return heroSigilOfferHtml(p, state);
    case 'reward':
      return rewardHtml(p, state, stubButton);
    case 'attach':
      return attachHtml(p, state, stubButton);
  }
}

/** The words a player reads, tags taken out. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

const HEALTH = STAT_TERMS.health.name;

/** Every "<n> of <m> Health" the text says. */
function healthStated(text: string): { health: number; maxHealth: number }[] {
  return [...text.matchAll(new RegExp(`(\\d+) of (\\d+) ${HEALTH}`, 'g'))].map((m) => ({
    health: Number(m[1]),
    maxHealth: Number(m[2]),
  }));
}

/** Every "+<pay> gold" and every "you now have <gold>" the text says. */
function goldStated(text: string): { pays: number[]; totals: number[] } {
  return {
    pays: [...text.matchAll(/\+(\d+) gold/g)].map((m) => Number(m[1])),
    totals: [...text.matchAll(/you now have (\d+)/g)].map((m) => Number(m[1])),
  };
}

/** The choices already made inside the node being checked. */
type Made = { sigil?: number; reward?: number };

/**
 * What the run holds if the player walks away now.
 *
 * A second controller, resumed from the log - which holds completed nodes only
 * - travels to the same node, is handed the same fight, makes the choices
 * already made in it, and declines everything still open. Declining touches
 * neither Health nor gold, and where it cannot decline - an attach - where the
 * sigil goes touches neither either. So its state after the commit is the
 * answer to "what are the hero's numbers now", and it is `replayRun`'s answer,
 * reached without the phase the screens were built from.
 */
function walkAway(content: RunContent, ctl: RunController, nodeId: number, outcome: FightOutcome, made: Made): RunState {
  const fork = createRunController(content, ctl.seed, { classId: ctl.classId, resume: ctl.log });
  fork.travel(nodeId);
  fork.finishFight(outcome);
  for (let guard = 0; ; guard++) {
    assert.ok(guard < 4, 'walking away from a won fight took more than three answers');
    const p = fork.phase;
    if (p.kind === 'sigil') fork.pickSigil(made.sigil ?? -1);
    else if (p.kind === 'reward') fork.pickReward(made.reward ?? -1);
    else if (p.kind === 'attach') fork.attach(p.offers[0]!);
    else break;
  }
  assert.ok(
    fork.phase.kind === 'travel' || fork.phase.kind === 'over',
    `walking away left the node open, at ${fork.phase.kind}`,
  );
  return fork.state;
}

type Tally = {
  screens: Record<WonPhase['kind'], number>;
  /** Screens where the Health the replay sets differs from the stale state's. */
  healthMoved: number;
  /** Reward screens where the maximum the replay sets differs from the stale state's, per class. */
  maxMovedAtReward: Map<string, number>;
  /** Screens where the hero holds a sigil the stale state does not have yet. */
  sigilsMoved: number;
  statements: number;
};

/** Hold one won-fight screen, and the HUD above it, to the replay. */
function check(
  content: RunContent,
  ctl: RunController,
  p: WonPhase,
  nodeId: number,
  outcome: FightOutcome,
  made: Made,
  tally: Tally,
  label: string,
): void {
  const truth = walkAway(content, ctl, nodeId, outcome, made);
  const want = { health: truth.hero.health, maxHealth: truth.hero.maxHealth, gold: truth.gold };
  const wantSigils = heldHeroSigils(truth).map((s) => s.id);
  const stale = ctl.state;
  const where = `${label}, ${p.kind} screen at node ${nodeId}`;

  const hud = heroNow(stale, p);
  const hudSaid = { health: hud.health, maxHealth: hud.maxHealth, gold: hud.gold };
  assert.deepEqual(
    hudSaid,
    want,
    `${where}: the HUD states ${JSON.stringify(hudSaid)} and the replay sets ${JSON.stringify(want)}`,
  );
  assert.deepEqual(
    hud.heroSigils.map((s) => s.id),
    wantSigils,
    `${where}: the HUD's chips show hero sigils [${hud.heroSigils.map((s) => s.id).join(', ')}] and the ` +
      `replay has the hero holding [${wantSigils.join(', ')}]`,
  );

  const text = textOf(screenFor(p, stale));
  const health = healthStated(text);
  if (p.kind !== 'attach') {
    assert.ok(health.length > 0, `${where}: the screen no longer states the hero's ${HEALTH} at all:\n${text}`);
  }
  for (const s of health) {
    assert.deepEqual(
      s,
      { health: want.health, maxHealth: want.maxHealth },
      `${where}: the screen says "${s.health} of ${s.maxHealth} ${HEALTH}" and the replay sets ` +
        `${want.health} of ${want.maxHealth}. The run state is stale until the node commits; read ` +
        `heroNow, as the HUD does.\n${text}`,
    );
  }
  const gold = goldStated(text);
  for (const pay of gold.pays) {
    assert.equal(pay, want.gold - stale.gold, `${where}: the screen says the fight paid ${pay} and the replay pays ${want.gold - stale.gold}`);
  }
  for (const total of gold.totals) {
    assert.equal(total, want.gold, `${where}: the screen says you now have ${total} gold and the replay sets ${want.gold}`);
  }

  tally.screens[p.kind]++;
  tally.statements += health.length + gold.pays.length + gold.totals.length;
  if (want.health !== stale.hero.health) tally.healthMoved++;
  if (wantSigils.length !== heldHeroSigils(stale).length) tally.sigilsMoved++;
  if (p.kind === 'reward' && want.maxHealth !== stale.hero.maxHealth) {
    tally.maxMovedAtReward.set(ctl.classId, (tally.maxMovedAtReward.get(ctl.classId) ?? 0) + 1);
  }
}

function drive(content: RunContent, seed: number, classId: string, route: 'greedy' | 'random', tally: Tally): void {
  const label = `${classId} seed ${seed} ${route}`;
  const agent = makeRunAgent({ route, placement: 'right', seed });
  const ctl = createRunController(content, seed, { classId });
  let nodeId = -1;
  let outcome: FightOutcome | null = null;
  let made: Made = {};
  for (let guard = 0; ctl.phase.kind !== 'over'; guard++) {
    assert.ok(guard < 800, `${label}: the run never ended`);
    const p = ctl.phase;
    switch (p.kind) {
      case 'travel': {
        const options = travelOptions(ctl.state);
        nodeId = options[agent.travel(ctl.state, options)]!.id;
        ctl.travel(nodeId);
        break;
      }
      case 'fight': {
        const { fight, log } = runFight(p.setup, agent.placement);
        outcome = { fight, rounds: log };
        made = {};
        ctl.finishFight(outcome);
        break;
      }
      case 'sigil': {
        check(content, ctl, p, nodeId, outcome!, made, tally, label);
        const pick = agent.sigil(ctl.state, p.offer);
        made = { ...made, sigil: pick };
        ctl.pickSigil(pick);
        break;
      }
      case 'reward': {
        check(content, ctl, p, nodeId, outcome!, made, tally, label);
        const pick = agent.reward(ctl.state, p.offer);
        made = { ...made, reward: pick };
        ctl.pickReward(pick);
        break;
      }
      case 'attach': {
        check(content, ctl, p, nodeId, outcome!, made, tally, label);
        ctl.attach(p.offers[agent.attach(ctl.state, p.sigil, p.offers)]!);
        break;
      }
      case 'forge': {
        const offer = p.offers[agent.forge(ctl.state, p.offers)]!;
        ctl.forge(offer.deckIndex, offer.mode);
        break;
      }
      case 'shop':
        ctl.buy(agent.shop(ctl.state, p.stock));
        break;
      case 'event':
        ctl.chooseEvent(agent.event(ctl.state, p.def));
        break;
    }
  }
}

test("everything a won fight's screens and the HUD state about the hero is what the replay sets", () => {
  const classes = (RUN_CONTENT.classes ?? []).map((c) => c.id);
  assert.ok(classes.length >= 3, `RUN_CONTENT lists ${classes.length} class(es); the walk below reads that list`);
  const tally: Tally = {
    screens: { sigil: 0, reward: 0, attach: 0 },
    healthMoved: 0,
    maxMovedAtReward: new Map(),
    sigilsMoved: 0,
    statements: 0,
  };
  for (const classId of classes) {
    for (let seed = 1; seed <= 4; seed++) {
      for (const route of ['greedy', 'random'] as const) drive(RUN_CONTENT, seed, classId, route, tally);
    }
  }

  // The population, so "did not run" cannot come back as "passed", and so the
  // one case the defect lived in cannot fall out of the window unnoticed.
  const summary = JSON.stringify({ ...tally, maxMovedAtReward: Object.fromEntries(tally.maxMovedAtReward) });
  assert.ok(tally.screens.sigil >= 10, `too few hero sigil screens checked: ${summary}`);
  assert.ok(tally.screens.reward >= 50, `too few reward screens checked: ${summary}`);
  assert.ok(tally.screens.attach >= 3, `too few attach screens checked: ${summary}`);
  assert.ok(tally.healthMoved >= 50, `too few screens where the fight moved the hero's Health: ${summary}`);
  assert.ok(tally.sigilsMoved >= 10, `too few screens where a hero sigil taken at the node is held: ${summary}`);
  for (const classId of classes) {
    assert.ok(
      (tally.maxMovedAtReward.get(classId) ?? 0) >= 1,
      `no ${classId} reward screen came after a hero sigil that moved the maximum, which is the ` +
        `case the defect lived in: ${summary}`,
    );
  }
});
