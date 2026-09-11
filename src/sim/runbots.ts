// Run agents: the bots that route a run and answer its offers.
//
// Same rule as `bots.ts`, and for the same reason: **every policy here is a
// pure function of the run state it is handed.** None of them keeps a
// generator or a counter that survives a call. A router that carried state
// would make its own decisions depend on how many runs the instance had already
// seen, and hoisting one agent out of a measurement loop for speed would then
// silently change every route and every final hash with every gate still green.
//
// So the randomness a policy needs is derived from `(agent seed, run seed, act,
// node, how many nodes have been visited, which decision)` rather than carried
// forward. `test/run.test.ts` pins it: a warmed agent and a fresh one produce
// identical runs.
//
// The two route styles exist to be compared. `greedy` reads the map and the
// hero's Health; `random` walks uniformly. Holding the placement policy
// constant across the two is what makes the difference between them a statement
// about routing rather than about the fights.
//
// **Both style unions are derived from a list, and an unknown style is refused
// by name.** `ROUTE_STYLES` and `PLACEMENT_STYLES` are the single source for
// the accepted set: the union is read off the array, so the error message and
// the type cannot drift apart, and the `never` guard in each `default:` arm
// makes a member added to an array with no `case` a typecheck failure as well
// as a runtime one. The refusal is not defensive decoration - `.mjs` probes
// call `makeRunAgent` with no typecheck in front of them, and before this the
// two switches had no `default:`: an unknown placement fell off the end as
// `undefined` and died four layers down in `src/engine/fight.ts` as `policy is
// not a function`, and an unknown route silently became the *random* router,
// which is worse, because it answers rather than stopping. See
// `docs/learning/defect-register.md`.

import { type Rng, makeRng, mixSeeds, nextInt } from '../engine/rng.ts';
import { VOLLEY_SWINGS } from '../engine/resolver.ts';
import type { PlacementPolicy } from '../engine/fight.ts';
import type { UnitCard } from '../engine/state.ts';
import { resolveDeckCard } from '../run/deck.ts';
import type { RunAgent } from '../run/run.ts';
import type {
  CardSigilDef,
  ForgeOffer,
  HeroSigilDef,
  MapNode,
  NodeType,
  RewardOption,
  RunEventDef,
  RunState,
  ShopItem,
} from '../run/types.ts';
import { DEFAULT_LOOKAHEAD, appendRightPlacer, lookaheadPlacer, randomPlacer } from './bots.ts';

/**
 * Every route style `makeRunAgent` accepts, in report order. The union is read
 * off this array rather than written beside it, so the accepted set a refusal
 * prints is the accepted set the type describes.
 */
export const ROUTE_STYLES = ['greedy', 'random'] as const;
export type RouteStyle = (typeof ROUTE_STYLES)[number];

/** Every placement style `makeRunAgent` accepts, same rule as `ROUTE_STYLES`. */
export const PLACEMENT_STYLES = ['lookahead', 'random', 'right'] as const;
export type PlacementStyle = (typeof PLACEMENT_STYLES)[number];

export type RunBotOptions = {
  readonly route: RouteStyle;
  readonly placement: PlacementStyle;
  /** The agent's own seed. Mixed with the run's, so one agent varies per run. */
  readonly seed: number;
};

/** Which decision is being made. Keeps one node's draws off each other. */
const DECISION = { travel: 1, reward: 2, forge: 3, shop: 4, event: 5, sigil: 6, attach: 7 } as const;

function rngFor(run: RunState, seed: number, decision: number): Rng {
  return makeRng(
    mixSeeds(seed, run.seed, run.act, run.nodeId, run.nodesVisited, decision),
    'run-agent',
  );
}

/**
 * What an unrecognised style says, for both dials.
 *
 * The caller that reaches this has no typecheck in front of it, so `got` can be
 * anything at all - a misspelt string, `undefined`, a number, an object. It is
 * printed through `String(...)` rather than interpolated directly, because
 * interpolating a symbol throws and an error that throws while being built
 * reports nothing; the `typeof` is carried alongside because `3` and `"3"`
 * print identically and are two different mistakes.
 */
function refuseStyle(field: 'route' | 'placement', got: unknown, accepted: readonly string[]): never {
  const shown = typeof got === 'string' ? `"${got}"` : String(got);
  throw new Error(
    `runbots: makeRunAgent was given ${field} ${shown} (typeof ${typeof got}), which is not a ` +
      `${field} style this repo has. Pass one of ${accepted.map((s) => `"${s}"`).join(', ')} as ` +
      `\`${field}\`.`,
  );
}

function placementFor(style: PlacementStyle, seed: number): PlacementPolicy {
  switch (style) {
    case 'lookahead':
      return lookaheadPlacer(DEFAULT_LOOKAHEAD);
    case 'random':
      return randomPlacer(seed, 'run-placement');
    case 'right':
      return appendRightPlacer();
    default: {
      // Compile-time half: a style added to `PLACEMENT_STYLES` with no `case`
      // is not assignable to `never` and fails `npm run typecheck`. Run-time
      // half: the refusal below, for a caller the compiler never saw. The
      // guard is passed to `refuseStyle` rather than left dangling because
      // `noUnusedLocals` rejects a local nothing reads.
      const unreachable: never = style;
      return refuseStyle('placement', unreachable, PLACEMENT_STYLES);
    }
  }
}

/**
 * How good a card looks on its own, per point of energy.
 *
 * The numerator is `bots.ts`'s board value - printed Power plus 0.7 x Health -
 * so the run agent and the placement bot agree about what a body is worth. The
 * `+1` on the denominator is what keeps a 0-cost card from being infinite.
 */
function cardValue(card: UnitCard): number {
  const body = card.power + 0.7 * card.health + 1.5 * card.armour;
  // A Volley body swings `VOLLEY_SWINGS` times, so its Power counts that many
  // times. The extra swings are read from the resolver's own constant rather
  // than written as `+ card.power`, which was a third copy of "Volley is two"
  // beside the resolver's and the tooltip's and would have stopped following it.
  //
  // Everything AROUND it is still a starting guess - the 0.7, the 1.5, the +1
  // below - and deliberately the same guess for every class, so the per-class
  // measurement compares content rather than three different bots. What is not
  // a guess is the swing count.
  const volley = card.traits.includes('volley') ? card.power * (VOLLEY_SWINGS - 1) : 0;
  const trait = card.traits.includes('guard') ? 2 : 0;
  return (body + volley + trait) / (card.cost + 1);
}

/**
 * How much the greedy router wants each node type, before Health is considered.
 *
 * Elites and fights pay; a forge is permanent; a shop is only worth a detour
 * with gold in hand. The numbers are a starting guess, and the measurement's
 * job is to say whether routing on them beats routing at random.
 */
const ROUTE_VALUE: Record<NodeType, number> = {
  elite: 5,
  fight: 4,
  forge: 3.5,
  shop: 3,
  event: 2,
  rest: 2,
  boss: 0,
};

function greedyTravel(run: RunState, options: readonly MapNode[]): number {
  const missing = run.hero.maxHealth - run.hero.health;
  const fraction = run.hero.health / Math.max(1, run.hero.maxHealth);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const node = options[i]!;
    let score = ROUTE_VALUE[node.type];
    if (node.type === 'rest') {
      // A rest is worth exactly what it heals, and nothing when nothing is
      // missing. This is the only term that makes the route depend on how the
      // run has gone rather than on the map alone.
      score += (6 * missing) / Math.max(1, run.hero.maxHealth);
    }
    if (node.type === 'elite' && fraction < 0.6) score -= 6;
    if (node.type === 'fight' && fraction < 0.35) score -= 3;
    if (node.type === 'shop') score += Math.min(2, run.gold / 60);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * What a card sigil on the shelf is worth to the greedy bot, on the same scale
 * as `cardValue`, which runs about 1.5 to 3 across the shipped pool. A trait
 * on a body the deck already fields is priced as a card that costs nothing
 * to play, which is what it is. A starting guess, like every number in this
 * file: it is a bot's preference, and the measurement's job is to report
 * what it does with it.
 */
const CARD_SIGIL_VALUE: Readonly<Record<CardSigilDef['trait'], number>> = {
  relay: 2.6,
  wake: 2.2,
  guard: 2.4,
  // Priced but never offered: `src/content/sigils.ts` ships no Volley or
  // Scorch sigil today. The record is keyed by the trait union on purpose, so
  // adding one there does not silently reach a bot with no preference for it.
  volley: 2.8,
  scorch: 2.5,
  // The three tribal traits, also priced and also never offered. They are
  // priced BELOW Relay and Wake on purpose, and the reason is a fact about
  // this bot rather than about the cards: it drafts by `cardValue`, which
  // cannot see a race at all, so the deck it assembles is not built around
  // one. A trait that pays only when the neighbour happens to match is worth
  // less to a bot that never arranged for a match than to a player who did.
  kindle: 1.8,
  chorus: 1.8,
  banner: 1.8,
};

/**
 * Which hero sigil the greedy bot reaches for first. Health is the run's life
 * bar and is what ends most runs, so it comes first; Armour on the hero comes
 * off every hit it takes, which over a run of many small hits is worth more
 * than one Power on a hero that swings once a round. Keyed by the effect
 * union, so a kind the run can apply cannot ship without a preference.
 */
const HERO_SIGIL_VALUE: Readonly<Record<HeroSigilDef['effect']['kind'], number>> = {
  maxHealth: 4,
  heroArmour: 3,
  heroPower: 2,
};

function greedyReward(run: RunState, offer: readonly RewardOption[]): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < offer.length; i++) {
    const option = offer[i]!;
    const score =
      option.kind === 'card'
        ? cardValue(run.content.pool.card(option.cardId))
        : CARD_SIGIL_VALUE[option.sigil.trait];
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return offer.length === 0 ? -1 : best;
}

function greedySigil(_run: RunState, offer: readonly HeroSigilDef[]): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < offer.length; i++) {
    const score = HERO_SIGIL_VALUE[offer[i]!.effect.kind];
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return offer.length === 0 ? -1 : best;
}

/**
 * Where a card sigil goes. A Relay is worth most on a body that survives its
 * own swing to hand the +2 forward, so Health and Armour; a Guard on the
 * biggest body, since the Guard is what the enemy will be forced to hit; Wake
 * on the highest Power, since the +2 is a swing at a number that is already
 * above the armour line.
 */
function greedyAttach(run: RunState, sigil: CardSigilDef, offers: readonly number[]): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < offers.length; i++) {
    const card = resolveDeckCard(run.content.pool, run.deck[offers[i]!]!);
    let score: number;
    if (sigil.trait === 'relay') score = card.health + 2 * card.armour;
    else if (sigil.trait === 'guard') score = card.health + 2 * card.armour + 0.5 * card.power;
    else score = card.power + 0.3 * card.health;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Cheapen the most expensive card the run owns; failing that, arm the biggest
 * body. A cost forge on a card already at zero would be thrown away, so cards
 * whose applied cost has reached zero are skipped.
 */
function greedyForge(run: RunState, offers: readonly ForgeOffer[]): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i]!;
    const dc = run.deck[offer.deckIndex]!;
    const card = run.content.pool.card(dc.cardId);
    const appliedCost = Math.max(0, card.cost + dc.costDelta);
    let score: number;
    if (offer.mode === 'cost') score = appliedCost > 0 ? 10 + appliedCost : -1;
    else if (offer.mode === 'power') score = 5 + card.power + dc.powerBonus * 0.5;
    else score = 4 + (card.health + dc.healthBonus) * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function greedyShop(run: RunState, stock: readonly ShopItem[]): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < stock.length; i++) {
    const item = stock[i]!;
    if (item.price > run.gold) continue;
    const score = cardValue(run.content.pool.card(item.cardId));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Heal when hurt, take the gold when not. Damage is never taken below half. */
function greedyEvent(run: RunState, def: RunEventDef): number {
  const fraction = run.hero.health / Math.max(1, run.hero.maxHealth);
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < def.options.length; i++) {
    let score = 0;
    for (const effect of def.options[i]!.effects) {
      switch (effect.kind) {
        case 'heal':
          score += effect.amount * (fraction < 0.7 ? 1.5 : 0.4);
          break;
        case 'damage':
          score -= effect.amount * (fraction < 0.6 ? 4 : 1);
          break;
        case 'gold':
          score += effect.amount * 0.15;
          break;
        case 'card':
          score += 6;
          break;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Uniform over every legal answer, including declining where declining is legal. */
function randomAgentChoices(seed: number): Omit<RunAgent, 'placement'> {
  return {
    travel: (run, options) => nextInt(rngFor(run, seed, DECISION.travel), options.length),
    sigil: (run, offer) =>
      offer.length === 0 ? -1 : nextInt(rngFor(run, seed, DECISION.sigil), offer.length + 1) - 1,
    reward: (run, offer) =>
      offer.length === 0 ? -1 : nextInt(rngFor(run, seed, DECISION.reward), offer.length + 1) - 1,
    attach: (run, _sigil, offers) => nextInt(rngFor(run, seed, DECISION.attach), offers.length),
    forge: (run, offers) => nextInt(rngFor(run, seed, DECISION.forge), offers.length),
    shop: (run, stock) => {
      const affordable: number[] = [];
      for (let i = 0; i < stock.length; i++) if (stock[i]!.price <= run.gold) affordable.push(i);
      const roll = nextInt(rngFor(run, seed, DECISION.shop), affordable.length + 1);
      return roll === 0 ? -1 : affordable[roll - 1]!;
    },
    event: (run, def) => nextInt(rngFor(run, seed, DECISION.event), def.options.length),
  };
}

const GREEDY_CHOICES: Omit<RunAgent, 'placement'> = {
  travel: greedyTravel,
  sigil: greedySigil,
  reward: greedyReward,
  attach: greedyAttach,
  forge: greedyForge,
  shop: greedyShop,
  event: greedyEvent,
};

function choicesFor(style: RouteStyle, seed: number): Omit<RunAgent, 'placement'> {
  switch (style) {
    case 'greedy':
      return GREEDY_CHOICES;
    case 'random':
      return randomAgentChoices(seed);
    default: {
      // This one was written as `opts.route === 'greedy' ? GREEDY : random(...)`
      // until 2026-09-10, so an unknown route did not crash - it routed at
      // random and reported a number. A wrong answer returned quietly is worse
      // than a stopped one, which is why the refusal covers both dials rather
      // than only the one a probe happened to trip over.
      const unreachable: never = style;
      return refuseStyle('route', unreachable, ROUTE_STYLES);
    }
  }
}

export function makeRunAgent(opts: RunBotOptions): RunAgent {
  const choices = choicesFor(opts.route, opts.seed);
  return { ...choices, placement: placementFor(opts.placement, opts.seed) };
}
