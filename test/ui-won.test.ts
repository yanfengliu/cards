// Every number a won fight's screens state about the hero is the number the
// replay sets, and the HUD says the same - over each fight's end banner too,
// won or lost.
//
// The defect this file exists for. From the moment a fight ends until its node
// commits the run state is stale by design: `src/ui/run.ts` moves the state
// when a node commits, so over the end banner and while the hero sigil offer,
// the reward shelf and the attach screen are up, `state.hero` still holds the
// Health the hero carried into the fight and the maximum from before any hero
// sigil. The shelf's opening line read its maximum from there. After the Sigil
// of the Oak, the final acceptance review saw "146 of 180 Health" under a HUD
// reading 146/210, and the same happens at any elite or boss where the Oak is
// taken. No test read that sentence: it was written inside `startRunApp`,
// which needs a document.
//
// The class, and so the claim: anything the HUD says in that window, and
// anything a won fight's screen says there, about the hero's Health, maximum
// Health or gold is what the replay sets. Not what the phase promises and not
// what `heroNow` returns - those are the code under test - but what a second
// controller reaches when it replays the same node through `replayRun` and
// walks away from every choice still open. The HUD reads `heroNow`, so it must
// say the same thing, and that includes its hero sigil chips: they read
// `state.sigils` too, so the Oak that had just made the bar 210 had no chip
// beside it until the shelf was answered. The review of the fix found the
// third: over the end banner, before `finishFight`, the HUD kept the Health
// the hero walked in with, 200/200 under "Your hero finished on 194 of 200
// Health".
//
// The fight screen's own words are outside the claim. Its end banner and its
// subtitle state the fight's maximum, and a fight's hero is built from the
// Health `heroSpecFor` hands it, which the engine also takes as its maximum. So
// after a damaged fight they read "186 of 194" beside a HUD rightly reading
// 186/200. That is how the engine builds a fight, not a choice any design
// document made, and nothing here reads or holds it.
//
// Bound of this gate - what a green run does and does not prove:
//
//   Shipped `RUN_CONTENT`, every class it lists, seeds 1..4, the greedy and the
//   random route, append-right placement. The greedy route takes the Oak
//   whenever it is offered, which is what makes the window's maximum differ
//   from the state's; the random route declines some offers. Every fight's end,
//   won or lost, is checked as `heroNow(state, phase, outcome)` - what the HUD
//   reads over the banner. Every sigil, reward and attach screen those runs
//   reach is rendered through the function `runapp.ts` calls for it -
//   `heroSigilOfferHtml`, `rewardHtml`, `attachHtml` - with a stand-in card
//   button, because the real one paints with the document.
//
//   It reads statements of two shapes: "<n> of <m> Health", and the gold line
//   "+<pay> gold ... you now have <gold>". A screen that states the hero's
//   numbers in another shape is not read. A screen in the window that states
//   none (attach, today) passes by saying nothing, which is why the population
//   check requires the sigil and reward screens to have stated both every time
//   they were drawn, and requires a reward screen where the maximum really had
//   moved - per class - so the Oak case cannot quietly fall out of the window.
//
//   It proves nothing about the wiring in `runapp.ts` - whether `renderNode`
//   still calls these functions, whether `renderHud` hands the finished fight
//   to `heroNow` and is redrawn when the banner goes up - or about the pixels.
//   That is `tools/ui-probe/run.ts`: at every hero sigil and reward screen it
//   reads the opening line, the HUD's Health and its sigil chips off the page,
//   and over every fight's end banner the HUD's Health, and holds each to the
//   run. It needs Chrome and is outside `npm run gates`.
//
// Made to go red: see `docs/learning/gate-proofs.md`, entry of 2026-09-23.

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
  type RunPhase,
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
function walkAway(
  content: RunContent,
  ctl: RunController,
  nodeId: number,
  outcome: FightOutcome,
  made: Made,
  where: string,
): RunState {
  const fork = createRunController(content, ctl.seed, { classId: ctl.classId, resume: ctl.log });
  fork.travel(nodeId);
  fork.finishFight(outcome);
  for (let guard = 0; ; guard++) {
    assert.ok(
      guard < 4,
      `${where}: walking away from the fight took more than three answers, and a won node asks at most ` +
        `three (hero sigil, shelf, attach); the node is still at ${fork.phase.kind}`,
    );
    const p = fork.phase;
    if (p.kind === 'sigil') fork.pickSigil(made.sigil ?? -1);
    else if (p.kind === 'reward') fork.pickReward(made.reward ?? -1);
    else if (p.kind === 'attach') fork.attach(p.offers[0]!);
    else break;
  }
  assert.ok(
    fork.phase.kind === 'travel' || fork.phase.kind === 'over',
    `${where}: walking away left the node open at ${fork.phase.kind}; declining every open choice ` +
      'should commit it and leave the run at travel or over',
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
  /** Fights whose end banner was checked, by how they ended. */
  ended: { won: number; lost: number };
  /** End banners where the Health or the gold the replay sets differs from the stale state's. */
  endedMoved: number;
  /**
   * End banners where the Health itself moved. Counted apart from the gold,
   * because every won fight pays, so "Health or gold" is met by gold alone.
   */
  endedHealthMoved: number;
};

/**
 * Hold the HUD over a fight's end banner - the fight over on screen, the
 * outcome not yet handed to `finishFight` - to the replay. That is
 * `heroNow(state, phase, outcome)`, which is what `renderHud` reads there.
 */
function checkEnded(
  content: RunContent,
  ctl: RunController,
  p: Extract<RunPhase, { kind: 'fight' }>,
  nodeId: number,
  outcome: FightOutcome,
  tally: Tally,
  label: string,
): void {
  const where = `${label}, the end of the fight at node ${nodeId} (${outcome.fight.result})`;
  const truth = walkAway(content, ctl, nodeId, outcome, {}, where);
  const want = { health: truth.hero.health, maxHealth: truth.hero.maxHealth, gold: truth.gold };
  const wantSigils = heldHeroSigils(truth).map((s) => s.id);
  const stale = ctl.state;
  const hud = heroNow(stale, p, outcome);
  const hudSaid = { health: hud.health, maxHealth: hud.maxHealth, gold: hud.gold };
  assert.deepEqual(
    hudSaid,
    want,
    `${where}: the HUD over the end banner states ${JSON.stringify(hudSaid)} and the replay sets ` +
      `${JSON.stringify(want)}. Until the node commits the state holds what the hero walked in with; ` +
      'hand the finished fight to heroNow.',
  );
  assert.deepEqual(
    hud.heroSigils.map((s) => s.id),
    wantSigils,
    `${where}: the HUD's chips over the end banner show hero sigils [${hud.heroSigils.map((s) => s.id).join(', ')}] ` +
      `and the replay has the hero holding [${wantSigils.join(', ')}]`,
  );
  tally.ended[outcome.fight.result === 'playerWin' ? 'won' : 'lost']++;
  if (want.health !== stale.hero.health || want.gold !== stale.gold) tally.endedMoved++;
  if (want.health !== stale.hero.health) tally.endedHealthMoved++;
}

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
  const where = `${label}, ${p.kind} screen at node ${nodeId}`;
  const truth = walkAway(content, ctl, nodeId, outcome, made, where);
  const want = { health: truth.hero.health, maxHealth: truth.hero.maxHealth, gold: truth.gold };
  const wantSigils = heldHeroSigils(truth).map((s) => s.id);
  const stale = ctl.state;

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
  if (p.kind !== 'attach') {
    assert.ok(
      gold.pays.length > 0 && gold.totals.length > 0,
      `${where}: the screen no longer states what the fight paid and the gold it leaves, in the shape ` +
        `"+<pay> gold ... you now have <gold>", so its gold cannot be held to the replay:\n${text}`,
    );
  }
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
        // The end banner is up and the outcome is not handed over yet.
        checkEnded(content, ctl, p, nodeId, outcome, tally, label);
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
    ended: { won: 0, lost: 0 },
    endedMoved: 0,
    endedHealthMoved: 0,
  };
  for (const classId of classes) {
    for (let seed = 1; seed <= 4; seed++) {
      for (const route of ['greedy', 'random'] as const) drive(RUN_CONTENT, seed, classId, route, tally);
    }
  }

  // The population, so "did not run" cannot come back as "passed", and so the
  // one case the defect lived in cannot fall out of the window unnoticed.
  const summary = JSON.stringify({ ...tally, maxMovedAtReward: Object.fromEntries(tally.maxMovedAtReward) });
  const atLeast = (count: number, floor: number, what: string): void =>
    assert.ok(count >= floor, `${what}: ${count}, and the check needs at least ${floor}. ${summary}`);
  atLeast(tally.screens.sigil, 10, 'hero sigil screens checked');
  atLeast(tally.screens.reward, 50, 'reward screens checked');
  atLeast(tally.screens.attach, 3, 'attach screens checked');
  atLeast(tally.healthMoved, 50, "screens where the fight moved the hero's Health");
  atLeast(tally.sigilsMoved, 10, 'screens where a hero sigil taken at the node is held');
  atLeast(tally.ended.won, 50, 'won fights whose end banner was checked');
  atLeast(tally.ended.lost, 5, 'lost fights whose end banner was checked');
  atLeast(tally.endedMoved, 50, 'end banners where the fight moved the Health or the gold');
  atLeast(tally.endedHealthMoved, 50, "end banners where the fight moved the hero's Health itself");
  for (const classId of classes) {
    assert.ok(
      (tally.maxMovedAtReward.get(classId) ?? 0) >= 1,
      `no ${classId} reward screen came after a hero sigil that moved the maximum, which is the ` +
        `case the defect lived in: ${summary}`,
    );
  }
});
