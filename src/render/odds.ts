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
 * stands**. A Guard that dies mid-phase widens the pool - and with combat
 * mutual a Guard can now die during your OWN phase, to the retaliation its
 * attack drew, which is a new way for this number to be optimistic. The label
 * on screen says "each attack, as the line stands", because a number presented
 * as more certain than it is would be the same lie in the other direction.
 */

import { legalTargets, swingsOf } from '../engine/resolver.ts';
import { type GameState, type Side, cloneState, heroOf, otherSide, power } from '../engine/state.ts';

/** Relay's flat grant, mirrored from `engine/resolver.ts`. */
const RELAY = 2;

/**
 * The board as it will stand once `side`'s own line has resolved, with the
 * Power that Relay will hand to the right already added.
 *
 * The Relay half is what the placement decision is *for*: the whole point of
 * choosing a slot is where the +2 lands, and a board that only reveals it after
 * the commit is asking the player to plan blind. A left-to-right walk is the
 * exact answer, chains included: each unit grants to a neighbour that has not
 * acted yet, and Relay's flat +2 does not compound down the line, which is
 * exactly why `docs/design/game.md` writes it as a flat number.
 *
 * Two things are deliberately *not* projected, both for the same reason - they
 * depend on a targeting roll:
 *
 *   - Wake, which answers a death, and which of your units dies is a roll.
 *   - Death by retaliation. Combat is mutual, so a unit can die during its own
 *     side's phase, and whether it does depends on which defender it drew. This
 *     projection therefore over-states your surviving line, and the label says
 *     "as the line stands" for that reason.
 *
 * A third case used to live here and is gone with the trait: Ward on your only
 * Guard emptied `legalTargets` outright, so the pre-commit board said "100%
 * onto your Guard" when the truth was 0% onto everything. Ward was removed by
 * the owner, and this projection no longer has anything to say about it.
 */
export function projectOwnPhase(state: GameState, side: Side): GameState {
  const projected = cloneState(state);
  const row = projected.board[side];
  for (let i = 0; i < row.length; i++) {
    const e = row[i]!;
    if (!e.alive) continue;
    const right = row[i + 1];
    if (right === undefined || !right.alive) continue;
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
  /** Attacks the attacking side will throw, hero included: a Volley body counts twice. */
  readonly attackers: number;
  /** Their total current Power, a Volley body's counted once per swing. */
  readonly totalPower: number;
  /** uid -> damage one *average* attack would deal it after its armour. */
  readonly damageIfHit: ReadonlyMap<number, number>;
};

/**
 * What `side` is about to throw at `otherSide(side)`.
 *
 * `legalTargets` reads only the defending side and its Guards, so one call
 * answers for every attacker on the attacking side. The side's own hero is
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
    // A Volley entity is two attacks at its Power, and the line on screen says
    // "N attacks for P Power", so both count it twice.
    attackers += swingsOf(e);
    totalPower += power(e) * swingsOf(e);
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
