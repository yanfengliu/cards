// A canonical serialisation of the whole fight, and a 64-bit hash of it.
//
// This is what "a match replays to a byte-identical final state" is checked
// against. It covers the board, both hands, the deck cursors and the generator
// states, because a replay that agrees on the board while disagreeing on the
// RNG has not actually reproduced the fight.

import type { Fight } from './fight.ts';
import { type Entity, type EquipmentSlots, type GameState, EQUIP_SLOTS } from './state.ts';

/**
 * The three slots, in slot order, each as its card's id and the two numbers the
 * card contributes. The numbers are there because a rebalanced piece keeps its
 * id: without them a replay of an old log against a retuned pool would agree
 * with itself while the fight differed.
 */
function equipmentToCanonical(s: EquipmentSlots): string {
  return EQUIP_SLOTS.map((slot) => {
    const item = s[slot];
    return item === null ? `${slot}=-` : `${slot}=${item.id}/${item.power}/${item.armour}`;
  }).join(',');
}

/**
 * An entity, canonically.
 *
 * Equipment is appended only when something is worn. That is not tidiness: it
 * means every hash recorded before equipment existed still reproduces, so the
 * measurement's numbers and this addition are independent. An empty set of
 * slots and no slots at all are the same string for the same reason - a hero
 * wearing nothing is in the same position a unit is.
 */
function entityToCanonical(e: Entity): string {
  const base = [
    e.uid,
    e.cardId,
    e.side,
    e.isHero ? 1 : 0,
    e.basePower,
    e.bonusPower,
    e.health,
    e.maxHealth,
    e.armour,
    e.traits.join('+'),
    e.alive ? 1 : 0,
  ].join(':');
  const eq = e.equipment;
  if (eq === null || (eq.weapon === null && eq.armour === null && eq.trinket === null)) {
    return base;
  }
  return `${base}:eq(${equipmentToCanonical(eq)})`;
}

export function stateToCanonical(state: GameState): string {
  return [
    `uid=${state.nextUid}`,
    `player=[${state.board.player.map(entityToCanonical).join('|')}]`,
    `enemy=[${state.board.enemy.map(entityToCanonical).join('|')}]`,
  ].join(';');
}

export function fightToCanonical(f: Fight): string {
  return [
    `round=${f.round}`,
    `result=${f.result}`,
    stateToCanonical(f.state),
    `phand=[${f.player.hand.join(',')}]`,
    `pdeck=${f.player.cursor}/${f.player.deck.join(',')}`,
    `ehand=[${f.enemy.hand.join(',')}]`,
    `edeck=${f.enemy.cursor}/${f.enemy.deck.join(',')}`,
    `rngCombat=${f.rngCombat.s}/${f.rngCombat.n}`,
    `rngDeck=${f.rngDeck.s}/${f.rngDeck.n}`,
  ].join(';');
}

/** FNV-1a run with two offsets, concatenated, for a 64-bit hex digest. */
export function hashString(s: string): string {
  let a = 2166136261;
  let b = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822519);
    b = (b << 13) | (b >>> 19);
  }
  const hi = (a >>> 0).toString(16).padStart(8, '0');
  const lo = (b >>> 0).toString(16).padStart(8, '0');
  return hi + lo;
}

export function hashFight(f: Fight): string {
  return hashString(fightToCanonical(f));
}
