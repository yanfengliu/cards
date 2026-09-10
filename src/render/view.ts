/**
 * The view model, and the only place the event stream is turned into pictures.
 *
 * `ARCHITECTURE.md`'s rule for this layer is narrow and worth restating,
 * because the tempting shortcut is right there: **render consumes the
 * resolver's event stream and derives its own state from it. It never adds a
 * field to `GameState`.** The obvious thing an animation wants is
 * `entity.isCurrentlyActing`, and putting that on the entity would put it
 * inside the determinism hash - `engine/hash.ts` canonicalises every entity
 * field - so a purely cosmetic flag would change the fight's identity. So
 * `acting` lives here, on `EntityView`, and the engine never hears about it.
 *
 * The flow is:
 *
 *   snapshot(state)  ->  BoardView            a frozen picture of the board
 *   buildBeats(view, events)  ->  Beat[]      what to draw, in order
 *   applyBeat(view, beat)                     advance the picture one step
 *
 * After the last beat of a phase the view must equal the engine's own state at
 * the end of that phase. `viewDrift` checks exactly that and the app asserts it
 * on every phase, so a mis-applied event surfaces as a loud mismatch rather
 * than as a board that quietly drifts out of step with the fight.
 */

import type { CardPool, Entity, GameState, Side, Trait, UnitCard } from '../engine/state.ts';
import type { GameEvent } from '../engine/resolver.ts';

export type EntityView = {
  readonly uid: number;
  readonly cardId: string;
  readonly name: string;
  readonly tribe: string;
  readonly side: Side;
  readonly isHero: boolean;
  readonly basePower: number;
  bonusPower: number;
  health: number;
  readonly maxHealth: number;
  readonly armour: number;
  readonly traits: readonly Trait[];
  readonly cost: number;
  alive: boolean;
  /** Presentation only. Never round-trips into `GameState`. */
  acting: boolean;
};

export type BoardView = {
  player: EntityView[];
  enemy: EntityView[];
};

/** How a buff reached its target. `via` is what the arrow on screen is labelled. */
export type BuffSource = {
  readonly sourceUid: number | null;
  readonly via: 'relay' | 'wake' | 'unknown';
};

export type Beat =
  | { readonly kind: 'act'; readonly uid: number }
  | {
      readonly kind: 'attack';
      readonly uid: number;
      readonly targetUid: number;
      readonly raw: number;
      readonly dealt: number;
      /** raw - dealt: what the target's armour ate. */
      readonly absorbed: number;
      /** dealt - target health before: overkill, thrown away. */
      readonly wasted: number;
      /** True when a Guard on the defending side took a hit meant for the pool. */
      readonly guardForced: boolean;
    }
  /**
   * The defender hitting back, drawn as its own blow immediately after the
   * attack it answers. `uid` deals, `targetUid` takes - the same way round as
   * `attack`, so one drawing routine serves both.
   */
  | {
      readonly kind: 'retaliate';
      readonly uid: number;
      readonly targetUid: number;
      readonly raw: number;
      readonly dealt: number;
      readonly absorbed: number;
      readonly wasted: number;
    }
  | { readonly kind: 'fizzle'; readonly uid: number }
  | {
      readonly kind: 'buff';
      readonly uid: number;
      readonly amount: number;
      readonly source: BuffSource;
    }
  /**
   * Damage that did not come from an attack: a spell's, or a Scorch rider's.
   * Same shape as `attack` less `guardForced`, because a spell consults no
   * Guard, and nothing hits back - which is why it is its own beat rather than
   * an `attack` with a flag the retaliation drawing would have to read.
   */
  | {
      readonly kind: 'spell';
      readonly uid: number;
      readonly targetUid: number;
      readonly raw: number;
      readonly dealt: number;
      readonly absorbed: number;
      readonly wasted: number;
    }
  | { readonly kind: 'death'; readonly uid: number; readonly side: Side };

function viewOf(e: Entity, pool: CardPool): EntityView {
  // A hero has no card in the pool, so its printed identity comes off the
  // entity itself. `cardId` is `hero:<name>` by construction in `state.ts`.
  if (e.isHero) {
    return {
      uid: e.uid,
      cardId: e.cardId,
      name: e.cardId.slice('hero:'.length),
      tribe: 'hero',
      side: e.side,
      isHero: true,
      basePower: e.basePower,
      bonusPower: e.bonusPower,
      health: e.health,
      maxHealth: e.maxHealth,
      armour: e.armour,
      traits: e.traits.slice(),
      cost: 0,
      alive: e.alive,
      acting: false,
    };
  }
  const card = pool.card(e.cardId);
  return {
    uid: e.uid,
    cardId: e.cardId,
    name: card.name,
    tribe: card.tribe,
    side: e.side,
    isHero: false,
    basePower: e.basePower,
    bonusPower: e.bonusPower,
    health: e.health,
    maxHealth: e.maxHealth,
    armour: e.armour,
    traits: e.traits.slice(),
    cost: card.cost,
    alive: e.alive,
    acting: false,
  };
}

/**
 * A card that is not on any board - in the hand, on offer as a reward, in the
 * run's deck - as the view the renderer draws. `uid` is -1 because it has none,
 * and it is drawn at its printed numbers.
 */
export function cardEntityView(card: UnitCard, side: Side = 'player'): EntityView {
  return {
    uid: -1,
    cardId: card.id,
    name: card.name,
    tribe: card.tribe,
    side,
    isHero: false,
    basePower: card.power,
    bonusPower: 0,
    health: card.health,
    maxHealth: card.health,
    armour: card.armour,
    traits: card.traits,
    cost: card.cost,
    alive: true,
    acting: false,
  };
}

export function snapshot(state: GameState, pool: CardPool): BoardView {
  return {
    player: state.board.player.map((e) => viewOf(e, pool)),
    enemy: state.board.enemy.map((e) => viewOf(e, pool)),
  };
}

export function findView(view: BoardView, uid: number): EntityView | null {
  for (const e of view.player) if (e.uid === uid) return e;
  for (const e of view.enemy) if (e.uid === uid) return e;
  return null;
}

export function power(e: EntityView): number {
  return e.basePower + e.bonusPower;
}

/**
 * The neighbour the engine would call "the unit to my right".
 *
 * A dead unit is spliced off the board in `checkStateBased`, so the engine's
 * neighbour of a unit whose right-hand neighbour just died is the one *past*
 * the corpse. The view keeps corpses in the row until the end of the phase so
 * they can be seen dying, so it has to step over them here or every adjacency
 * question answered after a death is answered about a dead card. A dead hero is
 * the exception in both places: `checkStateBased` keeps heroes on the board.
 */
export function rightOf(view: BoardView, e: EntityView): EntityView | null {
  const row = view[e.side];
  for (let i = row.indexOf(e) + 1; i > 0 && i < row.length; i++) {
    const next = row[i]!;
    if (next.alive || next.isHero) return next;
  }
  return null;
}

export function leftOf(view: BoardView, e: EntityView): EntityView | null {
  const row = view[e.side];
  const start = row.indexOf(e);
  if (start < 0) return null;
  for (let i = start - 1; i >= 0; i--) {
    const prev = row[i]!;
    if (prev.alive || prev.isHero) return prev;
  }
  return null;
}

/**
 * Attribute a `powerGained` event to the trait that caused it.
 *
 * The engine's `powerGained` event carries `{uid, amount}` and not the uid of
 * whatever granted it, although the `gainPower` *effect* does carry a
 * `sourceUid`. That is the one thing the animation genuinely needs that the
 * stream does not say outright, because a Relay buff that does not visibly
 * travel from one card to its neighbour teaches the player nothing - and
 * adjacency is the whole game. So it is reconstructed here, from the two
 * shipped power sources and the position of the event in the stream:
 *
 *   Relay fires on `afterActed{X}` and targets `rightNeighbour(X)`, on X's own
 *   side. Wake fires on `died{D, rightUid: T}` and targets T, on the *dying*
 *   side.
 *
 * **Deaths are plural and that is what mutual damage changed here.** One attack
 * can now put both entities at zero at one checkpoint, so a single effect
 * produces two `died` events and then the Wake triggers answering them, in that
 * order. Keeping only the most recent death made the first one's Wake
 * unattributable - the buff arrived after both deaths and matched neither, and
 * the arrow was simply not drawn. So every death in the phase is kept and the
 * newest matching one wins.
 *
 * That argument holds for the shipped trait set and is exactly as strong as
 * that set. `via: 'unknown'` is the honest answer for anything else, and the
 * arrow is simply not drawn. **The clean fix is one field**: put `sourceUid` on
 * the `powerGained` event, which costs the engine nothing and no `GameState`
 * field. That is an engine change, so it is reported rather than made here.
 */
function attributeBuff(
  view: BoardView,
  targetUid: number,
  lastActed: number | null,
  deaths: readonly { uid: number; rightUid: number | null }[],
): BuffSource {
  if (lastActed !== null) {
    const actor = findView(view, lastActed);
    if (actor !== null && actor.traits.includes('relay')) {
      const right = rightOf(view, actor);
      if (right !== null && right.uid === targetUid) {
        return { sourceUid: actor.uid, via: 'relay' };
      }
    }
  }
  const target = findView(view, targetUid);
  if (target !== null && target.traits.includes('wake')) {
    for (let i = deaths.length - 1; i >= 0; i--) {
      const d = deaths[i]!;
      if (d.rightUid === targetUid) return { sourceUid: d.uid, via: 'wake' };
    }
  }
  return { sourceUid: null, via: 'unknown' };
}

/** Was this attack forced onto a Guard that would not otherwise have been alone? */
function guardForced(view: BoardView, target: EntityView): boolean {
  if (!target.traits.includes('guard')) return false;
  // Forced only means something when the Guard was shielding somebody: a lone
  // Guard is the only legal target either way and the label would be noise.
  return view[target.side].some((e) => e.alive && !e.traits.includes('guard'));
}

/**
 * Turn one phase's events into the ordered beats that draw it, walking a
 * *copy-free* simulation of the same view the animation will show. The walk has
 * to happen against a live view because `guardForced`, overkill and buff
 * attribution all depend on what the board looked like at that instant, not on
 * what it looks like at the end.
 *
 * `view` is advanced as a side effect, so callers building beats ahead of time
 * hand in a scratch view and then re-snapshot for playback. `buildBeats` and
 * `applyBeat` share one mutation path so the two can never disagree.
 */
export function buildBeats(view: BoardView, events: readonly GameEvent[]): Beat[] {
  const beats: Beat[] = [];
  let lastActed: number | null = null;
  const deaths: { uid: number; rightUid: number | null }[] = [];

  for (const ev of events) {
    switch (ev.kind) {
      case 'acted': {
        lastActed = ev.uid;
        const beat: Beat = { kind: 'act', uid: ev.uid };
        beats.push(beat);
        applyBeat(view, beat);
        break;
      }
      case 'afterActed':
        // The hook itself has no picture; its consequences do.
        break;
      case 'attacked': {
        const target = findView(view, ev.targetUid);
        const before = target?.health ?? 0;
        const beat: Beat = {
          kind: 'attack',
          uid: ev.uid,
          targetUid: ev.targetUid,
          raw: ev.raw,
          dealt: ev.dealt,
          absorbed: ev.raw - ev.dealt,
          wasted: Math.max(0, ev.dealt - before),
          guardForced: target === null ? false : guardForced(view, target),
        };
        beats.push(beat);
        applyBeat(view, beat);
        break;
      }
      case 'fizzled': {
        const beat: Beat = { kind: 'fizzle', uid: ev.uid };
        beats.push(beat);
        applyBeat(view, beat);
        break;
      }
      case 'powerGained': {
        const beat: Beat = {
          kind: 'buff',
          uid: ev.uid,
          amount: ev.amount,
          source: attributeBuff(view, ev.uid, lastActed, deaths),
        };
        beats.push(beat);
        applyBeat(view, beat);
        break;
      }
      case 'retaliated': {
        const target = findView(view, ev.targetUid);
        const before = target?.health ?? 0;
        const beat: Beat = {
          kind: 'retaliate',
          uid: ev.uid,
          targetUid: ev.targetUid,
          raw: ev.raw,
          dealt: ev.dealt,
          absorbed: ev.raw - ev.dealt,
          wasted: Math.max(0, ev.dealt - before),
        };
        beats.push(beat);
        applyBeat(view, beat);
        break;
      }
      case 'damaged': {
        // Spell damage. Before the Mage's Scorch no fight the screen played
        // could produce this event - the run deals only units - and a view
        // that dropped it drifted from the engine on the first scorched line.
        const target = findView(view, ev.targetUid);
        const before = target?.health ?? 0;
        const beat: Beat = {
          kind: 'spell',
          uid: ev.uid,
          targetUid: ev.targetUid,
          raw: ev.raw,
          dealt: ev.dealt,
          absorbed: ev.raw - ev.dealt,
          wasted: Math.max(0, ev.dealt - before),
        };
        beats.push(beat);
        applyBeat(view, beat);
        break;
      }
      case 'equipped':
        // Worn, not drawn: equipment changes the hero's numbers through
        // `power()` and `armourOf()`, which the view reads off the engine's
        // state at the end of the phase. No card the run deals is equipment.
        break;
      case 'died': {
        deaths.push({ uid: ev.uid, rightUid: ev.rightUid });
        const beat: Beat = { kind: 'death', uid: ev.uid, side: ev.side };
        beats.push(beat);
        applyBeat(view, beat);
        break;
      }
    }
  }
  return beats;
}

/**
 * Advance the view by one beat.
 *
 * A dead unit is *not* spliced out here even though the engine removes it from
 * the board: the card has to stay in the row long enough to be seen dying, and
 * the row is rebuilt from the engine's own state at the end of the phase.
 * `viewDrift` knows this and compares only the entities the engine still has.
 */
export function applyBeat(view: BoardView, beat: Beat): void {
  switch (beat.kind) {
    case 'act': {
      for (const e of view.player) e.acting = false;
      for (const e of view.enemy) e.acting = false;
      const actor = findView(view, beat.uid);
      if (actor !== null) actor.acting = true;
      break;
    }
    case 'attack':
    case 'retaliate':
    case 'spell': {
      const target = findView(view, beat.targetUid);
      if (target !== null) target.health -= beat.dealt;
      break;
    }
    case 'fizzle':
      break;
    case 'buff': {
      const target = findView(view, beat.uid);
      if (target !== null) target.bonusPower += beat.amount;
      break;
    }
    case 'death': {
      const dead = findView(view, beat.uid);
      if (dead !== null) {
        dead.alive = false;
        dead.acting = false;
      }
      break;
    }
  }
}

/**
 * What the view got wrong, compared with the engine's state after the same
 * events. Empty means the two agree.
 *
 * Only entities the engine still has are compared: dead units leave the board
 * in `checkStateBased` and stay in the view so they can be animated out.
 */
export function viewDrift(view: BoardView, state: GameState): string[] {
  const problems: string[] = [];
  for (const side of ['player', 'enemy'] as const) {
    for (const e of state.board[side]) {
      const v = findView(view, e.uid);
      if (v === null) {
        problems.push(`${side} uid ${e.uid} (${e.cardId}) is on the board but not in the view`);
        continue;
      }
      if (v.health !== e.health) {
        problems.push(`uid ${e.uid} health: view ${v.health}, engine ${e.health}`);
      }
      if (v.bonusPower !== e.bonusPower) {
        problems.push(`uid ${e.uid} bonusPower: view ${v.bonusPower}, engine ${e.bonusPower}`);
      }
      if (v.alive !== e.alive) {
        problems.push(`uid ${e.uid} alive: view ${v.alive}, engine ${e.alive}`);
      }
    }
  }
  return problems;
}
