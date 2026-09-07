// A canonical serialisation of a whole run, and a 64-bit hash of it.
//
// The run's counterpart to `src/engine/hash.ts`, and it covers the same class
// of things for the same reason: a replay that agrees on the hero's Health
// while disagreeing on the run generator's position has not reproduced the run,
// it has coincided with it. So the digest carries the generator state and draw
// count, the deck instance by instance with its permanent upgrades, the map
// every act was routed through, and the sigil list - which is empty in every
// run this unit can produce, and is in the digest so that stops being true
// loudly rather than quietly the day sigils land.
//
// `hashString` is the engine's. Sharing it is the point: two digests produced
// by the same function are comparable, and a run digest that quoted a fight
// digest computed some other way would not be.

import { hashString } from '../engine/hash.ts';
import type { ActMap, DeckCard, RunState } from './types.ts';

function deckToCanonical(deck: readonly DeckCard[]): string {
  return deck
    .map((d) => `${d.instanceId}+${d.powerBonus}/${d.healthBonus}/${d.costDelta}`)
    .join(',');
}

/**
 * A map, edges included. Two maps with the same node types in the same rows but
 * different edges are different maps, and a route is only meaningful against
 * the edges it was chosen from.
 */
export function mapToCanonical(map: ActMap): string {
  const nodes = map.nodes
    .map((n) => `${n.id}@${n.row}.${n.col}:${n.type}>${n.next.join('.')}`)
    .join('|');
  return `act=${map.act};rows=[${map.rows.map((r) => r.join('.')).join('|')}];nodes=[${nodes}]`;
}

export function runToCanonical(run: RunState): string {
  return [
    `seed=${run.seed}`,
    `act=${run.act}`,
    `row=${run.row}`,
    `node=${run.nodeId}`,
    `result=${run.result}`,
    `ending=${
      run.ending === null
        ? 'none'
        : `${run.ending.act}.${run.ending.row}.${run.ending.nodeType}.${run.ending.cause}`
    }`,
    `hero=${run.hero.health}/${run.hero.maxHealth}`,
    `gold=${run.gold}`,
    `deck=[${deckToCanonical(run.deck)}]`,
    `nextInstance=${run.nextInstance}`,
    `sigils=[${run.sigils
      .map((s) => `${typeof s.target === 'string' ? s.target : s.target.instanceId}:${s.sigilId}`)
      .join(',')}]`,
    `nodes=${run.nodesVisited}`,
    `fights=${run.fightsFought}`,
    `rounds=${run.roundsFought}`,
    `forges=${run.forgesApplied}`,
    `cards=${run.cardsGained}`,
    `rng=${run.rng.s}/${run.rng.n}`,
    `maps=[${run.maps.map(mapToCanonical).join('||')}]`,
  ].join(';');
}

export function hashRun(run: RunState): string {
  return hashString(runToCanonical(run));
}

/** Just the three maps. Used to check that a seed's map is route-independent. */
export function hashMaps(run: RunState): string {
  return hashString(run.maps.map(mapToCanonical).join('||'));
}
