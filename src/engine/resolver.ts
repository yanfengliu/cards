// The resolver. Follows `ARCHITECTURE.md`'s "resolution graph" contract:
//
//   - an explicit effect queue, never recursion
//   - `apply` is the only place state mutates
//   - deaths are batched at a state-based checkpoint after every effect
//   - trigger order is board order, and board order means board *index*
//   - two deaths at one checkpoint are announced in that same board order, and
//     that is decided in `checkStateBased`, not in `triggersFor`
//   - inside one unit, trait order is the source order of the blocks in
//     `triggersFor`
//   - an effect's own continuations queue ahead of any reaction to it, and the
//     two reaction sources queue in the order their events were emitted
//   - an effect naming an entity that has left the board is skipped, not an
//     error, and a unit and a hero answer that the same way
//   - a loop iteration cap that throws with the queue trace, capping the exact
//     number of effects that may be applied
//
// The queue is drained once per acting entity, which is what "resolves left to
// right, one unit at a time" means: a unit's whole cascade finishes before its
// neighbour starts.

import { type Rng, pick } from './rng.ts';
import {
  type Entity,
  type GameState,
  type Side,
  findEntity,
  otherSide,
  power,
  rightNeighbour,
} from './state.ts';

export type Effect =
  | { kind: 'act'; uid: number }
  | { kind: 'attack'; uid: number }
  | { kind: 'afterAct'; uid: number }
  | { kind: 'gainPower'; uid: number; amount: number; sourceUid: number }
  | { kind: 'grantWard'; uid: number; sourceUid: number };

export type GameEvent =
  | { kind: 'acted'; uid: number }
  | { kind: 'afterActed'; uid: number }
  | { kind: 'attacked'; uid: number; targetUid: number; raw: number; dealt: number }
  | { kind: 'fizzled'; uid: number }
  | { kind: 'powerGained'; uid: number; amount: number }
  | { kind: 'warded'; uid: number }
  | { kind: 'died'; uid: number; side: Side; leftUid: number | null; rightUid: number | null };

/**
 * One extra trigger rule, asked of every living entity inside the same
 * board-order walk as the shipped traits - immediately after that entity's own
 * shipped blocks, not in a pass of its own once every entity has been asked.
 * It exists for tests and production passes nothing; `triggersFor` says why it
 * has to exist at all, and why where it is asked is load-bearing.
 */
export type TriggerRule = (
  state: GameState,
  event: GameEvent,
  entity: Entity,
) => readonly Effect[];

export const RELAY_POWER = 2;
export const WAKE_POWER = 2;
export const DEFAULT_MAX_ITERATIONS = 4096;

/**
 * Legal targets for an attack by `attacker`.
 *
 * Design rules, in this order:
 *   - the pool is every living entity on the defending side, hero included
 *   - Guard: if any Guard lives on that side, the pool narrows to the Guards
 *   - Ward: a warded entity is removed from the pool
 *
 * Ward is applied after Guard, so warding every living Guard leaves no legal
 * target and the attack fizzles. That combination is not covered by the design
 * document; see `docs/work/1_turn-prototype/plan.md`.
 */
export function legalTargets(state: GameState, attacker: Entity): Entity[] {
  const defenders = state.board[otherSide(attacker.side)];
  const living: Entity[] = [];
  let anyGuard = false;
  for (const e of defenders) {
    if (!e.alive) continue;
    living.push(e);
    if (e.traits.includes('guard')) anyGuard = true;
  }
  const gated = anyGuard ? living.filter((e) => e.traits.includes('guard')) : living;
  return gated.filter((e) => !e.warded);
}

/**
 * The only function in the engine that writes to `GameState`.
 *
 * Returns the events it produced and any effects that directly continue it.
 * Spawned effects are queued ahead of trigger effects, which is what keeps
 * "its action, then any after-acting trait" in that order.
 *
 * An effect that names an entity which is no longer there is skipped, not an
 * error, and that is the same answer for a unit as for a hero. Deaths are
 * batched at a checkpoint precisely so that "A kills B, B's trigger kills A"
 * does not depend on evaluation order (`ARCHITECTURE.md`), which means an
 * effect can be queued against a living entity and come up after that entity
 * has died. A dead hero stays on the board and every case's `!e.alive` guard
 * already caught it; a dead unit is *removed* from the board, so the same
 * sequence used to reach `requireEntity` and throw. One situation, two
 * answers, decided by a filter that exists for an unrelated reason.
 *
 * Throwing could not have been a useful diagnostic either: `findEntity`
 * returns null identically for "died and was removed" and "never existed", so
 * the message named a uid and could say nothing about which had happened.
 *
 * This is reachable the moment a trigger queues an action against a unit that
 * can die first - `Echo` in `docs/design/game.md` is exactly that shape.
 * Gated by "an effect naming an entity that has left the board is skipped" in
 * `test/resolver-order.test.ts`.
 */
function apply(
  state: GameState,
  effect: Effect,
  rng: Rng,
): { events: GameEvent[]; spawned: Effect[] } {
  switch (effect.kind) {
    case 'act': {
      const e = findEntity(state, effect.uid);
      if (e === null || !e.alive) return { events: [], spawned: [] };
      return {
        events: [{ kind: 'acted', uid: e.uid }],
        spawned: [
          { kind: 'attack', uid: e.uid },
          { kind: 'afterAct', uid: e.uid },
        ],
      };
    }

    case 'attack': {
      const e = findEntity(state, effect.uid);
      if (e === null || !e.alive) return { events: [], spawned: [] };
      const targets = legalTargets(state, e);
      if (targets.length === 0) {
        return { events: [{ kind: 'fizzled', uid: e.uid }], spawned: [] };
      }
      const target = pick(rng, targets);
      const raw = power(e);
      // Armour is flat per attack, to a minimum of zero. Damage does not carry:
      // the whole hit lands on one target and any excess is wasted.
      const dealt = Math.max(0, raw - target.armour);
      target.health -= dealt;
      return {
        events: [{ kind: 'attacked', uid: e.uid, targetUid: target.uid, raw, dealt }],
        spawned: [],
      };
    }

    case 'afterAct': {
      const e = findEntity(state, effect.uid);
      if (e === null || !e.alive) return { events: [], spawned: [] };
      return { events: [{ kind: 'afterActed', uid: e.uid }], spawned: [] };
    }

    case 'gainPower': {
      const e = findEntity(state, effect.uid);
      if (e === null || !e.alive) return { events: [], spawned: [] };
      e.bonusPower += effect.amount;
      return {
        events: [{ kind: 'powerGained', uid: e.uid, amount: effect.amount }],
        spawned: [],
      };
    }

    case 'grantWard': {
      const e = findEntity(state, effect.uid);
      if (e === null || !e.alive) return { events: [], spawned: [] };
      e.warded = true;
      return { events: [{ kind: 'warded', uid: e.uid }], spawned: [] };
    }
  }
}

/**
 * The state-based checkpoint. Health is only inspected here, never at the
 * instant damage lands, so "A kills B, B's death trigger kills A" does not
 * depend on evaluation order.
 *
 * Dead units leave the board. Heroes stay in place even when dead: the hero
 * anchors the right end of the line, and the fight ends the moment one dies.
 *
 * When two entities are at zero at one checkpoint, the order their `died`
 * events come out is decided by the two loops below and nowhere else - the
 * player's line left to right, then the enemy's - and that is the order the
 * triggers answering those deaths queue in. It is the same board order
 * `triggersFor` walks in, but it is a *separate* walk: reversing either loop
 * here leaves `triggersFor` untouched, so the board-order gates do not cover
 * it. Gated by the two "simultaneous deaths" tests in
 * `test/resolver-order.test.ts`, which need no seam - a unit sitting at zero
 * Health before a checkpoint is enough.
 *
 * Nothing shipped puts two units at zero at once. AoE is the first designed
 * effect that does, and `docs/design/game.md` names AoE as the only counter to
 * a wide board, so this stops being invisible the day that lands.
 */
function checkStateBased(state: GameState): GameEvent[] {
  const deaths: GameEvent[] = [];
  for (const side of ['player', 'enemy'] as const) {
    const board = state.board[side];
    let anyDead = false;
    for (let i = 0; i < board.length; i++) {
      const e = board[i]!;
      if (!e.alive || e.health > 0) continue;
      e.alive = false;
      anyDead = true;
      // Neighbours are read before removal, so Wake sees the line as it was.
      const left = board[i - 1] ?? null;
      const right = board[i + 1] ?? null;
      deaths.push({
        kind: 'died',
        uid: e.uid,
        side,
        leftUid: left === null ? null : left.uid,
        rightUid: right === null ? null : right.uid,
      });
    }
    if (anyDead) {
      state.board[side] = board.filter((e) => e.alive || e.isHero);
    }
  }
  return deaths;
}

/**
 * Every trigger that responds to `event`, in board order: the player's line
 * left to right, then the enemy's. Board order is the documented tie-break for
 * two units triggering on the same event, and board order means board *index* -
 * where a unit stands - never uid, which only records when the unit was made.
 *
 * The tie-break *inside* one unit is the source order of the `if` blocks
 * below, and this is the only place it is written down. A unit carrying both
 * Relay and Ward grants the power first and the ward second, because Relay's
 * block is written first. There is no priority number on a trait; moving a
 * block moves the rule. No shipped card carries two triggering traits, so today
 * this decides nothing - it decides everything the day one does.
 *
 * `extra` is a seam for tests, and the reason it is here is worth stating.
 * Every shipped trigger is keyed to a single uid - `event.uid === e.uid`, or
 * `event.rightUid === e.uid` - so no event can ever match two units, and for
 * *these two loops* no fixture built from the shipped traits alone can tell the
 * correct order from a reversed one or a uid-ordered one. A rule that fires for
 * more than one unit is the only way to make those two properties fail when
 * they are broken, and a gate nobody can make go red is not a gate.
 *
 * That is a claim about this function, not about resolution order generally.
 * Two sibling orderings *are* reachable from the shipped traits and are gated
 * without any seam: which of two simultaneous deaths is announced first
 * (`checkStateBased`) and whether a death's triggers queue behind the acting
 * effect's own continuations (`drain`).
 *
 * Where `extra` is asked is load-bearing, not incidental. It runs inside this
 * walk, right after the same entity's shipped blocks. Hoisting it into a pass
 * of its own after both loops would still order the seam's triggers by board
 * index - so every board-order test written with the seam alone stays green -
 * while silently putting every seam trigger after every shipped trigger. A
 * shipped trait and a seam rule answering one event would stop interleaving,
 * and with the seam decoupled the shipped loops could then be reversed with the
 * whole suite green. Gated by "a shipped trigger and a seam trigger answering
 * one event interleave by board index" in `test/resolver-order.test.ts`.
 */
function triggersFor(state: GameState, event: GameEvent, extra: TriggerRule | null): Effect[] {
  const out: Effect[] = [];
  for (const side of ['player', 'enemy'] as const) {
    for (const e of state.board[side]) {
      if (!e.alive) continue;

      if (event.kind === 'afterActed' && event.uid === e.uid) {
        // Relay - after acting, the unit to my right gains +2 Power this turn.
        if (e.traits.includes('relay')) {
          const r = rightNeighbour(state, e);
          if (r !== null && r.alive) {
            out.push({ kind: 'gainPower', uid: r.uid, amount: RELAY_POWER, sourceUid: e.uid });
          }
        }
        // Ward - the unit to my right cannot be struck this turn.
        if (e.traits.includes('ward')) {
          const r = rightNeighbour(state, e);
          if (r !== null && r.alive) {
            out.push({ kind: 'grantWard', uid: r.uid, sourceUid: e.uid });
          }
        }
      }

      // Wake - when the unit to my left dies this turn, gain +2 Power.
      if (event.kind === 'died' && event.rightUid === e.uid && e.traits.includes('wake')) {
        out.push({ kind: 'gainPower', uid: e.uid, amount: WAKE_POWER, sourceUid: event.uid });
      }

      if (extra !== null) {
        for (const t of extra(state, event, e)) out.push(t);
      }
    }
  }
  return out;
}

export class ResolverLoopError extends Error {
  readonly trace: Effect[];
  constructor(message: string, trace: Effect[]) {
    super(message);
    this.name = 'ResolverLoopError';
    this.trace = trace;
  }
}

export type DrainResult = {
  events: GameEvent[];
  trace: Effect[];
  iterations: number;
};

/**
 * Drain the effect queue. This is the loop from `ARCHITECTURE.md`.
 *
 * A hang is strictly worse than a crash, so the iteration cap throws and hands
 * back the full trace of what it was chewing on.
 *
 * `maxIterations` is the number of effects that may be applied, exactly: a
 * drain needing `maxIterations` effects finishes, and one needing
 * `maxIterations + 1` throws. `>` in place of `>=` below moves that boundary
 * by one and nothing else in the engine notices, so the boundary itself is
 * gated - both sides of it - in `test/resolver-order.test.ts`.
 */
export function drain(
  state: GameState,
  queue: Effect[],
  rng: Rng,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
  extraTriggers: TriggerRule | null = null,
): DrainResult {
  const trace: Effect[] = [];
  const events: GameEvent[] = [];
  let iterations = 0;

  while (queue.length > 0) {
    if (iterations >= maxIterations) {
      const shown = trace.slice(-24).map((e) => `${e.kind}#${e.uid}`).join(' -> ');
      throw new ResolverLoopError(
        `resolver: effect queue exceeded ${maxIterations} iterations and did not drain. ` +
          `${queue.length} effect(s) still pending. Last effects applied: ${shown}. ` +
          `A trait that reads another trait's output needs a termination argument.`,
        trace,
      );
    }
    iterations++;

    const effect = queue.shift()!;
    trace.push(effect);

    const { events: produced, spawned } = apply(state, effect, rng);
    const deaths = checkStateBased(state);

    for (const e of produced) events.push(e);
    for (const d of deaths) events.push(d);

    // Direct continuations first, then reactions. An effect's own continuation
    // is part of the thing that is happening; a trigger is a response to it
    // having happened, and responses queue behind it.
    //
    // There are two reaction sources, not one, and they queue in the order
    // their events were emitted three lines up: the effect's own events first,
    // then the deaths the checkpoint found. The event stream is what the
    // animation layer replays, so the triggers follow the stream. Both
    // orderings are gated in `test/resolver-order.test.ts`.
    for (const s of spawned) queue.push(s);
    for (const e of produced) for (const t of triggersFor(state, e, extraTriggers)) queue.push(t);
    for (const d of deaths) for (const t of triggersFor(state, d, extraTriggers)) queue.push(t);
  }

  return { events, trace, iterations };
}

/**
 * Resolve one side's line: left to right, one entity at a time, hero last
 * because the hero is the rightmost element of the board array.
 *
 * The acting order is snapshotted before the phase, so a unit killed mid-phase
 * never acts and no unit acts twice.
 */
export function resolvePhase(
  state: GameState,
  side: Side,
  rng: Rng,
  maxIterations: number = DEFAULT_MAX_ITERATIONS,
  extraTriggers: TriggerRule | null = null,
): GameEvent[] {
  const order = state.board[side].map((e) => e.uid);
  const events: GameEvent[] = [];
  for (const uid of order) {
    const e = state.board[side].find((x) => x.uid === uid);
    if (e === undefined || !e.alive) continue;
    const result = drain(state, [{ kind: 'act', uid }], rng, maxIterations, extraTriggers);
    for (const ev of result.events) events.push(ev);
    // A dead hero ends the fight; stop resolving the line around it.
    if (!state.board.player[state.board.player.length - 1]!.alive) break;
    if (!state.board.enemy[state.board.enemy.length - 1]!.alive) break;
  }
  return events;
}

/**
 * Start of a side's turn: this-turn buffs and Ward marks expire.
 *
 * "Buffs granted during resolution last until end of turn" - clearing them at
 * the start of the owner's next turn is the same window, and it lets a Ward
 * granted in the player's phase still be up during the enemy's attacks.
 */
export function startTurn(state: GameState, side: Side): void {
  for (const e of state.board[side]) {
    e.bonusPower = 0;
    e.warded = false;
  }
}
