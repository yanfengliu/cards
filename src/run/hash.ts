// A canonical serialisation of a whole run, and a 64-bit hash of it.
//
// The run's counterpart to `src/engine/hash.ts`, and it covers the same class
// of things for the same reason: a replay that agrees on the hero's Health
// while disagreeing on the run generator's position has not reproduced the run,
// it has coincided with it. So the digest carries the generator state and draw
// count, the deck instance by instance with its permanent upgrades and the
// sigils attached to it, the map every act was routed through, the class the
// run was started as, and the ledger of every sigil granted. The ledger was in
// the digest for a unit before any run could fill it, so that the day sigils
// landed the hash would move loudly rather than agree with itself; the
// per-instance list beside it is what makes two runs that attached the same
// sigil to different Squires hash apart.
//
// The class line means no run hash recorded before classes existed
// reproduces, and that is deliberate: a run's class is never absent, so there
// is no "nothing worn" case to leave the line off for, as `engine/hash.ts`
// does for equipment.
//
// The unlock line is the opposite case and is handled the opposite way: a run
// can genuinely have no unlock layer - that is what every measurement and
// every log written before unlocks existed is - so the line is appended only
// when there is a set, and no recorded run hash moves. It is in the digest at
// all because two runs that drafted from different pools are different runs
// even where their states happen to coincide: a run that declines every reward
// reaches the same deck, the same gold and the same generator position whatever
// was on the shelf, and without this line those two would hash the same.
//
// `hashString` is the engine's. Sharing it is the point: two digests produced
// by the same function are comparable, and a run digest that quoted a fight
// digest computed some other way would not be.

import { hashString } from '../engine/hash.ts';
import type { ActMap, DeckCard, RunState } from './types.ts';

/**
 * A deck card's sigils are appended only when it has some, so an instance with
 * none canonicalises to exactly the string it did before sigils existed.
 */
function deckToCanonical(deck: readonly DeckCard[]): string {
  return deck
    .map(
      (d) =>
        `${d.instanceId}+${d.powerBonus}/${d.healthBonus}/${d.costDelta}` +
        (d.sigils.length > 0 ? `~${d.sigils.map((s) => `${s.id}=${s.trait}`).join('~')}` : ''),
    )
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

/**
 * The unlock set, appended only when the run had one.
 *
 * The same rule as a deck card's sigils just above, and for the same reason: a
 * run played with no unlock layer - every measurement, every fixture, every
 * log written before unlocks existed - canonicalises to exactly the string it
 * did before, so no recorded run hash moves. A run that *was* narrowed carries
 * both lists, because two runs that drafted from different pools are different
 * runs even when they declined every card and their states coincide.
 */
function unlockedToCanonical(run: RunState): string[] {
  const u = run.unlocked;
  if (u === null) return [];
  return [`unlocked=g[${u.gated.join(',')}]/o[${u.owned.join(',')}]`];
}

export function runToCanonical(run: RunState): string {
  return [
    `seed=${run.seed}`,
    `class=${run.classId}`,
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
    ...unlockedToCanonical(run),
  ].join(';');
}

export function hashRun(run: RunState): string {
  return hashString(runToCanonical(run));
}

/** Just the three maps. Used to check that a seed's map is route-independent. */
export function hashMaps(run: RunState): string {
  return hashString(run.maps.map(mapToCanonical).join('||'));
}
