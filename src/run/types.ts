// The run, as types.
//
// `docs/design/game.md`: "Three acts, each a branching map, each ending in a
// boss. Nodes: fight, elite, event, shop, forge, rest." A run carries a hero's
// Health and a deck from the first node of act 1 to the boss of act 3.
//
// The shape of this file follows `src/engine/state.ts`: the data a run is, and
// nothing that decides anything. The run is handed its content the same way a
// fight is handed its `CardPool` - `RunContent` is an argument, never an import
// reached for from inside the loop - so a test can drive a whole run on two
// cards and four nodes without touching `src/content/`.

import type { RoundRecord, FightResult } from '../engine/fight.ts';
import type { Rng } from '../engine/rng.ts';
import type { CardPool, HeroSpec } from '../engine/state.ts';

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/** The six node types the design names, plus the boss that closes an act. */
export type NodeType = 'fight' | 'elite' | 'event' | 'shop' | 'forge' | 'rest' | 'boss';

export const NODE_TYPES: readonly NodeType[] = [
  'fight',
  'elite',
  'event',
  'shop',
  'forge',
  'rest',
  'boss',
];

/**
 * One node. `id` is its index in `ActMap.nodes`, so `nodes[id].id === id`.
 *
 * `next` holds the ids of the nodes in the row below that this one leads to,
 * left to right. A path down the map therefore visits exactly one node per row,
 * which is what makes "how long is an act" a number in the content file rather
 * than an emergent property of the generator.
 */
export type MapNode = {
  readonly id: number;
  readonly row: number;
  /** Position within the row, left to right. Edges never cross, so this reads. */
  readonly col: number;
  readonly type: NodeType;
  readonly next: readonly number[];
};

export type ActMap = {
  /** 0-based act index. */
  readonly act: number;
  /** Node ids per row, left to right. `rows[0]` is the entry, the last is the boss. */
  readonly rows: readonly (readonly number[])[];
  readonly nodes: readonly MapNode[];
};

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

/**
 * One card in the run deck, as an instance rather than an id.
 *
 * The forge "permanently upgrades one card", and a deck holding three Squires
 * has to be able to upgrade one of them. So a run deck is a list of instances,
 * each with its own permanent bonuses, and each carries an `instanceId` that is
 * unique within the run.
 *
 * That id is what gets handed to the fight as a deck entry. The fight resolves
 * it through the `CardPool` it was given - see `runPool` in `deck.ts` - so the
 * upgrade reaches the engine through the seam the engine already has, and no
 * engine change is needed to make a +1 Power Squire fight as a +1 Power Squire.
 */
export type DeckCard = {
  /** `${cardId}#${n}`. Unique within a run; `#` never appears in a card id. */
  readonly instanceId: string;
  readonly cardId: string;
  readonly powerBonus: number;
  readonly healthBonus: number;
  /** Negative lowers the cost. Applied cost is clamped at zero. */
  readonly costDelta: number;
};

export type ForgeMode = 'power' | 'health' | 'cost';

export const FORGE_MODES: readonly ForgeMode[] = ['power', 'health', 'cost'];

/** One thing the forge could do to one deck card, priced in nothing. */
export type ForgeOffer = {
  readonly deckIndex: number;
  readonly mode: ForgeMode;
};

/** One card on a shop's shelf, at the price this run pays for it. */
export type ShopItem = {
  readonly cardId: string;
  readonly price: number;
};

// ---------------------------------------------------------------------------
// The sigil seam
// ---------------------------------------------------------------------------

/**
 * Where sigils will attach when they exist.
 *
 * Sigils are the run's progression system and they are **out of scope for this
 * unit** - they are a system of their own and they get their own. What is here
 * is the seam and nothing else: a reward may grant one, a run carries the ones
 * it was granted, and `hashRun` covers the list, so the day sigils land the
 * run hash notices them instead of silently agreeing.
 *
 * Nothing in this unit ever produces one. `RunState.sigils` is empty in every
 * run this code can generate, and that is asserted rather than assumed - see
 * the "sigils stay out of scope" gate in `test/run.test.ts`.
 */
export type SigilGrant = {
  /** The hero, for a run-long sigil, or a deck card by its instance id. */
  readonly target: 'hero' | { readonly instanceId: string };
  readonly sigilId: string;
};

// ---------------------------------------------------------------------------
// Content: the data a run is made of
// ---------------------------------------------------------------------------

/** One enemy a fight, elite or boss node can put in front of the player. */
export type RunEncounter = {
  readonly id: string;
  readonly name: string;
  readonly enemyHero: HeroSpec;
  readonly enemyDeck: readonly string[];
  /** Bodies already on the enemy line, so turn one is not a free hit. */
  readonly opening: readonly string[];
};

/** A card the reward and shop tables can offer, and how often. */
export type RewardEntry = {
  readonly cardId: string;
  readonly weight: number;
};

export type EventEffect =
  | { readonly kind: 'heal'; readonly amount: number }
  | { readonly kind: 'damage'; readonly amount: number }
  | { readonly kind: 'gold'; readonly amount: number }
  /** A card drawn from the reward table, with no choice of which. */
  | { readonly kind: 'card' };

export type EventOption = {
  readonly label: string;
  readonly effects: readonly EventEffect[];
};

export type RunEventDef = {
  readonly id: string;
  readonly name: string;
  readonly options: readonly EventOption[];
};

/** What one act is: how deep, how hard, and what it pays. */
export type ActContent = {
  readonly act: number;
  readonly name: string;
  readonly fights: readonly RunEncounter[];
  readonly elites: readonly RunEncounter[];
  readonly boss: RunEncounter;
  readonly goldPerFight: number;
  readonly goldPerElite: number;
  readonly goldPerBoss: number;
};

/** The weight table for one row of the map. */
export type RowShape = {
  /** Nodes in this row. Clamped to the number of distinct types available. */
  readonly minWidth: number;
  readonly maxWidth: number;
  /** Types this row may hold, with weights. A row's nodes never share a type. */
  readonly weights: readonly { readonly type: NodeType; readonly weight: number }[];
};

export type MapShape = {
  /** One entry per row, top to bottom. The last row is the boss row. */
  readonly rows: readonly RowShape[];
  /** Chance, per source node, of one extra downward edge beyond the base graph. */
  readonly extraEdgeChance: number;
};

/**
 * One class a run can be started as: a hero, a starting deck and a reward
 * pool, which is exactly what `docs/design/game.md` says a class sets.
 *
 * `startRun` copies the chosen class's three fields over the content's own
 * `hero`, `startingDeck` and `rewards`, so nothing inside the loop reads a
 * class: `nodes.ts` draws from `run.content.rewards` and `fightSetupFor` hands
 * a fight `run.content.hero`, as they did before classes existed. The class
 * survives as `RunState.classId`, which the log records and the hash covers.
 */
export type RunClass = {
  readonly id: string;
  readonly name: string;
  readonly hero: HeroSpec;
  readonly startingDeck: readonly string[];
  readonly rewards: readonly RewardEntry[];
};

/**
 * Everything a run is made of, handed in rather than imported.
 *
 * Same seam as `CardPool`: `src/run/` never reaches into `src/content/` from
 * inside the loop, so the loop can be driven by a fixture. `RUN_CONTENT` in
 * `content.ts` is the one place that builds this from the shipped cards.
 */
export type RunContent = {
  readonly pool: CardPool;
  /**
   * The hero, deck and pool a run of this content plays. With `classes`
   * present these are the chosen class's, copied in by `startRun`; without it
   * they are the content's one and only class, whose id is `knight`.
   */
  readonly hero: HeroSpec;
  /** Card ids the run starts with. Instances are minted from these. */
  readonly startingDeck: readonly string[];
  /**
   * The classes a run may be started as. Optional so a fixture with one hero
   * and one deck needs no class list: `startRun` treats such a content as
   * offering the default class alone.
   */
  readonly classes?: readonly RunClass[];
  readonly acts: readonly ActContent[];
  readonly mapShape: MapShape;
  readonly rewards: readonly RewardEntry[];
  readonly events: readonly RunEventDef[];
  /** How many cards a fight reward offers. */
  readonly rewardOffers: number;
  /** How many cards a shop stocks. */
  readonly shopStock: number;
  readonly shopBasePrice: number;
  readonly shopPricePerCost: number;
  readonly startingGold: number;
  /** Fraction of max Health a rest node restores. At least 1 Health. */
  readonly restHealFraction: number;
  readonly maxRounds: number;
};

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

export type RunResult = 'ongoing' | 'dead' | 'won';

/** How a run that is no longer ongoing finished. `null` while it is running. */
export type RunEnding = {
  readonly act: number;
  readonly row: number;
  readonly nodeType: NodeType;
  /** `killed` lost the fight, `timeout` ran out of rounds, `won` beat act 3. */
  readonly cause: 'killed' | 'timeout' | 'won';
};

export type RunChoice =
  | { readonly kind: 'travel'; readonly nodeId: number }
  | { readonly kind: 'reward'; readonly pick: number }
  | { readonly kind: 'forge'; readonly deckIndex: number; readonly mode: ForgeMode }
  | { readonly kind: 'shop'; readonly buy: number }
  | { readonly kind: 'event'; readonly option: number };

/** Everything one visited node did, and every choice made inside it. */
export type NodeRecord = {
  readonly act: number;
  readonly nodeId: number;
  readonly type: NodeType;
  /** The choices made at this node, in the order they were asked for. */
  readonly choices: RunChoice[];
  /** The fight's own action list, when this node fought. Replayed, not re-run. */
  readonly fight: RoundRecord[] | null;
  readonly fightSeed: number | null;
  readonly fightResult: FightResult | null;
  readonly fightRounds: number;
  readonly heroHealthAfter: number;
  readonly goldAfter: number;
  readonly deckSizeAfter: number;
};

/**
 * A whole run as seed plus an ordered list of choices.
 *
 * This is the run's half of the keystone invariant. `replayRun` takes one of
 * these and no agent at all: every offer is recomputed, every choice is read
 * back, and the final state must hash identically to the live run.
 */
export type RunLog = {
  readonly seed: number;
  /**
   * The class the run was started as. Every log written since classes
   * existed carries it; a log written before them has no field, and
   * `replayRun` reads that as the default class, which is the only class
   * such a run could have been. `test/classes.test.ts` holds a log of the old
   * shape and requires it to keep replaying.
   */
  readonly classId?: string;
  readonly nodes: NodeRecord[];
};

/**
 * The decision half of a run agent: one method per decision the run puts in
 * front of a player, each returning an index into the options it was handed.
 *
 * It is a type of its own because `replayRun` implements it from a recorded
 * choice list, which is what lets the live path and the replay path share one
 * node code path instead of having one each.
 */
export type RunAgentChoice = {
  travel(run: RunState, options: readonly MapNode[]): number;
  reward(run: RunState, offer: readonly string[]): number;
  forge(run: RunState, offers: readonly ForgeOffer[]): number;
  shop(run: RunState, stock: readonly ShopItem[]): number;
  event(run: RunState, def: RunEventDef): number;
};

export type RunState = {
  readonly seed: number;
  /** The class this run was started as. Recorded in the log, covered by the hash. */
  readonly classId: string;
  /**
   * Immutable data shared by every run of this class on this content: the
   * content handed to `startRun` with the class's hero, deck and pool in
   * place. Not hashed.
   */
  readonly content: RunContent;
  /** All three act maps, generated once at setup from the seed alone. */
  readonly maps: readonly ActMap[];
  act: number;
  /** Row of the current node, or -1 before the act's entry has been chosen. */
  row: number;
  /** Current node id within the current act, or -1 before entry. */
  nodeId: number;
  hero: { health: number; maxHealth: number };
  deck: DeckCard[];
  /** Next instance number. Instance ids are unique and never reused in a run. */
  nextInstance: number;
  gold: number;
  /** Always empty in this unit. See `SigilGrant`. */
  sigils: SigilGrant[];
  result: RunResult;
  ending: RunEnding | null;
  nodesVisited: number;
  fightsFought: number;
  /** Rounds summed across every fight, so mean fight length is derivable. */
  roundsFought: number;
  forgesApplied: number;
  cardsGained: number;
  /** The run's own generator. Its own stream; no fight ever reads it. */
  rng: Rng;
};
