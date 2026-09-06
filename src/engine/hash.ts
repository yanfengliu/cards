// A canonical serialisation of the whole fight, and a 64-bit hash of it.
//
// This is what "a match replays to a byte-identical final state" is checked
// against. It covers the board, both hands, the deck cursors and the generator
// states, because a replay that agrees on the board while disagreeing on the
// RNG has not actually reproduced the fight.

import type { Fight } from './fight.ts';
import type { Entity, GameState } from './state.ts';

function entityToCanonical(e: Entity): string {
  return [
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
    e.warded ? 1 : 0,
  ].join(':');
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
