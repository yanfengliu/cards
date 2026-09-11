// The resolver's ordering contract, made observable.
//
// ARCHITECTURE.md promises six things about the order things resolve in. Until
// this file existed every one of them was unfalsifiable: the suite stayed green
// with the trigger loop reversed, with the trigger loop ordered by uid, with the
// queue turned into a stack, with deaths deferred to the end of the drain, with
// the acting order read live instead of snapshotted, and with reactions queued
// ahead of direct continuations.
//
// A review of those first six gates found several of them pinned to nothing, so
// the file also gates five orderings ARCHITECTURE.md does not name and the
// resolver's own comments now do: the interleaving of a shipped trigger with a
// seam trigger, the order of two deaths at one checkpoint across sides and along
// one line, the two reaction sources drain pushes, the exact iteration-cap
// boundary, and that an effect naming an entity which has left the board is
// skipped rather than thrown at. Each test names the mutation it was watched
// failing under; the failures themselves are in docs/learning/gate-proofs.md.
//
// Bound of this file - what a green run does and does not prove:
//
//   These are fixtures, not cards. No id below exists in src/content, and this
//   file adds nothing to the pool.
//
//   Four properties are gated with a trigger rule of this file's own, handed
//   to drain() through its `extraTriggers` seam. The narrow reason: for the
//   exact mutations recorded against `triggersFor` - reversing its two loops,
//   or ordering a line by uid - no fixture built from the shipped traits alone
//   can tell correct from broken, because every shipped trigger is keyed to one
//   uid and no event can match two units. Those tests prove the loops order
//   correctly given a rule that fires for more than one unit, which is the day
//   the property starts mattering and the day the mutations stop being
//   harmless.
//
//   That is a statement about `triggersFor`, and it was once written here as
//   though it were a statement about resolution order. It is not. Sibling
//   orderings at other sites ARE reachable from Wake alone, and are gated below
//   with no seam at all: which of two simultaneous deaths is announced first
//   (`checkStateBased`'s own two loops), and whether a death's triggers queue
//   behind the acting effect's continuations (`drain`'s three push loops).
//
//   One test crosses the two: a shipped trigger and a seam trigger answering
//   one event. Without it the seam is coupled to the shipped loop only by where
//   the `extra(...)` call physically sits, and hoisting it into a correct pass
//   of its own leaves every other test here green while the shipped board-order
//   loop can be reversed freely.
//
//   Order is asserted on the events and the effect trace, not only on final
//   state, because for two buffs landing on two different units the order IS
//   the observable: the state is the same either way, and the event stream is
//   what the animation layer replays.
//
//   One test in here reads source rather than behaviour, and says why in its
//   own body: the seam's `null` default is behaviourally indistinguishable
//   from a no-op rule, so what is checked is the declaration and the four
//   production call sites. It proves nothing about a rule handed to drain()
//   from outside src/.

import * as path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

import { makeRng } from '../src/engine/rng.ts';
import {
  type Effect,
  type GameEvent,
  type TriggerRule,
  DEFAULT_MAX_ITERATIONS,
  ResolverLoopError,
  drain,
  resolvePhase,
} from '../src/engine/resolver.ts';
import {
  type Entity,
  type GameState,
  type Side,
  type Trait,
  type UnitCard,
  heroOf,
  insertUnit,
  makeHero,
  makeUnit,
  unitCount,
} from '../src/engine/state.ts';
import { ROOT, parse, rel, tsFilesUnder } from '../tools/gates/scan.ts';

function card(
  id: string,
  power: number,
  health: number,
  armour: number,
  traits: readonly Trait[] = [],
): UnitCard {
  return { id, name: id, cost: 1, power, health, armour, tribe: 'human', traits };
}

type Fixture = {
  state: GameState;
  add: (side: Side, c: UnitCard, index?: number) => Entity;
};

/** Heroes swing for 0 by default here, so they add nothing to what is measured. */
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

const WATCHER = 'test:watcher';
const RIPOSTE = 'test:riposte';
const EAGER = 'test:eager';
const ECHO = 'test:echo';

/** Test-only trait: any death anywhere gives me +1 Power. Matches many units. */
const watchDeaths: TriggerRule = (_state, event, e) =>
  event.kind === 'died' && e.cardId === WATCHER
    ? [{ kind: 'gainPower', uid: e.uid, amount: 1, sourceUid: event.uid }]
    : [];

/** Test-only trait: when I am struck, I strike back out of turn. */
const riposte: TriggerRule = (_state, event, e) =>
  event.kind === 'attacked' && event.targetUid === e.uid && e.cardId === RIPOSTE
    ? [{ kind: 'attack', uid: e.uid }]
    : [];

/**
 * Test-only trait: when anything else acts, I queue an action for the entity
 * named when the rule was built. That is `Echo`'s shape in
 * `docs/design/game.md` - "repeat the base action of the unit that resolved
 * immediately before me" - which is a trigger queueing an action against a unit
 * that can die before the action comes up.
 */
const echoOnto = (uid: number): TriggerRule => (_state, event, e) =>
  event.kind === 'acted' && e.cardId === ECHO && event.uid !== e.uid
    ? [{ kind: 'act', uid }]
    : [];

/** Test-only trait: acting gives me +5 Power - a reaction to my own action. */
const eager: TriggerRule = (_state, event, e) =>
  event.kind === 'acted' && event.uid === e.uid && e.cardId === EAGER
    ? [{ kind: 'gainPower', uid: e.uid, amount: 5, sourceUid: e.uid }]
    : [];

function uidsOf(events: readonly GameEvent[], kind: GameEvent['kind']): number[] {
  return events.filter((e) => e.kind === kind).map((e) => e.uid);
}

test('trigger order is board order: the player line left to right, then the enemy line', () => {
  // Mutation watched going red: iterate the sides and each line in reverse.
  const f = fixture();
  const w1 = f.add('player', card(WATCHER, 0, 5, 0));
  const w2 = f.add('player', card(WATCHER, 0, 5, 0));
  const w3 = f.add('enemy', card(WATCHER, 0, 5, 0));
  const corpse = f.add('enemy', card('test:corpse', 0, 5, 0));
  // A unit at zero Health that has not reached a checkpoint yet: the state that
  // exists between damage landing and checkStateBased running.
  corpse.health = 0;

  const { events } = drain(
    f.state,
    [{ kind: 'afterAct', uid: w1.uid }],
    makeRng(1, 'combat'),
    DEFAULT_MAX_ITERATIONS,
    watchDeaths,
  );

  assert.equal(uidsOf(events, 'died').length, 1, 'the fixture must produce exactly one death');
  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [w1.uid, w2.uid, w3.uid],
    'three units answered one death; they answered in board order',
  );
});

test('trigger order is board index, not uid: a later-made unit standing left goes first', () => {
  // Mutation watched going red: order the line by uid instead of by index.
  const f = fixture();
  const low = f.add('player', card(WATCHER, 0, 5, 0), 0);
  const high = f.add('player', card(WATCHER, 0, 5, 0), 0);
  const corpse = f.add('enemy', card('test:corpse', 0, 5, 0));
  corpse.health = 0;

  assert.ok(high.uid > low.uid, 'the fixture needs uid order to disagree with board order');
  assert.deepEqual(
    f.state.board.player.map((e) => e.uid),
    [high.uid, low.uid, heroOf(f.state, 'player').uid],
    'the later-made unit stands to the left',
  );

  const { events } = drain(
    f.state,
    [{ kind: 'afterAct', uid: low.uid }],
    makeRng(1, 'combat'),
    DEFAULT_MAX_ITERATIONS,
    watchDeaths,
  );

  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [high.uid, low.uid],
    'where a unit stands decides, not when it was made',
  );
});

test('Relay and Wake key on different events, so one unit answers each with one effect', () => {
  // The half of the old tripwire that was true: Relay and Wake do key on
  // different events, and a unit carrying both gets exactly one effect out of
  // each. What this test used to *also* claim - that it would go red the day a
  // second `afterActed` trait was written - was never true of it, and Chorus
  // proved so by landing in that branch with this test green. The claim moved
  // to the AST check below, which reads the branch instead of a fixture's
  // hand-written trait list. `docs/learning/gate-proofs.md` records the
  // failure.
  //
  // Mutation watched going red: Wake's block re-keyed to `afterActed`.
  const f = fixture();
  const both = f.add('player', card('test:relay+wake', 1, 5, 0, ['relay', 'wake']));
  const corpse = f.add('player', card('test:corpse', 0, 5, 0), 0);
  const right = f.add('player', card('test:right', 1, 5, 0));

  const afterAct = drain(f.state, [{ kind: 'afterAct', uid: both.uid }], makeRng(2, 'combat'));
  assert.deepEqual(
    afterAct.trace.map((e) => e.kind),
    ['afterAct', 'gainPower'],
    'afterActed reaches Relay and nothing else',
  );
  assert.equal(right.bonusPower, 2);

  // Now put the left-hand neighbour at zero: the next checkpoint announces it
  // and Wake answers - a separate event, a separate walk of triggersFor.
  corpse.health = 0;
  const death = drain(f.state, [{ kind: 'afterAct', uid: right.uid }], makeRng(3, 'combat'));
  assert.deepEqual(
    death.events.map((e) => e.kind),
    ['afterActed', 'died', 'powerGained'],
    'died reaches Wake and nothing else',
  );
  assert.equal(both.bonusPower, 2, 'Wake, not Relay: the unit to my left died');
});

/**
 * The traits whose blocks answer `afterActed` inside `triggersFor`, in the
 * order those blocks are written. Relay grants to the right-hand neighbour;
 * Chorus grants to each adjacent unit of its own race, left then right.
 *
 * Pinned as an ordered list rather than a set, because the order *is* the rule
 * under test: `triggersFor`'s own header says moving a block moves the rule,
 * and this is the list that says which way round the blocks stand.
 */
const AFTER_ACTED_TRAITS: readonly Trait[] = ['relay', 'chorus'];

test('a body carrying Relay and Chorus fires Relay first, then Chorus left to right', () => {
  // Reachable with shipped content: `si_relay` grants Relay to a card that does
  // not print it, and `u_songkeeper` and `u_elflord` print Chorus, so a run can
  // hand the engine a body carrying both. No test anywhere put two triggering
  // traits on one body until this one, which is why moving the Chorus block
  // above Relay's left the whole suite green.
  //
  // Mutation watched going red: the Chorus block moved above Relay's in
  // `triggersFor`.
  const f = fixture();
  const left = f.add('player', card('test:left', 1, 5, 0));
  const both = f.add('player', card('test:relay+chorus', 1, 5, 0, ['relay', 'chorus']));
  const right = f.add('player', card('test:right', 1, 5, 0));

  const out = drain(f.state, [{ kind: 'afterAct', uid: both.uid }], makeRng(4, 'combat'));

  // Three grants out of one event, and the stream order is the whole
  // observable: the final state is the same whichever way round they come.
  assert.deepEqual(
    out.events.map((e) => (e.kind === 'powerGained' ? `${e.uid}` : e.kind)),
    ['afterActed', `${right.uid}`, `${left.uid}`, `${right.uid}`],
    'Relay first, then Chorus left to right. Relay reaches the right-hand neighbour, so that ' +
      'unit is announced twice and the first of the two announcements is Relay’s.',
  );
  assert.equal(right.bonusPower, 4, 'the right-hand neighbour is in both traits’ reach');
  assert.equal(left.bonusPower, 2, 'the left-hand one is only in Chorus’s');
  assert.equal(both.bonusPower, 0, 'neither trait buffs its own body');
});

test('every trait keying on afterActed is pinned, in the order its block is written', () => {
  // The tripwire the old test claimed to be, built so that it cannot fail the
  // way that one did.
  //
  // The old one was a fixture body carrying `['relay', 'wake']` asserting that
  // `afterActed` produced one effect. A *third* trait keyed to `afterActed`
  // does not appear on that body, so its block never ran and the test stayed
  // green - which is exactly what happened when Chorus was added inside the
  // same branch. A gate built from a hand-written trait list can only see the
  // traits somebody remembered to write into it.
  //
  // So this reads the branch itself. Every `…includes('x')` inside the
  // `afterActed` arm of `triggersFor`, in source order, must be exactly
  // AFTER_ACTED_TRAITS. A new trait there goes red at the moment it is written,
  // and its author has to say where in the order it belongs.
  //
  // Mutations watched going red: the Chorus block moved above Relay's; a third
  // trait added to the branch.
  //
  // Bound: the `afterActed` arm of `triggersFor` in `src/engine/resolver.ts`,
  // and only trait tests written as a call to `.includes('literal')`. A trait
  // read some other way - a `Set`, a lookup table, a variable holding the name
  // - is not seen here, and the behavioural test above is what covers the pair
  // that exists today.
  const sf = parse(path.join(ROOT, 'src', 'engine', 'resolver.ts'));

  let branch: ts.Node | null = null;
  const findBranch = (node: ts.Node, inTriggersFor: boolean): void => {
    const here =
      inTriggersFor ||
      (ts.isFunctionDeclaration(node) && node.name?.getText(sf) === 'triggersFor');
    if (
      here &&
      ts.isIfStatement(node) &&
      /event\.kind === 'afterActed'/.test(node.expression.getText(sf))
    ) {
      assert.equal(branch, null, 'triggersFor has more than one afterActed arm');
      branch = node.thenStatement;
    }
    ts.forEachChild(node, (c) => findBranch(c, here));
  };
  findBranch(sf, false);

  assert.notEqual(
    branch,
    null,
    'found no `event.kind === \'afterActed\'` arm in triggersFor. Either the branch was ' +
      'renamed or this check stopped being able to see it - and it cannot tell those apart, ' +
      'so it fails rather than reporting an empty list as agreement.',
  );

  const found: string[] = [];
  const collect = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'includes' &&
      node.arguments.length === 1 &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, collect);
  };
  collect(branch!);

  assert.deepEqual(
    found,
    [...AFTER_ACTED_TRAITS],
    `the traits keying on afterActed in triggersFor are now [${found.join(', ')}], not ` +
      `[${AFTER_ACTED_TRAITS.join(', ')}].\n\n` +
      'Inside one unit, traits fire in the source order of those blocks, and there is no ' +
      'priority number anywhere - so a trait added here, or two blocks swapped, changes what a ' +
      'body carrying both emits. Update this list once the order is a decision rather than an ' +
      'accident, and gate the new order with a fixture the way the Relay/Chorus test above does.',
  );
});

test('it is a queue, not a stack: the first effect queued is the first applied', () => {
  // Mutation watched going red: queue.shift() -> queue.pop().
  //
  // The buff is what makes the order observable: applied first, the attacker
  // swings at 5 and kills; applied second, it swings at its printed 1 and the
  // target lives. This fixture used to grant a Ward instead, which the owner
  // removed; the claim under test is the queue, not the verb.
  const f = fixture();
  const target = f.add('player', card('test:target', 0, 5, 0, ['guard']));
  const attacker = f.add('enemy', card('test:attacker', 1, 5, 0));

  const queue: Effect[] = [
    { kind: 'gainPower', uid: attacker.uid, amount: 4, sourceUid: attacker.uid },
    { kind: 'attack', uid: attacker.uid },
  ];
  const { events, trace } = drain(f.state, queue, makeRng(3, 'combat'));

  assert.deepEqual(trace.map((e) => e.kind), ['gainPower', 'attack']);
  assert.equal(target.health, 0, 'the buff landed first, so the attack swung at 5');
  assert.equal(events.some((e) => e.kind === 'died' && e.uid === target.uid), true);
});

test('deaths are batched after every effect, not once at the end of the drain', () => {
  // Mutation watched going red: run checkStateBased only when the queue empties.
  const f = fixture();
  const killer = f.add('player', card('test:killer', 5, 5, 0));
  const second = f.add('player', card('test:second', 4, 5, 0));
  // 0 Power, so it retaliates for 0 and the trade cannot muddy which death
  // this test is about. A `retaliated` event still comes out - a blow that
  // bounced is a different thing from no blow at all.
  const guard = f.add('enemy', card('test:guard', 0, 1, 0, ['guard']));
  const enemyHero = heroOf(f.state, 'enemy');

  const queue: Effect[] = [
    { kind: 'attack', uid: killer.uid },
    { kind: 'attack', uid: second.uid },
  ];
  const { events } = drain(f.state, queue, makeRng(4, 'combat'));

  assert.equal(guard.alive, false);
  assert.deepEqual(
    events.map((e) => e.kind),
    ['attacked', 'retaliated', 'died', 'attacked', 'retaliated'],
    'the death landed between the two attacks, not after both of them',
  );
  assert.equal(
    enemyHero.health,
    26,
    'the Guard left the board at the checkpoint, so the second attack reached the hero',
  );
});

test('the acting order is snapshotted: a unit removed mid-phase does not shift the line', () => {
  // Mutation watched going red: walk state.board[side] by live index instead of
  // resolving the uid list captured before the phase.
  const f = fixture(1);
  // The only Guard on its side, so the riposte below has no choice of target.
  const first = f.add('player', card('test:first', 1, 1, 0, ['guard']));
  const middle = f.add('player', card('test:middle', 1, 20, 0));
  const last = f.add('player', card('test:last', 1, 20, 0));
  // The only Guard on its side, so every player attack lands here.
  f.add('enemy', card(RIPOSTE, 5, 40, 0, ['guard']));

  const events = resolvePhase(
    f.state,
    'player',
    makeRng(7, 'combat'),
    DEFAULT_MAX_ITERATIONS,
    riposte,
  );

  assert.equal(first.alive, false, 'the riposte killed the leftmost unit during its own action');
  assert.equal(
    f.state.board.player.length,
    3,
    'exactly one unit left the line mid-phase',
  );
  const acted = uidsOf(events, 'acted');
  assert.deepEqual(
    acted,
    [first.uid, middle.uid, last.uid, heroOf(f.state, 'player').uid],
    'the line acts in the order it stood in when the phase began',
  );
  assert.equal(new Set(acted).size, acted.length, 'and no unit acts twice');
});

test('direct continuations are queued ahead of reactions to the same effect', () => {
  // Mutation watched going red: swap the two queue.push loops in drain.
  const f = fixture();
  const actor = f.add('player', card(EAGER, 1, 5, 0));
  const target = f.add('enemy', card('test:target', 0, 99, 0, ['guard']));

  const { events } = drain(
    f.state,
    [{ kind: 'act', uid: actor.uid }],
    makeRng(5, 'combat'),
    DEFAULT_MAX_ITERATIONS,
    eager,
  );

  const attacked = events.find((e) => e.kind === 'attacked');
  assert.ok(attacked !== undefined && attacked.kind === 'attacked');
  assert.equal(attacked.raw, 1, 'acting spawns the attack; the reaction to having acted queues behind it');
  assert.equal(target.health, 98);
  assert.equal(actor.bonusPower, 5, 'the reaction still lands - later, which is the whole point');
});

test('a shipped trigger and a seam trigger answering one event interleave by board index', () => {
  // Three mutations watched going red, and the first two are seen by no other
  // test in this file:
  //   1. hoist the `extra(...)` call out of triggersFor's walk into a pass of
  //      its own after both loops - correctly ordered, still board order;
  //   2. that hoist, plus the shipped side/entity loops reversed;
  //   3. the shipped side/entity loops reversed on their own.
  // Every other board-order test here is built from the seam alone, so a
  // separate-but-correctly-ordered seam pass keeps them all green while
  // decoupling the seam from the loop they exist to gate.
  const f = fixture();
  // Built right to left, so uid order is the exact reverse of board order and
  // the same fixture also fails if the line is walked by uid.
  const waker = f.add('player', card('test:waker', 0, 5, 0, ['wake']), 0);
  const corpse = f.add('player', card('test:corpse', 0, 5, 0), 0);
  const watcher = f.add('player', card(WATCHER, 0, 5, 0), 0);
  // A unit at zero Health that has not reached a checkpoint yet.
  corpse.health = 0;

  assert.deepEqual(
    f.state.board.player.map((e) => e.uid),
    [watcher.uid, corpse.uid, waker.uid, heroOf(f.state, 'player').uid],
    'the line stands watcher, corpse, waker, hero',
  );
  assert.ok(watcher.uid > waker.uid, 'and uid order disagrees with board order');

  const { events } = drain(
    f.state,
    [{ kind: 'afterAct', uid: waker.uid }],
    makeRng(11, 'combat'),
    DEFAULT_MAX_ITERATIONS,
    watchDeaths,
  );

  assert.deepEqual(uidsOf(events, 'died'), [corpse.uid], 'one death, and two units answer it');
  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [watcher.uid, waker.uid],
    'the seam rule standing at index 0 answers before the shipped Wake at index 2',
  );
});

test('two deaths at one checkpoint are announced player line first, then enemy line', () => {
  // Mutation watched going red: iterate checkStateBased's side loop in reverse.
  //
  // No seam. Wake plus a unit already at zero Health is enough, because the
  // order two simultaneous deaths reach their triggers is decided in
  // checkStateBased and not in triggersFor - so the board-order gates above,
  // which are about triggersFor, say nothing about it. AoE is the first
  // designed effect that puts two units at zero at once.
  const f = fixture();
  const corpseP = f.add('player', card('test:corpse', 0, 5, 0));
  const wakerP = f.add('player', card('test:waker', 0, 5, 0, ['wake']));
  const corpseE = f.add('enemy', card('test:corpse', 0, 5, 0));
  const wakerE = f.add('enemy', card('test:waker', 0, 5, 0, ['wake']));
  corpseP.health = 0;
  corpseE.health = 0;

  const { events } = drain(f.state, [{ kind: 'afterAct', uid: wakerP.uid }], makeRng(12, 'combat'));

  assert.deepEqual(
    uidsOf(events, 'died'),
    [corpseP.uid, corpseE.uid],
    'the player line is checked before the enemy line',
  );
  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [wakerP.uid, wakerE.uid],
    'and the triggers answering those deaths queue in that same order',
  );
});

test('two deaths on one line at one checkpoint are announced left to right', () => {
  // Mutation watched going red: walk checkStateBased's index loop backwards.
  // Also no seam, and the side loop above cannot see this one.
  const f = fixture();
  const corpseL = f.add('player', card('test:corpse-left', 0, 5, 0));
  const wakerL = f.add('player', card('test:waker-left', 0, 5, 0, ['wake']));
  const corpseR = f.add('player', card('test:corpse-right', 0, 5, 0));
  const wakerR = f.add('player', card('test:waker-right', 0, 5, 0, ['wake']));
  corpseL.health = 0;
  corpseR.health = 0;

  assert.deepEqual(
    f.state.board.player.map((e) => e.uid),
    [corpseL.uid, wakerL.uid, corpseR.uid, wakerR.uid, heroOf(f.state, 'player').uid],
    'two corpse-and-waker pairs stand on one line',
  );

  const { events } = drain(f.state, [{ kind: 'afterAct', uid: wakerL.uid }], makeRng(13, 'combat'));

  assert.deepEqual(
    uidsOf(events, 'died'),
    [corpseL.uid, corpseR.uid],
    'the leftmost death is announced first',
  );
  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [wakerL.uid, wakerR.uid],
    'and the triggers answering those deaths queue in that same order',
  );
});

test("a death's triggers queue behind the acting unit's own continuations", () => {
  // Mutation watched going red: move drain's `deaths` trigger loop above the
  // `spawned` loop.
  //
  // The recorded mutation for "continuations before reactions" swaps `spawned`
  // with the *produced* trigger loop, and the test above gates that. There are
  // two reaction sources; the deaths loop was gated by nothing. This reaches it
  // from shipped traits alone: an acting unit with Wake whose left neighbour is
  // a corpse makes one `act` both spawn a continuation and produce a death.
  const f = fixture();
  const corpse = f.add('player', card('test:corpse', 0, 5, 0));
  const actor = f.add('player', card('test:actor', 3, 5, 0, ['wake']));
  const target = f.add('enemy', card('test:target', 0, 99, 0, ['guard']));
  corpse.health = 0;

  const { events, trace } = drain(
    f.state,
    [{ kind: 'act', uid: actor.uid }],
    makeRng(14, 'combat'),
  );

  assert.deepEqual(trace.map((e) => e.kind), ['act', 'attack', 'afterAct', 'gainPower']);
  const attacked = events.find((e) => e.kind === 'attacked');
  assert.ok(attacked !== undefined && attacked.kind === 'attacked');
  assert.equal(attacked.raw, 3, 'it swings at its printed Power; the wake pays out behind the swing');
  assert.equal(target.health, 96);
  assert.equal(actor.bonusPower, 2, 'the wake still lands - later, which is the whole point');
});

test("reactions queue in the order their events were emitted: an effect's own, then the checkpoint's deaths", () => {
  // Mutation watched going red: swap drain's `produced` and `deaths` trigger
  // loops. Both are reactions, so "continuations before reactions" does not
  // separate them. What does is the event stream: `produced` events are pushed
  // to it before `deaths` are, and the animation layer replays that stream, so
  // the triggers follow it.
  const f = fixture();
  const corpse = f.add('player', card('test:corpse', 0, 5, 0));
  const waker = f.add('player', card('test:waker', 0, 5, 0, ['wake']));
  const relay = f.add('player', card('test:relay', 0, 5, 0, ['relay']));
  const beneficiary = f.add('player', card('test:beneficiary', 0, 5, 0));
  corpse.health = 0;

  const { events } = drain(f.state, [{ kind: 'afterAct', uid: relay.uid }], makeRng(15, 'combat'));

  assert.deepEqual(
    events.map((e) => e.kind),
    ['afterActed', 'died', 'powerGained', 'powerGained'],
    'the effect announces itself, then the checkpoint announces the death',
  );
  assert.deepEqual(
    uidsOf(events, 'powerGained'),
    [beneficiary.uid, waker.uid],
    'Relay answers the afterActed it was emitted with, before Wake answers the death',
  );
});

test('an effect naming an entity that has left the board is skipped, and a hero answers the same way', () => {
  // Mutation watched going red: `findEntity` back to `requireEntity` in apply's
  // five cases - i.e. the throw restored. Only the unit half goes red; that
  // asymmetry is the defect.
  //
  // Both halves are one sequence: a trigger queues an action against an entity,
  // and the entity dies before that action comes up. A dead hero stays on the
  // board and every case's `!e.alive` guard caught it. A dead unit is removed
  // by checkStateBased, so `requireEntity` found nothing and threw - the same
  // situation answered two ways, decided by a filter that exists to keep the
  // hero anchoring the right end of the line.
  const run = (victimIsHero: boolean): { events: GameEvent[]; victimUid: number } => {
    const f = fixture();
    f.add('player', card('test:attacker', 5, 5, 0));
    f.add('player', card(ECHO, 0, 5, 0));
    const victim = victimIsHero
      ? heroOf(f.state, 'enemy')
      : f.add('enemy', card('test:victim', 0, 1, 0, ['guard']));
    victim.health = 1;
    const events = resolvePhase(
      f.state,
      'player',
      makeRng(16, 'combat'),
      DEFAULT_MAX_ITERATIONS,
      echoOnto(victim.uid),
    );
    return { events, victimUid: victim.uid };
  };

  for (const [label, r] of [['unit', run(false)], ['hero', run(true)]] as const) {
    assert.equal(
      uidsOf(r.events, 'died').includes(r.victimUid),
      true,
      `${label}: the victim died while an action against it was already queued`,
    );
    assert.equal(
      uidsOf(r.events, 'acted').includes(r.victimUid),
      false,
      `${label}: and that queued action was dropped, not applied`,
    );
  }
});

test('the iteration cap is the exact number of effects that may be applied', () => {
  // Mutation watched going red: `iterations >= maxIterations` -> `>`, which
  // moves the boundary by one and is invisible to every other test.
  // `act` spawns `attack` and `afterAct`: three effects, exactly.
  const atCap = fixture();
  const a = atCap.add('player', card('test:actor', 1, 5, 0));
  atCap.add('enemy', card('test:wall', 0, 99, 0, ['guard']));

  const full = drain(atCap.state, [{ kind: 'act', uid: a.uid }], makeRng(17, 'combat'), 3);
  assert.equal(full.iterations, 3, 'a drain needing exactly maxIterations effects finishes');
  assert.deepEqual(full.trace.map((e) => e.kind), ['act', 'attack', 'afterAct']);

  const overCap = fixture();
  const b = overCap.add('player', card('test:actor', 1, 5, 0));
  overCap.add('enemy', card('test:wall', 0, 99, 0, ['guard']));

  assert.throws(
    () => drain(overCap.state, [{ kind: 'act', uid: b.uid }], makeRng(17, 'combat'), 2),
    (err: unknown) => {
      assert.ok(err instanceof ResolverLoopError);
      assert.match(err.message, /exceeded 2 iterations/);
      assert.deepEqual(
        err.trace.map((e) => e.kind),
        ['act', 'attack'],
        'exactly maxIterations effects were applied before it threw',
      );
      return true;
    },
    'a drain needing maxIterations + 1 effects throws',
  );
});

test('the test seam is off in production: its default is null, and nothing in src/ passes one', () => {
  // Two mutations watched going red: change either default from `null` to a
  // no-op TriggerRule, and, separately, hand a rule to one of the four
  // resolvePhase calls in src/engine/fight.ts.
  //
  // Bound, and it is the reason this test reads source rather than behaviour: a
  // no-op default is behaviourally identical to `null`. triggersFor asks it,
  // it returns nothing, and no fixture can tell the two apart. What is worth
  // defending is not the token but what the token buys - that the seam is off
  // unless a caller asks for it, and that no caller in src/ asks. This proves
  // the declaration and the call sites; it proves nothing about a rule handed
  // in at runtime from outside src/.
  const sf = parse(path.join(ROOT, 'src', 'engine', 'resolver.ts'));
  const defaults: [string, string][] = [];
  const readDefaults = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      for (const param of node.parameters) {
        if (ts.isIdentifier(param.name) && param.name.text === 'extraTriggers') {
          defaults.push([
            node.name.text,
            param.initializer === undefined ? '<no default>' : param.initializer.getText(sf),
          ]);
        }
      }
    }
    ts.forEachChild(node, readDefaults);
  };
  readDefaults(sf);

  assert.deepEqual(
    defaults.sort((x, y) => x[0].localeCompare(y[0])),
    [
      ['drain', 'null'],
      ['resolvePhase', 'null'],
    ],
    'both entry points default the seam to null, so an omitted argument is no rule at all',
  );

  const sources = tsFilesUnder('src').filter((file) => rel(file) !== 'src/engine/resolver.ts');
  assert.ok(sources.length > 0, 'the scan found files under src/ to read');
  const offenders: string[] = [];
  let callsSeen = 0;
  for (const file of sources) {
    const src = parse(file);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'drain' || node.expression.text === 'resolvePhase')
      ) {
        callsSeen++;
        if (node.arguments.length > 4) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
          offenders.push(`${rel(file)}:${line + 1}  ${node.expression.text} is handed a trigger rule`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  // A scan that matched nothing would report "no offenders" and mean "did not
  // run"; src/engine/fight.ts holds four production calls.
  assert.ok(callsSeen >= 4, `the scan reached ${callsSeen} production call(s), expected at least 4`);
  assert.deepEqual(offenders, [], 'production passes the seam nothing');
});
