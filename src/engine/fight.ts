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

import { type Rng, cloneRng, makeRng, shuffle } from './rng.ts';
import {
  type Effect,
  type GameEvent,
  resolvePhase,
  startTurn,
} from './resolver.ts';
import {
  type GameState,
  type HeroSpec,
  type Side,
  cloneState,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  unitCount,
} from './state.ts';
import { ENERGY_PER_TURN, HAND_SIZE, cardById } from '../content/cards.ts';

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
};

export type FightSetup = {
  seed: number;
  playerDeck: readonly string[];
  enemyDeck: readonly string[];
  enemyOpening: readonly string[];
  playerHero: HeroSpec;
  enemyHero: HeroSpec;
  maxRounds: number;
};

/** One placed card: which card, and where in the line it goes. */
export type Placement = { cardId: string; index: number };

/** Everything a bot decided on one round, and the hand it decided from. */
export type RoundRecord = {
  round: number;
  handBefore: string[];
  placements: Placement[];
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
    const unit = makeUnit(state, 'enemy', cardById(id));
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
  };
}

export function cloneFight(f: Fight): Fight {
  return {
    seed: f.seed,
    round: f.round,
    maxRounds: f.maxRounds,
    result: f.result,
    state: cloneState(f.state),
    player: { deck: f.player.deck, cursor: f.player.cursor, hand: f.player.hand.slice() },
    enemy: { deck: f.enemy.deck, cursor: f.enemy.cursor, hand: f.enemy.hand.slice() },
    rngCombat: cloneRng(f.rngCombat),
    rngDeck: cloneRng(f.rngDeck),
  };
}

/** Draw to `HAND_SIZE`. Running the deck out just stops the draw. */
export function drawTo(side: SideState, handSize: number = HAND_SIZE): void {
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
export function selectPlays(hand: readonly string[], energy: number): number[] {
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
      spend += cardById(hand[i]!).cost;
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
    const unit = makeUnit(f.state, 'player', cardById(p.cardId));
    insertUnit(f.state, 'player', unit, p.index);
  }
}

/** The enemy plays the same selection policy and always appends at its right end. */
function enemyPlays(f: Fight): void {
  drawTo(f.enemy);
  const idx = selectPlays(f.enemy.hand, ENERGY_PER_TURN);
  const ids = idx.map((i) => f.enemy.hand[i]!);
  for (const id of ids) {
    const at = f.enemy.hand.indexOf(id);
    f.enemy.hand.splice(at, 1);
    const unit = makeUnit(f.state, 'enemy', cardById(id));
    insertUnit(f.state, 'enemy', unit, unitCount(f.state, 'enemy'));
  }
}

function settleResult(f: Fight): void {
  const enemyHero = heroOf(f.state, 'enemy');
  const playerHero = heroOf(f.state, 'player');
  if (!enemyHero.alive) f.result = 'playerWin';
  else if (!playerHero.alive) f.result = 'enemyWin';
}

/**
 * Run one round. `decide` is called after the draw and before any placement,
 * and returns the cards to place and where. There is exactly one round code
 * path, so replay exercises the same one the bots do.
 */
export function runRound(f: Fight, decide: (f: Fight) => Placement[]): RoundRecord | null {
  if (f.result !== 'ongoing') return null;
  f.round++;

  startTurn(f.state, 'player');
  drawTo(f.player);
  const handBefore = f.player.hand.slice();
  const placements = decide(f);
  const record: RoundRecord = { round: f.round, handBefore, placements };

  applyPlacements(f, placements);
  resolvePhase(f.state, 'player', f.rngCombat);
  settleResult(f);
  if (f.result !== 'ongoing') return record;

  startTurn(f.state, 'enemy');
  enemyPlays(f);
  resolvePhase(f.state, 'enemy', f.rngCombat);
  settleResult(f);
  if (f.result !== 'ongoing') return record;

  if (f.round >= f.maxRounds) f.result = 'timeout';
  return record;
}

/** Run a whole fight, asking `policy` where to put each selected card. */
export function runFight(setup: FightSetup, policy: PlacementPolicy): FightRun {
  const f = setupFight(setup);
  const log: RoundRecord[] = [];

  while (f.result === 'ongoing') {
    const record = runRound(f, (fight) => {
      const chosen = selectPlays(fight.player.hand, ENERGY_PER_TURN).map(
        (i) => fight.player.hand[i]!,
      );
      const indices = policy(fight, chosen);
      if (indices.length !== chosen.length) {
        throw new Error(
          `fight: placement policy returned ${indices.length} index/indices for ` +
            `${chosen.length} chosen card(s); it must return exactly one per card`,
        );
      }
      return chosen.map((cardId, i) => ({ cardId, index: indices[i]! }));
    });
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
    runRound(f, () => rec.placements.slice());
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

export type { GameEvent, Effect, Side };
