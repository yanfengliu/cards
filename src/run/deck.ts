// The run deck, and the seam that carries a forged or sigilled card into a fight.
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
//
// A sigil goes through the same seam and needed no engine change either. A
// Relay Sigil on a Pikeman is the word `relay` merged into that instance's
// `traits` in `resolveDeckCard`, and the resolver treats it exactly as it
// treats the Relay printed on a Squire, because both are the same word in the
// same list. `docs/design/game.md`: "a Relay Sigil makes any unit a relay."
// The only thing the fight is told beyond the trait is `sigilTraits`, which the
// engine never reads and the panel uses to say where the trait came from.

import type { CardPool, Trait, UnitCard } from '../engine/state.ts';
import type { AttachedSigil, DeckCard, ForgeMode } from './types.ts';

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
    sigils: [],
  };
}

/**
 * The traits this instance's sigils add beyond what the card prints, in the
 * order they were attached.
 *
 * A trait is a word in a list, so this is a set difference: a Relay Sigil on
 * a card that already prints Relay adds nothing, and `attachSigil` refuses
 * that attachment before it gets here. It is the run-layer answer to "where
 * did this trait come from", which the screens ask so a pip can say a sigil
 * put it there; the fight is never told, because the resolver has no use for
 * the answer and `AGENTS.md` keeps a fight's card an ordinary card.
 */
export function grantedTraits(base: CardPool, dc: DeckCard): Trait[] {
  const printed = base.card(dc.cardId).traits;
  const out: Trait[] = [];
  for (const s of dc.sigils) {
    if (!printed.includes(s.trait) && !out.includes(s.trait)) out.push(s.trait);
  }
  return out;
}

/**
 * The card a deck instance actually fights as: upgrades applied, sigil traits
 * merged in.
 *
 * `traits` is rewritten only when a sigil added something, so a plain instance
 * resolves to exactly the object it resolved to before sigils existed.
 */
export function resolveDeckCard(base: CardPool, dc: DeckCard): UnitCard {
  const card = base.card(dc.cardId);
  const granted = grantedTraits(base, dc);
  return {
    ...card,
    id: dc.instanceId,
    cost: Math.max(0, card.cost + dc.costDelta),
    power: card.power + dc.powerBonus,
    health: card.health + dc.healthBonus,
    ...(granted.length > 0 ? { traits: [...card.traits, ...granted] } : {}),
  };
}

/**
 * A `CardPool` for one fight in one run.
 *
 * Instance ids resolve to the run's upgraded copies; every other id falls
 * through to the base pool, which is how the enemy's plain card ids still work.
 * Built fresh per fight from the deck as it stands, so a forge or a sigil
 * between two fights is visible in the second and not the first.
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
    ...dc,
    powerBonus: dc.powerBonus + (mode === 'power' ? 1 : 0),
    healthBonus: dc.healthBonus + (mode === 'health' ? 1 : 0),
    costDelta: dc.costDelta + (mode === 'cost' ? -1 : 0),
  };
}

/**
 * Does this instance already have `trait`, printed or by an earlier sigil?
 * The question the attach shelf asks of every deck card.
 */
export function hasTrait(base: CardPool, dc: DeckCard, trait: Trait): boolean {
  return base.card(dc.cardId).traits.includes(trait) || dc.sigils.some((s) => s.trait === trait);
}

/**
 * Attach one sigil to one deck card, permanently.
 *
 * Refuses a card that already has the trait, printed or from an earlier sigil,
 * because the attachment would change nothing and a sigil spent on nothing is
 * not a decision the shelf should have offered - `attachOffers` in `nodes.ts`
 * never lists such a card, and this is the check behind it.
 */
export function attachSigil(
  base: CardPool,
  deck: DeckCard[],
  index: number,
  sigil: AttachedSigil,
): void {
  const dc = deck[index];
  if (dc === undefined) {
    throw new Error(
      `sigil: deck index ${index} is not a card; the deck holds ${deck.length} card(s) and ` +
        `accepts 0..${deck.length - 1}`,
    );
  }
  if (hasTrait(base, dc, sigil.trait)) {
    throw new Error(
      `sigil: "${sigil.id}" grants ${sigil.trait} and ${dc.instanceId} already has it, so ` +
        `attaching it would change nothing. Attach it to a card without ${sigil.trait}.`,
    );
  }
  deck[index] = { ...dc, sigils: [...dc.sigils, { id: sigil.id, trait: sigil.trait }] };
}

export function cloneDeck(deck: readonly DeckCard[]): DeckCard[] {
  return deck.map((d) => ({
    instanceId: d.instanceId,
    cardId: d.cardId,
    powerBonus: d.powerBonus,
    healthBonus: d.healthBonus,
    costDelta: d.costDelta,
    sigils: d.sigils.map((s) => ({ id: s.id, trait: s.trait })),
  }));
}
