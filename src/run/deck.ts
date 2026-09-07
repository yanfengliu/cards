// The run deck, and the seam that carries a forged card into a fight.
//
// A run deck is a list of *instances*, not of card ids, because the forge
// "permanently upgrades one card" and a deck holding three Squires must be able
// to upgrade one of them. Each instance has an id of the form `u_squire#7`.
//
// The engine never learns any of this. A fight is handed a deck of instance ids
// and a `CardPool` that resolves them - `runPool` below - so a +1 Power Squire
// arrives at `makeUnit` as an ordinary `UnitCard` with a power of 2. That is
// the pool seam in `src/engine/state.ts` doing exactly the job its comment
// claims: "a fight is *given* its cards rather than reaching into
// `src/content/` for them." No engine change was needed for the forge.

import type { CardPool, UnitCard } from '../engine/state.ts';
import type { DeckCard, ForgeMode } from './types.ts';

/** The separator between a card id and its instance number. */
export const INSTANCE_SEPARATOR = '#';

export function makeDeckCard(cardId: string, instance: number): DeckCard {
  if (cardId.includes(INSTANCE_SEPARATOR)) {
    throw new Error(
      `run deck: card id "${cardId}" contains "${INSTANCE_SEPARATOR}", which separates a card ` +
        `id from its run instance number. Card ids may not contain it.`,
    );
  }
  return {
    instanceId: `${cardId}${INSTANCE_SEPARATOR}${instance}`,
    cardId,
    powerBonus: 0,
    healthBonus: 0,
    costDelta: 0,
  };
}

/** The card a deck instance actually fights as, upgrades applied. */
export function resolveDeckCard(base: CardPool, dc: DeckCard): UnitCard {
  const card = base.card(dc.cardId);
  return {
    ...card,
    id: dc.instanceId,
    cost: Math.max(0, card.cost + dc.costDelta),
    power: card.power + dc.powerBonus,
    health: card.health + dc.healthBonus,
  };
}

/**
 * A `CardPool` for one fight in one run.
 *
 * Instance ids resolve to the run's upgraded copies; every other id falls
 * through to the base pool, which is how the enemy's plain card ids still work.
 * Built fresh per fight from the deck as it stands, so a forge between two
 * fights is visible in the second and not the first.
 */
export function runPool(base: CardPool, deck: readonly DeckCard[]): CardPool {
  const byInstance = new Map<string, UnitCard>();
  for (const dc of deck) byInstance.set(dc.instanceId, resolveDeckCard(base, dc));
  return {
    card(id: string): UnitCard {
      const hit = byInstance.get(id);
      if (hit !== undefined) return hit;
      if (id.includes(INSTANCE_SEPARATOR)) {
        const known = [...byInstance.keys()].join(', ');
        throw new Error(
          `run pool: no deck instance "${id}" in this run's deck. The deck holds: ${known}. ` +
            `An instance id is minted when a card enters the deck and is never reused.`,
        );
      }
      return base.card(id);
    },
    energyPerTurn: base.energyPerTurn,
    handSize: base.handSize,
  };
}

/**
 * Apply one forge. `docs/design/game.md`: "Forge nodes permanently upgrade one
 * card: +1 Power, +1 Health, or -1 cost."
 *
 * Permanent means it lives on the `DeckCard` and survives every later fight,
 * which is the whole difference between the forge and a this-turn buff. Cost
 * is clamped at zero when the card is resolved, not here, so repeated cost
 * forges on a 1-cost card are wasted rather than negative - a decision the
 * player can make badly, which is the point of offering it.
 */
export function applyForge(deck: DeckCard[], index: number, mode: ForgeMode): void {
  const dc = deck[index];
  if (dc === undefined) {
    throw new Error(
      `forge: deck index ${index} is not a card; the deck holds ${deck.length} card(s) and ` +
        `accepts 0..${deck.length - 1}`,
    );
  }
  deck[index] = {
    instanceId: dc.instanceId,
    cardId: dc.cardId,
    powerBonus: dc.powerBonus + (mode === 'power' ? 1 : 0),
    healthBonus: dc.healthBonus + (mode === 'health' ? 1 : 0),
    costDelta: dc.costDelta + (mode === 'cost' ? -1 : 0),
  };
}

export function cloneDeck(deck: readonly DeckCard[]): DeckCard[] {
  return deck.map((d) => ({
    instanceId: d.instanceId,
    cardId: d.cardId,
    powerBonus: d.powerBonus,
    healthBonus: d.healthBonus,
    costDelta: d.costDelta,
  }));
}
