// The hero's class-flavoured attack, as two traits the resolver reads for a
// hero and a unit alike.
//
// `docs/design/game.md`: "Health, plus a small class-flavoured attack. The
// Knight swings for 2, the Ranger for 1 twice, the Mage for 1 with a rider."
// A Knight is a plain `attack`. The other two are not one `attack`, so they
// are the two smallest verbs that express them under the resolver contract:
// Volley makes an `act` spawn a second `attack`, and Scorch makes it spawn a
// `scorch`, which is `damageAll`'s loop under its own name. Neither adds a
// site of mutation, and both are continuations of the act, so they queue
// ahead of any reaction to the first swing.
//
// Two rules the design does not state are decided here and gated as they
// stand, so reversing either goes red rather than passing quietly:
//
//   - A Volley body whose first swing drew lethal retaliation does not swing
//     again, and its after-acting trait does not fire. The checkpoint runs
//     between the two swings, and the second names an entity that has left
//     the board. For a hero the question cannot arise: a hero takes no
//     retaliation, so a hero's second swing is never lost that way.
//   - A Scorch with nothing to burn emits no event, where a spell cast into an
//     empty line fizzles. A `fizzled` after the hero's own `attacked` would
//     contradict it on screen.
//
// Bound of this file - what a green run does and does not prove:
//
//   Fixtures, not cards. No id below exists in `src/content` and nothing here
//   adds to the pool; the shipped heroes and the two shipped Volley bodies are
//   `test/classes.test.ts`'s. Volley is gated at `VOLLEY_SWINGS`, which is 2,
//   the design's own number; Scorch at `SCORCH_DAMAGE`, which is 1.
//
//   Every ordering claim is asserted on the event stream and the effect trace,
//   not only on final state. For a second swing landing before a Wake, the
//   order IS the observable, and one test searches a small seed window for a
//   roll that makes it observable in Health too, and says so if none is found.
//
//   **Board order here is one line's order, never the two lines' order.** "two
//   Wake units answering one Scorch gain Power in board order" builds all four
//   units on the enemy side, because a rider only reaches one side. So it
//   covers `checkStateBased`'s inner loop - left to right within a line - and
//   is blind to its outer one: swapping `['player', 'enemy']` for
//   `['enemy', 'player']` there leaves every assertion in this file true. The
//   side order is gated by "two deaths at one checkpoint are announced player
//   line first, then enemy line" in `test/resolver-order.test.ts`, and that is
//   the only place it is.
//
//   "an act that ended the fight finishes, and says nothing it did not do" is
//   one fixture at one seed, with targeting forced. How often a real fight
//   reaches it is not this file's to say; the 500-seed sweep that measured it
//   is in `docs/work/10_classes/plan.md`, session four.
//
//   Nothing here says either class is worth playing. `npm run measure:run --
//   --class <id>` is the instrument for that, and its numbers are information
//   for the player, not a target - `docs/policies/local-rules.md`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { castSpell } from '../src/engine/cast.ts';
import { stateToCanonical } from '../src/engine/hash.ts';
import { makeRng } from '../src/engine/rng.ts';
import {
  type GameEvent,
  SCORCH_DAMAGE,
  VOLLEY_SWINGS,
  drain,
  resolvePhase,
  swingsOf,
} from '../src/engine/resolver.ts';
import {
  type Entity,
  type GameState,
  type HeroSpec,
  type Side,
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

type Fixture = {
  state: GameState;
  add: (side: Side, c: UnitCard, index?: number) => Entity;
};

/**
 * Both heroes swing for 0 unless told otherwise, so a hero adds nothing to
 * what is measured unless the test is about the hero.
 */
function fixture(player: Partial<HeroSpec> = {}, enemy: Partial<HeroSpec> = {}): Fixture {
  const state: GameState = { board: { player: [], enemy: [] }, nextUid: 1 };
  state.board.player.push(
    makeHero(state, 'player', { name: 'Knight', health: 30, power: 0, armour: 0, ...player }),
  );
  state.board.enemy.push(
    makeHero(state, 'enemy', { name: 'Warchief', health: 30, power: 0, armour: 0, ...enemy }),
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

const kinds = (events: readonly GameEvent[]): string[] => events.map((e) => e.kind);

function attacks(events: readonly GameEvent[]): { targetUid: number; raw: number; dealt: number }[] {
  const out: { targetUid: number; raw: number; dealt: number }[] = [];
  for (const e of events) {
    if (e.kind === 'attacked') out.push({ targetUid: e.targetUid, raw: e.raw, dealt: e.dealt });
  }
  return out;
}

function retaliations(events: readonly GameEvent[]): { uid: number; raw: number; dealt: number }[] {
  const out: { uid: number; raw: number; dealt: number }[] = [];
  for (const e of events) {
    if (e.kind === 'retaliated') out.push({ uid: e.uid, raw: e.raw, dealt: e.dealt });
  }
  return out;
}

function burns(events: readonly GameEvent[]): { targetUid: number; raw: number; dealt: number }[] {
  const out: { targetUid: number; raw: number; dealt: number }[] = [];
  for (const e of events) {
    if (e.kind === 'damaged') out.push({ targetUid: e.targetUid, raw: e.raw, dealt: e.dealt });
  }
  return out;
}

// ------------------------------------------------------------------ Volley

test('a Volley act is two attacks from one act, each its own effect', () => {
  // Mutation watched going red: `swingsOf` returning 1 for everything.
  //
  // The trace is asserted as well as the events, because two swings inside
  // one `attack` would produce two `attacked` events from one effect and the
  // checkpoint would not run between them.
  const f = fixture({ name: 'Ranger', power: 1, traits: ['volley'] });
  const wall = f.add('enemy', card('test:wall', 0, 9, 0, ['guard']));
  const hero = heroOf(f.state, 'player');

  assert.equal(VOLLEY_SWINGS, 2, 'the design says "1 twice"');
  assert.equal(swingsOf(hero), 2);
  assert.equal(swingsOf(wall), 1);

  const { events, trace } = drain(f.state, [{ kind: 'act', uid: hero.uid }], makeRng(1, 'combat'));
  assert.deepEqual(trace.map((e) => e.kind), ['act', 'attack', 'attack', 'afterAct']);
  assert.deepEqual(kinds(events), ['acted', 'attacked', 'attacked', 'afterActed']);
  assert.deepEqual(attacks(events), [
    { targetUid: wall.uid, raw: 1, dealt: 1 },
    { targetUid: wall.uid, raw: 1, dealt: 1 },
  ]);
  assert.equal(wall.health, 7);
});

test('mutual damage applies to a Volley swing as to any other: a unit trades on each, a hero on neither', () => {
  // Mutation watched going red: one `attack` at `power * swingsOf`, which is
  // the other way to write "swings twice" and draws one retaliation for two
  // swings' worth of damage.
  const f = fixture({ name: 'Ranger', power: 1, traits: ['volley'] });
  const archer = f.add('player', card('test:archer', 1, 10, 0, ['volley']));
  const wall = f.add('enemy', card('test:wall', 3, 20, 0, ['guard']));
  const hero = heroOf(f.state, 'player');

  const unitTurn = drain(f.state, [{ kind: 'act', uid: archer.uid }], makeRng(1, 'combat'));
  assert.deepEqual(kinds(unitTurn.events), [
    'acted',
    'attacked',
    'retaliated',
    'attacked',
    'retaliated',
    'afterActed',
  ]);
  assert.deepEqual(
    retaliations(unitTurn.events).map((r) => r.dealt),
    [3, 3],
    'each swing is a trade at the defender’s printed Power',
  );
  assert.equal(archer.health, 4, 'the archer paid for both swings');
  assert.equal(wall.health, 18);

  const heroTurn = drain(f.state, [{ kind: 'act', uid: hero.uid }], makeRng(2, 'combat'));
  assert.deepEqual(kinds(heroTurn.events), ['acted', 'attacked', 'attacked', 'afterActed']);
  assert.equal(hero.health, 30, 'a hero takes nothing back on either swing');
  assert.equal(wall.health, 16);
});

test('each swing picks its own target, from the board as the first swing left it', () => {
  // Mutation watched going red: both swings applied inside one `apply`
  // against one target, which over-kills a 1-Health Guard with the second
  // swing instead of reaching the hero it uncovered.
  const f = fixture({ name: 'Ranger', power: 1, traits: ['volley'] });
  const gate = f.add('enemy', card('test:gate', 0, 1, 0, ['guard']));
  const hero = heroOf(f.state, 'player');
  const enemyHero = heroOf(f.state, 'enemy');

  const { events } = drain(f.state, [{ kind: 'act', uid: hero.uid }], makeRng(3, 'combat'));
  assert.deepEqual(kinds(events), ['acted', 'attacked', 'died', 'attacked', 'afterActed']);
  assert.deepEqual(
    attacks(events).map((a) => a.targetUid),
    [gate.uid, enemyHero.uid],
    'the first swing had to hit the Guard; the second found the hero it uncovered',
  );
  assert.equal(gate.alive, false);
  assert.equal(enemyHero.health, 29);
});

test('a Volley unit that dies to its first swing’s retaliation never swings again, and its after-acting trait does not fire', () => {
  // Mutation watched going red: both swings applied inside one `apply`, with
  // no checkpoint between them. The rule is the existing one - an effect
  // naming an entity that has left the board is skipped - reaching the second
  // swing; nothing here is written for Volley.
  const f = fixture();
  const scout = f.add('player', card('test:scout', 1, 2, 0, ['volley', 'relay']));
  const buddy = f.add('player', card('test:buddy', 1, 5, 0));
  const wall = f.add('enemy', card('test:wall', 5, 20, 0, ['guard']));

  const { events } = drain(f.state, [{ kind: 'act', uid: scout.uid }], makeRng(4, 'combat'));
  assert.deepEqual(kinds(events), ['acted', 'attacked', 'retaliated', 'died']);
  assert.equal(scout.alive, false, 'the first swing’s retaliation was lethal');
  assert.equal(wall.health, 19, 'one swing landed, not two');
  assert.equal(power(buddy), 1, 'the scout acted but never finished acting, so Relay handed nothing on');
  assert.equal(f.state.board.player.length, 2, 'the scout has left the board');
});

test('the second swing lands before any reaction to the first: a woken Guard retaliates at its printed Power', () => {
  // Mutation watched going red: reactions pushed onto the queue before an
  // effect’s own continuations in `drain`, which lets the Wake +2 land between
  // the two swings. Both attacks are continuations of the one `act`, so the
  // Wake answering the first swing’s kill queues behind the second swing.
  //
  // The second swing picks between the waker and the enemy hero, so the seed
  // window below is searched for a roll that hits the waker - the only roll
  // that makes the ordering visible in Health and not only in the stream.
  let found = false;
  for (let seed = 1; seed <= 24 && !found; seed++) {
    const f = fixture();
    const archer = f.add('player', card('test:archer', 1, 10, 0, ['volley']));
    const victim = f.add('enemy', card('test:victim', 0, 1, 0, ['guard']));
    const waker = f.add('enemy', card('test:waker', 1, 10, 0, ['wake']));

    const { events } = drain(f.state, [{ kind: 'act', uid: archer.uid }], makeRng(seed, 'combat'));
    const swings = attacks(events);
    assert.equal(swings.length, 2, `seed ${seed}: two swings`);
    assert.equal(swings[0]!.targetUid, victim.uid, `seed ${seed}: the Guard is the only first target`);
    const attackAt = events.map((e, i) => (e.kind === 'attacked' ? i : -1)).filter((i) => i >= 0);
    const secondAttack = attackAt[1]!;
    const wake = events.findIndex((e) => e.kind === 'powerGained');
    assert.ok(wake >= 0, `seed ${seed}: the waker answered the victim’s death`);
    assert.ok(secondAttack < wake, `seed ${seed}: the second swing came before the Wake, at ${secondAttack} against ${wake}`);
    if (swings[1]!.targetUid !== waker.uid) continue;

    found = true;
    assert.deepEqual(kinds(events), [
      'acted',
      'attacked',
      'retaliated',
      'died',
      'attacked',
      'retaliated',
      'afterActed',
      'powerGained',
    ]);
    assert.deepEqual(
      retaliations(events).map((r) => r.raw),
      [0, 1],
      `seed ${seed}: the waker hit back at its printed 1, not the woken 3`,
    );
    assert.equal(archer.health, 9);
    assert.equal(power(waker), 3, 'the Wake did land - after the swing');
  }
  assert.ok(found, 'no seed in 1..24 sent the second swing at the waker, so the Health half of this gate did not run');
});

test('an act that ended the fight finishes, and says nothing it did not do', () => {
  // The product-surface rule in `src/engine/resolver.ts`'s header, at the
  // entity a player met it on. A Ranger's first swing kills the exposed enemy
  // hero; the second swing is already queued, finds an empty pool, and used to
  // emit `fizzled` - so the screen read "the Warchief dies", then "has no legal
  // target - the attack fizzles", with a floating "no target" over the hero
  // that had just won the fight.
  //
  // Both halves matter. The act still FINISHES - the trace still holds both
  // attacks and the `afterAct` - because clearing the queue at the checkpoint
  // would be a change to the resolution contract. What changed is only what is
  // said.
  //
  // Bound: one fixture, one seed, targeting forced by there being exactly one
  // enemy entity. It says nothing about the frequency of this in real fights;
  // that measurement is in `docs/work/10_classes/plan.md`, session four.
  const f = fixture({ name: 'Ranger', power: 1, traits: ['volley'] }, { health: 1 });
  const hero = heroOf(f.state, 'player');
  const enemyHero = heroOf(f.state, 'enemy');

  const { events, trace } = drain(f.state, [{ kind: 'act', uid: hero.uid }], makeRng(12, 'combat'));
  assert.deepEqual(trace.map((e) => e.kind), ['act', 'attack', 'attack', 'afterAct'], 'the act finished');
  assert.deepEqual(kinds(events), ['acted', 'attacked', 'died', 'afterActed']);
  assert.equal(
    events.some((e) => e.kind === 'fizzled'),
    false,
    'the second swing changed nothing, so it said nothing - a fizzle here lands under the ' +
      'death that ended the fight and contradicts it',
  );
  assert.equal(enemyHero.alive, false);

  // The Mage's half of the same rule, and the reason it is not symmetrical: a
  // rider that BURNS still announces it, because the board really did change
  // and the view is derived from these events. Only a rider with nothing to
  // burn is silent, which is the rule `scorch` already carried.
  const g = fixture({ name: 'Mage', power: 1, traits: ['scorch'] }, { health: 1 });
  const mage = heroOf(g.state, 'player');
  const mook = g.add('enemy', card('test:mook', 0, 5, 0));
  const burnt = drain(g.state, [{ kind: 'act', uid: mage.uid }], makeRng(13, 'combat'));
  assert.deepEqual(kinds(burnt.events), ['acted', 'attacked', 'died', 'damaged', 'afterActed']);
  assert.equal(mook.health, 4, 'the burn landed, so the burn is announced');
});

// ------------------------------------------------------------------ Scorch

test('Scorch: after the swing, every enemy unit takes SCORCH_DAMAGE less its Armour, the hero is untouched, nothing hits back', () => {
  // Mutations watched going red: the `scorch` spawn dropped from the `act`
  // case (no `damaged` at all); the `t.isHero` filter dropped from the shared
  // loop (the enemy hero burns).
  const f = fixture({ name: 'Mage', power: 1, traits: ['scorch'] });
  const guard = f.add('enemy', card('test:guard', 2, 5, 0, ['guard']));
  const plated = f.add('enemy', card('test:plated', 4, 5, 1));
  const hero = heroOf(f.state, 'player');
  const enemyHero = heroOf(f.state, 'enemy');

  assert.equal(SCORCH_DAMAGE, 1);
  const { events, trace } = drain(f.state, [{ kind: 'act', uid: hero.uid }], makeRng(5, 'combat'));
  assert.deepEqual(trace.map((e) => e.kind), ['act', 'attack', 'scorch', 'afterAct']);
  assert.deepEqual(kinds(events), ['acted', 'attacked', 'damaged', 'damaged', 'afterActed']);
  assert.deepEqual(attacks(events), [{ targetUid: guard.uid, raw: 1, dealt: 1 }]);
  assert.deepEqual(burns(events), [
    { targetUid: guard.uid, raw: 1, dealt: 1 },
    { targetUid: plated.uid, raw: 1, dealt: 0 },
  ]);
  assert.equal(guard.health, 3, 'the swing and the burn');
  assert.equal(plated.health, 5, 'Armour 1 stops a 1-point burn');
  assert.equal(enemyHero.health, 30, 'a rider never reaches the hero');
  assert.equal(hero.health, 30, 'nothing hits back at a hero, and spell damage draws no retaliation');
});

test('Scorch is spell damage on a unit too: Guard does not narrow it and the burned draw no retaliation', () => {
  // Mutation watched going red: Scorch written as one `attack` per enemy unit,
  // which trades with every body it touches and is narrowed by Guard.
  const f = fixture();
  const ember = f.add('player', card('test:ember', 0, 10, 0, ['scorch']));
  const guard = f.add('enemy', card('test:guard', 2, 5, 0, ['guard']));
  const brute = f.add('enemy', card('test:brute', 5, 5, 0));

  const { events } = drain(f.state, [{ kind: 'act', uid: ember.uid }], makeRng(6, 'combat'));
  assert.deepEqual(kinds(events), ['acted', 'attacked', 'retaliated', 'damaged', 'damaged', 'afterActed']);
  assert.deepEqual(attacks(events).map((a) => a.targetUid), [guard.uid], 'the swing went where Guard sent it');
  assert.deepEqual(burns(events).map((b) => b.targetUid), [guard.uid, brute.uid], 'the burn went everywhere');
  assert.equal(ember.health, 8, 'the swing’s trade with the Guard, and nothing from the brute');
  assert.equal(guard.health, 4);
  assert.equal(brute.health, 4);
});

test('Scorch follows the swing: a unit the swing kills is not burned, and the burn’s deaths come at their own checkpoint', () => {
  // Mutation watched going red: the `scorch` spawned ahead of the attacks in
  // the `act` case, which burns the Guard before the swing can hit it and
  // sends the swing at the hero instead.
  const f = fixture({ name: 'Mage', power: 1, traits: ['scorch'] });
  const gate = f.add('enemy', card('test:gate', 0, 1, 0, ['guard']));
  const soft = f.add('enemy', card('test:soft', 0, 1, 0));
  const hero = heroOf(f.state, 'player');

  const { events } = drain(f.state, [{ kind: 'act', uid: hero.uid }], makeRng(7, 'combat'));
  assert.deepEqual(kinds(events), ['acted', 'attacked', 'died', 'damaged', 'died', 'afterActed']);
  assert.deepEqual(attacks(events).map((a) => a.targetUid), [gate.uid]);
  assert.deepEqual(burns(events).map((b) => b.targetUid), [soft.uid], 'the Guard was already dead when the burn came');
  assert.equal(heroOf(f.state, 'enemy').health, 30);
});

test('a Scorch with nothing to burn says nothing; a spell cast into the same empty line still fizzles', () => {
  // Mutation watched going red: `effect.kind === 'damageAll'` dropped from the
  // fizzle condition in the shared loop, which makes a Mage announce a fizzle
  // after every swing at an exposed hero.
  const f = fixture({ name: 'Mage', power: 1, traits: ['scorch'] });
  const hero = heroOf(f.state, 'player');
  const enemyHero = heroOf(f.state, 'enemy');

  const { events, trace } = drain(f.state, [{ kind: 'act', uid: hero.uid }], makeRng(8, 'combat'));
  assert.deepEqual(trace.map((e) => e.kind), ['act', 'attack', 'scorch', 'afterAct'], 'the burn was applied');
  assert.deepEqual(kinds(events), ['acted', 'attacked', 'afterActed'], 'and said nothing');
  assert.equal(enemyHero.health, 29);

  const cast = castSpell(
    f.state,
    'player',
    { kind: 'spell', id: 'test:wipe', name: 'test:wipe', cost: 1, effects: [{ kind: 'damageAll', amount: 1 }] },
    makeRng(8, 'combat'),
  );
  assert.deepEqual(kinds(cast), ['fizzled'], 'the spell rule is unchanged');
});

test('two Wake units answering one Scorch gain Power in board order', () => {
  // Mutation watched going red: Scorch as one effect per unit, which gives
  // every death its own checkpoint and interleaves each Wake with the death
  // it answers. The burn is one effect, so both deaths are announced together
  // and both Wakes queue in `checkStateBased`’s board order.
  //
  // Built right to left so uid order is the reverse of board order.
  const f = fixture({ name: 'Mage', power: 0, traits: ['scorch'] });
  const wakerR = f.add('enemy', card('test:waker-right', 0, 9, 0, ['wake']), 0);
  const victimR = f.add('enemy', card('test:victim-right', 0, 1, 0), 0);
  const wakerL = f.add('enemy', card('test:waker-left', 0, 9, 0, ['wake']), 0);
  const victimL = f.add('enemy', card('test:victim-left', 0, 1, 0), 0);
  const hero = heroOf(f.state, 'player');

  const { events } = drain(f.state, [{ kind: 'act', uid: hero.uid }], makeRng(9, 'combat'));
  const tail = events.filter((e) => e.kind === 'died' || e.kind === 'powerGained');
  assert.deepEqual(
    tail.map((e) => `${e.kind}#${e.uid}`),
    [`died#${victimL.uid}`, `died#${victimR.uid}`, `powerGained#${wakerL.uid}`, `powerGained#${wakerR.uid}`],
  );
  assert.equal(power(wakerL), 2);
  assert.equal(power(wakerR), 2);
});

test('Volley and Scorch on one entity: the swings, then the burn, then the after-acting hook', () => {
  // Pins the order the `act` case spawns in. No shipped card carries both;
  // a sigil could grant the second, and the order is decided here once.
  const f = fixture();
  const both = f.add('player', card('test:both', 1, 10, 0, ['volley', 'scorch']));
  f.add('enemy', card('test:wall', 0, 9, 0, ['guard']));

  const { trace } = drain(f.state, [{ kind: 'act', uid: both.uid }], makeRng(10, 'combat'));
  assert.deepEqual(trace.map((e) => e.kind), ['act', 'attack', 'attack', 'scorch', 'afterAct']);
});

// ------------------------------------------- the design's two play examples

test('the two play examples in docs/design/game.md walk exactly as written', () => {
  // `AGENTS.md`: a change to `docs/design/` restates the affected rule as a
  // concrete play example, "because a mechanic that cannot be walked through by
  // hand is not yet specified". An example nothing runs is prose, and prose
  // drifts - so both are walked here, number for number, and the assertion
  // messages quote the document.
  //
  // Bound: it holds the two examples to the engine, not the engine to the
  // design. If a rule changes deliberately, this goes red and the document is
  // what has to be edited.

  // "The Mage's rider is a Scorch" - Mage hero Power 1, against an Orc
  // Shieldwall (1/5, Armour 1, Guard) and two Goblin Wolfriders (2/1).
  {
    const f = fixture({ name: 'Mage', power: 1, traits: ['scorch'] });
    const wall = f.add('enemy', card('ex:shieldwall', 1, 5, 1, ['guard']));
    const wolfA = f.add('enemy', card('ex:wolfrider-a', 2, 1, 0));
    const wolfB = f.add('enemy', card('ex:wolfrider-b', 2, 1, 0));
    const mage = heroOf(f.state, 'player');
    const enemyHero = heroOf(f.state, 'enemy');

    const { events } = drain(f.state, [{ kind: 'act', uid: mage.uid }], makeRng(14, 'combat'));
    assert.deepEqual(attacks(events), [{ targetUid: wall.uid, raw: 1, dealt: 0 }], 'step 1: "it deals 0"');
    assert.equal(mage.health, 30, 'step 1: "the Mage is untouched"');
    assert.deepEqual(
      burns(events),
      [
        { targetUid: wall.uid, raw: 1, dealt: 0 },
        { targetUid: wolfA.uid, raw: 1, dealt: 1 },
        { targetUid: wolfB.uid, raw: 1, dealt: 1 },
      ],
      'step 2: "the Shieldwall takes 1 - 1 = 0, each Wolfrider takes 1 - 0 = 1"',
    );
    assert.deepEqual(
      events.filter((e) => e.kind === 'died').map((e) => e.uid),
      [wolfA.uid, wolfB.uid],
      'step 3: "announced dead together, left to right"',
    );
    assert.equal(wall.health, 5, 'the board after: "Shieldwall 5/5"');
    assert.equal(enemyHero.health, 30, 'the board after: "enemy hero untouched"');
  }

  // "A Volley body killed by its first swing does not swing again" - an Elf
  // Archer (1/2, Volley, Relay) left of a Human Squire (1/2), into a Guard with
  // Power 5 and Health 20.
  {
    const f = fixture();
    const archer = f.add('player', card('ex:archer', 1, 2, 0, ['volley', 'relay']));
    const squire = f.add('player', card('ex:squire', 1, 2, 0));
    const wall = f.add('enemy', card('ex:wall', 5, 20, 0, ['guard']));

    const { events } = drain(f.state, [{ kind: 'act', uid: archer.uid }], makeRng(15, 'combat'));
    assert.deepEqual(attacks(events), [{ targetUid: wall.uid, raw: 1, dealt: 1 }], 'step 1: one swing landed');
    assert.equal(wall.health, 19, 'step 1 and 3: "the wall stays on 19"');
    assert.equal(archer.alive, false, 'step 2: "it dies and leaves the board"');
    assert.deepEqual(kinds(events), ['acted', 'attacked', 'retaliated', 'died'], 'step 3: the second swing said nothing');
    assert.equal(power(squire), 1, 'step 4: "the Squire gets no +2 and swings for its printed 1"');

    // "The same Ranger hero into the same wall loses nothing."
    const g = fixture({ name: 'Ranger', power: 1, traits: ['volley'] });
    const gWall = g.add('enemy', card('ex:wall', 5, 20, 0, ['guard']));
    const ranger = heroOf(g.state, 'player');
    drain(g.state, [{ kind: 'act', uid: ranger.uid }], makeRng(16, 'combat'));
    assert.equal(gWall.health, 18, '"the wall goes 20 -> 19 -> 18"');
    assert.equal(ranger.health, 30);
  }
});

// ---------------------------------------------------------- the plain hero

test('a hero written without traits is the hero it was, and a hero’s trait list is its own copy', () => {
  // Mutation watched going red: `traits: spec.traits` in `makeHero`, aliasing
  // the spec’s array so a buff or a sigil written to the entity would reach
  // back into content.
  const plain = fixture();
  const knight = heroOf(plain.state, 'player');
  assert.deepEqual(knight.traits, []);
  assert.equal(swingsOf(knight), 1);
  assert.match(stateToCanonical(plain.state), /hero:Knight:player:1:0:0:30:30:0::1/, 'the empty trait segment, as before classes');

  const spec: HeroSpec = { name: 'Ranger', health: 30, power: 1, armour: 0, traits: ['volley'] };
  const f = fixture(spec);
  const ranger = heroOf(f.state, 'player');
  ranger.traits.push('scorch');
  assert.deepEqual(spec.traits, ['volley'], 'the spec is untouched by a write to the entity');
  assert.match(stateToCanonical(f.state), /hero:Ranger:player:1:1:0:30:30:0:volley\+scorch:1/);
});

test('resolvePhase runs a class hero’s act like any other: the hero acts last, both swings and the burn included', () => {
  // The whole phase rather than one drain, so the class traits are reached
  // through the path a fight takes and not only through a hand-built queue.
  const f = fixture({ name: 'Mage', power: 1, traits: ['scorch', 'volley'] });
  const squire = f.add('player', card('test:squire', 1, 5, 0));
  const wall = f.add('enemy', card('test:wall', 0, 9, 0, ['guard']));
  const hero = heroOf(f.state, 'player');

  const events = resolvePhase(f.state, 'player', makeRng(11, 'combat'));
  const acted = events.filter((e) => e.kind === 'acted').map((e) => e.uid);
  assert.deepEqual(acted, [squire.uid, hero.uid]);
  assert.equal(attacks(events).length, 3, 'the squire’s swing and the hero’s two');
  assert.equal(burns(events).length, 1);
  assert.equal(wall.health, 9 - 1 - 1 - 1 - 1);
});
