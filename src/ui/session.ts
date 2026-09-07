/**
 * The human's fight driver.
 *
 * `engine/fight.ts` already has a driver - `runRound` - and it is the right one
 * for a bot: hand it a policy, get a `RoundRecord` back. It is the wrong one
 * for a screen, for one reason. `resolvePhase` *returns* the event stream and
 * `runRound` drops it on the floor, and that stream is the entire input to the
 * animation layer: `ARCHITECTURE.md` requires render to consume the resolver's
 * events and derive its own view state from them, never to diff two boards and
 * guess what happened in between.
 *
 * So this file runs the same round out of the same exported engine pieces and
 * keeps the events. It carries two small replications of logic that
 * `engine/fight.ts` keeps private - `settle` and `enemyPlays` - and that is a
 * real risk: two drivers that drift apart are two different games, and the one
 * with a screen would be the one nobody measured. **That risk is gated, not
 * accepted.** `test/ui-session.test.ts` replays a recorded bot fight through
 * this driver and requires `hashFight` to agree after every single round, over
 * a seed range. Change the enemy's insertion index here, or the order of
 * `settle` against the timeout check, and that test goes red.
 *
 * Nothing in this file writes to `src/engine/`, and no field is added to
 * `GameState`.
 */

import {
  type Fight,
  type Placement,
  applyPlacements,
  drawTo,
  selectPlays,
} from '../engine/fight.ts';
import { resolvePhase, startTurn, type GameEvent } from '../engine/resolver.ts';
import {
  type CardPool,
  type GameState,
  type Side,
  cloneState,
  heroOf,
  insertUnit,
  makeUnit,
  unitCount,
} from '../engine/state.ts';

export type Segment =
  | {
      readonly kind: 'phase';
      readonly side: Side;
      readonly events: readonly GameEvent[];
      /** The engine's own state once this phase finished. The view re-syncs here. */
      readonly stateAfter: GameState;
    }
  | {
      readonly kind: 'spawns';
      readonly side: 'enemy';
      readonly uids: readonly number[];
      readonly stateAfter: GameState;
    };

export type Committed = {
  /** The board the animation starts from: placements made, nothing resolved. */
  readonly stateAtStart: GameState;
  readonly segments: readonly Segment[];
  readonly result: Fight['result'];
};

/**
 * `engine/fight.ts` keeps `settleResult` private. Reproduced here rather than
 * exported, so the engine is untouched; pinned by `test/ui-session.test.ts`.
 */
function settle(f: Fight): void {
  if (!heroOf(f.state, 'enemy').alive) f.result = 'playerWin';
  else if (!heroOf(f.state, 'player').alive) f.result = 'enemyWin';
}

/**
 * The enemy's turn, identical to `engine/fight.ts`'s private `enemyPlays`: draw
 * up, run the shared `selectPlays` policy - which is imported, not copied, so
 * the *decision* cannot drift - and append each card immediately left of the
 * hero. Returns the uids created, because a spawn is not an event and the
 * animation still has to show a body arriving.
 */
function enemyPlays(f: Fight): number[] {
  drawTo(f.enemy, f.pool.handSize, f.rngDeck);
  const chosen = selectPlays(f.enemy.hand, f.pool.energyPerTurn, f.pool);
  const ids = chosen.map((i) => f.enemy.hand[i]!);
  const uids: number[] = [];
  for (const id of ids) {
    const at = f.enemy.hand.indexOf(id);
    f.enemy.hand.splice(at, 1);
    const unit = makeUnit(f.state, 'enemy', f.pool.card(id));
    insertUnit(f.state, 'enemy', unit, unitCount(f.state, 'enemy'));
    uids.push(unit.uid);
  }
  return uids;
}

/**
 * Open the player's turn: this-turn buffs expire and the hand is drawn up.
 * Returns false when the fight is already over.
 */
export function beginRound(f: Fight): boolean {
  if (f.result !== 'ongoing') return false;
  f.round++;
  startTurn(f.state, 'player');
  drawTo(f.player, f.pool.handSize, f.rngDeck);
  return true;
}

/**
 * Spend the turn and resolve it. The order below is `runRound`'s order, and the
 * gate in `test/ui-session.test.ts` is what keeps it that way.
 */
export function commitRound(f: Fight, placements: readonly Placement[]): Committed {
  applyPlacements(f, placements.slice());
  const stateAtStart = cloneState(f.state);
  const segments: Segment[] = [];

  segments.push({
    kind: 'phase',
    side: 'player',
    events: resolvePhase(f.state, 'player', f.rngCombat),
    stateAfter: cloneState(f.state),
  });
  settle(f);

  if (f.result === 'ongoing') {
    startTurn(f.state, 'enemy');
    const uids = enemyPlays(f);
    segments.push({ kind: 'spawns', side: 'enemy', uids, stateAfter: cloneState(f.state) });
    segments.push({
      kind: 'phase',
      side: 'enemy',
      events: resolvePhase(f.state, 'enemy', f.rngCombat),
      stateAfter: cloneState(f.state),
    });
    settle(f);
    if (f.result === 'ongoing' && f.round >= f.maxRounds) f.result = 'timeout';
  }

  return { stateAtStart, segments, result: f.result };
}

/**
 * The line the player is building: the real units on the board with the cards
 * they have placed this turn spliced in where they chose.
 */
export type LineItem =
  | { readonly kind: 'real'; readonly uid: number }
  | { readonly kind: 'ghost'; readonly id: number; readonly cardId: string };

/**
 * Turn a built line back into the ordered insertions that reproduce it.
 *
 * `applyPlacements` inserts one card at a time, each index read against the
 * board as it stands at that moment, so the indices are not simply "where the
 * card ended up" in general. They are here, and the argument is one line:
 * ghosts are emitted left to right, so when a ghost at final position `p` is
 * inserted, everything to its left - every real unit and every earlier ghost -
 * is already in the array, and the array's first `p` entries are exactly those.
 * So its insertion index is `p`.
 */
export function placementsFrom(line: readonly LineItem[]): Placement[] {
  const out: Placement[] = [];
  line.forEach((item, index) => {
    if (item.kind === 'ghost') out.push({ cardId: item.cardId, index });
  });
  return out;
}

/** Energy the built line costs. The UI is the only thing enforcing the cap. */
export function lineCost(line: readonly LineItem[], pool: CardPool): number {
  let total = 0;
  for (const item of line) {
    if (item.kind === 'ghost') total += pool.card(item.cardId).cost;
  }
  return total;
}
