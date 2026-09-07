// Casting a spell and wearing a piece of equipment.
//
// `docs/design/game.md` gives the hero two things to spend energy on besides
// bodies: spells, which resolve immediately, and equipment, which sits in one
// of three slots until the fight ends. Both happen during the spend phase, so
// both are finished before the line resolves.
//
// The one interesting function here is `spellQueue`, and what makes it worth a
// file of its own is the `AGENTS.md` invariant it exists to satisfy:
//
//   > Card behaviour is data plus a named effect, never bespoke branching.
//
// So the switch below is over the *verb*, never over the card. Adding a spell
// is adding a row to `src/content/cards.ts`. Adding a shape of spell that no
// verb covers is adding a verb to `SpellEffectSpec` and a case to `apply`,
// which `ARCHITECTURE.md` makes a coordinator decision rather than a worker's.
//
// Nothing here mutates state. Every write still happens inside `apply`.

import type { Rng } from './rng.ts';
import {
  type Effect,
  type GameEvent,
  DEFAULT_MAX_ITERATIONS,
  drain,
} from './resolver.ts';
import {
  type Entity,
  type EquipmentCard,
  type GameState,
  type Side,
  type SpellCard,
  heroOf,
  otherSide,
} from './state.ts';

/**
 * Bind a spell's data to the effects that carry it out.
 *
 * Which side each verb aims at is part of the verb, not part of the card:
 * damage goes to the caster's opponent and a buff goes to the caster's own
 * line. A card that wanted to aim differently would be a new verb.
 *
 * The effects are queued in written order, and `drain` is a queue, so a spell
 * reading "wipe the board, then buff my line" does those two things in that
 * order with the deaths from the first already resolved.
 */
export function spellQueue(caster: Entity, spell: SpellCard): Effect[] {
  const enemy = otherSide(caster.side);
  const out: Effect[] = [];
  for (const spec of spell.effects) {
    switch (spec.kind) {
      case 'damageOne':
        out.push({ kind: 'damageOne', uid: caster.uid, amount: spec.amount });
        break;
      case 'damageAll':
        out.push({ kind: 'damageAll', uid: caster.uid, side: enemy, amount: spec.amount });
        break;
      case 'buffAll':
        out.push({ kind: 'buffAll', uid: caster.uid, side: caster.side, amount: spec.amount });
        break;
      case 'gainPower':
        out.push({
          kind: 'gainPower',
          uid: caster.uid,
          amount: spec.amount,
          sourceUid: caster.uid,
        });
        break;
    }
  }
  return out;
}

/**
 * Cast a spell. The hero casts - `docs/design/game.md` has no other caster -
 * so the caster is the rightmost entity of its own line and every verb reads
 * its side from there.
 *
 * The whole spell drains before this returns, deaths, triggers and all, which
 * is what "immediate effect" means: nothing of it is left pending when the line
 * starts resolving.
 */
export function castSpell(
  state: GameState,
  side: Side,
  spell: SpellCard,
  rng: Rng,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
): GameEvent[] {
  const hero = heroOf(state, side);
  return drain(state, spellQueue(hero, spell), rng, maxIterations).events;
}

/**
 * Wear a piece of equipment, replacing whatever is in its slot.
 *
 * It goes through the queue rather than writing the slot directly, so `apply`
 * stays the only place state is written and the swap shows up in the event
 * stream the animation layer replays.
 */
export function equipItem(
  state: GameState,
  side: Side,
  item: EquipmentCard,
  rng: Rng,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
): GameEvent[] {
  const hero = heroOf(state, side);
  return drain(state, [{ kind: 'equip', uid: hero.uid, item }], rng, maxIterations).events;
}
