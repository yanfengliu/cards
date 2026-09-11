// The run loop: enter a node, resolve it, carry the state forward.
//
// The keystone invariant, restated for the run:
//
//   Given a seed and an ordered list of choices - which node, which reward,
//   which forge target - a whole run replays to an identical final state.
//
// `replayRun` is that sentence as code. It takes a `RunLog` and no agent at
// all: every map is regenerated, every offer recomputed, every fight replayed
// from its own recorded action list through `replayFight`, and the final state
// must hash identically to the live run. There is exactly one node code path -
// `visit` below - so replay exercises the same one an agent does, which is the
// same shape `runRound`/`replayFight` already use for a fight.
//
// Randomness, and why it is arranged this way:
//
//   - The run has **one** generator, `RunState.rng`, on the stream `run`. It is
//     threaded through map generation at setup and through every offer after
//     it. It is derived from the run seed by `makeRng`, exactly as a fight's
//     `deck` and `combat` streams are derived from the fight seed, so the run
//     stream and the fight streams are disjoint by construction.
//   - **No fight ever reads it.** A fight's seed is `mixSeeds(runSeed, act,
//     nodeId, tag)`. A routing choice changes how many draws the run stream has
//     taken; it cannot change one bit inside a fight.
//   - All three act maps are generated at setup, before the first choice. The
//     map is therefore a function of the seed alone, which is what makes two
//     routes through one seed comparable at all.
//   - Sigil offers are node-keyed too, and never touch the run stream; see
//     `nodes.ts` for why that is what lets a log from before sigils replay.
//
// The engine is composed, never reached into: `setupFight`, `runFight` and
// `replayFight` are called with a `CardPool` this module builds. Nothing under
// `src/engine/` knows a run exists.

import {
  type FightRun,
  type FightSetup,
  type PlacementPolicy,
  replayFight,
  runFight,
} from '../engine/fight.ts';
import { type Rng, makeRng } from '../engine/rng.ts';
import { heroOf } from '../engine/state.ts';
import { cloneDeck, makeDeckCard, runPool, applyForge } from './deck.ts';
import { generateAct } from './map.ts';
import {
  addCard,
  attachCardSigil,
  attachOffers,
  drawEvent,
  encounterFor,
  fightSeedFor,
  forgeOffers,
  goldFor,
  grantHeroSigil,
  heroSigilOffer,
  heroSpecFor,
  applyEventEffect,
  healHero,
  restAmount,
  rewardOffer,
  shopStock,
} from './nodes.ts';
import {
  type ActMap,
  type MapNode,
  type NodeRecord,
  type RunAgentChoice,
  type RunChoice,
  type RunClass,
  type RunContent,
  type RunLog,
  type RunState,
  type UnlockSet,
  RUN_LOG_FORMAT,
} from './types.ts';
import { canonicalUnlockSet, parseUnlockSet, unlockedContent } from './unlocks.ts';

/** The stream name the run's own generator is derived on. */
export const RUN_STREAM = 'run';

/**
 * The one class a content with no class list offers, made of its own hero,
 * deck and pool. It is the class every run was before classes existed, which
 * is what lets a log written then replay unchanged: `replayRun` reads a
 * missing `classId` as `defaultClassId(content)`, and for the shipped content
 * that is this one.
 */
export const DEFAULT_CLASS_ID = 'knight';

/**
 * The class `content` starts as when none is named: the first it lists, or
 * `DEFAULT_CLASS_ID` for a content that lists none.
 *
 * First-listed is what makes `contentForClass` self-describing. A content
 * derived for one class lists that class alone and so starts as it, and
 * nothing that takes a content - `runRun`, `checkRuns`, `calibrateEncounters`
 * - has to be told a class to measure one. It is also what an old log relies
 * on: the shipped content lists the Knight first, and `test/classes.test.ts`
 * holds it there, because a log with no class must replay as the Knight it
 * was.
 */
export function defaultClassId(content: RunContent): string {
  const first = content.classes?.[0];
  return first === undefined ? DEFAULT_CLASS_ID : first.id;
}

/**
 * The class `classId` names on `content`, or the content's default one.
 *
 * A content without a class list has exactly one class, made of its own hero,
 * deck and pool and called `DEFAULT_CLASS_ID`; a fixture with one hero and one
 * deck is such a content. Asking such a content for any other class, or a
 * listed content for a class it does not list, is an error that names the
 * classes it does offer.
 */
export function classOf(content: RunContent, classId: string = defaultClassId(content)): RunClass {
  const classes = content.classes;
  if (classes === undefined || classes.length === 0) {
    if (classId !== DEFAULT_CLASS_ID) {
      throw new Error(
        `run: class "${classId}" is not one this content offers. A content with no class list ` +
          `has one class, "${DEFAULT_CLASS_ID}", made of its own hero, starting deck and pool.`,
      );
    }
    return {
      id: DEFAULT_CLASS_ID,
      name: content.hero.name,
      hero: content.hero,
      startingDeck: content.startingDeck,
      rewards: content.rewards,
    };
  }
  const cls = classes.find((c) => c.id === classId);
  if (cls === undefined) {
    throw new Error(
      `run: class "${classId}" is not one this content offers. A run is started as one of ` +
        `${classes.map((c) => c.id).join(', ')}.`,
    );
  }
  return cls;
}

/**
 * `content` as a run of `classId` plays it: the class's hero, starting deck
 * and pool in the content's own three fields, so nothing inside the loop
 * reads a class, and that class alone in its list, so the derived content
 * starts as it when no class is named. Asking the derived content for another
 * class is refused by name, as for any content that does not list it.
 */
export function contentForClass(content: RunContent, classId: string = defaultClassId(content)): RunContent {
  const cls = classOf(content, classId);
  return {
    ...content,
    hero: cls.hero,
    startingDeck: cls.startingDeck,
    rewards: cls.rewards,
    classes: [cls],
  };
}

/**
 * A run agent. One method per decision the run puts in front of a player, plus
 * the placement policy the fights are played with.
 *
 * Every method returns an index into the options it was handed, so a decision
 * is one integer and a run is a list of integers plus a seed. `reward`,
 * `sigil` and `shop` also accept `-1`, which is "take nothing" - declining is
 * a decision, and a run where you cannot decline has one fewer.
 */
export type RunAgent = RunAgentChoice & {
  readonly placement: PlacementPolicy;
};

/**
 * The one thing `visit` needs that differs between a live run and a replay.
 * Everything else - the offers, the arithmetic, the state transitions - is
 * shared, which is what makes the replay a check rather than a second opinion.
 */
type Driver = {
  choose: RunAgentChoice;
  fight(setup: FightSetup): FightRun;
};

function requirePick(value: number, count: number, what: string, allowSkip: boolean): number {
  const lowest = allowSkip ? -1 : 0;
  if (!Number.isInteger(value) || value < lowest || value >= count) {
    throw new Error(
      `run: ${what} returned ${value}, which is not one of the ${count} option(s) offered` +
        `${allowSkip ? ' (or -1 to decline)' : ''}. Legal values are ${lowest}..${count - 1}.`,
    );
  }
  return value;
}

/**
 * Start a run as `classId`, drafting from what `unlocked` allows.
 *
 * The class decides the hero, the starting deck and the pool, and nothing
 * else: the maps are generated from the seed alone, so two classes on one seed
 * walk the same three acts and fight the same encounters at the same nodes
 * with the same fight seeds. That is what makes two classes on one seed
 * comparable at all.
 *
 * `unlocked` narrows the pool the class hands over, before the class is read
 * out of the content, so nothing inside the loop knows unlocks exist - the
 * same trick classes used on the hero and the deck. `null`, the default, is no
 * unlock layer at all: `unlockedContent` hands the content straight back, so
 * every measurement and every fixture is byte-identical to what it was.
 *
 * The set is fixed here and never moves again. A run cannot widen its own
 * pool mid-run, which is what lets the log record one set for the whole run
 * and lets `replayRun` redraw every shelf from it.
 *
 * It is also **canonicalised** here, and that is the keystone rather than
 * tidiness. `UnlockSet` is a structural type, so a caller may hand over an
 * unsorted or duplicated pair of lists; the digest quotes both lists, and
 * `replayRun` reads its set through `parseUnlockSet`, which sorts and dedupes.
 * A run started from a list in some other order would therefore hash
 * differently from its own replay while being, draw for draw, the same run.
 * This is the one place both paths pass through, so it is where the shape is
 * fixed.
 */
export function startRun(
  content: RunContent,
  seed: number,
  classId: string = defaultClassId(content),
  raw: UnlockSet | null = null,
): RunState {
  const unlocked = canonicalUnlockSet(raw);
  const pooled = unlockedContent(content, unlocked);
  const cls = classOf(pooled, classId);
  const active = contentForClass(pooled, classId);
  const rng: Rng = makeRng(seed, RUN_STREAM);
  const maps: ActMap[] = [];
  for (let a = 0; a < active.acts.length; a++) {
    maps.push(generateAct(rng, a, active.mapShape));
  }

  const deck = active.startingDeck.map((id, i) => makeDeckCard(id, i));

  return {
    seed,
    classId: cls.id,
    unlocked,
    content: active,
    maps,
    act: 0,
    row: -1,
    nodeId: -1,
    hero: { health: active.hero.health, maxHealth: active.hero.health },
    deck,
    nextInstance: deck.length,
    gold: active.startingGold,
    sigils: [],
    result: 'ongoing',
    ending: null,
    nodesVisited: 0,
    fightsFought: 0,
    roundsFought: 0,
    forgesApplied: 0,
    cardsGained: 0,
    rng,
  };
}

export function currentMap(run: RunState): ActMap {
  const map = run.maps[run.act];
  if (map === undefined) {
    throw new Error(
      `run: act index ${run.act} has no map; this run has ${run.maps.length} act(s) and the ` +
        `run should already have ended`,
    );
  }
  return map;
}

/** The nodes reachable from where the run stands. The travel decision. */
export function travelOptions(run: RunState): MapNode[] {
  const map = currentMap(run);
  if (run.row < 0) return map.rows[0]!.map((id) => map.nodes[id]!);
  const here = map.nodes[run.nodeId];
  if (here === undefined) {
    throw new Error(`run: node ${run.nodeId} is not in act ${run.act + 1}'s map`);
  }
  return here.next.map((id) => map.nodes[id]!);
}

/**
 * The fight setup this node produces: deck, hero and sigils as they stand
 * now.
 *
 * A card sigil reaches the fight as a trait on its instance through `runPool`;
 * a hero sigil reaches it as a number on the `HeroSpec` through `heroSpecFor`.
 * Both are seams the engine already had. Nothing goes through the pool's two
 * per-fight numbers, `handSize` and `energyPerTurn`, because `fight.ts` reads
 * those for both sides and a hero sigil that moved one would hand the enemy
 * the same card; `fightSigilProblems` in `src/run/sigils.ts` holds them still,
 * and `npm run verify:run` fails on it. A run holding no sigil hands the fight
 * exactly the setup it did before sigils existed.
 */
export function fightSetupFor(run: RunState, node: MapNode): FightSetup {
  const enc = encounterFor(run, node);
  return {
    seed: fightSeedFor(run, node),
    pool: runPool(run.content.pool, run.deck),
    playerDeck: run.deck.map((d) => d.instanceId),
    enemyDeck: enc.enemyDeck,
    enemyOpening: enc.opening,
    // Hero Health persists across the whole run; the fight is handed the bar as
    // it stands, and whatever is left of it is carried out again below.
    playerHero: heroSpecFor(run),
    enemyHero: enc.enemyHero,
    maxRounds: run.content.maxRounds,
  };
}

/**
 * Resolve one node, whatever kind it is. The single node code path.
 *
 * `choices` is appended to in the order the decisions were asked for, which is
 * the order `replayRun` reads them back in.
 */
function visit(run: RunState, node: MapNode, driver: Driver): NodeRecord {
  const choices: RunChoice[] = [{ kind: 'travel', nodeId: node.id }];
  let fightLog: NodeRecord['fight'] = null;
  let fightSeed: NodeRecord['fightSeed'] = null;
  let fightResult: NodeRecord['fightResult'] = null;
  let fightRounds = 0;

  switch (node.type) {
    case 'fight':
    case 'elite':
    case 'boss': {
      const setup = fightSetupFor(run, node);
      fightSeed = setup.seed;
      const result = driver.fight(setup);
      fightLog = result.log.slice();
      fightResult = result.fight.result;
      fightRounds = result.fight.round;
      run.fightsFought++;
      run.roundsFought += fightRounds;
      run.hero.health = Math.max(0, heroOf(result.fight.state, 'player').health);

      if (result.fight.result !== 'playerWin') {
        run.result = 'dead';
        run.ending = {
          act: run.act,
          row: node.row,
          nodeType: node.type,
          cause: result.fight.result === 'timeout' ? 'timeout' : 'killed',
        };
        break;
      }

      run.gold += goldFor(run, node);

      // A won elite or boss asks about a hero sigil first, and always.
      // `docs/design/game.md`: "boss and event rewards are hero sigils" - this
      // is where relics went. The offer is the node's own draw, and when
      // nothing is left to offer the only legal answer is -1. Asking every
      // time is what keeps a log's shape a function of the map and the fights,
      // which `migrateRunLog` relies on.
      if (node.type === 'elite' || node.type === 'boss') {
        const sigils = heroSigilOffer(run, node);
        const pick = requirePick(driver.choose.sigil(run, sigils), sigils.length, 'sigil', true);
        choices.push({ kind: 'sigil', pick });
        if (pick >= 0) grantHeroSigil(run, sigils[pick]!);
      }

      // Then the shelf: cards, and at an ordinary fight sometimes a card sigil
      // beside them. "Card or sigil?" is one pick, and a sigil pick asks one
      // more question - which deck card it goes on.
      const offer = rewardOffer(run, node);
      const pick = requirePick(driver.choose.reward(run, offer), offer.length, 'reward', true);
      choices.push({ kind: 'reward', pick });
      if (pick >= 0) {
        const chosen = offer[pick]!;
        if (chosen.kind === 'card') {
          addCard(run, chosen.cardId);
        } else {
          const targets = attachOffers(run, chosen.sigil);
          if (targets.length === 0) {
            throw new Error(
              `run: "${chosen.sigil.id}" was on the shelf and no deck card can take it; ` +
                `rewardOffer must only offer a card sigil with somewhere to go`,
            );
          }
          const at = requirePick(
            driver.choose.attach(run, chosen.sigil, targets),
            targets.length,
            'attach',
            false,
          );
          const deckIndex = targets[at]!;
          choices.push({ kind: 'attach', deckIndex });
          attachCardSigil(run, deckIndex, chosen.sigil);
        }
      }
      break;
    }

    case 'rest': {
      healHero(run, restAmount(run));
      break;
    }

    case 'forge': {
      const offers = forgeOffers(run);
      if (offers.length > 0) {
        const idx = requirePick(driver.choose.forge(run, offers), offers.length, 'forge', false);
        const chosen = offers[idx]!;
        applyForge(run.deck, chosen.deckIndex, chosen.mode);
        run.forgesApplied++;
        choices.push({ kind: 'forge', deckIndex: chosen.deckIndex, mode: chosen.mode });
      }
      break;
    }

    case 'shop': {
      const stock = shopStock(run);
      const buy = requirePick(driver.choose.shop(run, stock), stock.length, 'shop', true);
      choices.push({ kind: 'shop', buy });
      if (buy >= 0) {
        const item = stock[buy]!;
        if (item.price > run.gold) {
          throw new Error(
            `run: shop purchase of "${item.cardId}" costs ${item.price} gold and the run holds ` +
              `${run.gold}. An agent must check the price before buying, or return -1 to decline.`,
          );
        }
        run.gold -= item.price;
        addCard(run, item.cardId);
      }
      break;
    }

    case 'event': {
      const def = drawEvent(run);
      if (def.options.length === 0) {
        throw new Error(
          `run: event "${def.id}" offers no options, so there is nothing to decide. Every event ` +
            `in the run content needs at least one option.`,
        );
      }
      const option = requirePick(driver.choose.event(run, def), def.options.length, 'event', false);
      choices.push({ kind: 'event', option });
      for (const effect of def.options[option]!.effects) applyEventEffect(run, effect);
      break;
    }
  }

  return {
    act: run.act,
    nodeId: node.id,
    type: node.type,
    choices,
    fight: fightLog,
    fightSeed,
    fightResult,
    fightRounds,
    heroHealthAfter: run.hero.health,
    goldAfter: run.gold,
    deckSizeAfter: run.deck.length,
  };
}

/** Travel to one node, resolve it, and advance the act if it was the boss. */
function step(run: RunState, driver: Driver): NodeRecord | null {
  if (run.result !== 'ongoing') return null;

  const options = travelOptions(run);
  if (options.length === 0) {
    throw new Error(
      `run: node ${run.nodeId} in act ${run.act + 1} leads nowhere and is not a boss node`,
    );
  }
  const idx = requirePick(driver.choose.travel(run, options), options.length, 'travel', false);
  const node = options[idx]!;

  run.row = node.row;
  run.nodeId = node.id;
  run.nodesVisited++;

  const record = visit(run, node, driver);

  if (run.result === 'ongoing' && node.type === 'boss') {
    run.act++;
    run.row = -1;
    run.nodeId = -1;
    if (run.act >= run.content.acts.length) {
      run.result = 'won';
      run.ending = { act: run.act - 1, row: node.row, nodeType: 'boss', cause: 'won' };
    }
  }

  return record;
}

function liveDriver(agent: RunAgent): Driver {
  return {
    choose: agent,
    fight: (setup) => runFight(setup, agent.placement),
  };
}

/**
 * Run a whole run as `classId`, drafting from `unlocked`, asking `agent` for
 * every decision.
 *
 * The log carries the unlock set it was played with, and carries it only when
 * there was one: a run with no unlock layer writes the log it always wrote.
 */
export function runRun(
  content: RunContent,
  seed: number,
  agent: RunAgent,
  classId: string = defaultClassId(content),
  unlocked: UnlockSet | null = null,
): { run: RunState; log: RunLog } {
  const run = startRun(content, seed, classId, unlocked);
  const nodes: NodeRecord[] = [];
  const driver = liveDriver(agent);
  while (run.result === 'ongoing') {
    const record = step(run, driver);
    if (record === null) break;
    nodes.push(record);
  }
  return {
    run,
    log: {
      seed,
      classId: run.classId,
      ...(run.unlocked === null ? {} : { unlocked: run.unlocked }),
      format: RUN_LOG_FORMAT,
      nodes,
    },
  };
}

/**
 * A stored log, whatever format it was written in, as the format this code
 * replays - or an error naming what is wrong with it.
 *
 * Format 1 is what units 5, 8 and 10 wrote: no `format` field, and no `sigil`
 * choice at a won elite or boss because there was nothing to ask. Everything
 * else it holds still indexes what it indexed: the sigil offers are drawn from
 * node-keyed streams (`nodes.ts`), the card sigil sits after the cards on the
 * shelf, and the hero sigil offer is asked at every won elite or boss. So the
 * whole upgrade is one inserted decline per won elite or boss, after the
 * travel choice, and `test/sigils.test.ts` replays two format 1 logs recorded
 * before sigils existed to the runs they recorded. Read that test's own note
 * before trusting the word "replays": it pins the reward table those logs were
 * recorded against, because a recorded log indexes offers and unit 10 changed
 * the offers. The format is what this function owns; the content is not.
 *
 * `classId` is carried through untouched and is not part of the format. Unit
 * 10 added it to a format 1 log without moving the number, because a log that
 * names no class replays as the content's default class either way; a format 1
 * log may therefore name a class or not, and both upgrade the same.
 *
 * `unlocked` is the opposite and is **refused on a format 1 log**. Unlocks
 * landed in unit 12, with the format already at 2, so a format 1 log naming a
 * set is one no version of this code wrote. The class could be absent
 * harmlessly; a set cannot be present harmlessly, because it narrows the
 * shelves the log's picks index into.
 *
 * A log in the current format comes back as it is. A log in a format this
 * code has never written is refused with both numbers named, because its
 * choices would index shelves drawn some other way and a "successful" replay
 * of it would be a different run wearing its seed.
 */
export function migrateRunLog(raw: unknown): RunLog {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('run log: not a run log - it is not an object');
  }
  const log = raw as { seed?: unknown; classId?: unknown; format?: unknown; nodes?: unknown };
  if (typeof log.seed !== 'number' || !Number.isInteger(log.seed)) {
    throw new Error('run log: not a run log - it has no integer `seed`');
  }
  if (!Array.isArray(log.nodes)) {
    throw new Error(`run log: not a run log - seed ${log.seed} has no \`nodes\` list`);
  }
  const nodes = log.nodes as NodeRecord[];
  const named = typeof log.classId === 'string' ? { classId: log.classId } : {};
  // Carried through untouched, like the class, and read strictly: a set that
  // cannot be parsed is refused by name rather than dropped, because dropping
  // it would replay the log against a wider pool and reach a different run.
  const set = parseUnlockSet(
    (raw as { unlocked?: unknown }).unlocked,
    `the log for seed ${log.seed}`,
  );
  const drafted = set === null ? {} : { unlocked: set };
  const format = log.format ?? 1;
  if (format === RUN_LOG_FORMAT) {
    return { seed: log.seed, ...named, ...drafted, format: RUN_LOG_FORMAT, nodes };
  }
  if (format !== 1) {
    throw new Error(
      `run log: written in format ${String(format)}, and this code reads formats 1 and ` +
        `${RUN_LOG_FORMAT}. Its choices index shelves that are drawn some other way, so it cannot ` +
        `be replayed; start a new run on seed ${log.seed}.`,
    );
  }
  // A format 1 log naming an unlock set is a log no version of this code ever
  // wrote: format 1 is units 5, 8 and 10, and unlocks landed in unit 12 with
  // the format already at 2. Refused rather than upgraded, because the one
  // thing such a field can be is a hand-edited or forged set, and honouring it
  // would narrow shelves the recorded picks were never taken from.
  if (set !== null) {
    throw new Error(
      `run log: the format 1 log for seed ${log.seed} names an unlock set ` +
        `(gated ${set.gated.length}, owned ${set.owned.length}), and no version of this code ` +
        `ever wrote one - format 1 predates unlocks, and every log written since is format ` +
        `${RUN_LOG_FORMAT}. Its picks index shelves drawn with nothing gated, so honouring the ` +
        `set would replay a different run. Drop the \`unlocked\` field, or mark the log format ` +
        `${RUN_LOG_FORMAT} if that is what wrote it.`,
    );
  }
  const decline: RunChoice = { kind: 'sigil', pick: -1 };
  const upgraded = nodes.map((n) => {
    const asked = (n.type === 'elite' || n.type === 'boss') && n.fightResult === 'playerWin';
    if (!asked) return n;
    const [travel, ...rest] = n.choices;
    if (travel === undefined || travel.kind !== 'travel') {
      throw new Error(
        `run log: node ${n.nodeId} in act ${n.act + 1} does not begin with a travel choice, so it ` +
          `is not a format 1 record and cannot be upgraded`,
      );
    }
    return { ...n, choices: [travel, decline, ...rest] };
  });
  return { seed: log.seed, ...named, ...drafted, format: RUN_LOG_FORMAT, nodes: upgraded };
}

/**
 * Replay a recorded run from seed plus its choice list alone, with no agent in
 * the loop. This is the run's half of the determinism invariant, executable.
 *
 * Nothing derived is read back from the log: the maps are regenerated, every
 * offer is recomputed from the run stream, and each fight is replayed from its
 * own action list. Only the choices come from the record, and a choice whose
 * kind does not match what the node asks for is an error rather than a
 * silently ignored entry - a replay that skipped a decision would otherwise
 * diverge quietly, which is the exact failure the invariant exists to forbid.
 *
 * The class is the one thing read from the log before the first node, and a
 * log with no `classId` - one written before classes existed - is the
 * content's default class, which for the shipped content is the Knight: the
 * only class such a run could have been.
 *
 * **The unlock set is the second, and it is read from the log and from nowhere
 * else.** Not from the player's profile, not from a module-level default: a
 * reward pick in the log is an index into a shelf, and a shelf redrawn from a
 * pool the run never had makes that index name a card the player never saw.
 * A log naming no set was played with no unlock layer - nothing gated - which
 * is the only thing such a run could have been, and is what every log written
 * before unlocks existed is.
 */
export function replayRun(content: RunContent, log: RunLog): RunState {
  // Only the current format is replayed. A log from an earlier one is not
  // wrong, it is unupgraded: `migrateRunLog` is the one path that reads it,
  // and refusing it here is what keeps a stale log from being replayed as if
  // it were current by a caller that forgot to upgrade it.
  const format = (log as { format?: unknown }).format ?? 1;
  if (format !== RUN_LOG_FORMAT) {
    throw new Error(
      `run replay: this log was written in format ${String(format)} and this code replays ` +
        `format ${RUN_LOG_FORMAT}. Upgrade it with migrateRunLog first; a log it refuses cannot ` +
        `be resumed, so start a new run on seed ${log.seed}.`,
    );
  }
  const run = startRun(
    content,
    log.seed,
    log.classId ?? defaultClassId(content),
    parseUnlockSet(log.unlocked, `the log for seed ${log.seed}`),
  );

  for (const record of log.nodes) {
    if (run.result !== 'ongoing') break;
    let cursor = 0;
    const take = <K extends RunChoice['kind']>(kind: K): Extract<RunChoice, { kind: K }> => {
      const choice = record.choices[cursor];
      cursor++;
      if (choice === undefined || choice.kind !== kind) {
        throw new Error(
          `run replay: node ${record.nodeId} in act ${record.act + 1} asked for a "${kind}" ` +
            `choice at position ${cursor - 1}, and the log holds ` +
            `${choice === undefined ? 'nothing' : `"${choice.kind}"`}. The recorded choice list ` +
            `does not match the decisions this node offers.`,
        );
      }
      return choice as Extract<RunChoice, { kind: K }>;
    };

    const driver: Driver = {
      choose: {
        travel: (_run, options) => {
          const wanted = take('travel').nodeId;
          const at = options.findIndex((o) => o.id === wanted);
          if (at < 0) {
            throw new Error(
              `run replay: the log travels to node ${wanted}, which is not reachable from ` +
                `here; the options are [${options.map((o) => o.id).join(', ')}]. The map did ` +
                `not regenerate identically.`,
            );
          }
          return at;
        },
        sigil: () => take('sigil').pick,
        reward: () => take('reward').pick,
        attach: (_run, sigil, targets) => {
          const wanted = take('attach').deckIndex;
          const at = targets.indexOf(wanted);
          if (at < 0) {
            throw new Error(
              `run replay: the log attaches "${sigil.id}" to deck index ${wanted}, which is not ` +
                `one of the cards that can take ${sigil.trait} now [${targets.join(', ')}]. ` +
                `The deck did not regenerate identically.`,
            );
          }
          return at;
        },
        forge: (_run, offers) => {
          const wanted = take('forge');
          const at = offers.findIndex(
            (o) => o.deckIndex === wanted.deckIndex && o.mode === wanted.mode,
          );
          if (at < 0) {
            throw new Error(
              `run replay: the log forges deck index ${wanted.deckIndex} (${wanted.mode}), ` +
                `which this forge does not offer; the deck holds ${offers.length / 3} card(s).`,
            );
          }
          return at;
        },
        shop: () => take('shop').buy,
        event: () => take('event').option,
      },
      fight: (setup) => {
        const recorded = record.fight;
        if (recorded === null) {
          throw new Error(
            `run replay: node ${record.nodeId} in act ${record.act + 1} fights, and the log ` +
              `holds no fight action list for it.`,
          );
        }
        return { fight: replayFight(setup, recorded), log: recorded.slice() };
      },
    };

    step(run, driver);
  }

  return run;
}

/** The run's choices, flattened in the order they were made. */
export function runChoices(log: RunLog): RunChoice[] {
  const out: RunChoice[] = [];
  for (const node of log.nodes) for (const c of node.choices) out.push(c);
  return out;
}

export function cloneRunState(run: RunState): RunState {
  return {
    ...run,
    maps: run.maps,
    hero: { health: run.hero.health, maxHealth: run.hero.maxHealth },
    deck: cloneDeck(run.deck),
    sigils: run.sigils.slice(),
    ending: run.ending === null ? null : { ...run.ending },
    rng: { s: run.rng.s, n: run.rng.n },
  };
}
