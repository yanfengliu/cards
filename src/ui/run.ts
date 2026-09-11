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
 *     the deck, the sigils granted - and throws, naming both numbers, if they
 *     differ. A preview that lied is a screen that showed the player a choice
 *     they did not get, and that has to be loud.
 *
 * A won fight is the one node with more than one decision in it, and the
 * order is `visit`'s: a hero sigil offer at an elite or boss, then the shelf,
 * then - when the shelf pick was a card sigil - the card it goes on. The
 * clone that previews the first offer is kept as a cursor through the node,
 * so each later offer is drawn from the run stream exactly where `visit`
 * draws it, and the grant a hero sigil makes to the cursor is the grant the
 * replay makes to the state.
 *
 * Nothing here writes to `src/run/`, and no `src/run/` export is reached
 * around: the offers come from `nodes.ts`, the setup from `fightSetupFor`, the
 * options from `travelOptions`, and the state from `replayRun`.
 */

import type { Fight, FightSetup, RoundRecord } from '../engine/fight.ts';
import { heroOf } from '../engine/state.ts';
import { hashRun } from '../run/hash.ts';
import {
  attachCardSigil,
  attachOffers,
  drawEvent,
  encounterFor,
  forgeOffers,
  goldFor,
  grantHeroSigil,
  heroSigilOffer,
  rewardOffer,
  restAmount,
  shopStock,
} from '../run/nodes.ts';
import {
  classOf,
  cloneRunState,
  defaultClassId,
  fightSetupFor,
  replayRun,
  travelOptions,
} from '../run/run.ts';
import {
  FORGE_MODES,
  RUN_LOG_FORMAT,
  type CardSigilDef,
  type DeckCard,
  type ForgeMode,
  type ForgeOffer,
  type HeroSigilDef,
  type MapNode,
  type NodeRecord,
  type RewardOption,
  type RunChoice,
  type RunContent,
  type RunEncounter,
  type RunEventDef,
  type RunLog,
  type RunState,
  type ShopItem,
  type SigilGrant,
  type UnlockSet,
} from '../run/types.ts';
import { canonicalUnlockSet, parseUnlockSet, stillLocked } from '../run/unlocks.ts';

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

/** What a won fight has already settled by the time its shelves are shown. */
type WonNumbers = {
  /** What replay will set the hero to. Read off the finished fight, then off any hero sigil. */
  readonly healthAfter: number;
  readonly maxHealthAfter: number;
  /** What replay will set gold to: the run's gold plus this node's pay. */
  readonly goldAfter: number;
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
  /** A won elite or boss: `pickSigil`, or -1 to take none. */
  | ({
      readonly kind: 'sigil';
      readonly node: MapNode;
      readonly encounter: RunEncounter;
      readonly outcome: FightOutcome;
      readonly offer: readonly HeroSigilDef[];
    } & WonNumbers)
  /** The fight was won: `pickReward`, or -1 to take nothing. */
  | ({
      readonly kind: 'reward';
      readonly node: MapNode;
      readonly encounter: RunEncounter;
      readonly outcome: FightOutcome;
      readonly offer: readonly RewardOption[];
    } & WonNumbers)
  /** A card sigil was picked: `attach(deckIndex)`, one of `offers`. */
  | ({
      readonly kind: 'attach';
      readonly node: MapNode;
      readonly encounter: RunEncounter;
      readonly outcome: FightOutcome;
      readonly sigil: CardSigilDef;
      /** Deck indices that can take the sigil, in deck order. */
      readonly offers: readonly number[];
    } & WonNumbers)
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
  /** Sigils granted at this node, hero and card, in the order they were granted. */
  readonly sigils: readonly SigilGrant[];
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
  /** The class the run was started as. Fixed for the life of the run. */
  readonly classId: string;
  /**
   * What this run may draft, or null for no unlock layer. Fixed for the life
   * of the run and written into every log this controller hands out.
   */
  readonly unlocked: UnlockSet | null;
  /** The canonical state: `replayRun(content, log)`. Read it, never write it. */
  readonly state: RunState;
  /** The log so far. Complete records only; the node in progress is not in it. */
  readonly log: RunLog;
  readonly phase: RunPhase;
  /** The last node completed, or null before the first. */
  readonly last: NodeOutcome | null;
  travel(nodeId: number): void;
  finishFight(outcome: FightOutcome): void;
  pickSigil(pick: number): void;
  pickReward(pick: number): void;
  attach(deckIndex: number): void;
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
    case 'sigil':
      return 'a hero sigil is waiting to be picked or declined';
    case 'reward':
      return 'a fight reward is waiting to be picked';
    case 'attach':
      return `the ${phase.sigil.name} is waiting for a card to go on`;
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

/** Two unlock sets are the same set when this agrees. `null` is its own value. */
function unlockKey(set: UnlockSet | null): string {
  return set === null ? 'none' : `g[${set.gated.join(',')}]/o[${set.owned.join(',')}]`;
}

/** An unlock set as a phrase, for the one error message that has to name two. */
function unlockWords(set: UnlockSet | null): string {
  if (set === null) return 'no unlock layer';
  const locked = stillLocked(set);
  const owned = set.gated.length - locked.length;
  return locked.length === 0
    ? `all ${set.gated.length} unlockable card(s) and sigil(s)`
    : `${owned} of ${set.gated.length} unlockable card(s) and sigil(s), still missing ${locked.join(', ')}`;
}

/** A promise the preview made that the replay then broke. Always a bug. */
function diverged(what: string, promised: unknown, replayed: unknown): Error {
  return new Error(
    `run: the screen showed ${what} as ${String(promised)} and the replay produced ${String(replayed)}. ` +
      'The preview in src/ui/run.ts no longer computes what src/run/run.ts visit() computes; ' +
      'the node choices were recorded but the run state on screen cannot be trusted.',
  );
}

export type RunControllerOptions = {
  /** The class to start as. Ignored when resuming: the log carries its own. */
  readonly classId?: string;
  /**
   * What this run may draft, from the player's profile. Fixed for the life of
   * the run and written into the log, so the run replays from its own set and
   * not from whatever has been unlocked since. Omitted, or null, is no unlock
   * layer at all - the run every test and every measurement plays.
   *
   * A resumed log carries its own, and it wins: a saved run cannot be resumed
   * with a wider pool than it was played with, any more than it can be resumed
   * as another class. Asking is refused rather than quietly obeyed, because
   * obeying would redraw its shelves and reach a different run.
   */
  readonly unlocked?: UnlockSet | null;
  /** A saved run's log, replayed from the seed. */
  readonly resume?: RunLog;
};

/** A won fight in progress: its cursor through the node's draws, and the choices so far. */
type WonNode = {
  readonly node: MapNode;
  readonly encounter: RunEncounter;
  readonly outcome: FightOutcome;
  /** The canonical state cloned at the node's start and advanced through its draws and grants. */
  readonly cursor: RunState;
  readonly choices: RunChoice[];
};

/**
 * Start a run as a class, or resume one from its log.
 *
 * A resumed run is replayed from the seed through the same `replayRun` a
 * fresh one starts with, so a saved run is nothing but its choice list. What
 * a log cannot hold is the node in progress - a fight half fought is not in
 * it - so a resumed run stands on its last completed node, between nodes.
 * A log whose seed is not `seed`, or that does not replay, is refused with the
 * reason rather than half-applied. A log written under an earlier format is
 * one of those: `replayRun` names the two formats, and `migrateRunLog` is what
 * the caller reads a stored log through. A log's class is the log's: a log
 * written before classes existed has none and is the default class, as
 * `replayRun` reads it, and `classId` is only for a fresh run - a saved run
 * cannot be resumed as a class it was not started as, and asking is refused.
 */
export function createRunController(
  content: RunContent,
  seed: number,
  options: RunControllerOptions = {},
): RunController {
  const nodes: NodeRecord[] = [];
  const resume = options.resume;
  let classId = options.classId ?? defaultClassId(content);
  // Canonical from here on, for the reason `startRun` gives: the set is
  // compared with the log's below by `unlockKey`, which reads both lists in
  // order, and it is handed back to the caller as `ctl.unlocked`. A set that
  // arrived unsorted would refuse a resume it should have allowed.
  let unlocked = canonicalUnlockSet(options.unlocked ?? null);
  let format = RUN_LOG_FORMAT;
  if (resume !== undefined) {
    if (resume.seed !== seed) {
      throw new Error(
        `run: cannot resume a run seeded ${resume.seed} as seed ${seed}. A log replays only on its own seed.`,
      );
    }
    const logged = resume.classId ?? defaultClassId(content);
    if (options.classId !== undefined && options.classId !== logged) {
      throw new Error(
        `run: cannot resume a run started as the ${logged} as the ${options.classId}. A log replays ` +
          'only as the class it was started as.',
      );
    }
    classId = logged;
    // The log's unlock set wins, and a caller that asked for another one is
    // refused rather than obeyed: the log's reward picks are indices into
    // shelves drawn from *its* pool, so resuming it against a wider one would
    // hand the player cards the run never offered.
    const saved = parseUnlockSet(resume.unlocked, `the saved run on seed ${seed}`);
    // `unlocked` here is the caller's set already canonicalised; `unlockKey`
    // reads both lists in order, so comparing the raw option would refuse a
    // resume on list order alone. `options.unlocked !== undefined` is still
    // what tells "not passed" from "passed as null".
    if (options.unlocked !== undefined && unlockKey(unlocked) !== unlockKey(saved)) {
      throw new Error(
        `run: cannot resume a run played with ${unlockWords(saved)} while ${unlockWords(unlocked)} ` +
          'is unlocked now. A log replays only against the pool it was played with; finish or ' +
          'abandon this run before the new unlocks apply.',
      );
    }
    unlocked = saved;
    // A saved log parsed from storage may predate the field; 1 is what "no
    // field" meant, and `replayRun` is the one that refuses it.
    format = (resume as { format?: number }).format ?? 1;
    for (const record of resume.nodes) nodes.push(record);
  }
  // Refuse an unknown class here, by name, rather than three frames down.
  classOf(content, classId);
  // The one path. Even the empty log goes through it, so the starting state is
  // the replay of nothing rather than a second construction of the same thing.
  const drafted = unlocked === null ? {} : { unlocked };
  let state: RunState = replayRun(content, { seed, classId, ...drafted, format, nodes });
  format = RUN_LOG_FORMAT;
  let phase: RunPhase = state.result === 'ongoing' ? { kind: 'travel' } : { kind: 'over' };
  let last: NodeOutcome | null = null;
  let won: WonNode | null = null;

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
    detail: Omit<NodeOutcome, 'node' | 'act' | 'before' | 'after' | 'gained' | 'sigils' | 'actCleared'>,
    verify: (next: RunState) => void,
  ): void {
    const before = snapshotOf(state);
    const node = provisional;
    const next = replayRun(content, { seed, classId, ...drafted, format, nodes: [...nodes, provisional] });
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
      sigils: next.sigils.slice(state.sigils.length),
      actCleared: mapNode.type === 'boss' && next.result !== 'dead',
      ...detail,
    };
    state = next;
    won = null;
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

  function numbersOf(w: WonNode): WonNumbers {
    return {
      healthAfter: w.cursor.hero.health,
      maxHealthAfter: w.cursor.hero.maxHealth,
      goldAfter: w.cursor.gold,
    };
  }

  /** The shelf, drawn where `visit` draws it: after any hero sigil offer and grant. */
  function toReward(w: WonNode): void {
    phase = {
      kind: 'reward',
      node: w.node,
      encounter: w.encounter,
      outcome: w.outcome,
      offer: rewardOffer(w.cursor, w.node),
      ...numbersOf(w),
    };
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
    const detail = { ...noDetail, fight: { encounter: p.encounter, outcome } };

    if (fight.result !== 'playerWin') {
      const record: NodeRecord = {
        ...baseRecord(p.node, [travelChoice]),
        fight: rounds.slice(),
        fightSeed: p.setup.seed,
        fightResult: fight.result,
        fightRounds: fight.round,
      };
      commit(record, detail, (next) => {
        if (next.result !== 'dead') {
          throw diverged('the fight', `a loss (${fight.result})`, `a run that is ${next.result}`);
        }
      });
      return;
    }

    // `visit` on a win: Health carried out, gold paid, then any hero sigil
    // offer, then the shelf. Neither the Health nor the gold touches the run
    // stream, so the clone at the node's start is at the first offer's
    // position; it is kept as the cursor for the offers after it.
    const cursor = cloneRunState(state);
    cursor.hero.health = Math.max(0, heroOf(fight.state, 'player').health);
    cursor.gold = state.gold + goldFor(state, p.node);
    const w: WonNode = {
      node: p.node,
      encounter: p.encounter,
      outcome,
      cursor,
      choices: [travelChoice],
    };
    won = w;
    if (p.node.type === 'elite' || p.node.type === 'boss') {
      // `visit` asks at every won elite or boss. With nothing left to offer
      // the only legal answer is -1, so the controller gives it on the
      // player's behalf rather than showing a screen with one button, and
      // the log holds the choice either way.
      const offer = heroSigilOffer(cursor, p.node);
      if (offer.length > 0) {
        phase = { kind: 'sigil', node: p.node, encounter: p.encounter, outcome, offer, ...numbersOf(w) };
        return;
      }
      w.choices.push({ kind: 'sigil', pick: -1 });
    }
    toReward(w);
  }

  function pickSigil(pick: number): void {
    const p = requirePhase('sigil', 'pick a hero sigil');
    const w = won!;
    requireIndex(pick, p.offer.length, 'hero sigil pick', true);
    w.choices.push({ kind: 'sigil', pick });
    if (pick >= 0) grantHeroSigil(w.cursor, p.offer[pick]!);
    toReward(w);
  }

  /** The record a won node commits, and the checks every won node shares. */
  function commitWon(w: WonNode, cardTaken: string | null, attached: { sigil: CardSigilDef; deckIndex: number } | null): void {
    const record: NodeRecord = {
      ...baseRecord(w.node, w.choices.slice()),
      fight: w.outcome.rounds.slice(),
      fightSeed: w.outcome.fight.seed,
      fightResult: w.outcome.fight.result,
      fightRounds: w.outcome.fight.round,
    };
    const deckBefore = state.deck.length;
    const sigilsBefore = state.sigils.length;
    const promisedSigils = w.cursor.sigils.slice(sigilsBefore);
    commit(record, { ...noDetail, fight: { encounter: w.encounter, outcome: w.outcome } }, (next) => {
      if (next.result === 'dead') throw diverged('the fight', 'a win', 'a run that is dead');
      if (next.hero.health !== w.cursor.hero.health) {
        throw diverged('Health after the fight', w.cursor.hero.health, next.hero.health);
      }
      if (next.hero.maxHealth !== w.cursor.hero.maxHealth) {
        throw diverged('maximum Health after the fight', w.cursor.hero.maxHealth, next.hero.maxHealth);
      }
      if (next.gold !== w.cursor.gold) throw diverged('gold after the fight', w.cursor.gold, next.gold);
      const joined = next.deck.slice(deckBefore).map((d) => d.cardId);
      const expected = cardTaken === null ? [] : [cardTaken];
      if (joined.join(',') !== expected.join(',')) {
        throw diverged('the card taken', expected.join(',') || 'nothing', joined.join(',') || 'nothing');
      }
      const granted = next.sigils.slice(sigilsBefore);
      const word = (g: SigilGrant): string =>
        `${g.sigilId}@${g.target === 'hero' ? 'hero' : g.target.instanceId}`;
      if (granted.map(word).join(',') !== promisedSigils.map(word).join(',')) {
        throw diverged(
          'the sigils granted',
          promisedSigils.map(word).join(',') || 'none',
          granted.map(word).join(',') || 'none',
        );
      }
      if (attached !== null) {
        const dc = next.deck[attached.deckIndex];
        if (dc === undefined || !dc.sigils.some((s) => s.id === attached.sigil.id)) {
          throw diverged(
            `the card carrying ${attached.sigil.name}`,
            state.deck[attached.deckIndex]?.instanceId ?? `deck index ${attached.deckIndex}`,
            dc === undefined ? 'nothing' : `${dc.instanceId} without it`,
          );
        }
      }
    });
  }

  function pickReward(pick: number): void {
    const p = requirePhase('reward', 'pick a reward');
    const w = won!;
    requireIndex(pick, p.offer.length, 'reward pick', true);
    const wanted = pick >= 0 ? p.offer[pick]! : null;
    w.choices.push({ kind: 'reward', pick });
    if (wanted !== null && wanted.kind === 'sigil') {
      // `visit` asks which card next, from the deck as it stands - no draw.
      const offers = attachOffers(w.cursor, wanted.sigil);
      phase = {
        kind: 'attach',
        node: w.node,
        encounter: w.encounter,
        outcome: w.outcome,
        sigil: wanted.sigil,
        offers,
        ...numbersOf(w),
      };
      return;
    }
    commitWon(w, wanted === null ? null : wanted.cardId, null);
  }

  function attach(deckIndex: number): void {
    const p = requirePhase('attach', 'attach a sigil');
    const w = won!;
    if (!p.offers.includes(deckIndex)) {
      throw new Error(
        `run: ${p.sigil.name} cannot go on deck index ${deckIndex}. It can go on ` +
          `[${p.offers.join(', ')}] - every card without ${p.sigil.trait} already.`,
      );
    }
    w.choices.push({ kind: 'attach', deckIndex });
    // The cursor mirrors `visit` to the end of the node, so the grants it
    // promises are the grants the replay must make - hero and card alike.
    attachCardSigil(w.cursor, deckIndex, p.sigil);
    commitWon(w, null, { sigil: p.sigil, deckIndex });
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
    classId,
    unlocked,
    get state() {
      return state;
    },
    get log(): RunLog {
      return { seed, classId, ...drafted, format, nodes: nodes.slice() };
    },
    get phase() {
      return phase;
    },
    get last() {
      return last;
    },
    travel,
    finishFight,
    pickSigil,
    pickReward,
    attach,
    forge,
    buy,
    chooseEvent,
    hash: () => hashRun(state),
  };
}
