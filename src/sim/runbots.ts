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

import { type Rng, makeRng, mixSeeds, nextInt } from '../engine/rng.ts';
import { VOLLEY_SWINGS } from '../engine/resolver.ts';
import type { PlacementPolicy } from '../engine/fight.ts';
import type { UnitCard } from '../engine/state.ts';
import type { RunAgent } from '../run/run.ts';
import type { ForgeOffer, MapNode, NodeType, RunEventDef, RunState, ShopItem } from '../run/types.ts';
import { DEFAULT_LOOKAHEAD, appendRightPlacer, lookaheadPlacer, randomPlacer } from './bots.ts';

export type RouteStyle = 'greedy' | 'random';
export type PlacementStyle = 'lookahead' | 'random' | 'right';

export type RunBotOptions = {
  readonly route: RouteStyle;
  readonly placement: PlacementStyle;
  /** The agent's own seed. Mixed with the run's, so one agent varies per run. */
  readonly seed: number;
};

/** Which decision is being made. Keeps one node's draws off each other. */
const DECISION = { travel: 1, reward: 2, forge: 3, shop: 4, event: 5 } as const;

function rngFor(run: RunState, seed: number, decision: number): Rng {
  return makeRng(
    mixSeeds(seed, run.seed, run.act, run.nodeId, run.nodesVisited, decision),
    'run-agent',
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

function greedyReward(run: RunState, offer: readonly string[]): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < offer.length; i++) {
    const score = cardValue(run.content.pool.card(offer[i]!));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return offer.length === 0 ? -1 : best;
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
    reward: (run, offer) =>
      offer.length === 0 ? -1 : nextInt(rngFor(run, seed, DECISION.reward), offer.length + 1) - 1,
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
  reward: greedyReward,
  forge: greedyForge,
  shop: greedyShop,
  event: greedyEvent,
};

export function makeRunAgent(opts: RunBotOptions): RunAgent {
  const choices = opts.route === 'greedy' ? GREEDY_CHOICES : randomAgentChoices(opts.seed);
  return { ...choices, placement: placementFor(opts.placement, opts.seed) };
}
