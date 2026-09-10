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
  handSizeFor,
  heroRules,
  heroSigilOffer,
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
  type RunContent,
  type RunLog,
  type RunState,
  RUN_LOG_FORMAT,
} from './types.ts';

/** The stream name the run's own generator is derived on. */
export const RUN_STREAM = 'run';

/**
 * A run agent. One method per decision the run puts in front of a player, plus
 * the placement policy the fights are played with.
 *
 * Every method returns an index into the options it was handed, so a decision
 * is one integer and a run is a list of integers plus a seed. `reward` and
 * `shop` also accept `-1`, which is "take nothing" - declining is a decision,
 * and a run where you cannot decline has one fewer.
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

export function startRun(content: RunContent, seed: number): RunState {
  const rng: Rng = makeRng(seed, RUN_STREAM);
  const maps: ActMap[] = [];
  for (let a = 0; a < content.acts.length; a++) {
    maps.push(generateAct(rng, a, content.mapShape));
  }

  const deck = content.startingDeck.map((id, i) => makeDeckCard(id, i));

  return {
    seed,
    content,
    maps,
    act: 0,
    row: -1,
    nodeId: -1,
    hero: { health: content.hero.health, maxHealth: content.hero.health },
    deck,
    nextInstance: deck.length,
    gold: content.startingGold,
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
 * The fight setup this node produces: deck, hero Health and hero sigils as
 * they stand now.
 *
 * Hero sigils reach the fight through two seams the engine already had. The
 * rule amounts go on the hero's `SideRules`, so a Relay on the player's line
 * hands what the run's sigils say and the enemy's hand the default. The hand
 * size goes on the pool, which is where the engine reads it from anyway. A
 * run holding no hero sigil hands the fight exactly the setup it did before
 * sigils existed: no `rules` key, the pool's own hand size.
 */
export function fightSetupFor(run: RunState, node: MapNode): FightSetup {
  const enc = encounterFor(run, node);
  const pool = runPool(run.content.pool, run.deck);
  const handSize = handSizeFor(run);
  const rules = heroRules(run);
  const bent = rules.relayPower !== undefined || rules.wakePower !== undefined;
  return {
    seed: fightSeedFor(run, node),
    pool: handSize === pool.handSize ? pool : { ...pool, handSize },
    playerDeck: run.deck.map((d) => d.instanceId),
    enemyDeck: enc.enemyDeck,
    enemyOpening: enc.opening,
    // Hero Health persists across the whole run; the fight is handed the bar as
    // it stands, and whatever is left of it is carried out again below.
    playerHero: { ...run.content.hero, health: run.hero.health, ...(bent ? { rules } : {}) },
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

      // A won elite or boss offers a hero sigil first. `docs/design/game.md`:
      // "boss and event rewards are hero sigils" - this is where relics went.
      // The offer draws from the run stream before the card shelf does, so the
      // shelf a replay recomputes is the shelf the player saw, in that order.
      // Nothing on offer - every hero sigil already held, or a content set with
      // none - asks no choice, the way an empty deck asks no forge.
      if (node.type === 'elite' || node.type === 'boss') {
        const sigils = heroSigilOffer(run);
        if (sigils.length > 0) {
          const pick = requirePick(driver.choose.sigil(run, sigils), sigils.length, 'sigil', true);
          choices.push({ kind: 'sigil', pick });
          if (pick >= 0) grantHeroSigil(run, sigils[pick]!);
        }
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

/** Run a whole run, asking `agent` for every decision. */
export function runRun(
  content: RunContent,
  seed: number,
  agent: RunAgent,
): { run: RunState; log: RunLog } {
  const run = startRun(content, seed);
  const nodes: NodeRecord[] = [];
  const driver = liveDriver(agent);
  while (run.result === 'ongoing') {
    const record = step(run, driver);
    if (record === null) break;
    nodes.push(record);
  }
  return { run, log: { seed, format: RUN_LOG_FORMAT, nodes } };
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
 */
export function replayRun(content: RunContent, log: RunLog): RunState {
  // A log from another format is refused before a single node is replayed. Its
  // choices are indices into shelves this code no longer draws in the same
  // order, so replaying it would not fail - it would quietly produce a
  // different run under the same seed. `RUN_LOG_FORMAT` says what changed.
  const format = (log as { format?: unknown }).format ?? 1;
  if (format !== RUN_LOG_FORMAT) {
    throw new Error(
      `run replay: this log was written in format ${String(format)} and this code replays ` +
        `format ${RUN_LOG_FORMAT}. The choices in it index shelves that are drawn differently ` +
        `now, so it cannot be resumed; start a new run on seed ${log.seed}.`,
    );
  }
  const run = startRun(content, log.seed);

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
