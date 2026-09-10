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
 *
 * **Everything a side is about to deal has to be in here, not only what it
 * swings for.** A class trait that adds damage and is missing from this file
 * does not read as a missing feature, it reads as a wrong number: a Mage facing
 * three enemy units was told "1 of yours will swing for 1 Power" while it was
 * about to deal 1 and then burn 3 more. Volley is counted through `swingsOf`,
 * Scorch through `scorchers` and `burnOn`, and both are read off the traits the
 * resolver reads rather than off a list of class names.
 *
 * **Everything here that subtracts Armour subtracts `armourOf`**, which is the
 * rule `engine/state.ts` states at that function: a worn shield covers a spell
 * exactly as it covers a swing. A `damageIfHit` map used to sit beside `burnOn`
 * reading `e.armour` instead; it had no caller anywhere and was deleted rather
 * than repaired, because a second wrong number nobody draws is still a second
 * number to keep true. Gated by "the odds read Armour the way every damage site
 * must" in `test/explain.test.ts`, which is a text check and says why.
 */

import { SCORCH_DAMAGE, legalTargets, swingsOf } from '../engine/resolver.ts';
import {
  type GameState,
  type Side,
  armourOf,
  cloneState,
  heroOf,
  otherSide,
  power,
} from '../engine/state.ts';

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
  /** Attacks the attacking side will throw, hero included: a Volley body counts once per swing. */
  readonly attackers: number;
  /** Their total current Power, a Volley body's counted once per swing. */
  readonly totalPower: number;
  /** Living entities on the attacking side carrying Scorch. */
  readonly scorchers: number;
  /**
   * uid -> damage this defending unit takes for certain, after its own Armour,
   * from every Scorch on the attacking side.
   *
   * Certain is the point, and it is why this is not folded into `chance` or
   * `totalPower`: a burn picks no target and no roll can miss it. Only units are
   * in it - a rider never reaches a hero - and each burn is blunted by Armour
   * separately, so two Scorches against Armour 1 at `SCORCH_DAMAGE` 1 is still
   * nothing. A unit taking nothing is absent rather than present at zero, so the
   * screen can say "this one shrugs it off" by not finding it.
   */
  readonly burnOn: ReadonlyMap<number, number>;
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
  let scorchers = 0;
  for (const e of state.board[side]) {
    if (!e.alive) continue;
    // A Volley entity is `swingsOf` attacks at its Power, and the line on screen
    // says "N attacks for P Power", so both count every swing. `swingsOf` is the
    // resolver's own function, not a second reading of the trait.
    attackers += swingsOf(e);
    totalPower += power(e) * swingsOf(e);
    if (e.traits.includes('scorch')) scorchers++;
  }

  // The burn. It is unconditional, so it is counted per defending unit rather
  // than per attack: each Scorch on the attacking side deals `SCORCH_DAMAGE` to
  // every living enemy unit, blunted by that unit's own Armour each time.
  const burnOn = new Map<number, number>();
  if (scorchers > 0) {
    for (const t of state.board[defending]) {
      if (!t.alive || t.isHero) continue;
      const each = Math.max(0, SCORCH_DAMAGE - armourOf(t));
      if (each > 0) burnOn.set(t.uid, each * scorchers);
    }
  }

  return {
    chance,
    poolSize: targets.length,
    guarded,
    attackers,
    totalPower,
    scorchers,
    burnOn,
  };
}

/** Everything the burn lands across the defending line, Armour already off. */
export function burnTotal(odds: IncomingOdds): number {
  let total = 0;
  for (const n of odds.burnOn.values()) total += n;
  return total;
}

/** A percentage for the board, rounded the way a player reads it. */
export function pct(p: number): string {
  if (p <= 0) return '0%';
  if (p >= 1) return '100%';
  const n = p * 100;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;
}
