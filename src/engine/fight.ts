// One fight, headless and deterministic.
//
// A round is: player draws, spends energy placing units, resolves its line
// left to right with the hero last, then the enemy does the same.
//
// Everything random flows through two named streams derived from the seed:
//   - `deck`   shuffles both decks once, at setup
//   - `combat` picks targets
//
// They are separate on purpose. The A/B measurement changes only where units
// are inserted, which changes how many targeting rolls a fight consumes. A
// single shared stream would let that shift the card draw order too, and the
// two arms would then differ by more than the variable under test.
//
// The card data is handed in, never imported: `FightSetup.pool` carries the
// card lookup and the two per-round numbers, so nothing under `src/engine/`
// reaches into `src/content/`. See `CardPool` in `state.ts`.

import { castSpell, equipItem } from './cast.ts';
import { type Rng, cloneRng, makeRng, shuffle } from './rng.ts';
import {
  type Effect,
  type GameEvent,
  endFight,
  resolvePhase,
  startTurn,
} from './resolver.ts';
import {
  type CardPool,
  type GameState,
  type HeroSpec,
  type Side,
  cardCost,
  castableById,
  cloneState,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  unitCount,
} from './state.ts';

export type FightResult = 'ongoing' | 'playerWin' | 'enemyWin' | 'timeout';

export type SideState = {
  deck: string[];
  cursor: number;
  hand: string[];
};

export type Fight = {
  seed: number;
  round: number;
  maxRounds: number;
  result: FightResult;
  state: GameState;
  player: SideState;
  enemy: SideState;
  rngCombat: Rng;
  rngDeck: Rng;
  /** The cards this fight is fought with. Data in, never reached for. */
  pool: CardPool;
};

export type FightSetup = {
  seed: number;
  /** The card data, the energy per round and the hand size. */
  pool: CardPool;
  playerDeck: readonly string[];
  enemyDeck: readonly string[];
  enemyOpening: readonly string[];
  playerHero: HeroSpec;
  enemyHero: HeroSpec;
  maxRounds: number;
};

/** One placed card: which card, and where in the line it goes. */
export type Placement = { cardId: string; index: number };

/**
 * One spell cast or one piece of equipment worn. There is nothing to choose
 * beyond the card: a spell's targeting is the game's own random rule and a
 * piece of equipment's slot is printed on it.
 */
export type CastAction = { cardId: string };

/** Everything a bot decided on one round, and the hand it decided from. */
export type RoundRecord = {
  round: number;
  handBefore: string[];
  placements: Placement[];
  /**
   * Spells and equipment spent this round, in the order they resolved.
   *
   * Absent rather than empty when the round cast nothing, so a record from a
   * unit-only fight is exactly the record it was before spells existed, and an
   * older log replays without migration - `replayFight` reads `?? []`. Gated by
   * "a record written before spells existed still replays" in
   * `test/spells.test.ts`.
   */
  casts?: CastAction[];
};

export type FightRun = {
  fight: Fight;
  log: RoundRecord[];
};

/**
 * A placement policy. It is handed the cards that have already been chosen -
 * it may not change them - and returns one insertion index per card, applied
 * in order.
 *
 * This split is the whole methodology of the measurement: card selection is
 * shared, only `place` differs between bots.
 */
export type PlacementPolicy = (fight: Fight, plays: readonly string[]) => number[];

export function setupFight(setup: FightSetup): Fight {
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  state.board.player.push(makeHero(state, 'player', setup.playerHero));
  state.board.enemy.push(makeHero(state, 'enemy', setup.enemyHero));

  const rngDeck = makeRng(setup.seed, 'deck');
  const rngCombat = makeRng(setup.seed, 'combat');

  const playerDeck = shuffle(rngDeck, setup.playerDeck.slice());
  const enemyDeck = shuffle(rngDeck, setup.enemyDeck.slice());

  for (const id of setup.enemyOpening) {
    const unit = makeUnit(state, 'enemy', setup.pool.card(id));
    insertUnit(state, 'enemy', unit, unitCount(state, 'enemy'));
  }

  return {
    seed: setup.seed,
    round: 0,
    maxRounds: setup.maxRounds,
    result: 'ongoing',
    state,
    player: { deck: playerDeck, cursor: 0, hand: [] },
    enemy: { deck: enemyDeck, cursor: 0, hand: [] },
    rngCombat,
    rngDeck,
    pool: setup.pool,
  };
}

export function cloneFight(f: Fight): Fight {
  return {
    seed: f.seed,
    round: f.round,
    maxRounds: f.maxRounds,
    result: f.result,
    state: cloneState(f.state),
    // The decks are copied, not shared. Nothing writes to a deck today, so this
    // costs two array copies and buys the first mill, shuffle-in or tutor
    // effect: without it a lookahead rollout would write through into the live
    // fight it is only supposed to be looking at.
    player: { deck: f.player.deck.slice(), cursor: f.player.cursor, hand: f.player.hand.slice() },
    enemy: { deck: f.enemy.deck.slice(), cursor: f.enemy.cursor, hand: f.enemy.hand.slice() },
    rngCombat: cloneRng(f.rngCombat),
    rngDeck: cloneRng(f.rngDeck),
    // The pool is immutable data shared by every fight, so the reference is the copy.
    pool: f.pool,
  };
}

/** Draw to `handSize`. Running the deck out just stops the draw. */
export function drawTo(side: SideState, handSize: number): void {
  while (side.hand.length < handSize && side.cursor < side.deck.length) {
    side.hand.push(side.deck[side.cursor]!);
    side.cursor++;
  }
}

/**
 * The shared card-selection policy - the constant held across both bots.
 *
 * A pure function of hand and energy. It never reads the board, which is what
 * guarantees the two arms play the same cards on the same round forever: decks
 * are shuffled from the same stream, the same cards leave the hand, so the
 * hands stay identical by induction however differently the boards develop.
 *
 * The rule: spend as much of the energy as possible; break ties toward playing
 * more cards; break remaining ties toward earlier positions in hand.
 */
export function selectPlays(
  hand: readonly string[],
  energy: number,
  pool: CardPool,
): number[] {
  const n = hand.length;
  let best: number[] | null = null;
  let bestSpend = -1;
  let bestCount = -1;

  for (let mask = 0; mask < 1 << n; mask++) {
    let spend = 0;
    let count = 0;
    const chosen: number[] = [];
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) === 0) continue;
      // `cardCost` answers for all three types. For a unit-only pool it is
      // `pool.card(id).cost`, which is what this line used to read.
      spend += cardCost(pool, hand[i]!);
      count++;
      chosen.push(i);
    }
    if (spend > energy) continue;
    if (spend > bestSpend || (spend === bestSpend && count > bestCount)) {
      best = chosen;
      bestSpend = spend;
      bestCount = count;
    }
  }
  return best ?? [];
}

/**
 * Split already-chosen card ids into bodies to place and cards to spend.
 *
 * A pool with no spells or equipment returns everything as a unit, which is
 * what makes this free to put on the existing path: `castableById` answers
 * `null` for every id such a pool knows.
 */
export function splitPlays(
  pool: CardPool,
  ids: readonly string[],
): { units: string[]; casts: CastAction[] } {
  const units: string[] = [];
  const casts: CastAction[] = [];
  for (const id of ids) {
    if (castableById(pool, id) === null) units.push(id);
    else casts.push({ cardId: id });
  }
  return { units, casts };
}

/** Place already-chosen cards at already-chosen indices. */
export function applyPlacements(f: Fight, placements: readonly Placement[]): void {
  for (const p of placements) {
    const i = f.player.hand.indexOf(p.cardId);
    if (i < 0) {
      throw new Error(
        `fight: cannot play "${p.cardId}" - it is not in hand [${f.player.hand.join(', ')}]`,
      );
    }
    f.player.hand.splice(i, 1);
    const unit = makeUnit(f.state, 'player', f.pool.card(p.cardId));
    insertUnit(f.state, 'player', unit, p.index);
  }
}

/**
 * Cast already-chosen spells and wear already-chosen equipment, in order.
 *
 * Run after `applyPlacements`, so a board-wide buff reaches the bodies played
 * on the same turn. `docs/design/game.md` lists the spend phase as "place
 * units, cast spells, equip the hero" and leaves the order inside it to the
 * player; this is the fixed order the engine offers, and it is the one that
 * makes a turn's own placements count.
 */
export function applyCasts(f: Fight, casts: readonly CastAction[]): void {
  for (const c of casts) {
    const i = f.player.hand.indexOf(c.cardId);
    if (i < 0) {
      throw new Error(
        `fight: cannot cast "${c.cardId}" - it is not in hand [${f.player.hand.join(', ')}]`,
      );
    }
    const card = castableById(f.pool, c.cardId);
    if (card === null) {
      throw new Error(
        `fight: "${c.cardId}" is not a spell or a piece of equipment in this pool, ` +
          `so it cannot be cast. A unit is placed into the line instead.`,
      );
    }
    f.player.hand.splice(i, 1);
    if (card.kind === 'spell') castSpell(f.state, 'player', card, f.rngCombat);
    else equipItem(f.state, 'player', card, f.rngCombat);
  }
}

/**
 * Energy is one pool for all three card types.
 *
 * `ARCHITECTURE.md` lists conservation - energy spent never exceeds energy
 * available - among the invariants a property test should hold. `selectPlays`
 * already respects it, so this never fires for a bot; it fires for a hand-built
 * round, which is what a UI will produce.
 */
function checkEnergy(
  f: Fight,
  placements: readonly Placement[],
  casts: readonly CastAction[],
): void {
  let spent = 0;
  for (const p of placements) spent += cardCost(f.pool, p.cardId);
  for (const c of casts) spent += cardCost(f.pool, c.cardId);
  if (spent > f.pool.energyPerTurn) {
    throw new Error(
      `fight: round ${f.round} spends ${spent} energy on ${placements.length} unit(s) and ` +
        `${casts.length} cast(s), but a side has ${f.pool.energyPerTurn} per turn. ` +
        `Units, spells and equipment all draw from the same pool.`,
    );
  }
}

/** The enemy plays the same selection policy and always appends at its right end. */
function enemyPlays(f: Fight): void {
  drawTo(f.enemy, f.pool.handSize);
  const idx = selectPlays(f.enemy.hand, f.pool.energyPerTurn, f.pool);
  const ids = idx.map((i) => f.enemy.hand[i]!);
  for (const id of ids) {
    const at = f.enemy.hand.indexOf(id);
    f.enemy.hand.splice(at, 1);
    // Units are placed; spells and equipment are spent. A unit-only pool takes
    // the first branch every time, which is the whole of the existing path.
    const castable = castableById(f.pool, id);
    if (castable === null) {
      const unit = makeUnit(f.state, 'enemy', f.pool.card(id));
      insertUnit(f.state, 'enemy', unit, unitCount(f.state, 'enemy'));
    } else if (castable.kind === 'spell') {
      castSpell(f.state, 'enemy', castable, f.rngCombat);
    } else {
      equipItem(f.state, 'enemy', castable, f.rngCombat);
    }
  }
}

function settleResult(f: Fight): void {
  const enemyHero = heroOf(f.state, 'enemy');
  const playerHero = heroOf(f.state, 'player');
  if (!enemyHero.alive) f.result = 'playerWin';
  else if (!playerHero.alive) f.result = 'enemyWin';
  // "Equipment resets at the end of every fight" - the design's own rule, and
  // the split that keeps equipment the per-fight layer and sigils the run-long
  // one. A fight where nothing was equipped is untouched by this.
  if (f.result !== 'ongoing') endFight(f.state);
}

/**
 * Run one round. `decide` is called after the draw and before any placement,
 * and returns the cards to place and where. There is exactly one round code
 * path, so replay exercises the same one the bots do.
 *
 * `decideCasts` is the same thing for spells and equipment, and it defaults to
 * `null`, which is no casts at all. A caller written before the other two card
 * types existed compiles and behaves exactly as it did - the parameter is not
 * read, `casts` is left off the record, and no energy, hand card or random draw
 * moves.
 */
export function runRound(
  f: Fight,
  decide: (f: Fight) => Placement[],
  decideCasts: ((f: Fight) => CastAction[]) | null = null,
): RoundRecord | null {
  if (f.result !== 'ongoing') return null;
  f.round++;

  startTurn(f.state, 'player');
  drawTo(f.player, f.pool.handSize);
  const handBefore = f.player.hand.slice();
  const placements = decide(f);
  const casts = decideCasts === null ? [] : decideCasts(f);
  checkEnergy(f, placements, casts);
  const record: RoundRecord =
    casts.length === 0
      ? { round: f.round, handBefore, placements }
      : { round: f.round, handBefore, placements, casts };

  applyPlacements(f, placements);
  applyCasts(f, casts);
  resolvePhase(f.state, 'player', f.rngCombat);
  settleResult(f);
  if (f.result !== 'ongoing') return record;

  startTurn(f.state, 'enemy');
  enemyPlays(f);
  resolvePhase(f.state, 'enemy', f.rngCombat);
  settleResult(f);
  if (f.result !== 'ongoing') return record;

  if (f.round >= f.maxRounds) {
    f.result = 'timeout';
    endFight(f.state);
  }
  return record;
}

/** Run a whole fight, asking `policy` where to put each selected card. */
export function runFight(setup: FightSetup, policy: PlacementPolicy): FightRun {
  const f = setupFight(setup);
  const log: RoundRecord[] = [];

  while (f.result === 'ongoing') {
    // Selection happens once, in `decide`; the cards that are not bodies are
    // handed to `decideCasts` through this. With a unit-only pool `splitPlays`
    // puts everything in `units` and this stays empty for the whole fight.
    let pendingCasts: CastAction[] = [];
    const record = runRound(
      f,
      (fight) => {
        const chosen = selectPlays(fight.player.hand, fight.pool.energyPerTurn, fight.pool).map(
          (i) => fight.player.hand[i]!,
        );
        const split = splitPlays(fight.pool, chosen);
        pendingCasts = split.casts;
        const indices = policy(fight, split.units);
        if (indices.length !== split.units.length) {
          throw new Error(
            `fight: placement policy returned ${indices.length} index/indices for ` +
              `${split.units.length} chosen card(s); it must return exactly one per card`,
          );
        }
        return split.units.map((cardId, i) => ({ cardId, index: indices[i]! }));
      },
      () => pendingCasts,
    );
    if (record !== null) log.push(record);
  }

  return { fight: f, log };
}

/**
 * Replay a recorded fight from seed plus action list alone, with no bot in the
 * loop. This is the determinism invariant in executable form.
 */
export function replayFight(setup: FightSetup, log: readonly RoundRecord[]): Fight {
  const f = setupFight(setup);
  for (const rec of log) {
    if (f.result !== 'ongoing') break;
    // A record written before spells existed has no `casts` field. That is the
    // whole migration: absent means the round cast nothing.
    const casts = rec.casts ?? [];
    runRound(
      f,
      () => rec.placements.slice(),
      () => casts.slice(),
    );
  }
  return f;
}

/** Resolve just the current player phase then the enemy's attacks. Used by the
 * lookahead bot on a cloned fight; it never touches the live fight. */
export function simulateRoundForEval(f: Fight, evalRng: Rng): void {
  resolvePhase(f.state, 'player', evalRng);
  settleResult(f);
  if (f.result !== 'ongoing') return;
  startTurn(f.state, 'enemy');
  // Deliberately no enemy card plays here: letting the search see the enemy's
  // hand would make it an oracle rather than a bot.
  resolvePhase(f.state, 'enemy', evalRng);
  settleResult(f);
}

export type { CardPool, GameEvent, Effect, Side };
