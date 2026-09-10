/**
 * The run, driven by a person.
 *
 * `src/run/run.ts` is a synchronous loop. `runRun` asks an agent for every
 * decision and plays every fight itself through `runFight`, which picks the
 * cards with the bot's `selectPlays`. A person decides on a different clock and
 * picks their own cards, so neither `runRun` nor its agent seam can carry a
 * hand-played run: there is no way to hand a fight the player fought into a
 * loop that insists on fighting it.
 *
 * What can carry it is `replayRun`. It takes a seed and a list of node records
 * - each one holding that node's choices and, for a fight, the fight's own
 * action list - recomputes every offer from the run stream, and applies the
 * recorded choice. So this controller keeps exactly that list. **The run's
 * canonical state is `replayRun(content, log)` and nothing else.** Every choice
 * the player makes is appended as the `RunChoice` the replay reads back, the
 * log is re-replayed from the seed, and the result is the state the screen
 * shows. The log a hand-played run leaves behind is therefore byte-for-byte
 * the shape `npm run verify:run` checks, and there is no second way to advance
 * the run for it to disagree with.
 *
 * The one thing replay cannot do is show an offer *before* the choice is made,
 * because it needs the choice to complete the record. So an offer is
 * **previewed**: the canonical state is cloned and the same `nodes.ts` function
 * `visit` will call is called on the clone, at the point in the node where
 * `visit` calls it. That duplicates one fact per node type - which draw comes
 * when - and the duplication is gated rather than trusted, two ways:
 *
 *   - `test/ui-run.test.ts` drives this controller with the decisions a bot
 *     made inside `runRun`, requires every previewed offer to equal the offer
 *     `runRun` handed the bot, and requires the two final run hashes to agree.
 *   - After every commit the controller checks the replayed state against what
 *     the preview promised - the hero's Health, the gold, the card that joined
 *     the deck - and throws, naming both numbers, if they differ. A preview
 *     that lied is a screen that showed the player a choice they did not get,
 *     and that has to be loud.
 *
 * Nothing here writes to `src/run/`, and no `src/run/` export is reached
 * around: the offers come from `nodes.ts`, the setup from `fightSetupFor`, the
 * options from `travelOptions`, and the state from `replayRun`.
 */

import type { Fight, FightSetup, RoundRecord } from '../engine/fight.ts';
import { heroOf } from '../engine/state.ts';
import { hashRun } from '../run/hash.ts';
import {
  drawEvent,
  encounterFor,
  forgeOffers,
  goldFor,
  rewardOffer,
  restAmount,
  shopStock,
} from '../run/nodes.ts';
import { cloneRunState, fightSetupFor, replayRun, travelOptions } from '../run/run.ts';
import {
  FORGE_MODES,
  type DeckCard,
  type ForgeMode,
  type ForgeOffer,
  type MapNode,
  type NodeRecord,
  type RunChoice,
  type RunContent,
  type RunEncounter,
  type RunEventDef,
  type RunLog,
  type RunState,
  type ShopItem,
} from '../run/types.ts';

/** A fight the screen finished: the engine's final state and its action list. */
export type FightOutcome = {
  readonly fight: Fight;
  readonly rounds: readonly RoundRecord[];
};

/** The run's numbers at one moment, for a before/after the screens can show. */
export type RunSnapshot = {
  readonly health: number;
  readonly maxHealth: number;
  readonly gold: number;
  readonly deckSize: number;
};

/**
 * What the run is waiting on. Exactly one of these at a time, and the method
 * that answers it is the only one the controller accepts.
 */
export type RunPhase =
  /** Between nodes: `travel` to one of `travelOptions(state)`. */
  | { readonly kind: 'travel' }
  /** A fight is on screen: `finishFight` when it ends. */
  | {
      readonly kind: 'fight';
      readonly node: MapNode;
      readonly setup: FightSetup;
      readonly encounter: RunEncounter;
    }
  /** The fight was won: `pickReward`, or -1 to take nothing. */
  | {
      readonly kind: 'reward';
      readonly node: MapNode;
      readonly encounter: RunEncounter;
      readonly outcome: FightOutcome;
      readonly offer: readonly string[];
      /** What replay will set the hero to. Read off the finished fight. */
      readonly healthAfter: number;
      /** What replay will set gold to: the run's gold plus this node's pay. */
      readonly goldAfter: number;
    }
  /** A forge: `forge(deckIndex, mode)`. */
  | { readonly kind: 'forge'; readonly node: MapNode; readonly offers: readonly ForgeOffer[] }
  /** A shop: `buy(index)`, or -1 to leave. */
  | { readonly kind: 'shop'; readonly node: MapNode; readonly stock: readonly ShopItem[] }
  /** An event: `chooseEvent(option)`. */
  | { readonly kind: 'event'; readonly node: MapNode; readonly def: RunEventDef }
  /** The run has ended. `state.ending` says how. */
  | { readonly kind: 'over' };

/** Everything the last completed node did, for the screen that reports it. */
export type NodeOutcome = {
  readonly node: MapNode;
  /** The act the node was in. `state.act` may already be the next one. */
  readonly act: number;
  readonly before: RunSnapshot;
  readonly after: RunSnapshot;
  /** Cards that joined the deck at this node, in the order they joined. */
  readonly gained: readonly DeckCard[];
  readonly forged: { readonly card: DeckCard; readonly mode: ForgeMode } | null;
  readonly bought: { readonly item: ShopItem } | null;
  readonly event: { readonly def: RunEventDef; readonly option: number } | null;
  readonly fight: { readonly encounter: RunEncounter; readonly outcome: FightOutcome } | null;
  /** True when this node was a boss and the hero survived it. */
  readonly actCleared: boolean;
};

export type RunController = {
  readonly content: RunContent;
  readonly seed: number;
  /** The canonical state: `replayRun(content, log)`. Read it, never write it. */
  readonly state: RunState;
  /** The log so far. Complete records only; the node in progress is not in it. */
  readonly log: RunLog;
  readonly phase: RunPhase;
  /** The last node completed, or null before the first. */
  readonly last: NodeOutcome | null;
  travel(nodeId: number): void;
  finishFight(outcome: FightOutcome): void;
  pickReward(pick: number): void;
  forge(deckIndex: number, mode: ForgeMode): void;
  buy(index: number): void;
  chooseEvent(option: number): void;
  /** `hashRun` of the canonical state. What a replay elsewhere must reproduce. */
  hash(): string;
};

function snapshotOf(run: RunState): RunSnapshot {
  return {
    health: run.hero.health,
    maxHealth: run.hero.maxHealth,
    gold: run.gold,
    deckSize: run.deck.length,
  };
}

function describe(phase: RunPhase): string {
  switch (phase.kind) {
    case 'travel':
      return 'the run is waiting for a node to travel to';
    case 'fight':
      return `a ${phase.node.type} is being fought`;
    case 'reward':
      return 'a fight reward is waiting to be picked';
    case 'forge':
      return 'a forge is waiting for a card and an upgrade';
    case 'shop':
      return 'a shop is waiting for a purchase or a leave';
    case 'event':
      return `the event "${phase.def.name}" is waiting for an option`;
    case 'over':
      return 'the run is over';
  }
}

function requireIndex(value: number, count: number, what: string, allowSkip: boolean): void {
  const lowest = allowSkip ? -1 : 0;
  if (!Number.isInteger(value) || value < lowest || value >= count) {
    throw new Error(
      `run: ${what} ${value} is not one of the ${count} option(s) on offer` +
        `${allowSkip ? ' (or -1 to decline)' : ''}. Legal values are ${lowest}..${count - 1}.`,
    );
  }
}

/** A promise the preview made that the replay then broke. Always a bug. */
function diverged(what: string, promised: unknown, replayed: unknown): Error {
  return new Error(
    `run: the screen showed ${what} as ${String(promised)} and the replay produced ${String(replayed)}. ` +
      'The preview in src/ui/run.ts no longer computes what src/run/run.ts visit() computes; ' +
      'the node choices were recorded but the run state on screen cannot be trusted.',
  );
}

/**
 * Start a run, or resume one from its log.
 *
 * A resumed run is replayed from the seed through the same `replayRun` a
 * fresh one starts with, so a saved run is nothing but its choice list. What
 * a log cannot hold is the node in progress - a fight half fought is not in
 * it - so a resumed run stands on its last completed node, between nodes.
 * A log whose seed is not `seed`, or that does not replay, is refused with the
 * reason rather than half-applied.
 */
export function createRunController(content: RunContent, seed: number, resume?: RunLog): RunController {
  const nodes: NodeRecord[] = [];
  if (resume !== undefined) {
    if (resume.seed !== seed) {
      throw new Error(
        `run: cannot resume a run seeded ${resume.seed} as seed ${seed}. A log replays only on its own seed.`,
      );
    }
    for (const record of resume.nodes) nodes.push(record);
  }
  // The one path. Even the empty log goes through it, so the starting state is
  // the replay of nothing rather than a second construction of the same thing.
  let state: RunState = replayRun(content, { seed, nodes });
  let phase: RunPhase = state.result === 'ongoing' ? { kind: 'travel' } : { kind: 'over' };
  let last: NodeOutcome | null = null;

  function requirePhase<K extends RunPhase['kind']>(
    kind: K,
    action: string,
  ): Extract<RunPhase, { kind: K }> {
    if (phase.kind !== kind) {
      throw new Error(
        `run: cannot ${action} now - ${describe(phase)}. Answer that first.`,
      );
    }
    return phase as Extract<RunPhase, { kind: K }>;
  }

  /**
   * Append one node's record and re-derive the state from the seed.
   *
   * `provisional` carries the choices and the fight log, which are all replay
   * reads. The record that is kept is rebuilt afterwards with the replayed
   * numbers - Health, gold, deck size - so the log never claims something the
   * replay did not do.
   */
  function commit(
    provisional: NodeRecord,
    detail: Omit<NodeOutcome, 'node' | 'act' | 'before' | 'after' | 'gained' | 'actCleared'>,
    verify: (next: RunState) => void,
  ): void {
    const before = snapshotOf(state);
    const node = provisional;
    const next = replayRun(content, { seed, nodes: [...nodes, provisional] });
    verify(next);

    const record: NodeRecord = {
      ...provisional,
      heroHealthAfter: next.hero.health,
      goldAfter: next.gold,
      deckSizeAfter: next.deck.length,
    };
    nodes.push(record);

    const mapNode = state.maps[node.act]!.nodes[node.nodeId]!;
    last = {
      node: mapNode,
      act: node.act,
      before,
      after: snapshotOf(next),
      gained: next.deck.slice(state.deck.length),
      actCleared: mapNode.type === 'boss' && next.result !== 'dead',
      ...detail,
    };
    state = next;
    phase = next.result === 'ongoing' ? { kind: 'travel' } : { kind: 'over' };
  }

  function baseRecord(node: MapNode, choices: RunChoice[]): NodeRecord {
    return {
      act: state.act,
      nodeId: node.id,
      type: node.type,
      choices,
      fight: null,
      fightSeed: null,
      fightResult: null,
      fightRounds: 0,
      heroHealthAfter: state.hero.health,
      goldAfter: state.gold,
      deckSizeAfter: state.deck.length,
    };
  }

  const noDetail = { forged: null, bought: null, event: null, fight: null } as const;

  function travel(nodeId: number): void {
    requirePhase('travel', 'travel');
    const options = travelOptions(state);
    const node = options.find((o) => o.id === nodeId);
    if (node === undefined) {
      throw new Error(
        `run: node ${nodeId} is not reachable from here. The map offers ` +
          `[${options.map((o) => `${o.id} (${o.type})`).join(', ')}].`,
      );
    }
    const travelChoice: RunChoice = { kind: 'travel', nodeId: node.id };

    switch (node.type) {
      case 'fight':
      case 'elite':
      case 'boss': {
        phase = {
          kind: 'fight',
          node,
          setup: fightSetupFor(state, node),
          encounter: encounterFor(state, node),
        };
        return;
      }
      case 'rest': {
        // No choice at a rest. `visit` heals and moves on; so does this.
        const healed = Math.min(state.hero.maxHealth, state.hero.health + restAmount(state));
        commit(baseRecord(node, [travelChoice]), noDetail, (next) => {
          if (next.hero.health !== healed) throw diverged('Health after resting', healed, next.hero.health);
        });
        return;
      }
      case 'forge': {
        // Pure over the deck: no draw, so no clone. An empty deck offers nothing
        // and `visit` asks nothing; the node still counts as visited.
        const offers = forgeOffers(state);
        if (offers.length === 0) {
          commit(baseRecord(node, [travelChoice]), noDetail, () => undefined);
          return;
        }
        phase = { kind: 'forge', node, offers };
        return;
      }
      case 'shop': {
        // `visit` draws the shelf as the node's first act, from the run stream
        // as it stands. The clone stands exactly there.
        phase = { kind: 'shop', node, stock: shopStock(cloneRunState(state)) };
        return;
      }
      case 'event': {
        phase = { kind: 'event', node, def: drawEvent(cloneRunState(state)) };
        return;
      }
    }
  }

  function finishFight(outcome: FightOutcome): void {
    const p = requirePhase('fight', 'finish a fight');
    const { fight, rounds } = outcome;
    if (fight.seed !== p.setup.seed) {
      throw new Error(
        `run: the fight handed back was seeded ${fight.seed} and this node's fight is seeded ` +
          `${p.setup.seed}. A node completes only with its own fight.`,
      );
    }
    if (fight.result === 'ongoing') {
      throw new Error(
        'run: the fight handed back is still ongoing. A node completes only once a hero has ' +
          'fallen or the round cap has run out.',
      );
    }
    const travelChoice: RunChoice = { kind: 'travel', nodeId: p.node.id };
    const fightRecord = (choices: RunChoice[]): NodeRecord => ({
      ...baseRecord(p.node, choices),
      fight: rounds.slice(),
      fightSeed: p.setup.seed,
      fightResult: fight.result,
      fightRounds: fight.round,
    });
    const detail = { ...noDetail, fight: { encounter: p.encounter, outcome } };

    if (fight.result !== 'playerWin') {
      commit(fightRecord([travelChoice]), detail, (next) => {
        if (next.result !== 'dead') {
          throw diverged('the fight', `a loss (${fight.result})`, `a run that is ${next.result}`);
        }
      });
      return;
    }

    // `visit` on a win: Health carried out, gold paid, then the reward drawn.
    // Neither the Health nor the gold touches the run stream, so the clone at
    // the node's start is at the offer's position.
    const healthAfter = Math.max(0, heroOf(fight.state, 'player').health);
    const goldAfter = state.gold + goldFor(state, p.node);
    phase = {
      kind: 'reward',
      node: p.node,
      encounter: p.encounter,
      outcome,
      offer: rewardOffer(cloneRunState(state)),
      healthAfter,
      goldAfter,
    };
  }

  function pickReward(pick: number): void {
    const p = requirePhase('reward', 'pick a reward');
    requireIndex(pick, p.offer.length, 'reward pick', true);
    const wanted = pick >= 0 ? p.offer[pick]! : null;
    const record: NodeRecord = {
      ...baseRecord(p.node, [
        { kind: 'travel', nodeId: p.node.id },
        { kind: 'reward', pick },
      ]),
      fight: p.outcome.rounds.slice(),
      fightSeed: p.outcome.fight.seed,
      fightResult: p.outcome.fight.result,
      fightRounds: p.outcome.fight.round,
    };
    const deckBefore = state.deck.length;
    commit(record, { ...noDetail, fight: { encounter: p.encounter, outcome: p.outcome } }, (next) => {
      if (next.result === 'dead') throw diverged('the fight', 'a win', 'a run that is dead');
      if (next.hero.health !== p.healthAfter) {
        throw diverged('Health after the fight', p.healthAfter, next.hero.health);
      }
      if (next.gold !== p.goldAfter) throw diverged('gold after the fight', p.goldAfter, next.gold);
      const joined = next.deck.slice(deckBefore).map((d) => d.cardId);
      const expected = wanted === null ? [] : [wanted];
      if (joined.join(',') !== expected.join(',')) {
        throw diverged('the card taken', expected.join(',') || 'nothing', joined.join(',') || 'nothing');
      }
    });
  }

  function forge(deckIndex: number, mode: ForgeMode): void {
    const p = requirePhase('forge', 'forge');
    if (!FORGE_MODES.includes(mode)) {
      throw new Error(
        `run: "${String(mode)}" is not a forge mode. The forge offers ${FORGE_MODES.join(', ')}.`,
      );
    }
    const at = p.offers.findIndex((o) => o.deckIndex === deckIndex && o.mode === mode);
    if (at < 0) {
      throw new Error(
        `run: the forge cannot apply ${mode} to deck index ${deckIndex}; the deck holds ` +
          `${state.deck.length} card(s) and accepts 0..${state.deck.length - 1}.`,
      );
    }
    const before = state.deck[deckIndex]!;
    const record = baseRecord(p.node, [
      { kind: 'travel', nodeId: p.node.id },
      { kind: 'forge', deckIndex, mode },
    ]);
    commit(record, { ...noDetail, forged: { card: before, mode } }, (next) => {
      const after = next.deck[deckIndex];
      if (after === undefined || after.instanceId !== before.instanceId) {
        throw diverged('the forged card', before.instanceId, after?.instanceId ?? 'nothing');
      }
      const moved =
        after.powerBonus - before.powerBonus + (after.healthBonus - before.healthBonus) +
        (before.costDelta - after.costDelta);
      if (moved !== 1) throw diverged(`the ${mode} forge on ${before.instanceId}`, '+1', `${moved}`);
    });
  }

  function buy(index: number): void {
    const p = requirePhase('shop', 'buy');
    requireIndex(index, p.stock.length, 'shop item', true);
    const item = index >= 0 ? p.stock[index]! : null;
    if (item !== null && item.price > state.gold) {
      throw new Error(
        `run: "${item.cardId}" costs ${item.price} gold and the run holds ${state.gold}. ` +
          'Buy something cheaper, or leave with -1.',
      );
    }
    const record = baseRecord(p.node, [
      { kind: 'travel', nodeId: p.node.id },
      { kind: 'shop', buy: index },
    ]);
    const goldBefore = state.gold;
    const deckBefore = state.deck.length;
    commit(record, { ...noDetail, bought: item === null ? null : { item } }, (next) => {
      const spent = goldBefore - next.gold;
      if (spent !== (item?.price ?? 0)) throw diverged('gold spent', item?.price ?? 0, spent);
      const joined = next.deck.slice(deckBefore).map((d) => d.cardId).join(',');
      if (joined !== (item?.cardId ?? '')) {
        throw diverged('the card bought', item?.cardId ?? 'nothing', joined || 'nothing');
      }
    });
  }

  function chooseEvent(option: number): void {
    const p = requirePhase('event', 'choose an event option');
    requireIndex(option, p.def.options.length, 'event option', false);
    const record = baseRecord(p.node, [
      { kind: 'travel', nodeId: p.node.id },
      { kind: 'event', option },
    ]);
    // What an option does is applied by the replay alone; the screen reports
    // the before/after it produced rather than predicting it. Damage outside a
    // fight floors at 1 in `nodes.ts`, and a run cannot end here.
    commit(record, { ...noDetail, event: { def: p.def, option } }, (next) => {
      if (next.result !== 'ongoing') {
        throw diverged('the run after an event', 'ongoing', next.result);
      }
    });
  }

  return {
    content,
    seed,
    get state() {
      return state;
    },
    get log(): RunLog {
      return { seed, nodes: nodes.slice() };
    },
    get phase() {
      return phase;
    },
    get last() {
      return last;
    },
    travel,
    finishFight,
    pickReward,
    forge,
    buy,
    chooseEvent,
    hash: () => hashRun(state),
  };
}
