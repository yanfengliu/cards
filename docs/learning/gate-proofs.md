# Gate proofs

A gate counts only once it has been made to go red by reintroducing the defect it claims to catch. This file records the mutation, the exact failure it produced, and the bound the gate carries in its own header. Newest first.

Auditing a gate means reaching what was measured at the time, never the sentence the gate carries about itself — a gate and its claim can be wrong together and look exactly like a gate that is right.

## 2026-09-06 — the resolver's ordering contract (`test/resolver-order.test.ts`)

Claim: the ordering properties `ARCHITECTURE.md` promises — trigger order is board order, board order means board *index*, it is a queue and not a stack, deaths are batched after every effect, the acting order is snapshotted, and direct continuations are queued ahead of reactions — each fail when they are broken. Bound stated in the test file's header.

These six were the reason for the work. An independent review at `26e55a8` found the engine correct and the suite weak: of 28 mutations that reintroduce a defect the code or docs claim to prevent, **10 left 34/34 green**, and six of those ten were resolution order. They were not untested by oversight — they were **unobservable**. With the shipped pool every trigger is keyed to one uid (`event.uid === e.uid`, or `event.rightUid === e.uid`), so no event can match two units and the board-order loop decides nothing; and no shipped effect both spawns a continuation and produces an event anything triggers on, so the order of those two queue pushes decides nothing either. No fixture built from Relay, Guard, Wake and Ward can tell the correct resolver from any of these broken ones.

Three of the six therefore needed a trigger rule that fires for more than one unit, and the game has none. `drain` and `resolvePhase` gained an optional `extraTriggers` parameter for exactly that: it defaults to `null`, every production caller passes nothing, and `triggersFor`'s doc comment carries the argument for why it exists. **This is the one engine-source change in this round that is not behaviour**, and it is here because a gate nobody can make go red is not a gate.

Each mutation below was applied to the stated file, `npm test` run against the whole suite, and the tree restored. The suite is 44 tests after this round. Where a mutation fails *only* tests added in this round, that is the review's finding reproduced: the 34 that existed before it do not see the defect.

Line numbers are as they stood at `26e55a8`, which is how the review named them.

| mutation | site | tests failed | which |
|---|---|---|---|
| sides and lines iterated in reverse | `resolver.ts:181-182` | 2 of 44 | both new trigger-order tests |
| line ordered by `uid` instead of index | `resolver.ts:182` | 1 of 44 | the index-not-uid test |
| Ward's block moved above Relay's | `resolver.ts:186-199` | 1 of 44 | the within-unit tie-break test |
| `queue.shift()` → `queue.pop()` | `resolver.ts:254` | 7 of 44 | six new tests and the rewritten act guard |
| `checkStateBased` deferred to the end of the drain | `resolver.ts:258` | 2 of 44 | the batching test and the act guard |
| acting order read live by index | `resolver.ts:285-289` | 1 of 44 | the snapshot test |
| the two `queue.push` loops swapped | `resolver.ts:264-265` | 1 of 44 | the continuations-before-reactions test |

The failures themselves.

**Sides and lines reversed** (`['enemy', 'player']`, and `[...state.board[side]].reverse()`). Three units answer one death; correct order is the player line left to right, then the enemy line.

```
✖ trigger order is board order: the player line left to right, then the enemy line
  AssertionError [ERR_ASSERTION]: three units answered one death; they answered in board order
    actual: [ 5, 4, 3 ], expected: [ 3, 4, 5 ]
✖ trigger order is board index, not uid: a later-made unit standing left goes first
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

**Ordered by uid** (`[...state.board[side]].sort((a, b) => a.uid - b.uid)`). The fixture makes the later-created unit stand to the left, so uid order and board order disagree; the test asserts that premise before it asserts the result, or it would degenerate into agreeing with itself.

```
✖ trigger order is board index, not uid: a later-made unit standing left goes first
  AssertionError [ERR_ASSERTION]: where a unit stands decides, not when it was made
    actual: [ 3, 4 ], expected: [ 4, 3 ]
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

**Ward's block above Relay's.** The tie-break inside one unit is the source order of the `if` blocks in `triggersFor` and it was documented nowhere; it is now in that function's comment, and this is the test that holds it.

```
✖ inside one unit, traits fire in the source order of the blocks: Relay before Ward
  AssertionError [ERR_ASSERTION]:
    actual:   [ 'afterAct', 'grantWard', 'gainPower' ]
    expected: [ 'afterAct', 'gainPower', 'grantWard' ]
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

**`queue.pop()`.** Seven tests. The state-level one: a queue of `[grantWard on the only Guard, attack]` leaves the attacker with no legal target and it fizzles; a stack strikes first and wards afterwards.

```
✖ it is a queue, not a stack: the first effect queued is the first applied
  AssertionError [ERR_ASSERTION]: actual: [ 'attack', 'grantWard' ], expected: [ 'grantWard', 'attack' ]
ℹ tests 44   ℹ pass 37   ℹ fail 7
```

**Deaths deferred** (`const deaths = queue.length === 0 ? checkStateBased(state) : []`). Written deliberately so the triggers still fire — the naive version that drops them is caught by the existing Wake test, and this one is not. Two attacks are queued; the first kills the defending side's only Guard.

```
✖ deaths are batched after every effect, not once at the end of the drain
  AssertionError [ERR_ASSERTION]: the death landed between the two attacks, not after both of them
    actual:   [ 'attacked', 'attacked', 'died' ]
    expected: [ 'attacked', 'died', 'attacked' ]
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

The test's next assertion is the state, not the events: with the checkpoint in place the Guard has left the board and the second attack reaches the enemy hero for 4; with deaths deferred the hero is untouched and the corpse absorbs a second hit.

**Acting order read live.** A unit is killed mid-phase by a riposte, the array is rebuilt, and a live index walk steps over the unit that shifted into the slot it just left.

```
✖ the acting order is snapshotted: a unit removed mid-phase does not shift the line
  AssertionError [ERR_ASSERTION]: the line acts in the order it stood in when the phase began
    actual: [ 3, 5, 1 ], expected: [ 3, 4, 5, 1 ]
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

Bound worth stating, because it is the difference between a gate and a coincidence: this fails for the **index** formulation of the mutation. The `for (const e of state.board[side])` formulation is *equivalent* to the snapshot today and no test can separate them, because `checkStateBased` rebinds `state.board[side]` to a new array rather than splicing the old one, so a running `for...of` keeps iterating the array the phase began with.

**The two `queue.push` loops swapped.** The acting unit's own reaction to having acted grants it +5 Power. Queued behind its attack, the attack lands at its printed 1; queued ahead of it, at 6.

```
✖ direct continuations are queued ahead of reactions to the same effect
  AssertionError [ERR_ASSERTION]: acting spawns the attack; the reaction to having acted queues behind it
    6 !== 1
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

## 2026-09-06 — two tests that were passing for the wrong reason (`test/rules.test.ts`)

Claim: Guard's random target selection really goes through `pick`, and the `!e.alive` guard in `apply`'s `act` case really stops a dead entity acting.

**"Guard forces attacks onto Guards, randomly among them"** created a generator, discarded it (`void rng`), and then indexed the target list with `t[Math.floor((i * 7919) % t.length)]`. 7919 is odd and the list has two entries, so `seen.size === 2` was the test's own arithmetic alternating; `pick` and `resolvePhase` were never called. It now resolves 200 real attacks on one combat stream and reads the targets out of the events.

Mutation, `src/engine/rng.ts` — `pick` consumes its draw and returns the first element:

```ts
  nextInt(r, xs.length);
  return xs[0]!;
```

```
✖ Guard forces attacks onto Guards, randomly among them
  AssertionError [ERR_ASSERTION]: both Guards were struck and nothing else ever was
    actual: [ 3 ], expected: [ 3, 4 ]
✖ the worked example under-specifies its own targeting
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

`the worked example under-specifies its own targeting` is a pre-existing test and it does catch this one — the review's finding was about the Guard test specifically, and it holds: before the rewrite that test passed with `pick` stubbed out.

**"no unit acts after dying"** removed the unit from the board before calling `resolvePhase`, so the snapshot never contained it and the phase loop skipped it. The guard at `resolver.ts:84` could be deleted outright with the suite green. Reaching it needs an entity that is on the board and alive when its action is queued and dead when that action comes up: a hero at zero Health, which the checkpoint kills mid-drain and which stays on the board because heroes do.

Mutation, `src/engine/resolver.ts` — the `if (!e.alive) return { events: [], spawned: [] };` line deleted from `case 'act'`:

```
✖ no unit acts after dying, even with its action already queued
  AssertionError [ERR_ASSERTION]: an entity that died before its queued action came up does not act
    true !== false
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

## 2026-09-06 — a cloned fight shares nothing mutable (`test/fight.test.ts`)

Claim: `cloneFight` returns a fight that can be written to without reaching the live one. Bound: the test writes to the deck, the hand, an entity and the generator; it does not enumerate future fields, so a new mutable field added to `Fight` and not copied would pass it.

`cloneFight` passed both decks by reference, so `clone.player.deck === live.player.deck`. Harmless only because nothing writes to a deck after setup — the first mill, shuffle-in or tutor effect makes every lookahead rollout a write into the fight it is searching from.

Mutation, `src/engine/fight.ts` — the two `.slice()` calls removed:

```
✖ a cloned fight shares no mutable state with the live one
  AssertionError [ERR_ASSERTION]: the player deck is a copy
    actual:   [ 'test:grunt', 'test:wall', 'test:grunt' ]
    expected: [ 'test:grunt', 'test:wall', 'test:grunt' ]
    operator: 'notStrictEqual'
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

Two arrays that print identically and fail `notStrictEqual` is the defect stated as plainly as it can be: same object, two names.

## 2026-09-06 — Wake's inertness, gated in both directions (`test/rules.test.ts`)

Claim: Wake fires, and the +2 it grants is always cleared before the woken unit can swing. This **documents a defect and does not endorse it** — the rule is the owner's decision. `startTurn` clears `bonusPower` at the start of a side's own phase and a side's units only die during the opponent's phase, so the buff is wiped before it can be spent, and `docs/work/1_turn-prototype/plan.md` measured the trait changing zero rows in 20,000 fights.

The test that existed asserted `waker.bonusPower === 2` and stopped, which is green on a dead trait. The new one carries the whole sequence to the swing, so both a regression and a fix are visible.

Mutation A, the regression — Wake's block deleted from `triggersFor`:

```
✖ Wake fires when the unit to my left dies
  AssertionError [ERR_ASSERTION]: the unit to the right of the dead one woke
    0 !== 2
✖ KNOWN DEFECT: Wake is inert - the +2 is always cleared before it can swing
  AssertionError [ERR_ASSERTION]: Wake fired: the unit to the right of the dead one woke
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

Mutation B, one plausible fix — `startTurn` no longer clears `bonusPower`, so the buff survives to the swing:

```
✖ buffs expire at the start of the owner’s next turn
  AssertionError [ERR_ASSERTION]: 2 !== 0
✖ KNOWN DEFECT: Wake is inert - the +2 is always cleared before it can swing
  AssertionError [ERR_ASSERTION]: and the buff is gone before the unit can spend it
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

A fix now has to come past a red test that names the decision, instead of being absorbed by a green suite.

## 2026-09-06 — `npm run gate:boundaries` covers `src/content/`, and proves every prefix

Claim: nothing under `src/engine/` imports from `src/content/`, `src/render/`, `src/ui/` or `tools/`. Extends the entry below, which had the same claim without `src/content/`. Bound stated in `tools/gates/boundaries.ts`.

`ARCHITECTURE.md` draws content → engine. The code had `src/engine/fight.ts` importing `src/content/cards.ts` while `src/content/cards.ts` imported `src/engine/state.ts`, so the one-way arrow was a cycle, and the gate that exists to enforce that arrow did not name the direction that was actually broken. A fight is now handed a `CardPool` — the card lookup, the energy per round and the hand size — and the engine imports nothing.

Mutation, appended to `src/engine/fight.ts`:

```ts
import { cardById } from '../content/cards.ts';
export const mutationLookup = cardById;
```

Red:

```
Import boundary gate FAILED: 1 violation(s) of the rule that src/engine/ imports nothing from src/content/, src/render/, src/ui/, tools/ and touches no DOM global.

  src/engine/fight.ts:316:26  imports "../content/cards.ts", which is src/content/cards.ts under src/content/
```

Exit status 1 under the mutation, 0 after the revert.

The probe the gate runs against itself on every invocation was also widened: it now carries one import per forbidden prefix and the gate exits 2 unless the detector fires for **each** of them, not just once in total. A single-import probe would have kept reporting "detector fired" while a newly added prefix matched nothing.

## 2026-09-06 — `npm run gate:boundaries`

Claim: nothing under `src/engine/` imports from `src/render/`, `src/ui/` or `tools/`, and nothing there references a global that only `lib.dom` declares. Bound stated in `tools/gates/boundaries.ts`.

Mutation 1, appended to `src/engine/state.ts`:

```ts
import '../render/heraldry/card.ts';
export const gateProof: string = document.title;
```

Red:

```
Import boundary gate FAILED: 2 violation(s) of the rule that src/engine/ imports nothing from src/render/, src/ui/, tools/ and touches no DOM global.

  src/engine/state.ts:190:8   imports "../render/heraldry/card.ts", which is src/render/heraldry/card.ts under src/render/
  src/engine/state.ts:191:34  references the DOM global `document`
```

Mutation 2, the other two forbidden prefixes, one of them through a dynamic import and one of them naming a directory that does not exist yet:

```ts
import '../../tools/heraldry-probe/pages.ts';
const lazy = () => import('../ui/input.ts');
export const proof = lazy;
```

Red:

```
  src/engine/state.ts:189:8   imports "../../tools/heraldry-probe/pages.ts", which is tools/heraldry-probe/pages.ts under tools/
  src/engine/state.ts:190:27  imports "../ui/input.ts", which is src/ui/input.ts under src/ui/
```

Both mutations reverted; the gate returned to green on the unmodified tree. Exit status was 1 in both red runs and 0 after the revert.

The gate also runs its own probe on every invocation — a virtual `src/engine/__gate_probe__.ts` that breaks both halves — and exits 2 if the detector does not fire on it, or if `lib.dom` was not loaded. Without that, the DOM half would pass vacuously the day the lib configuration changes, and a green run would mean nothing.

## 2026-09-06 — `npm run gate:banned-apis`

Claim: `Math.random`, `Date.now` and `performance.now` appear nowhere outside `src/engine/rng.ts`. Bound stated in `tools/gates/banned-apis.ts`.

Mutation, appended to `src/engine/resolver.ts` and `src/sim/bots.ts`:

```ts
export const coin = () => Math.random() < 0.5;
export const stamp = () => Date.now();
export const tick = () => performance.now();
```

Red:

```
Banned API gate FAILED: 3 use(s) of Math.random, Date.now or performance.now outside src/engine/rng.ts.

  src/engine/resolver.ts:314:27  Math.random
  src/engine/resolver.ts:315:28  Date.now
  src/sim/bots.ts:182:27         performance.now
```

Reverted; green again at exit 0.

The reason this gate parses rather than greps is recorded here because it is the kind of thing that gets simplified back later. On the clean tree, `grep -rn "Math\.random\|Date\.now\|performance\.now" src test tools --include=*.ts` returns **16 hits and zero real calls** — comments in `src/engine/rng.ts` and `src/sim/measure.ts` name all three in order to say they are never called, and the gate's own source names them again. A check built from the same symbol as the thing it checks proves only that the text agrees with itself. The AST sees no comments and no string literals, which is exactly the property wanted here.

The detector is also asked to find a known set of six violations in a self-test snippet before it is trusted to report an absence, and exits 2 if it finds a different number. The snippet includes one banned name in a comment and one in a string, both of which must not count.

### Known overlap

`test/determinism.test.ts` already carries a line-regex version of the banned-API check, scanning `src/engine`, `src/content` and `src/sim` non-recursively. It is weaker on three axes — it does not see `test/`, `tools/` or `src/render/`, it does not descend into subdirectories, and it decides "this line is a comment" by looking at the first two characters — but it passes, and it was left alone rather than churned while the prototype was under independent review.
