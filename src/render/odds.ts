/**
 * The odds, before you commit.
 *
 * `ARCHITECTURE.md` defines fair precisely, and it is not "deterministic":
 *
 *   > Fair means the odds were visible before you committed.
 *   > Three Guards alive means each is a 33% target. Put that number on screen.
 *
 * So this is not a nicety bolted onto the board, it is the thing that makes
 * random targeting playable. Everything here is exact rather than sampled: the
 * engine picks uniformly among `legalTargets`, so the chance one attack lands
 * on a given entity is `1 / legalTargets.length`, and that is a number, not an
 * estimate. Nothing here rolls a die or clones a fight, which also means it
 * cannot accidentally become an oracle that shows the player the roll it is
 * about to lose.
 *
 * What it deliberately does *not* claim: the odds are for the board **as it
 * stands**. Two things move them before the enemy actually swings - a Ward
 * granted during your own resolution takes its target out of the pool, and a
 * Guard that dies mid-phase widens it. The label on screen says "each attack,
 * as the line stands", because a number presented as more certain than it is
 * would be the same lie in the other direction.
 */

import { legalTargets } from '../engine/resolver.ts';
import { type GameState, type Side, cloneState, heroOf, otherSide, power } from '../engine/state.ts';

/** Relay's flat grant, mirrored from `engine/resolver.ts`. */
const RELAY = 2;

/**
 * The board as it will stand once `side`'s own line has resolved: with the
 * Wards that line will grant already marked, and the Power that Relay will hand
 * to the right already added.
 *
 * This is not a guess and it does not roll anything. During a side's own phase
 * nothing on that side can be hurt - only the *other* side is attacked - so
 * every unit acts, its Ward lands on its right-hand neighbour, and its Relay
 * adds a flat +2 there, with no dependence on any targeting roll. A left-to-
 * right walk is therefore the exact answer, chains included: each unit grants
 * to the neighbour that has not acted yet, and Relay's flat +2 does not
 * compound down the line, which is exactly why `docs/design/game.md` writes it
 * as a flat number.
 *
 * Wake is deliberately *not* projected. It answers a death, and which of your
 * units dies is a roll.
 *
 * The Ward half exists because leaving it out made the fairness number *wrong*
 * rather than merely incomplete, in the most common case there is. Playing a
 * Ward to the left of your only Guard makes your whole side untargetable -
 * `legalTargets` narrows to the Guards and then removes the warded ones,
 * leaving nothing, and every enemy attack fizzles. The board before resolution
 * says "100% onto your Guard". The truth is 0% onto everything. A player who
 * commits on the first number has been told the opposite of what happens,
 * which is exactly the failure `ARCHITECTURE.md` calls being cheated.
 *
 * The Relay half is the same argument about the other half of the decision: the
 * whole point of choosing a slot is where the +2 lands, and a board that only
 * reveals it after the commit is asking the player to plan blind.
 */
export function projectOwnPhase(state: GameState, side: Side): GameState {
  const projected = cloneState(state);
  const row = projected.board[side];
  for (let i = 0; i < row.length; i++) {
    const e = row[i]!;
    if (!e.alive) continue;
    const right = row[i + 1];
    if (right === undefined || !right.alive) continue;
    if (e.traits.includes('ward')) right.warded = true;
    if (e.traits.includes('relay')) right.bonusPower += RELAY;
  }
  return projected;
}

export type IncomingOdds = {
  /** uid -> chance one attack from `attacker` lands here, 0..1. */
  readonly chance: ReadonlyMap<number, number>;
  /** How many entities are in the legal pool. */
  readonly poolSize: number;
  /** True when Guard is narrowing the pool: some living non-Guard is excluded. */
  readonly guarded: boolean;
  /** Living entities on the attacking side that will act, hero included. */
  readonly attackers: number;
  /** Their total current Power. */
  readonly totalPower: number;
  /** uid -> damage one *average* attack would deal it after its armour. */
  readonly damageIfHit: ReadonlyMap<number, number>;
};

/**
 * What `side` is about to throw at `otherSide(side)`.
 *
 * `legalTargets` reads only the attacker's side, its Guards and its Wards, so
 * one call answers for every attacker on that side. The side's own hero is
 * handed in as the stand-in attacker; it is always on the board, alive or not.
 */
export function incomingOdds(state: GameState, side: Side): IncomingOdds {
  const defending = otherSide(side);
  const targets = legalTargets(state, heroOf(state, side));
  const chance = new Map<number, number>();
  for (const t of targets) chance.set(t.uid, 1 / targets.length);

  const living = state.board[defending].filter((e) => e.alive);
  const guarded = targets.length > 0 && living.length > targets.length;

  let attackers = 0;
  let totalPower = 0;
  for (const e of state.board[side]) {
    if (!e.alive) continue;
    attackers++;
    totalPower += power(e);
  }

  // One attacker's damage against one defender is `power - armour`, floored at
  // zero. With several attackers the useful single number is the average, and
  // it is labelled as such on screen.
  const average = attackers === 0 ? 0 : totalPower / attackers;
  const damageIfHit = new Map<number, number>();
  for (const e of living) {
    damageIfHit.set(e.uid, Math.max(0, average - e.armour));
  }

  return { chance, poolSize: targets.length, guarded, attackers, totalPower, damageIfHit };
}

/** A percentage for the board, rounded the way a player reads it. */
export function pct(p: number): string {
  if (p <= 0) return '0%';
  if (p >= 1) return '100%';
  const n = p * 100;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;
}
