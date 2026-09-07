// Spells: the four verbs, and the ordering AoE makes visible for the first time.
//
// `docs/design/game.md` names AoE spells as the only designated counter to a
// wide board, and going wide is what the deck economy currently rewards. So
// `damageAll` is the card this file is really about, and two of its properties
// are load-bearing rather than incidental:
//
//   - it is ONE effect, so every target is damaged before any death is
//     announced, and the deaths it causes are announced together at one
//     checkpoint;
//   - it therefore makes `checkStateBased`'s board order player-visible. Two
//     Wake units answering one AoE gain Power in board order, and that order is
//     the event stream the animation layer replays.
//
// Bound of this file - what a green run does and does not prove:
//
//   Most cards below are fixtures. Ids beginning `test:` exist nowhere in
//   `src/content` and this file adds nothing to the pool. Two tests deliberately
//   run the shipped spells instead, and they are the only ones that say anything
//   about `src/content/cards.ts`.
//
//   The ordering tests use two corpse-and-waker pairs on one line, killed by one
//   `damageAll`. That covers one line and one checkpoint. A three-way answer, or
//   one spanning both sides, is not covered here - `test/resolver-order.test.ts`
//   covers the cross-side case with a fixture rather than with a spell.
//
//   Order is asserted on the event stream, not only on final state, because for
//   two buffs landing on two different units the order IS the observable: the
//   state is identical either way.
//
//   Nothing here measures balance. What a spell costs and whether it belongs in
//   a deck is the content-and-balance node's question, and the shipped spells
//   are deliberately absent from `PLAYER_DECK` so that no measured number moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { castSpell, spellQueue } from '../src/engine/cast.ts';
import { SPELL_CARDS } from '../src/content/cards.ts';
import { makeRng } from '../src/engine/rng.ts';
import { drain, resolvePhase, startTurn } from '../src/engine/resolver.ts';
import type { GameEvent } from '../src/engine/resolver.ts';
import {
  type Entity,
  type GameState,
  type Side,
  type SpellCard,
  type SpellEffectSpec,
  type Trait,
  type UnitCard,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  power,
  unitCount,
} from '../src/engine/state.ts';

function card(
  id: string,
  pow: number,
  health: number,
  armour: number,
  traits: readonly Trait[] = [],
): UnitCard {
  return { id, name: id, cost: 1, power: pow, health, armour, tribe: 'human', traits };
}

function spell(id: string, ...effects: SpellEffectSpec[]): SpellCard {
  return { kind: 'spell', id, name: id, cost: 1, effects };
}

type Fixture = {
  state: GameState;
  add: (side: Side, c: UnitCard, index?: number) => Entity;
};

/** Heroes swing for 0 by default, so they add nothing to what is measured. */
function fixture(playerHeroPower = 0, enemyHeroPower = 0): Fixture {
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  state.board.player.push(
    makeHero(state, 'player', { name: 'Knight', health: 30, power: playerHeroPower, armour: 0 }),
  );
  state.board.enemy.push(
    makeHero(state, 'enemy', { name: 'Warchief', health: 30, power: enemyHeroPower, armour: 0 }),
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

function uidsOf(events: readonly GameEvent[], kind: GameEvent['kind']): number[] {
  return events.filter((e) => e.kind === kind).map((e) => e.uid);
}

function targetsOf(events: readonly GameEvent[]): number[] {
  return events.filter((e) => e.kind === 'damaged').map((e) => (e.kind === 'damaged' ? e.targetUid : 0));
}

/**
 * Two corpse-and-waker pairs on the enemy line, built right to left so uid
 * order is the exact reverse of board order. One AoE for `amount` kills both
 * victims and leaves both wakers standing.
 */
function twoPairs(amount: number): {
  f: Fixture;
  victimL: Entity;
  wakerL: Entity;
  victimR: Entity;
  wakerR: Entity;
} {
  const f = fixture();
  const wakerR = f.add('enemy', card('test:waker-right', 0, amount + 5, 0, ['wake']), 0);
  const victimR = f.add('enemy', card('test:victim-right', 0, amount, 0), 0);
  const wakerL = f.add('enemy', card('test:waker-left', 0, amount + 5, 0, ['wake']), 0);
  const victimL = f.add('enemy', card('test:victim-left', 0, amount, 0), 0);
  return { f, victimL, wakerL, victimR, wakerR };
}

test('two Wake units answering one AoE gain Power in board order', () => {
  // Mutation watched going red: walk checkStateBased's index loop backwards.
  //
  // This is the property the whole spell round exists to pin. Before AoE,
  // nothing in the game put two units at zero Health in a single effect, so the
  // order two simultaneous deaths are announced in decided nothing a player
  // could see and could only be reached by parking a unit at zero Health in a
  // fixture. One Firestorm now reaches it, and what the player watches is two
  // units waking in the order they stand.
  const { f, victimL, wakerL, victimR, wakerR } = twoPairs(4);

  assert.deepEqual(
    f.state.board.enemy.map((e) => e.uid),
    [victimL.uid, wakerL.uid, victimR.uid, wakerR.uid, heroOf(f.state, 'enemy').uid],
    'the line stands victim, waker, victim, waker, hero',
  );
  assert.ok(victimL.uid > wakerR.uid, 'and uid order disagrees with board order');

  const events = castSpell(
    f.state,
    'player',
    spell('test:firestorm', { kind: 'damageAll', amount: 4 }),
    makeRng(21, 'combat'),
  );

  assert.deepEqual(
    uidsOf(events, 'died'),
    [victimL.uid, victimR.uid],
    'one AoE, two deaths, announced left to right',
  );
  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [wakerL.uid, wakerR.uid],
    'and the two Wake units answer them in that same order',
  );
  assert.equal(wakerL.bonusPower, 2);
  assert.equal(wakerR.bonusPower, 2);
  assert.equal(wakerL.alive, true, 'both wakers survived the AoE, or this measures something else');
  assert.equal(wakerR.alive, true);
});

test('an AoE is one effect: every target is damaged before any death is announced', () => {
  // Mutation watched going red: mark the dead inside damageAll's own loop, the
  // way an implementation that had not read the resolution contract would -
  // `if (t.health <= 0) { t.alive = false; events.push({kind:'died',...}) }`
  // right after the subtraction.
  //
  // ARCHITECTURE.md: "Health is checked at defined checkpoints, not the instant
  // damage lands." AoE is the first shipped effect where that is observable.
  const { f, victimL, wakerL, victimR, wakerR } = twoPairs(4);

  const events = castSpell(
    f.state,
    'player',
    spell('test:firestorm', { kind: 'damageAll', amount: 4 }),
    makeRng(22, 'combat'),
  );

  assert.deepEqual(
    events.map((e) => e.kind),
    ['damaged', 'damaged', 'damaged', 'damaged', 'died', 'died', 'powerGained', 'powerGained'],
    'all four hits land, then the checkpoint announces both deaths, then the wakes answer',
  );
  assert.deepEqual(
    targetsOf(events),
    [victimL.uid, wakerL.uid, victimR.uid, wakerR.uid],
    'and the hits themselves are dealt in board order',
  );
});

test('an AoE hits every living unit on the side and never the hero', () => {
  // Mutation watched going red: drop `|| t.isHero` from damageAll's filter.
  const f = fixture();
  const a = f.add('enemy', card('test:a', 0, 9, 0));
  const b = f.add('enemy', card('test:b', 0, 9, 0));
  const enemyHero = heroOf(f.state, 'enemy');
  const friendly = f.add('player', card('test:friendly', 0, 9, 0));

  castSpell(
    f.state,
    'player',
    spell('test:volley', { kind: 'damageAll', amount: 3 }),
    makeRng(23, 'combat'),
  );

  assert.equal(a.health, 6);
  assert.equal(b.health, 6);
  assert.equal(enemyHero.health, 30, 'AoE answers a wide board; a hero is reached by attacking it');
  assert.equal(friendly.health, 9, 'and it lands on the caster’s opponent, not the caster’s line');
});

test('an AoE consults no target-selection rule: Guard does not narrow it', () => {
  // Mutation watched going red: filter damageAll's targets through
  // legalTargets, which is where Guard lives.
  //
  // Guard answers "which single entity does this strike". An AoE picks nobody,
  // so it never asks - and a wide board of Guards is precisely the board
  // docs/design/game.md names AoE as the counter to. Ward used to be the second
  // half of this test and of that sentence; the owner removed it.
  const f = fixture();
  const guard = f.add('enemy', card('test:guard', 0, 9, 0, ['guard']));
  const plain = f.add('enemy', card('test:plain', 0, 9, 0));
  const third = f.add('enemy', card('test:third', 0, 9, 0));

  castSpell(
    f.state,
    'player',
    spell('test:volley', { kind: 'damageAll', amount: 2 }),
    makeRng(24, 'combat'),
  );

  assert.equal(guard.health, 7, 'the Guard is hit');
  assert.equal(plain.health, 7, 'and so is the unit the Guard would otherwise have covered');
  assert.equal(third.health, 7, 'every living unit on that side, with no pool to consult');
});

test('an AoE subtracts each target’s own Armour, so it is blunted unit by unit', () => {
  // Mutation watched going red: `t.health -= effect.amount` in damageAll,
  // dropping the armour term.
  const f = fixture();
  const soft = f.add('enemy', card('test:soft', 0, 9, 0));
  const plated = f.add('enemy', card('test:plated', 0, 9, 2));
  const immune = f.add('enemy', card('test:immune', 0, 9, 5));

  const events = castSpell(
    f.state,
    'player',
    spell('test:volley', { kind: 'damageAll', amount: 3 }),
    makeRng(25, 'combat'),
  );

  assert.deepEqual(
    events.filter((e) => e.kind === 'damaged').map((e) => (e.kind === 'damaged' ? e.dealt : -1)),
    [3, 1, 0],
    'flat per target, to a minimum of zero',
  );
  assert.equal(soft.health, 6);
  assert.equal(plated.health, 8);
  assert.equal(immune.health, 9, 'Armour 5 against a 3-point wipe takes nothing');
});

test('an AoE with no unit to hit fizzles rather than throwing', () => {
  const f = fixture();
  const events = castSpell(
    f.state,
    'player',
    spell('test:volley', { kind: 'damageAll', amount: 3 }),
    makeRng(26, 'combat'),
  );
  assert.deepEqual(events.map((e) => e.kind), ['fizzled']);
});

test('single-target spell damage picks the way an attack does: Guard narrows the pool', () => {
  // Mutation watched going red: pick from every living entity on the defending
  // side instead of from legalTargets.
  const f = fixture();
  const guard = f.add('enemy', card('test:guard', 0, 400, 0, ['guard']));
  const soft = f.add('enemy', card('test:soft', 0, 400, 0));
  const enemyHero = heroOf(f.state, 'enemy');

  const rng = makeRng(27, 'combat');
  const struck = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const events = castSpell(
      f.state,
      'player',
      spell('test:bolt', { kind: 'damageOne', amount: 1 }),
      rng,
    );
    for (const t of targetsOf(events)) struck.add(t);
  }

  assert.deepEqual([...struck], [guard.uid], 'the only Guard is the only legal target');
  assert.equal(struck.has(soft.uid), false);
  assert.equal(struck.has(enemyHero.uid), false);
  assert.ok(guard.health < guard.maxHealth, 'and the bolts actually landed');
});

test('single-target spell damage lands the card’s number, less the target’s Armour', () => {
  // Mutation watched going red: `target.health -= effect.amount`, dropping the
  // armour term - and, separately, `power(e)` in place of `effect.amount`,
  // which is the copy-paste from the attack case.
  const f = fixture(9);
  const plated = f.add('enemy', card('test:plated', 0, 20, 2, ['guard']));

  const events = castSpell(
    f.state,
    'player',
    spell('test:bolt', { kind: 'damageOne', amount: 5 }),
    makeRng(28, 'combat'),
  );

  const hit = events.find((e) => e.kind === 'damaged');
  assert.ok(hit !== undefined && hit.kind === 'damaged');
  assert.equal(hit.raw, 5, 'the number is the card’s, not the caster’s Power of 9');
  assert.equal(hit.dealt, 3);
  assert.equal(plated.health, 17);
});

test('a single-target spell with no legal target fizzles rather than throwing', () => {
  // An empty pool used to be reachable by warding the only Guard. With Ward
  // gone the remaining route is a side with nothing alive on it, which is the
  // state between a lethal hit and the checkpoint that ends the fight: a dead
  // hero stays on the board and `legalTargets` still skips it.
  const f = fixture();
  const deadHero = heroOf(f.state, 'enemy');
  deadHero.health = 0;
  deadHero.alive = false;

  const events = castSpell(
    f.state,
    'player',
    spell('test:bolt', { kind: 'damageOne', amount: 3 }),
    makeRng(29, 'combat'),
  );
  assert.deepEqual(events.map((e) => e.kind), ['fizzled']);
  assert.equal(deadHero.health, 0, 'nothing was struck');
});

test('a board-wide buff reaches every living unit on the caster’s line and the hero', () => {
  // Mutation watched going red: skip heroes in buffAll's loop, the way
  // damageAll skips them.
  //
  // The hero is the rightmost entity of its own line, not a back rank, and
  // docs/design/game.md puts board-wide effects in spells precisely so that no
  // cascade trait has to count anything.
  const f = fixture(2);
  const a = f.add('player', card('test:a', 1, 5, 0));
  const b = f.add('player', card('test:b', 3, 5, 0));
  const hero = heroOf(f.state, 'player');
  const foe = f.add('enemy', card('test:foe', 1, 5, 0));

  const events = castSpell(
    f.state,
    'player',
    spell('test:rally', { kind: 'buffAll', amount: 2 }),
    makeRng(30, 'combat'),
  );

  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [a.uid, b.uid, hero.uid],
    'left to right along the caster’s own line, hero last because the hero stands last',
  );
  assert.deepEqual([power(a), power(b), power(hero)], [3, 5, 4]);
  assert.equal(power(foe), 1, 'the other side is untouched');

  startTurn(f.state, 'player');
  assert.deepEqual([power(a), power(b), power(hero)], [1, 3, 2], 'and it expires like any buff');
});

test('a spell’s effects resolve in the order they are written', () => {
  // Mutation watched going red: build spellQueue's array in reverse.
  //
  // Wipe-then-buff and buff-then-wipe are different spells: the first buffs a
  // line that has already watched the enemy die, the second is a queue order
  // this asserts on the trace because the final state cannot tell them apart.
  const f = fixture();
  const victim = f.add('enemy', card('test:victim', 0, 2, 0));
  const ally = f.add('player', card('test:ally', 1, 5, 0));

  const { events, trace } = drain(
    f.state,
    spellQueue(
      heroOf(f.state, 'player'),
      spell('test:two-parter', { kind: 'damageAll', amount: 3 }, { kind: 'buffAll', amount: 1 }),
    ),
    makeRng(31, 'combat'),
  );

  assert.deepEqual(trace.map((e) => e.kind), ['damageAll', 'buffAll']);
  assert.deepEqual(events.map((e) => e.kind), ['damaged', 'died', 'powerGained', 'powerGained']);
  assert.equal(victim.alive, false, 'the wipe resolved before the buff');
  assert.equal(power(ally), 2);
});

test('every verb a spell can name is bound to an effect, and the shipped spells only name those', () => {
  // Mutation watched going red: delete the `buffAll` case from spellQueue's
  // switch, which is what "a card that needs a new `if`" would look like in
  // reverse - a card naming a verb the binder silently drops.
  //
  // AGENTS.md: card behaviour is data plus a named effect, never bespoke
  // branching. This is that invariant as an assertion - one effect out per spec
  // in, for every verb in the vocabulary, over the cards actually shipped.
  const f = fixture();
  const caster = heroOf(f.state, 'player');
  const all: SpellEffectSpec[] = [
    { kind: 'damageOne', amount: 1 },
    { kind: 'damageAll', amount: 1 },
    { kind: 'buffAll', amount: 1 },
    { kind: 'gainPower', amount: 1 },
  ];
  assert.deepEqual(
    spellQueue(caster, spell('test:every-verb', ...all)).map((e) => e.kind),
    ['damageOne', 'damageAll', 'buffAll', 'gainPower'],
  );

  assert.ok(SPELL_CARDS.length > 0, 'the scan found shipped spells to read');
  const verbs = new Set(all.map((s) => s.kind));
  for (const shipped of SPELL_CARDS) {
    assert.ok(shipped.effects.length > 0, `${shipped.id} does something`);
    assert.equal(
      spellQueue(caster, shipped).length,
      shipped.effects.length,
      `${shipped.id}: every spec it names produced exactly one effect`,
    );
    for (const spec of shipped.effects) {
      assert.ok(verbs.has(spec.kind), `${shipped.id} names the known verb ${spec.kind}`);
      assert.ok(Number.isInteger(spec.amount), `${shipped.id}: its number is data on the card`);
    }
  }
});

test('a spell is cast by the hero, so it resolves before the line does', () => {
  // The design's turn is: spend energy, commit, then the line resolves. A buff
  // cast in the spend phase is therefore still up when the line swings.
  const f = fixture(2);
  const ally = f.add('player', card('test:ally', 1, 5, 0));
  f.add('enemy', card('test:wall', 0, 99, 0, ['guard']));

  castSpell(
    f.state,
    'player',
    spell('test:rally', { kind: 'buffAll', amount: 2 }),
    makeRng(32, 'combat'),
  );
  const events = resolvePhase(f.state, 'player', makeRng(33, 'combat'));

  assert.deepEqual(
    events.filter((e) => e.kind === 'attacked').map((e) => (e.kind === 'attacked' ? e.raw : 0)),
    [3, 4],
    'the unit swings at 1 + 2 and the hero at 2 + 2',
  );
  assert.equal(ally.alive, true);
});
