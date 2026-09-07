// The resolver. Follows `ARCHITECTURE.md`'s "resolution graph" contract:
//
//   - an explicit effect queue, never recursion
//   - `apply` is the only place state mutates
//   - deaths are batched at a state-based checkpoint after every effect
//   - trigger order is board order, and board order means board *index*
//   - inside one unit, trait order is the source order of the blocks in
//     `triggersFor`
//   - a loop iteration cap that throws with the queue trace
//
// The queue is drained once per acting entity, which is what "resolves left to
// right, one unit at a time" means: a unit's whole cascade finishes before its
// neighbour starts.

import { type Rng, pick } from './rng.ts';
import {
  type Entity,
  type GameState,
  type Side,
  otherSide,
  power,
  requireEntity,
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
 * One extra trigger rule, asked of every living entity in board order after the
 * shipped traits have had their say. It exists for tests and production passes
 * nothing; `triggersFor` says why it has to exist at all.
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
 */
function apply(
  state: GameState,
  effect: Effect,
  rng: Rng,
): { events: GameEvent[]; spawned: Effect[] } {
  switch (effect.kind) {
    case 'act': {
      const e = requireEntity(state, effect.uid);
      if (!e.alive) return { events: [], spawned: [] };
      return {
        events: [{ kind: 'acted', uid: e.uid }],
        spawned: [
          { kind: 'attack', uid: e.uid },
          { kind: 'afterAct', uid: e.uid },
        ],
      };
    }

    case 'attack': {
      const e = requireEntity(state, effect.uid);
      if (!e.alive) return { events: [], spawned: [] };
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
      const e = requireEntity(state, effect.uid);
      if (!e.alive) return { events: [], spawned: [] };
      return { events: [{ kind: 'afterActed', uid: e.uid }], spawned: [] };
    }

    case 'gainPower': {
      const e = requireEntity(state, effect.uid);
      if (!e.alive) return { events: [], spawned: [] };
      e.bonusPower += effect.amount;
      return {
        events: [{ kind: 'powerGained', uid: e.uid, amount: effect.amount }],
        spawned: [],
      };
    }

    case 'grantWard': {
      const e = requireEntity(state, effect.uid);
      if (!e.alive) return { events: [], spawned: [] };
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
 * `event.rightUid === e.uid` - so no event can ever match two units, and the
 * two loops below decide nothing that a fixture built from the shipped traits
 * can observe. Reversing them, or ordering by uid, leaves the whole suite
 * green. A rule that fires for more than one unit is the only way to make those
 * two properties fail when they are broken, and a gate nobody can make go red
 * is not a gate. See `test/resolver-order.test.ts`.
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
