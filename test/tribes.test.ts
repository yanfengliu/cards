// Races are mechanical tribes: what that means, and the bound it is held to.
//
// `docs/design/game.md`, "Races are mechanical tribes": dwarf, elf, human and
// dragon, and "cards care about them". For ten units nothing in a fight could
// see a race at all - `UnitCard` carried a `tribe` and `makeUnit` dropped it -
// so the hover panel said so out loud and `test/explain.test.ts` held the
// resolver to it. Unit 11 built the traits, so that gate fired and was retired,
// and these are what replaced it.
//
// Four kinds of check live here, and the order matters less than the split:
//
//   **Three hand-walks**, one per trait, each the exact sequence
//   `docs/design/game.md` prints under "A tribal line, walked by hand". A rule
//   that cannot be walked through by hand is not specified; these are the walk,
//   run. Each asserts the board *and* the events, never the trace alone -
//   `drain` pushes an effect onto the trace before `apply` runs, so a trace
//   assertion on its own says an effect was dequeued and nothing about whether
//   it did anything.
//
//   **The adjacency bound**, which is the design's central constraint on this
//   whole mechanic: "every cascade trait references neighbours, never totals".
//   A counting trait's ceiling is whatever the deck economy allows, which is
//   not a number anyone controls. So the same trait is fought at 2 neighbours
//   and at 20, and the grant has to be the same number both times.
//
//   **Which traits read a race**, decided by the engine rather than by a list.
//   The same board is fought twice with one field changed - the neighbours'
//   `tribe`, same card id, same numbers, same everything else - and exactly the
//   traits in `TRIBAL_TRAITS` must notice. Each trait is also fought with and
//   without itself, so a trait that never fired cannot pass by not firing.
//
//   **One comparison site**, read off the AST: `src/engine/` may compare two
//   races in exactly one function. That is what stops the next tribal trait
//   from being written as a loop over the board.
//
// Bound, stated once for the file: every fixture here is a hand-built board and
// a seeded generator, so nothing here is a claim about the shipped card pool or
// about what any of this is worth in a run. `npm run measure:run` answers that,
// and `docs/policies/local-rules.md` says what the answer is for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

import { stateToCanonical } from '../src/engine/hash.ts';
import { makeRng } from '../src/engine/rng.ts';
import {
  BANNER_POWER,
  CHORUS_POWER,
  KINDLE_POWER,
  VOLLEY_SWINGS,
  type GameEvent,
  drain,
  resolvePhase,
} from '../src/engine/resolver.ts';
import {
  type Entity,
  type GameState,
  type Side,
  type Trait,
  type Tribe,
  type UnitCard,
  MOST_ADJACENT,
  TRIBAL_TRAITS,
  adjacentKin,
  insertUnit,
  isTribalTrait,
  makeHero,
  makeUnit,
  power,
  unitCount,
} from '../src/engine/state.ts';
import {
  ENEMY_CARDS,
  PLAYER_CARDS,
  PLAYER_CARDS_NO_CASCADE,
} from '../src/content/cards.ts';
import { TRAIT_TERMS } from '../src/render/glossary.ts';
import { projectOwnPhase } from '../src/render/odds.ts';
import { parse, rel, tsFilesUnder } from '../tools/gates/scan.ts';

// --------------------------------------------------------------- the fixture

type CardSpec = {
  id: string;
  power: number;
  health: number;
  tribe: Tribe;
  traits?: readonly Trait[];
  armour?: number;
};

function card(spec: CardSpec): UnitCard {
  return {
    id: spec.id,
    name: spec.id,
    cost: 1,
    power: spec.power,
    health: spec.health,
    armour: spec.armour ?? 0,
    tribe: spec.tribe,
    traits: spec.traits ?? [],
  };
}

type Fixture = {
  state: GameState;
  add: (side: Side, c: UnitCard, index?: number) => Entity;
};

function fixture(playerHeroPower = 0, enemyHeroPower = 0): Fixture {
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  state.board.player.push(
    makeHero(state, 'player', { name: 'Knight', health: 40, power: playerHeroPower, armour: 0 }),
  );
  state.board.enemy.push(
    makeHero(state, 'enemy', { name: 'Warchief', health: 40, power: enemyHeroPower, armour: 0 }),
  );
  return {
    state,
    add(side, c, index) {
      const u = makeUnit(state, side, c);
      insertUnit(state, side, u, index ?? unitCount(state, side));
      return u;
    },
  };
}

// -------------------------------------------------- the document is the source

const DESIGN_PATH = 'docs/design/game.md';
const DESIGN = readFileSync(path.join(import.meta.dirname, '..', DESIGN_PATH), 'utf8');

/**
 * The text under one heading, up to the next heading of any level. Same shape
 * as `test/hero-attacks.test.ts`'s, and for the same reason it exists there.
 */
function designSection(heading: string): string {
  const at = DESIGN.indexOf(`### ${heading}`);
  assert.notEqual(
    at,
    -1,
    `${DESIGN_PATH} has no "### ${heading}" section. The play example these gates walk was ` +
      'renamed or deleted; a rule with no walked example is not specified.',
  );
  const rest = DESIGN.slice(at + heading.length + 4);
  const end = rest.search(/\r?\n#{1,4} /);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * The numbers one sentence of the document states, as numbers.
 *
 * **Every number in the three walks below comes through here.** Transcribing
 * them into the test instead makes the gate one-way: the engine drifting goes
 * red, the document drifting stays green, and the claim that the example still
 * walks becomes a claim about a copy of the example. This repo has already paid
 * for that once - `test/hero-attacks.test.ts` says where.
 */
function stated(section: string, what: string, re: RegExp): number[] {
  const m = re.exec(section);
  assert.ok(
    m !== null,
    `${DESIGN_PATH} no longer states ${what} in the shape this gate reads.\n\n  looked for: ` +
      `${re.source}\n\nEdit the walk to match the document, never the other way round.`,
  );
  const out = m.slice(1).map((g) => Number(g));
  assert.ok(
    out.length > 0 && out.every((n) => Number.isFinite(n)),
    `${DESIGN_PATH}: ${what} matched but captured no number`,
  );
  return out;
}

const WALK = designSection('A tribal line, walked by hand');

/**
 * The one enemy every hand-walk is fought into: a Guard that cannot hit back,
 * at the numbers the document states for it.
 *
 * Guard makes targeting deterministic without a lucky seed - it is the only
 * legal target, so every swing lands on it and the damage total is arithmetic
 * rather than a draw. Power 0 means nothing in the player's line ever dies, so
 * the walk has no deaths in it to explain. Its Health is larger than anything
 * the fixtures can deal, so it never leaves the board either.
 */
const [WALL_POWER, WALL_HEALTH] = stated(
  WALK,
  "the wall's numbers",
  /\*\*Guard with (\d+) Power and (\d+) Health\*\*/,
) as [number, number];

const WALL = card({
  id: 'test:wall',
  power: WALL_POWER,
  health: WALL_HEALTH,
  tribe: 'orc',
  traits: ['guard'],
});

/** Health the walks' bodies are given. Not in the document - nothing dies. */
const STOUT = 40;

function playerPhase(state: GameState, seed = 1): GameEvent[] {
  return resolvePhase(state, 'player', makeRng(seed, 'tribes-test'));
}

function buffsOf(events: readonly GameEvent[]): { uid: number; amount: number }[] {
  return events
    .filter((e) => e.kind === 'powerGained')
    .map((e) => ({ uid: e.uid, amount: e.amount }));
}

// ------------------------------------------------------------- the hand-walks

test('Kindle, walked by hand: +1 Power for each adjacent unit of its own race, and the swing carries it', () => {
  // This is the first arrangement `docs/design/game.md` prints under "A tribal
  // line, walked by hand", run. Change either and the other has to move.
  //
  // Mutation watched going red: `adjacentKin(state, e, 'same')` in
  // `tribalOnAct` changed to `'different'` - the Kindler then counts two
  // strangers where it is standing among its own, swings for its printed 1 and
  // the wall takes 1 instead of 3.
  const [plainPower, kindlerPower] = stated(
    WALK,
    "the Kindle line's printed Power",
    /a plain \*\*dwarf\*\* \((\d+) Power\), a \*\*Kindler\*\* \(dwarf, (\d+) Power, Kindle\)/,
  ) as [number, number];
  const [gained, swungAt] = stated(
    WALK,
    'what Kindle grants and what it swings at',
    /both its own race, so \*\*\+(\d+)\*\*\. It swings at \*\*(\d+)\*\*/,
  ) as [number, number];
  const [tookBuffed] = stated(WALK, 'the wall’s share', /The wall takes \*\*(\d+)\*\*/) as [number];
  const [printed, tookPlain] = stated(
    WALK,
    'the same line among elves',
    /swings at its printed \*\*(\d+)\*\*, and the wall takes \*\*(\d+)\*\*/,
  ) as [number, number];

  assert.equal(gained, KINDLE_POWER * MOST_ADJACENT, 'the document and KINDLE_POWER disagree');

  const f = fixture();
  const left = f.add('player', card({ id: 'test:dwarfA', power: plainPower, health: STOUT, tribe: 'dwarf' }));
  const kindler = f.add(
    'player',
    card({ id: 'test:kindler', power: kindlerPower, health: STOUT, tribe: 'dwarf', traits: ['kindle'] }),
  );
  const right = f.add('player', card({ id: 'test:dwarfB', power: plainPower, health: STOUT, tribe: 'dwarf' }));
  const wall = f.add('enemy', WALL);

  const events = playerPhase(f.state);

  // The state, not only the stream: two dwarves beside it, so +2, and it swung
  // at 3 rather than at its printed 1.
  assert.equal(kindler.bonusPower, gained, 'a dwarf between two dwarves gains what the walk says');
  assert.equal(power(kindler), swungAt);
  assert.equal(wall.health, WALL_HEALTH - tookBuffed, 'the wall took the Kindler’s buffed swing and nothing else');
  assert.equal(left.bonusPower, 0, 'Kindle buffs itself, not its neighbours');
  assert.equal(right.bonusPower, 0);

  // The buff reached the board before the swing did. The `attacked` event
  // carries the Power the blow was struck at, which is the only way to tell a
  // buff that landed first from one that landed after and was wasted.
  const struck = events.find((e) => e.kind === 'attacked' && e.uid === kindler.uid);
  assert.ok(struck !== undefined && struck.kind === 'attacked');
  assert.equal(struck.raw, swungAt, 'the swing was struck buffed, so the buff was already on the board');
  assert.deepEqual(buffsOf(events), [{ uid: kindler.uid, amount: gained }]);

  // The same three cards with the neighbours' race changed and nothing else.
  const g = fixture();
  g.add('player', card({ id: 'test:dwarfA', power: plainPower, health: STOUT, tribe: 'elf' }));
  const alone = g.add(
    'player',
    card({ id: 'test:kindler', power: kindlerPower, health: STOUT, tribe: 'dwarf', traits: ['kindle'] }),
  );
  g.add('player', card({ id: 'test:dwarfB', power: plainPower, health: STOUT, tribe: 'elf' }));
  const wall2 = g.add('enemy', WALL);
  const quiet = playerPhase(g.state);

  assert.equal(alone.bonusPower, 0, 'a dwarf between two elves kindles nothing');
  assert.equal(power(alone), printed);
  assert.equal(wall2.health, WALL_HEALTH - tookPlain, 'and swings for its printed Power');
  assert.deepEqual(
    buffsOf(quiet),
    [],
    'a Kindle that found no kin announces nothing - not a +0. `docs/policies/local-rules.md`: ' +
      'the resolver reports an effect that reached a target and nothing about one that found none.',
  );
});

test('Chorus, walked by hand: both neighbours of its own race, and the left one’s share is already spent', () => {
  // The second arrangement in `docs/design/game.md`'s tribal walk.
  //
  // Mutation watched going red: `adjacentKinOf(state, e, 'same')` in
  // `triggersFor` changed to `rightNeighbour` only - the left elf then gains
  // nothing and the line's buff total halves.
  const [elfPower, singerPower] = stated(
    WALK,
    "the Chorus line's printed Power",
    /a plain \*\*elf\*\* \((\d+) Power\), a \*\*Songkeeper\*\* \(elf, (\d+) Power, Chorus\)/,
  ) as [number, number];
  const [sung] = stated(
    WALK,
    'what Chorus grants',
    /each adjacent elf gains \*\*\+(\d+)\*\*/,
  ) as [number];
  const [base, bonus, thirdAt, wallLeft] = stated(
    WALK,
    'the third elf’s swing and the wall after it',
    /The third elf acts at `(\d+) \+ (\d+) = (\d+)`\. The wall is on \*\*(\d+)\*\*/,
  ) as [number, number, number, number];
  const [amongOthers, amongOwn] = stated(
    WALK,
    'the same line among humans',
    /the wall takes (\d+) instead of (\d+)/,
  ) as [number, number];
  // The two intermediate running totals. They were transcribed rather than read
  // until a review pointed out that changing 199 to 198 left the suite green and
  // the document disagreeing with itself - the walk's *card* numbers came
  // through `stated`, its step-by-step totals did not. Every number the walk
  // prints is now one of these.
  const [firstSwing, afterFirst] = stated(
    WALK,
    'the first elf’s swing and the running total after it',
    /The first elf acts and swings for \*\*(\d+)\*\*\. The wall is on (\d+)\./,
  ) as [number, number];
  const [singerSwing, afterSinger] = stated(
    WALK,
    'the Songkeeper’s swing and the running total after it',
    /The Songkeeper acts and swings for \*\*(\d+)\*\*[\s\S]*?The wall is on (\d+)\./,
  ) as [number, number];

  assert.equal(sung, CHORUS_POWER, 'the document and CHORUS_POWER disagree');
  assert.equal(base + bonus, thirdAt, 'the document’s own arithmetic does not add up');
  // The walk's own arithmetic, before the engine is asked anything: each step's
  // running total is the one above it less that step's swing.
  assert.deepEqual(
    [WALL_HEALTH - firstSwing, afterFirst - singerSwing, afterSinger - thirdAt],
    [afterFirst, afterSinger, wallLeft],
    'the walk’s running totals do not follow from its own swings. The three steps say ' +
      `${WALL_HEALTH} − ${firstSwing} → ${afterFirst} − ${singerSwing} → ${afterSinger} − ` +
      `${thirdAt} → ${wallLeft}.`,
  );

  const f = fixture();
  const left = f.add('player', card({ id: 'test:elfL', power: elfPower, health: STOUT, tribe: 'elf' }));
  const singer = f.add(
    'player',
    card({ id: 'test:singer', power: singerPower, health: STOUT, tribe: 'elf', traits: ['chorus'] }),
  );
  const right = f.add('player', card({ id: 'test:elfR', power: elfPower, health: STOUT, tribe: 'elf' }));
  const wall = f.add('enemy', WALL);

  const events = playerPhase(f.state);

  // The engine walks the same three steps, in the same order, and the wall is
  // on the number the document prints after each. Asserted first, because it is
  // the walk's own narrative and the assertions below are its consequences. The
  // hero's blow is left out because the document leaves it out: "your hero
  // swings for 0 and adds nothing".
  const steps = new Set([left.uid, singer.uid, right.uid]);
  const running: number[] = [];
  let health = WALL_HEALTH;
  for (const e of events) {
    if (e.kind !== 'attacked' && e.kind !== 'damaged') continue;
    if (e.targetUid !== wall.uid) continue;
    health -= e.dealt;
    if (steps.has(e.uid)) running.push(health);
  }
  assert.deepEqual(
    running,
    [afterFirst, afterSinger, wallLeft],
    'the running total the walk prints after each step is not the wall’s Health after that step ' +
      `in the engine. The document says ${afterFirst}, ${afterSinger}, ${wallLeft}; the engine ` +
      `reached ${running.join(', ')}.`,
  );

  assert.equal(left.bonusPower, sung, 'the elf on the left is sung to');
  assert.equal(right.bonusPower, sung, 'and so is the elf on the right');
  assert.equal(singer.bonusPower, 0, 'Chorus buffs its neighbours, never itself');
  assert.equal(power(right), thirdAt, 'the elf on the right swings at what the walk says');
  // The left elf's share reached it after it had already swung, so the wall
  // took the document's stated total and not one point more. That gap is the
  // whole of what the trait asks the player to arrange.
  assert.equal(wall.health, wallLeft);
  assert.equal(WALL_HEALTH - wallLeft, amongOwn, 'the two sentences in the walk disagree');
  assert.deepEqual(buffsOf(events), [
    { uid: left.uid, amount: sung },
    { uid: right.uid, amount: sung },
  ]);

  // Same board, neighbours of another race.
  const g = fixture();
  const humanL = g.add('player', card({ id: 'test:elfL', power: elfPower, health: STOUT, tribe: 'human' }));
  g.add(
    'player',
    card({ id: 'test:singer', power: singerPower, health: STOUT, tribe: 'elf', traits: ['chorus'] }),
  );
  const humanR = g.add('player', card({ id: 'test:elfR', power: elfPower, health: STOUT, tribe: 'human' }));
  const wall2 = g.add('enemy', WALL);
  playerPhase(g.state);

  assert.equal(humanL.bonusPower, 0, 'a Chorus sings to its own race and to nobody else');
  assert.equal(humanR.bonusPower, 0);
  assert.equal(wall2.health, WALL_HEALTH - amongOthers, 'three unbuffed swings');
});

test('Banner, walked by hand: Kindle upside down, so it wants to stand between races', () => {
  // The third arrangement in `docs/design/game.md`'s tribal walk.
  //
  // Mutation watched going red: `BANNER_POWER` set to 0 - the Bannerman then
  // swings at its printed 1 with two strangers beside it.
  const [dwarfPower, bannerPower, elfPower] = stated(
    WALK,
    "the Banner line's printed Power",
    /a plain \*\*dwarf\*\* \((\d+) Power\), a \*\*Bannerman\*\* \(human, (\d+) Power, Banner\), a plain \*\*elf\*\* \((\d+) Power\)/,
  ) as [number, number, number];
  const [taken, swungAt] = stated(
    WALK,
    'what Banner grants among two other races',
    /takes \*\*\+(\d+)\*\*, and swings at \*\*(\d+)\*\*/,
  ) as [number, number];
  const [printed] = stated(
    WALK,
    'the same card among humans',
    /it takes nothing and swings at \*\*(\d+)\*\*/,
  ) as [number];

  assert.equal(taken, BANNER_POWER * MOST_ADJACENT, 'the document and BANNER_POWER disagree');

  const f = fixture();
  f.add('player', card({ id: 'test:mixA', power: dwarfPower, health: STOUT, tribe: 'dwarf' }));
  const bannerman = f.add(
    'player',
    card({ id: 'test:banner', power: bannerPower, health: STOUT, tribe: 'human', traits: ['banner'] }),
  );
  f.add('player', card({ id: 'test:mixB', power: elfPower, health: STOUT, tribe: 'elf' }));
  const wall = f.add('enemy', WALL);

  playerPhase(f.state);
  assert.equal(bannerman.bonusPower, taken, 'a dwarf and an elf are two strangers');
  assert.equal(power(bannerman), swungAt);
  assert.equal(wall.health, WALL_HEALTH - swungAt);

  // And the inverse board, which is the one Kindle wants.
  const g = fixture();
  g.add('player', card({ id: 'test:mixA', power: dwarfPower, health: STOUT, tribe: 'human' }));
  const amongOwn = g.add(
    'player',
    card({ id: 'test:banner', power: bannerPower, health: STOUT, tribe: 'human', traits: ['banner'] }),
  );
  g.add('player', card({ id: 'test:mixB', power: elfPower, health: STOUT, tribe: 'human' }));
  const wall2 = g.add('enemy', WALL);
  playerPhase(g.state);

  assert.equal(amongOwn.bonusPower, 0, 'a human among humans raises no banner');
  assert.equal(power(amongOwn), printed);
  assert.equal(wall2.health, WALL_HEALTH - printed);
});

test('a hero is not a race, so no tribal trait ever counts one', () => {
  // Mutation watched going red: the `n.isHero` skip removed from
  // `adjacentAllies` - the rightmost Bannerman then takes +1 for standing
  // beside a hero whose `tribe` is `'hero'`, which is a bonus for position
  // rather than for race. Relay deliberately does reach the hero; a count of
  // kin deliberately does not, and this is where the two part.
  const f = fixture();
  const bannerman = f.add(
    'player',
    card({ id: 'test:banner', power: 1, health: 9, tribe: 'human', traits: ['banner'] }),
  );
  const wall = f.add('enemy', WALL);

  playerPhase(f.state);
  assert.equal(
    bannerman.bonusPower,
    0,
    'the only thing beside this Bannerman is the hero, and a hero has no race',
  );
  assert.equal(wall.health, 200 - 1);

  // The other polarity of the same rule, on a fresh board: a Kindler beside the
  // hero counts no kin either, which is the same skip seen from the other side.
  const g = fixture();
  const kindler = g.add(
    'player',
    card({ id: 'test:kindler', power: 1, health: 9, tribe: 'dwarf', traits: ['kindle'] }),
  );
  g.add('enemy', WALL);
  playerPhase(g.state);
  assert.equal(kindler.bonusPower, 0);
});

test('a Chorus beside the hero sings to nobody, which is the other direction of the same rule', () => {
  // The test above and the `MOST_ADJACENT` test below both fight the *count*:
  // what a tribal trait sees when it looks at a hero. Nothing watched what a
  // hero *receives* when a trait fires beside it, and the two are different
  // functions - the count is `adjacentKinOf`'s hero guard, the grant is
  // `adjacentAllies`' `isHero` skip. Making Chorus grant to an adjacent living
  // hero left the whole suite green.
  //
  // It is also the most ordinary board there is rather than a corner case: the
  // rightmost unit's right-hand neighbour is always the hero, so every line
  // ending in a Chorus body is this board.
  //
  // Mutation watched going red: the Chorus block in `triggersFor` given a
  // second target list of adjacent living heroes.
  const f = fixture();
  const neighbour = f.add(
    'player',
    card({ id: 'test:elf', power: 1, health: STOUT, tribe: 'elf' }),
  );
  const singer = f.add(
    'player',
    card({ id: 'test:singer', power: 1, health: STOUT, tribe: 'elf', traits: ['chorus'] }),
  );
  const hero = f.state.board.player[f.state.board.player.length - 1]!;
  const wall = f.add('enemy', WALL);

  const line = f.state.board.player;
  assert.equal(hero.isHero, true);
  assert.equal(
    line[line.indexOf(singer) + 1],
    hero,
    'the hero is the singer’s right-hand neighbour, which is what makes this the ordinary board',
  );
  const heroPower = power(hero);

  const events = playerPhase(f.state);

  assert.equal(hero.bonusPower, 0, 'a hero has no race, so a Chorus beside it sings to nobody');
  assert.equal(power(hero), heroPower, 'and its swing is the swing it printed');
  assert.equal(neighbour.bonusPower, CHORUS_POWER, 'the elf on the other side is sung to');
  assert.deepEqual(
    buffsOf(events),
    [{ uid: neighbour.uid, amount: CHORUS_POWER }],
    'one grant, not two: nothing was announced for the hero either',
  );
  // The wall's health says the same thing from the board's side: two units
  // swinging for 1 each, the left one buffed after it had already swung, and a
  // hero swinging for 0.
  assert.equal(wall.health, WALL_HEALTH - 2);
});

// --------------------------------------------------------- the adjacency bound

/**
 * A line of `n` units of `tribe`, with the trait under test on the middle one,
 * fought into the wall. Returns the middle unit and every buff the phase
 * granted.
 *
 * `n` is what this file varies. Everything else is held still, which is what
 * makes the comparison between two `n`s a comparison of board width alone.
 */
function lineOf(
  n: number,
  neighbourTribe: Tribe,
  trait: Trait,
  ownTribe: Tribe = 'dwarf',
): { middle: Entity; line: Entity[]; buffs: { uid: number; amount: number }[] } {
  const f = fixture();
  const line: Entity[] = [];
  const middleAt = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    line.push(
      f.add(
        'player',
        i === middleAt
          ? card({ id: 'test:subject', power: 1, health: 40, tribe: ownTribe, traits: [trait] })
          : card({ id: `test:n${i}`, power: 0, health: 40, tribe: neighbourTribe }),
      ),
    );
  }
  f.add('enemy', WALL);
  const buffs = buffsOf(playerPhase(f.state));
  return { middle: line[middleAt]!, line, buffs };
}

test('a tribal grant does not move when the line grows: 20 neighbours pay exactly what 2 pay', () => {
  // **This is the design's own constraint, made to go red.**
  // `docs/design/game.md`, "Why adjacency, and not counting": a trait that
  // counts gives the Nth unit +N, and on a board with no fixed width its
  // ceiling is "not a number anyone controls directly". So the only thing that
  // has to be true of every tribal trait is that a wider line changes nothing.
  //
  // Mutation watched going red: `adjacentAllies` changed to walk
  // `state.board[e.side]` instead of the two neighbour slots. Kindle at 21
  // units then grants +20 where it granted +2, and the widths stop agreeing.
  //
  // Bound: widths 3, 5, 11 and 21, which is enough to separate a constant from
  // anything that grows with n - two points would not separate a constant from
  // one that grows and then saturates. It says nothing about a trait that reads
  // something other than the board's width, which is the next check's job.
  const widths = [3, 5, 11, 21];
  for (const trait of TRIBAL_TRAITS) {
    // Kindle and Chorus want kin beside them; Banner wants strangers. Both
    // polarities are run for every trait, so whichever one the trait pays for
    // is in the sweep and the other is the zero case.
    for (const neighbours of ['dwarf', 'elf'] as const) {
      const totals = widths.map((n) => {
        const { buffs } = lineOf(n, neighbours, trait);
        return buffs.reduce((sum, b) => sum + b.amount, 0);
      });
      const first = totals[0]!;
      for (let i = 1; i < totals.length; i++) {
        assert.equal(
          totals[i],
          first,
          `${TRAIT_TERMS[trait].name} granted ${first} on a line of ${widths[0]} and ` +
            `${totals[i]} on a line of ${widths[i]} (neighbours: ${neighbours}). A tribal trait ` +
            `reads its two neighbours and nothing else, so board width may not move it.`,
        );
      }
      // And the ceiling itself, so a trait that is constant at zero because it
      // never fires cannot pass this as a constant.
      assert.ok(
        first <= MOST_ADJACENT * Math.max(KINDLE_POWER, BANNER_POWER, CHORUS_POWER),
        `${TRAIT_TERMS[trait].name} granted ${first}, above what ${MOST_ADJACENT} neighbours can pay`,
      );
    }
  }
  // The sweep is only worth anything if some arm of it paid. Both polarities of
  // every trait at every width would be zero if no tribal trait fired at all,
  // and that is exactly the shape of a gate reporting "did not run" as
  // "passed".
  const paid = TRIBAL_TRAITS.flatMap((trait) =>
    (['dwarf', 'elf'] as const).map((t) =>
      lineOf(5, t, trait).buffs.reduce((sum, b) => sum + b.amount, 0),
    ),
  );
  assert.ok(
    paid.filter((p) => p > 0).length >= TRIBAL_TRAITS.length,
    `only ${paid.filter((p) => p > 0).length} of ${paid.length} arms granted anything; every ` +
      'tribal trait should pay in one of its two polarities, or this sweep is measuring silence',
  );
});

test('Chorus does not compound down a line of its own race: everyone receives the same +2 from each side', () => {
  // `docs/design/game.md` on Relay: a flat grant does not compound, and "Power
  // equal to mine" would - "Do not write that card." Chorus is the same flat
  // grant reaching two neighbours, so the same argument has to hold, and on a
  // line where every unit is both a singer and a listener is where it would
  // break if it did not.
  //
  // Mutation watched going red: `amount: CHORUS_POWER` in `triggersFor` changed
  // to `amount: CHORUS_POWER + ally.bonusPower`, which is "Power equal to
  // mine" in the one place it could be written. The line then reads
  // 2/6/10/12/4 instead of 2/4/4/4/2.
  const f = fixture();
  const line: Entity[] = [];
  for (let i = 0; i < 5; i++) {
    line.push(
      f.add(
        'player',
        card({ id: `test:singer${i}`, power: 0, health: 40, tribe: 'elf', traits: ['chorus'] }),
      ),
    );
  }
  f.add('enemy', WALL);
  playerPhase(f.state);

  assert.deepEqual(
    line.map((e) => e.bonusPower),
    [CHORUS_POWER, CHORUS_POWER * 2, CHORUS_POWER * 2, CHORUS_POWER * 2, CHORUS_POWER],
    'each unit is sung to by whichever of its two neighbours it has, once each, and never more',
  );
});

// ------------------------------------------- when the trait fires, not only what

test('a tribal count is spawned once per act, however many swings the act is', () => {
  // `act` spawns the `tribePower` and then the swings, and `swingsOf` decides
  // how many swings there are. Moving the `tribalOnAct` loop inside the swing
  // loop gives a Volley body one count per swing - +1 before the first, another
  // +1 before the second - and left the whole suite green, because no fixture
  // anywhere put a tribal trait on a Volley body.
  //
  // Not reachable from shipped content today: the six tribal cards print no
  // Volley and the two Volley cards print no tribal trait. It becomes reachable
  // the day a Volley sigil or a Volley tribal card lands, which is why the
  // fixture is here rather than the rule left to the card list.
  //
  // Mutation watched going red: `for (const t of tribalOnAct(state, e))` moved
  // inside the `swingsOf(e)` loop in `act`.
  const f = fixture();
  f.add('player', card({ id: 'test:kin', power: 0, health: STOUT, tribe: 'dwarf' }));
  const archer = f.add(
    'player',
    card({
      id: 'test:volley-kindler',
      power: 1,
      health: STOUT,
      tribe: 'dwarf',
      traits: ['kindle', 'volley'],
    }),
  );
  const wall = f.add('enemy', WALL);

  const events = playerPhase(f.state);

  assert.equal(
    archer.bonusPower,
    KINDLE_POWER,
    'one dwarf beside it and one act, so one count - not one per swing',
  );
  assert.deepEqual(
    buffsOf(events),
    [{ uid: archer.uid, amount: KINDLE_POWER }],
    'the count is announced once per act, however many swings the act spawns',
  );

  const swings = events.filter((e) => e.kind === 'attacked' && e.uid === archer.uid);
  assert.equal(swings.length, VOLLEY_SWINGS, 'Volley still spawns its own number of swings');
  assert.deepEqual(
    swings.map((e) => (e.kind === 'attacked' ? e.raw : -1)),
    swings.map(() => 1 + KINDLE_POWER),
    'both swings are struck at the same Power: the count landed once, before the first of them',
  );
  assert.equal(wall.health, WALL_HEALTH - VOLLEY_SWINGS * (1 + KINDLE_POWER));
});

test('a Chorus that died to its own swing’s retaliation sings to nobody', () => {
  // Chorus is keyed to `afterActed` rather than `acted`, and death is the only
  // board that can tell the two apart: a body that dies to the retaliation its
  // own attack drew never reaches `afterAct`, because `apply` skips an effect
  // naming an entity that has left the board. A trigger on `acted` fires before
  // the swing is even applied, so the grant survives the body and lands on a
  // neighbour that watched it die.
  //
  // Firing Chorus on `acted` left the whole suite green, because every Chorus
  // fixture before this one was fought into a Guard with 0 Power - deliberately,
  // so nothing in the line dies and the walk is arithmetic - and nothing in the
  // line dying is exactly what hides this.
  //
  // Mutation watched going red: a second Chorus block keyed to `acted`.
  const f = fixture();
  const neighbour = f.add(
    'player',
    card({ id: 'test:elf', power: 1, health: STOUT, tribe: 'elf' }),
  );
  const singer = f.add(
    'player',
    card({ id: 'test:fragile-singer', power: 1, health: 1, tribe: 'elf', traits: ['chorus'] }),
  );
  // A Guard that hits back hard enough to kill the singer with one retaliation,
  // and cannot die itself. Guard also makes it the only legal target, so the
  // trade is arithmetic rather than a draw.
  const biter = f.add(
    'enemy',
    card({ id: 'test:biter', power: 3, health: WALL_HEALTH, tribe: 'orc', traits: ['guard'] }),
  );

  const events = playerPhase(f.state);

  assert.equal(singer.alive, false, 'the singer died to the retaliation its own swing drew');
  assert.equal(
    neighbour.bonusPower,
    0,
    'it acted but never finished acting, so Chorus never fired. A trigger on `acted` would have ' +
      'granted here, from a body that is no longer on the board.',
  );
  assert.deepEqual(buffsOf(events), [], 'and nothing was announced');
  assert.equal(biter.health, WALL_HEALTH - 2, 'both elves did swing: this is not a board that ran');

  // The control, on the same board with one Health more on the singer: it
  // survives its own swing, reaches `afterAct`, and Chorus grants. Without this
  // the test above passes just as well on an engine where Chorus never fires.
  const g = fixture();
  const other = g.add('player', card({ id: 'test:elf', power: 1, health: STOUT, tribe: 'elf' }));
  const survivor = g.add(
    'player',
    card({ id: 'test:singer', power: 1, health: 4, tribe: 'elf', traits: ['chorus'] }),
  );
  g.add(
    'enemy',
    card({ id: 'test:biter', power: 3, health: WALL_HEALTH, tribe: 'orc', traits: ['guard'] }),
  );
  playerPhase(g.state);

  assert.equal(survivor.alive, true);
  assert.equal(other.bonusPower, CHORUS_POWER, 'a singer that lived does sing');
});

// ------------------------------------------------- which traits read a race

/**
 * One arm of the race-flip comparison: the trait under test on the middle unit,
 * with neighbours of `neighbourTribe`, both phases resolved.
 *
 * Everything except `neighbourTribe` and `trait` is fixed, and the neighbour
 * cards keep their **ids** across arms while changing their `tribe` - so the
 * canonical state is comparable, and any difference between two arms is
 * attributable to the one field that moved.
 */
function raceFlipArm(trait: Trait | null, neighbourTribe: Tribe): string {
  const f = fixture();
  // A fragile left neighbour, so Wake has a death to answer: it dies to the
  // wall's retaliation on its own swing, inside the player's own phase, which
  // is the only way Wake is reachable at all.
  f.add(
    'player',
    card({ id: 'test:left', power: 1, health: 2, tribe: neighbourTribe }),
  );
  f.add(
    'player',
    card({
      id: 'test:subject',
      power: 1,
      health: 30,
      tribe: 'dwarf',
      traits: trait === null ? [] : [trait],
    }),
  );
  f.add('player', card({ id: 'test:right', power: 1, health: 30, tribe: neighbourTribe }));
  // A Guard that hits back hard enough to kill the fragile one, and a second
  // body so Scorch has more than the Guard to burn.
  f.add('enemy', card({ id: 'test:bigwall', power: 5, health: 90, tribe: 'orc', traits: ['guard'] }));
  f.add('enemy', card({ id: 'test:mook', power: 1, health: 4, tribe: 'orc' }));

  const rng = makeRng(7, 'race-flip');
  resolvePhase(f.state, 'player', rng);
  resolvePhase(f.state, 'enemy', rng);
  return stateToCanonical(f.state);
}

test('exactly the traits in TRIBAL_TRAITS notice a neighbour’s race, and every one of them fired', () => {
  // **The gate that replaced "the race carries no rule claim is still true of
  // the resolver".** That one read `src/engine/resolver.ts` for the word
  // "tribe"; this one changes one field on a board and asks the engine.
  //
  // Two claims, and neither is worth much without the other:
  //
  //   - A trait in `TRIBAL_TRAITS` must produce a different fight when a
  //     neighbour's race changes. A trait listed there that does not read a
  //     race fails here.
  //   - A trait NOT in it must produce the byte-identical fight. A trait that
  //     quietly starts reading a race - the exact thing the retired gate
  //     existed to catch - fails here whether or not anyone updated the union,
  //     because this reads the fight and not the list.
  //
  // The control is the third arm: each trait is also fought WITHOUT itself, at
  // both neighbour races. If a trait never changed anything at all it would
  // pass the "identical" half by being inert, which is a gate reporting "did
  // not run" as "passed".
  //
  // Mutation watched going red: `'banner'` removed from the `TribalTrait`
  // union and given a plain `Trait` entry instead - the behaviour is unchanged
  // and the list is now wrong, and this test says so.
  //
  // Bound: one board, one seed, two races. It proves a trait reads a race, not
  // *how*; the hand-walks above are what pin the arithmetic.
  const allTraits = Object.keys(TRAIT_TERMS) as Trait[];
  assert.ok(allTraits.length >= 5, `expected the engine's trait set, got ${allTraits.length}`);

  // The control for the control: with no trait at all, the neighbours' race
  // must change nothing. If this fails, every comparison below is measuring
  // something other than the trait.
  assert.equal(
    raceFlipArm(null, 'dwarf'),
    raceFlipArm(null, 'elf'),
    'a board with no trait on it still noticed a neighbour’s race, so something outside the ' +
      'trait set is reading one',
  );

  for (const trait of allTraits) {
    const same = raceFlipArm(trait, 'dwarf');
    const diff = raceFlipArm(trait, 'elf');
    const fired =
      same !== raceFlipArm(null, 'dwarf') || diff !== raceFlipArm(null, 'elf');
    assert.ok(
      fired,
      `${TRAIT_TERMS[trait].name} changed nothing about this fight with or without itself, so ` +
        `what this test reports about it is that the fixture never exercised it`,
    );

    if (isTribalTrait(trait)) {
      assert.notEqual(
        same,
        diff,
        `${TRAIT_TERMS[trait].name} is in TRIBAL_TRAITS and did not notice its neighbours’ race ` +
          `changing from dwarf to elf. The glossary tells the player it reads one.`,
      );
    } else {
      assert.equal(
        same,
        diff,
        `${TRAIT_TERMS[trait].name} is not in TRIBAL_TRAITS and produced a different fight when ` +
          `a neighbour’s race changed. Either it reads a race - in which case it belongs in the ` +
          `union, and RACE_RULE has to name it - or something it touches does.`,
      );
    }
  }
});

// -------------------------------------------------------- one comparison site

test('the engine compares two races in exactly one place', () => {
  // A behavioural gate says a trait reads a race; it cannot say *how* it
  // reached the board to do it. This one can: every `===`/`!==` in
  // `src/engine/` with a `.tribe` on either side must sit inside
  // `adjacentKinOf`, which reads two array slots and returns at most two
  // entities. A tribal trait written as a filter over `state.board[side]` is
  // caught here and nowhere else - it would pass every behavioural check in
  // this file except the width sweep, and it would pass that one too on a
  // board whose extra units happened to be of the wrong race.
  //
  // It reads the AST rather than the text, for `tools/gates/scan.ts`'s reason:
  // this file's own comments contain `.tribe` comparisons written out in prose,
  // and a grep would report them.
  //
  // Mutation watched going red: `adjacentKin` in `state.ts` changed to count
  // `state.board[e.side].filter((a) => a.tribe === e.tribe).length` - a second
  // comparison site, in a function that is not `adjacentKinOf`.
  //
  // Bound: `===`, `!==`, `==` and `!=` against a property named `tribe`, under
  // `src/engine/` only, in every `.ts` file the directory holds *today* - the
  // list is read off the filesystem, not typed here. A comparison written some
  // other way - a `switch`, a `Map` lookup, an equality helper - is not seen,
  // and the behavioural checks above are what cover that. Nor does it see a
  // comparison outside `src/engine/`: `src/render/odds.ts` projects the same
  // arithmetic for the pre-commit forecast and is held to it by a behavioural
  // gate below rather than by this one.
  //
  // The file list used to be six names written out here. It was complete on the
  // day it was written and silently incomplete the moment `src/engine/` grew a
  // seventh file: a new engine file containing the whole-board count this gate
  // exists to forbid left `npm run gates` at exit 0. `tsFilesUnder` is the same
  // recursive walk both determinism gates use, and the assertion under it is
  // what stops an empty walk from reporting as agreement.
  const ALLOWED = 'adjacentKinOf';
  const files = tsFilesUnder('src/engine');
  assert.ok(
    files.length >= 6,
    `found ${files.length} TypeScript files under src/engine/, which is fewer than the six that ` +
      'were there when this check was written. Either the engine was gutted or the walk stopped ' +
      'working - and a walk that returns nothing reports as an engine that compares no races.',
  );
  const found: string[] = [];
  const offending: string[] = [];

  for (const file of files) {
    const name = rel(file).replace(/^src\/engine\//, '');
    const sf = parse(file);
    const enclosing: string[] = [];
    const touchesTribe = (node: ts.Node): boolean =>
      (ts.isPropertyAccessExpression(node) && node.name.text === 'tribe') ||
      ts.forEachChild(node, touchesTribe) === true;

    const visit = (node: ts.Node): void => {
      let pushed = false;
      if (
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        node.name !== undefined
      ) {
        enclosing.push(node.name.getText(sf));
        pushed = true;
      }
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind;
        const isEquality =
          op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
          op === ts.SyntaxKind.EqualsEqualsToken ||
          op === ts.SyntaxKind.ExclamationEqualsToken;
        if (isEquality && (touchesTribe(node.left) || touchesTribe(node.right))) {
          const where = `src/engine/${name}:${enclosing[enclosing.length - 1] ?? '<top level>'}`;
          found.push(where);
          if (enclosing[enclosing.length - 1] !== ALLOWED) {
            offending.push(`${where} — ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 90)}`);
          }
        }
      }
      ts.forEachChild(node, visit);
      if (pushed) enclosing.pop();
    };
    visit(sf);
  }

  assert.deepEqual(
    offending,
    [],
    `a race is compared outside ${ALLOWED}:\n\n${offending.join('\n')}\n\n` +
      'Every tribal trait reaches the board through that one function, which returns at most ' +
      `${MOST_ADJACENT} neighbours. A second site is how a trait that counts the board gets written.`,
  );
  // The detector has to have fired on something, or an engine that compares no
  // races at all reports as an engine that compares them in one place.
  assert.ok(
    found.length > 0,
    'found no race comparison anywhere under src/engine/. Either the tribal traits are gone, ' +
      'or this check stopped being able to see one - and it cannot tell those apart, so it fails.',
  );
});

// ------------------------------------------------- the number shown before commit

test('the tribal Power shown before commit is the Power that lands', () => {
  // `src/render/odds.ts` is a second implementation of the engine's arithmetic
  // and it is what the player reads before choosing a slot. A trait that adds
  // Power and is missing from it does not read as a missing feature, it reads
  // as a wrong number.
  //
  // Mutation watched going red: the three tribal branches deleted from
  // `projectOwnPhase` - the projection then shows every tribal body at its
  // printed Power and this fails on the first unit.
  //
  // Bound: a phase nothing dies in, which is the same bound the Relay version
  // of this check carries in `test/render-view.test.ts` and for the same
  // reason - the projection does not model a unit dying to the retaliation its
  // own attack drew. The wall here has Power 0, so nothing can.
  const f = fixture();
  const ids: Entity[] = [];
  ids.push(f.add('player', card({ id: 'test:d1', power: 1, health: 40, tribe: 'dwarf' })));
  ids.push(
    f.add(
      'player',
      card({ id: 'test:k', power: 1, health: 40, tribe: 'dwarf', traits: ['kindle'] }),
    ),
  );
  ids.push(f.add('player', card({ id: 'test:d2', power: 1, health: 40, tribe: 'dwarf' })));
  ids.push(
    f.add(
      'player',
      card({ id: 'test:s', power: 1, health: 40, tribe: 'dwarf', traits: ['chorus'] }),
    ),
  );
  ids.push(f.add('player', card({ id: 'test:d3', power: 1, health: 40, tribe: 'dwarf' })));
  ids.push(
    f.add(
      'player',
      card({ id: 'test:b', power: 1, health: 40, tribe: 'human', traits: ['banner'] }),
    ),
  );
  ids.push(f.add('player', card({ id: 'test:d4', power: 1, health: 40, tribe: 'dwarf' })));
  f.add('enemy', WALL);

  const projected = projectOwnPhase(f.state, 'player');
  const shown = new Map(projected.board.player.map((e) => [e.uid, e.bonusPower]));

  playerPhase(f.state);

  let anyShown = 0;
  for (const e of f.state.board.player) {
    assert.equal(
      shown.get(e.uid) ?? 0,
      e.bonusPower,
      `uid ${e.uid} (${e.cardId}) was shown ${shown.get(e.uid) ?? 0} bonus Power before commit ` +
        `and ended the phase on ${e.bonusPower}`,
    );
    if (e.bonusPower > 0) anyShown++;
  }
  assert.ok(
    anyShown >= 3,
    `only ${anyShown} unit(s) ended with any bonus Power; a projection that predicted nothing ` +
      'and got nothing agrees with itself and proves nothing',
  );
});

// ------------------------------------------------------------ the neighbourhood

test('a dead neighbour is not kin, and a neighbour that died earlier in the phase is not there to be', () => {
  // Two halves, and only the first is a gate. Saying which is which is the
  // point of the split: a check nobody can make go red is documentation, and
  // calling it a gate is how a suite starts reporting confidence it has not
  // earned.
  //
  // **Gated.** `adjacentAllies` skips a neighbour that is not `alive`.
  // Mutation watched going red: the `!n.alive` test removed - the corpse below
  // is then counted and the Kindler takes +2 where it should take +1.
  //
  // **Not gated, and said so.** The second half is what the rule looks like in
  // a real phase: with combat mutual a unit dies on its own swing, the
  // checkpoint takes it off the board, and the Kindler standing to its right
  // then counts one neighbour instead of two. No mutation makes that half red
  // on its own - `checkStateBased` removes a dead unit from the row outright,
  // so by the time anything asks, the corpse is not a neighbour by either
  // rule. It is kept because it is the board a player actually sees, and it
  // would catch a future change that started counting from a phase-start
  // snapshot rather than from the live line.
  const f = fixture();
  const kindler = f.add(
    'player',
    card({ id: 'test:kindler', power: 1, health: 40, tribe: 'dwarf', traits: ['kindle'] }),
  );
  f.add('player', card({ id: 'test:kinR', power: 0, health: 40, tribe: 'dwarf' }));
  f.state.board.player.unshift(makeUnit(f.state, 'player', card({ id: 'test:corpse', power: 0, health: 4, tribe: 'dwarf' })));
  const corpse = f.state.board.player[0]!;
  f.add('enemy', WALL);

  // A body still standing in the row with `alive` already false, which is what
  // every entity looks like between `apply` and the checkpoint that removes it.
  corpse.alive = false;
  assert.equal(
    adjacentKin(f.state, kindler, 'same'),
    1,
    'a dead dwarf still in the row was counted as kin',
  );
  playerPhase(f.state);
  assert.equal(kindler.bonusPower, KINDLE_POWER, 'and the swing was buffed by the living one only');

  // The second half, on its own board.
  const g = fixture();
  const doomed = g.add('player', card({ id: 'test:doomed', power: 1, health: 2, tribe: 'dwarf' }));
  const live = g.add(
    'player',
    card({ id: 'test:kindler', power: 1, health: 40, tribe: 'dwarf', traits: ['kindle'] }),
  );
  g.add('player', card({ id: 'test:survivor', power: 0, health: 40, tribe: 'dwarf' }));
  g.add('enemy', card({ id: 'test:killer', power: 5, health: 90, tribe: 'orc', traits: ['guard'] }));

  const events = playerPhase(g.state);
  assert.ok(
    events.some((e) => e.kind === 'died' && e.uid === doomed.uid),
    'the fixture did not kill the left-hand dwarf, so this half is not showing what it says',
  );
  assert.equal(
    live.bonusPower,
    KINDLE_POWER,
    'the dwarf on the left was off the board by the time the Kindler acted, so only the one ' +
      'on the right counted',
  );
});

test('a tribal count is bounded at MOST_ADJACENT on any board the accessor can be handed', () => {
  // `adjacentKin` is the whole surface a tribal trait has, so its own bound is
  // worth stating directly rather than only through the traits that use it.
  // A hero asking is 0 both ways round, because a hero is never a neighbour and
  // no unit is of race `'hero'`.
  const f = fixture();
  const units: Entity[] = [];
  for (let i = 0; i < 9; i++) {
    units.push(f.add('player', card({ id: `test:u${i}`, power: 0, health: 9, tribe: 'dwarf' })));
  }
  const hero = f.state.board.player[f.state.board.player.length - 1]!;

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    const same = adjacentKin(f.state, u, 'same');
    const different = adjacentKin(f.state, u, 'different');
    assert.ok(
      same <= MOST_ADJACENT,
      `a unit on a line of ${units.length} counted ${same} kin, above ${MOST_ADJACENT}`,
    );
    // The rightmost unit's right-hand neighbour is the hero, which is in
    // neither count, so it has one neighbour where the middle of the line has
    // two. The two polarities partition exactly those.
    const neighbours = (i > 0 ? 1 : 0) + (i < units.length - 1 ? 1 : 0);
    assert.equal(
      same + different,
      neighbours,
      `unit ${i} of ${units.length} has ${neighbours} unit neighbour(s) and the two polarities ` +
        `counted ${same} + ${different}`,
    );
  }
  // Both polarities of the *count* when a hero is the one asking, which are two
  // rules and not one. This is not "both directions of the hero rule" - it used
  // to say that, and overstated itself. A hero being *granted* to is the other
  // direction, it lives in `adjacentAllies` rather than here, and it is gated by
  // "a Chorus beside the hero sings to nobody" below.
  assert.equal(adjacentKin(f.state, hero, 'same'), 0, 'a hero has no kin');
  assert.equal(
    adjacentKin(f.state, hero, 'different'),
    0,
    'and no strangers either. Without this a hero carrying Banner would take +1 for the unit on ' +
      'its left, every turn, for standing at the right end of the line - which is a bonus for ' +
      'position and not for race. Found by this assertion rather than by review.',
  );
});

// ------------------------------------------------ a race is identity, not a dial

/**
 * Every shipped unit card's race, written out. Pinned, not derived.
 *
 * `hashFight`'s canonical form does not carry a race, and `ARCHITECTURE.md`
 * says why: a race is a function of `cardId`, which the form already carries,
 * and unlike a piece of equipment's two numbers it is *identity* rather than a
 * tuned value - "a rebalanced card keeps its id and a redesigned one gets a new
 * one, so changing a card's race mints a new id". Every hash recorded before
 * tribes existed still reproduces because of that rule.
 *
 * The rule had no gate. Changing `u_songkeeper` from elf to human with the id
 * kept passed `npm run gates`, `npm run verify` and `npm run verify:run` - while
 * changing what Chorus does in every fight that card appears in, and while
 * leaving every recorded hash claiming to describe a fight it no longer
 * describes. This table is the gate: an id whose race moves has to move this
 * line too, which is the moment the "mint a new id" rule is meant to be read.
 *
 * Derived from the pool it would be a tautology - the same class of check as
 * `verify:run`'s sigil ledger, whose first draft derived its expected traits
 * from the helpers the code under test was built from and could only prove the
 * code agreed with itself.
 */
const RACE_OF: Readonly<Record<string, Tribe>> = {
  u_squire: 'human',
  u_shieldbearer: 'dwarf',
  u_pikeman: 'dwarf',
  u_hornblower: 'human',
  u_ironguard: 'dwarf',
  u_avenger: 'dwarf',
  u_berserker: 'human',
  u_captain: 'human',
  u_sentinel: 'elf',
  u_champion: 'human',
  u_archer: 'elf',
  u_wayfinder: 'elf',
  u_treewarden: 'elf',
  u_longbow: 'elf',
  u_herald: 'human',
  u_manatarms: 'human',
  u_paladin: 'human',
  u_veteran: 'dwarf',
  u_thane: 'dwarf',
  u_bulwark: 'dwarf',
  u_kindler: 'dwarf',
  u_runesmith: 'dwarf',
  u_songkeeper: 'elf',
  u_elflord: 'elf',
  u_bannerman: 'human',
  u_marshal: 'human',
  e_goblin: 'orc',
  e_shieldwall: 'orc',
  e_ogre: 'orc',
  e_troll: 'beast',
};

test('a card id names a race, and a card that changes race gets a new id', () => {
  // Mutations watched going red: `u_songkeeper` changed from elf to human with
  // its id kept; a new card added to the pool without a line here.
  //
  // Bound: the shipped unit pools and the `_nc` control derived from the player
  // half. It says nothing about a card whose *numbers* move - those are in the
  // canonical form already - and nothing about spells or equipment, which carry
  // no race.
  const shipped = [...PLAYER_CARDS, ...ENEMY_CARDS];
  assert.ok(shipped.length > 0, 'no shipped unit cards found, so this check did not run');

  const drifted: string[] = [];
  for (const c of shipped) {
    const pinned = RACE_OF[c.id];
    if (pinned === undefined) {
      drifted.push(`${c.id} is ${c.tribe} in the pool and is not pinned here`);
    } else if (pinned !== c.tribe) {
      drifted.push(`${c.id} is pinned ${pinned} and is ${c.tribe} in the pool`);
    }
  }
  for (const id of Object.keys(RACE_OF)) {
    if (!shipped.some((c) => c.id === id)) drifted.push(`${id} is pinned here and is not shipped`);
  }

  assert.deepEqual(
    drifted,
    [],
    `a shipped card's race and this table disagree:\n\n  ${drifted.join('\n  ')}\n\n` +
      'A race is not in the fight hash, because it is recoverable from the card id - so a card ' +
      'that changes race has to get a NEW id, or every hash recorded against the old one now ' +
      'describes a different fight. Keep the id and change this line only when the card is new.',
  );

  // The negative control that stops "recoverable from the id" from being a
  // sentence: the canonical form carries the id and not the race, so two
  // entities of different races built from the same id would serialise the
  // same - which is exactly why the id has to move.
  const f = fixture();
  const elf = f.add('player', card({ id: 'u_songkeeper', power: 1, health: 4, tribe: 'elf' }));
  const rendered = stateToCanonical({ board: { player: [elf], enemy: [] }, nextUid: 0 });
  assert.ok(rendered.includes('u_songkeeper'), 'the canonical form carries the card id');
  for (const t of ['elf', 'dwarf', 'human', 'orc', 'beast'] as const) {
    assert.equal(
      rendered.includes(`${t}`),
      false,
      `the canonical form names the race "${t}". It is meant to carry the id only, and the ` +
        'race is meant to follow from it.',
    );
  }

  // And the `_nc` control inherits its race rather than restating it, so a
  // pinned race covers both halves of the measurement.
  for (const c of PLAYER_CARDS_NO_CASCADE) {
    const source = PLAYER_CARDS.find((p) => `${p.id}_nc` === c.id);
    assert.notEqual(source, undefined, `${c.id} has no card it was derived from`);
    assert.equal(c.tribe, source!.tribe, `${c.id} and ${source!.id} disagree about race`);
  }
});

test('a tribal effect naming an entity that has left the board is skipped, like every other effect', () => {
  // The rule is `engine/resolver.ts`'s header - "an effect naming an entity
  // that has left the board is skipped, not an error" - and a new verb has to
  // obey it or it is a new way to crash a fight.
  const f = fixture();
  const kindler = f.add(
    'player',
    card({ id: 'test:kindler', power: 1, health: 1, tribe: 'dwarf', traits: ['kindle'] }),
  );
  f.add('player', card({ id: 'test:kin', power: 0, health: 9, tribe: 'dwarf' }));
  f.add('enemy', WALL);

  kindler.health = 0;
  kindler.alive = false;
  const result = drain(
    f.state,
    [{ kind: 'tribePower', uid: kindler.uid, per: KINDLE_POWER, match: 'same' }],
    makeRng(1, 'skip'),
  );
  assert.deepEqual(result.events, [], 'a tribal effect on a dead entity announced something');
  assert.equal(kindler.bonusPower, 0);
});
