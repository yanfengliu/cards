// What each node type offers, and what accepting an offer does to run state.
//
// Split from `run.ts` for one reason: replay has to recompute every offer from
// the run state alone and take nothing but the *choice* from the log. Keeping
// the offers in named pure-ish functions is what makes "recompute, then apply
// the recorded index" a thing the loop can do without a second code path.
//
// Two different sources of randomness meet here, and the split between them is
// the run's determinism story:
//
//   - **The run stream.** One `Rng` on `RunState`, threaded through every
//     reward offer, shop shelf and event draw. Consuming a different number of
//     draws - by taking a shop instead of a forge - shifts everything after it,
//     which is what makes a route a route.
//
//   - **Node-keyed derivation.** A fight's seed and its encounter are
//     `mixSeeds(runSeed, act, nodeId, tag)`: a pure function of *which node it
//     is*, and of nothing the player did on the way there. So the fight at act
//     2's node 11 is the same fight whatever route reached it and whatever the
//     run stream has been up to. This is the clause in the unit's brief - "a
//     different routing choice cannot perturb a fight's internals" - as
//     arithmetic rather than as a convention, and it is gated by
//     "a node's fight is a function of the node, not of the route" in
//     `test/run.test.ts`.

import { type Rng, mixSeeds, nextFloat, nextInt } from '../engine/rng.ts';
import { makeDeckCard } from './deck.ts';
import type {
  EventEffect,
  ForgeOffer,
  MapNode,
  RewardEntry,
  RunEncounter,
  RunEventDef,
  RunState,
  ShopItem,
} from './types.ts';
import { FORGE_MODES } from './types.ts';

/** Distinguishes the two node-keyed derivations. Arbitrary, and fixed forever. */
const TAG_FIGHT_SEED = 0x1f19;
const TAG_ENCOUNTER = 0x0e11;

/**
 * Weighted draw of `k` distinct entries. Draws are taken one at a time from the
 * run stream, so `k` offers cost exactly `k` draws.
 */
export function drawDistinctCards(
  rng: Rng,
  table: readonly RewardEntry[],
  k: number,
): string[] {
  const pool = table.map((e) => ({ cardId: e.cardId, weight: e.weight }));
  const out: string[] = [];
  const want = Math.min(k, pool.length);
  for (let i = 0; i < want; i++) {
    let total = 0;
    for (const p of pool) total += p.weight;
    if (total <= 0) break;
    let roll = nextFloat(rng) * total;
    let chosen = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j]!.weight;
      if (roll < 0) {
        chosen = j;
        break;
      }
    }
    out.push(pool[chosen]!.cardId);
    pool.splice(chosen, 1);
  }
  return out;
}

/** The cards a fight, elite or boss reward offers. Costs `rewardOffers` draws. */
export function rewardOffer(run: RunState): string[] {
  return drawDistinctCards(run.rng, run.content.rewards, run.content.rewardOffers);
}

/** A shop's shelf. Price is a function of the card's printed cost. */
export function shopStock(run: RunState): ShopItem[] {
  const ids = drawDistinctCards(run.rng, run.content.rewards, run.content.shopStock);
  return ids.map((cardId) => ({
    cardId,
    price: run.content.shopBasePrice + run.content.shopPricePerCost * run.content.pool.card(cardId).cost,
  }));
}

/** Every upgrade the forge could apply, deck order then mode order. No draws. */
export function forgeOffers(run: RunState): ForgeOffer[] {
  const out: ForgeOffer[] = [];
  for (let i = 0; i < run.deck.length; i++) {
    for (const mode of FORGE_MODES) out.push({ deckIndex: i, mode });
  }
  return out;
}

/** Which event this node is. One draw from the run stream. */
export function drawEvent(run: RunState): RunEventDef {
  const events = run.content.events;
  if (events.length === 0) {
    throw new Error('run: an event node was reached but the content defines no events');
  }
  return events[nextInt(run.rng, events.length)]!;
}

/**
 * The seed the fight at this node is fought with.
 *
 * A pure function of the run seed and the node. Not of the route, not of the
 * run stream's position, not of the deck.
 */
export function fightSeedFor(run: RunState, node: MapNode): number {
  return mixSeeds(run.seed, run.act, node.id, TAG_FIGHT_SEED);
}

/** The encounter this node fields. Node-keyed for the same reason as the seed. */
export function encounterFor(run: RunState, node: MapNode): RunEncounter {
  const act = run.content.acts[run.act];
  if (act === undefined) {
    throw new Error(
      `run: act index ${run.act} has no content; the run content defines ` +
        `${run.content.acts.length} act(s)`,
    );
  }
  if (node.type === 'boss') return act.boss;
  const list = node.type === 'elite' ? act.elites : act.fights;
  if (list.length === 0) {
    throw new Error(
      `run: act ${run.act + 1} defines no ${node.type} encounters, but its map has a ` +
        `${node.type} node at row ${node.row}`,
    );
  }
  const idx = mixSeeds(run.seed, run.act, node.id, TAG_ENCOUNTER) % list.length;
  return list[idx]!;
}

/** Gold a won fight at this node pays. */
export function goldFor(run: RunState, node: MapNode): number {
  const act = run.content.acts[run.act]!;
  if (node.type === 'boss') return act.goldPerBoss;
  if (node.type === 'elite') return act.goldPerElite;
  return act.goldPerFight;
}

// ---------------------------------------------------------------------------
// Applying a choice
// ---------------------------------------------------------------------------

export function healHero(run: RunState, amount: number): void {
  run.hero.health = Math.min(run.hero.maxHealth, run.hero.health + Math.max(0, amount));
}

/** Damage outside a fight. Cannot kill: it floors at 1. See the note in `run.ts`. */
export function hurtHero(run: RunState, amount: number): void {
  run.hero.health = Math.max(1, run.hero.health - Math.max(0, amount));
}

/** What a rest node restores: a fraction of max Health, at least 1. */
export function restAmount(run: RunState): number {
  return Math.max(1, Math.round(run.hero.maxHealth * run.content.restHealFraction));
}

export function applyEventEffect(run: RunState, effect: EventEffect): void {
  switch (effect.kind) {
    case 'heal':
      healHero(run, effect.amount);
      return;
    case 'damage':
      hurtHero(run, effect.amount);
      return;
    case 'gold':
      run.gold += effect.amount;
      return;
    case 'card': {
      const drawn = drawDistinctCards(run.rng, run.content.rewards, 1)[0];
      if (drawn !== undefined) addCard(run, drawn);
      return;
    }
  }
}

/**
 * Mint a new instance of `cardId` and append it to the deck.
 *
 * Instance numbers only ever go up, so an id is unique for the life of a run
 * and is never reused - which is what lets a forge address one copy of a card
 * the deck holds three of.
 */
export function addCard(run: RunState, cardId: string): void {
  run.deck.push(makeDeckCard(cardId, run.nextInstance));
  run.nextInstance++;
  run.cardsGained++;
}
