# Gate proofs

A gate counts only once it has been made to go red by reintroducing the defect it claims to catch. This file records the mutation, the exact failure it produced, and the bound the gate carries in its own header. Newest first.

Auditing a gate means reaching what was measured at the time, never the sentence the gate carries about itself — a gate and its claim can be wrong together and look exactly like a gate that is right.

Every entry names the revision its numbers were taken at, and a suite total inside a quoted transcript is that revision's, not today's. This is not pedantry: entries written on parallel branches were merged, and the branch that gated the resolver's ordering recorded "of 44" while the branch that added `src/sim/bots.test.ts` recorded "37/37". Their merge `49f017b` is 47, and this round makes it 55. A numerator reproduces; a denominator is a fact about a tree.

## 2026-09-07 — spells and equipment, and the AoE that makes simultaneous-death order visible (`test/spells.test.ts`, `test/equipment.test.ts`, `test/casting.test.ts`)

Taken at `06c87c7` with this round's changes applied; the suite is **86 tests** here, 55 before it.

`docs/design/game.md` has three card types and only units existed. This round adds the other two and the four effect verbs they need — `damageOne`, `damageAll`, `buffAll`, `equip` — plus the end-of-fight equipment reset. Twenty-two mutations were applied one at a time, `node --test` run over the whole suite, and the tree restored after each. Every one goes red, and the table records which tests see it.

| mutation | site | failed, of 86 | which |
|---|---|---|---|
| `checkStateBased` index loop reversed | `resolver.ts:checkStateBased` | 2 | the AoE board-order test and the existing fixture one |
| `damageAll` marks the dead inside its own loop | `resolver.ts:apply` | 3 | one-effect-one-checkpoint, AoE board order, enemy casting |
| `damageAll` no longer skips heroes | `resolver.ts:apply` | 6 | five AoE tests and enemy casting |
| `damageAll` filtered through `legalTargets` | `resolver.ts:apply` | 1 | AoE consults no target-selection rule |
| `damageAll` drops the armour term | `resolver.ts:apply` | 1 | AoE armour, per target |
| `damageOne` picks from every living defender | `resolver.ts:apply` | 2 | bolt targeting, bolt fizzle |
| `damageOne` drops the armour term | `resolver.ts:apply` | 1 | bolt damage |
| `buffAll` skips heroes | `resolver.ts:apply` | 4 | the buff tests and both spell-order tests |
| `equip` refuses to overwrite a filled slot | `resolver.ts:apply` | 1 | slot replacement |
| `equip` ignores the item's own slot | `resolver.ts:apply` | 2 | slot independence, end-of-fight reset |
| `equip` drops the no-slots guard | `resolver.ts:apply` | 1 | equipping a unit |
| `attack` reads `target.armour` again instead of `armourOf` | `resolver.ts:apply` | 1 | worn Armour |
| `power()` drops `equipPower` | `state.ts:power` | 6 | every equipment test that reads a number |
| `cloneEntity` shares the slots object | `state.ts:cloneEntity` | 1 | the clone test |
| `spellQueue` builds its effects in reverse | `cast.ts:spellQueue` | 2 | spell order, verb binding |
| `spellQueue` drops the `buffAll` case | `cast.ts:spellQueue` | 5 | every buff test and verb binding |
| `runRound` no longer checks the energy budget | `fight.ts:runRound` | 2 | conservation, and the third arm of the message test |
| casts applied before placements | `fight.ts:runRound` | 1 | placements-before-casts |
| `settleResult` no longer calls `endFight` | `fight.ts:settleResult` | 1 | a fight that ends armed |
| `replayFight` drops the `casts` argument | `fight.ts:replayFight` | 1 | replay over the mixed deck |
| `splitPlays` inverts its branch | `fight.ts:splitPlays` | 17 | its own test plus every fight-level test in the suite |
| the equipment segment appended unconditionally | `hash.ts:entityToCanonical` | 1 | the canonical-form test |

### The one the round exists for: AoE makes simultaneous-death order player-visible

Before this, nothing in the game put two units at zero Health in a single effect. The order two simultaneous deaths are announced in was gated — in the entry below — but only through a fixture with a unit parked at zero Health, which is the *state* AoE produces and is not AoE. One Firestorm now reaches it, and what a player watches is two units waking in the order they stand.

The fixture is two corpse-and-waker pairs on one enemy line, built right to left so uid order is the exact reverse of board order, killed by one `damageAll 4`. Mutation: `checkStateBased`'s index loop walked backwards.

```
✖ two Wake units answering one AoE gain Power in board order
  AssertionError [ERR_ASSERTION]: one AoE, two deaths, announced left to right
    actual: [ 4, 6 ], expected: [ 6, 4 ]
✖ two deaths on one line at one checkpoint are announced left to right
ℹ tests 86   ℹ pass 84   ℹ fail 2
```

The test asserts the `died` order and then the `powerGained` order, because the second is the part a player sees: the same two deaths and the same final Power, in a different order down the event stream the animation layer replays.

### An AoE is one effect, and that is what puts both deaths at one checkpoint

`ARCHITECTURE.md`: "Health is checked at defined checkpoints, not the instant damage lands." AoE is the first shipped effect where that is observable. The mutation is the one an implementation that had not read the contract would write — mark the dead inside `damageAll`'s own loop:

```ts
        t.health -= dealt;
        events.push({ kind: 'damaged', ... });
        if (t.health <= 0) { t.alive = false; events.push({ kind: 'died', ... }); }   // added
```

```
✖ an AoE is one effect: every target is damaged before any death is announced
  AssertionError [ERR_ASSERTION]: all four hits land, then the checkpoint announces both deaths, then the wakes answer
    actual:   [ 'damaged', 'died', 'damaged', 'damaged', 'died', 'damaged' ]
    expected: [ 'damaged', 'damaged', 'damaged', 'damaged', 'died', 'died', 'powerGained', 'powerGained' ]
✖ two Wake units answering one AoE gain Power in board order
✖ the enemy spends on spells too, not only on bodies
ℹ tests 86   ℹ pass 83   ℹ fail 3
```

Two things in that diff rather than one: the deaths interleave with the damage, **and** both Wake triggers vanish entirely, because a death announced by hand never reaches `triggersFor`. Splitting one AoE into one effect per target is the same defect wearing different clothes and the same test catches it.

### The verbs, one mutation each

`damageAll` consults no target-selection rule — `legalTargets` is where Guard and Ward live, and it answers "which single entity does this strike". Filtering the AoE through it:

```
✖ an AoE consults no target-selection rule: Guard and Ward do not narrow it
  AssertionError [ERR_ASSERTION]: and so is the unit the Guard would otherwise have covered
    actual: 9, expected: 7
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

Armour still applies, per target, so the design's "concentrate against armour, spread against a swarm" inversion survives contact with spells. Dropping the armour term from `damageAll`:

```
✖ an AoE subtracts each target’s own Armour, so it is blunted unit by unit
  AssertionError [ERR_ASSERTION]: flat per target, to a minimum of zero
    actual: [ 3, 3, 3 ], expected: [ 3, 1, 0 ]
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

`damageOne` picks the way an attack does. Pointing it at every living defender instead of at `legalTargets` breaks both the Guard half and the fizzle half:

```
✖ single-target spell damage picks the way an attack does: Guard narrows the pool
  AssertionError [ERR_ASSERTION]: the only Guard is the only legal target
    actual: [ 4, 3, 2 ], expected: [ 3 ]
✖ a single-target spell with no legal target fizzles rather than throwing
ℹ tests 86   ℹ pass 84   ℹ fail 2
```

`buffAll` reaches the hero, which `damageAll` deliberately does not. Skipping heroes there:

```
✖ a board-wide buff reaches every living unit on the caster’s line and the hero
  AssertionError [ERR_ASSERTION]: left to right along the caster’s own line, hero last because the hero stands last
    actual: [ 3, 4 ], expected: [ 3, 4, 1 ]
ℹ tests 86   ℹ pass 82   ℹ fail 4
```

`spellQueue` is the one place a card's data becomes an effect, so both ways it can be wrong are gated: order, and a dropped verb. Reversing the array, and separately deleting the `buffAll` case:

```
✖ a spell’s effects resolve in the order they are written
    actual: [ 'buffAll', 'damageAll' ], expected: [ 'damageAll', 'buffAll' ]
✖ every verb a spell can name is bound to an effect, and the shipped spells only name those
    actual: [ 'damageOne', 'damageAll', 'gainPower' ]
    expected: [ 'damageOne', 'damageAll', 'buffAll', 'gainPower' ]
```

The second is the `AGENTS.md` invariant — card behaviour is data plus a named effect — as an assertion: one effect out per spec in, over the cards actually shipped. A card naming a verb the binder silently drops is the failure it catches.

### Equipment: the worked example's own third card, and the reset

`docs/design/game.md`'s worked example gives the Knight an Iron Sword (weapon, hero +3 Power) against a Stone Troll with Armour 2, and says 5 Power − 2 armour = 3 damage. Until this round that line could only be run by giving the Knight base Power 5, which is what `test/worked-example.test.ts` says in its own header. It now runs with the shipped card at its printed numbers. Mutation: `equipPower(e)` dropped from `power()`.

```
✖ the worked example’s Iron Sword: the Knight swings at 2 base + 3 sword, for 3 through Armour 2
  AssertionError [ERR_ASSERTION]: 2 base + 3 sword
    actual: 2, expected: 5
ℹ tests 86   ℹ pass 80   ℹ fail 6
```

Equipment is a summand in `power()` and `armourOf()` rather than a write to `basePower`, so taking a piece off is exact by construction and `basePower` keeps meaning "printed". A unit has no slots at all rather than three empty ones, and dropping that guard is a crash rather than a wrong number:

```
✖ a unit has no slots at all, so equipping one is skipped rather than thrown at
  TypeError: Cannot read properties of null (reading 'weapon')
      at apply (src/engine/resolver.ts:297:35)
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

"Equipment resets at the end of every fight" is reached through `runRound`, the one round code path, rather than by calling `endFight` directly — so the test pins that the reset is wired in at all. Mutation: the `endFight` call deleted from `settleResult`.

```
✖ a fight that ends with the hero armed leaves it unarmed
  AssertionError [ERR_ASSERTION]: the fight is over, so the sword is off
    actual: { weapon: { id: 'test:sword', ... }, armour: null, trinket: null }
    expected: { weapon: null, armour: null, trinket: null }
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

### The additive claim, and the gate that holds it

Everything above is an addition, and the claim that it is one rests on a single property: **an entity wearing nothing serialises exactly as it did before equipment existed**. `entityToCanonical` appends its equipment segment only when something is worn, and an empty set of slots is the same string as no slots at all. Mutation: append it unconditionally.

```
✖ an entity wearing nothing serialises exactly as it did before equipment existed
  AssertionError [ERR_ASSERTION]: nothing is worn, so nothing about equipment is in the canonical form
    actual: true, expected: false
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

**Behaviour held still, and this is the evidence for it.** `npm run verify` before and after the whole round is **identical line for line apart from its wall-clock line** — same 400-seed arms, same 2,454 compared rounds, same 2,167/4,238 differing placements, same 40 distinct final hashes, same 15.25 pp gap (CI 10.06..20.44), same four-encounter sweep, same negative control, same greedy-vs-exhaustive row. The shipped spells and equipment are deliberately absent from `PLAYER_DECK`, so no fight the measurement runs draws one, and the canonical form of a fight that draws none is byte-identical to what it was.

### Conservation, and the record format

`ARCHITECTURE.md` lists conservation — energy spent never exceeds energy available — among the invariants that should hold over every game, and it had no check. `selectPlays` caps the spend so a bot never breaks it; a hand-built round is where it can be broken, and a UI is a hand-built round. Mutation: the `checkEnergy` call deleted.

```
✖ units, spells and equipment all draw from the same three energy
  AssertionError [ERR_ASSERTION]: Missing expected exception.
    expected: /spends 4 energy on 1 unit\(s\) and 2 cast\(s\), but a side has 3 per turn\./
ℹ tests 86   ℹ pass 84   ℹ fail 2
```

The second failure there is worth naming rather than hiding: the third arm of "casting says which input was wrong" asserts that an id the pool has never heard of surfaces the **pool's** message, and it does so because `checkEnergy` has to price the card before anything else touches it. Remove the check and that id reaches the "not in hand" message instead. The two tests are coupled through the order of the two errors, and that coupling is real behaviour rather than a test artefact.

`RoundRecord` gained an optional `casts` field, and it is left off rather than set to `[]` when a round casts nothing — so a record from a unit-only fight is exactly the record it was before spells existed. The reader's rule is `rec.casts ?? []`. Dropping the argument from `replayFight`'s `runRound` call replays the placements and casts nothing, which desynchronises the hand within one round:

```
✖ a fight that casts replays byte-identically from its recorded action list
  Error: fight: cannot play "u_shieldbearer" - it is not in hand [s_bolt, q_iron_sword, s_volley, u_captain, u_hornblower]
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

That test runs 25 fights over `PLAYER_DECK_MIXED` and asserts more than 20 rounds actually cast something before it reports success, so a green run cannot mean "the deck never drew a spell".

### What this round does not prove

The AoE ordering tests use two corpse-and-waker pairs on **one** line at **one** checkpoint. A three-way answer, or one spanning both sides from a single AoE, is not covered — the cross-side case is still only gated by the fixture test in the entry below.

The replay and determinism evidence is bound to `PLAYER_DECK_MIXED` over 25 seeds. That deck is not the measured one, on purpose, so none of it is evidence about balance: what a spell costs, and whether any of them belongs in a deck, is untested and is the content-and-balance node's question.

`npm run verify` holding still is evidence that the additions are inert on the path the measurement runs, not that they are correct on the path it does not. The measurement never draws a spell, so it can say nothing about one.

Three decisions inside these gates are guesses that the owner may want to reverse, and each is a data or one-line change rather than a redesign: that Armour applies to spell damage, that an AoE hits units and never heroes, and that an AoE ignores Guard and Ward. They are recorded in `docs/work/4_spells-equipment/plan.md`.

## 2026-09-06 — six ordering gates that were pinned to nothing, and a latent crash closed (`test/resolver-order.test.ts`)

Taken at `49f017b` with this round's changes applied; the suite is **55 tests** here, 47 before it.

An independent review of the twelve gates below found the seam sound and several gates not gating what they claimed. Each mutation was applied to the stated file, `node --test` run over the whole suite, and the tree restored.

| mutation | site | tests failed, of 55 | which |
|---|---|---|---|
| `extra(...)` hoisted into a correct pass of its own after both loops | `resolver.ts:triggersFor` | 1 | the new interleave test, only |
| that hoist, plus the shipped side and entity loops reversed | `resolver.ts:triggersFor` | 1 | the new interleave test, only |
| the shipped side and entity loops reversed | `resolver.ts:triggersFor` | 3 | both board-order tests and the interleave test |
| the shipped entity loop ordered by `uid` | `resolver.ts:triggersFor` | 2 | the index-not-uid test and the interleave test |
| `checkStateBased` side loop reversed | `resolver.ts:checkStateBased` | 1 | simultaneous deaths, across sides |
| `checkStateBased` index loop reversed | `resolver.ts:checkStateBased` | 1 | simultaneous deaths, one line |
| the `deaths` trigger loop moved above the `spawned` loop | `resolver.ts:drain` | 2 | both new reaction-order tests |
| the `produced` and `deaths` trigger loops swapped | `resolver.ts:drain` | 1 | reactions in event-emission order |
| `requireEntity` restored in `apply`'s five cases | `resolver.ts:apply` | 1 | the skip-a-departed-entity test |
| `drain`'s seam default `null` → a no-op `TriggerRule` | `resolver.ts:drain` | 1 | the seam-is-off test |
| a production call site hands the seam a rule | `fight.ts:248` | 1 | the seam-is-off test |
| `iterations >= maxIterations` → `>` | `resolver.ts:drain` | 1 | the cap-boundary test |

### The board-order gates were pinned to the shipped loop by nothing but where the seam call sits

The three board-order tests that existed were built from the seam alone, and `extra(...)` happens to be called inside the shipped `for (side) / for (entity)` nest. Nothing asserted that coupling, and the seam's own doc comment sanctioned a separate pass — "after the shipped traits have had their say". Hoisting `extra` into a pass of its own, correctly ordered by board index, and then reversing the shipped loop, left every test green with the shipped board-order loop inverted.

The new test puts a shipped trigger and a seam trigger on **one event**: a `watchDeaths` unit at index 0 and a Wake unit at index 2, both answering one death. Correct is `[watcher, waker]`; the hoist reorders it whether or not the shipped loop is also reversed. The fixture is built right to left, so uid order is the exact reverse of board order and the same test also catches a uid-ordered walk.

Hoist alone — nothing else in the suite sees it:

```
✖ a shipped trigger and a seam trigger answering one event interleave by board index
  AssertionError [ERR_ASSERTION]: the seam rule standing at index 0 answers before the shipped Wake at index 2
    actual: [ 3, 5 ], expected: [ 5, 3 ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

Hoist plus the shipped loops reversed produces the identical failure, and the identical 1-of-55. That is the review's finding stated as a number: with the seam decoupled, reversing the shipped board-order loop costs one test, and before this round it cost none.

### Simultaneous-death order is decided in `checkStateBased`, which the board-order gate does not reach

When two entities are at zero at one checkpoint, the order their `died` events reach triggers is fixed by `checkStateBased`'s own two loops, not by `triggersFor`. Both are reachable with **no seam**: Wake, plus the corpse-at-zero-Health state already used elsewhere in the file.

One corpse-and-waker pair per side catches the side loop:

```
✖ two deaths at one checkpoint are announced player line first, then enemy line
  AssertionError [ERR_ASSERTION]: the player line is checked before the enemy line
    actual: [ 5, 3 ], expected: [ 3, 5 ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

Two pairs on one line catch the index loop, and neither test sees the other's mutation:

```
✖ two deaths on one line at one checkpoint are announced left to right
  AssertionError [ERR_ASSERTION]: the leftmost death is announced first
    actual: [ 5, 3 ], expected: [ 3, 5 ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

Each test asserts the `died` order and then the `powerGained` order, because the second is the part a player sees: the same two deaths, the same final Power, in a different order down the event stream the animation layer replays. `docs/design/game.md` names AoE as the only designated counter to a wide board, and AoE is the first designed effect that puts two units at zero at once.

### "Continuations before reactions" gated one of the two reaction sources

`drain` pushes three loops: `spawned`, then triggers for `produced` events, then triggers for `deaths`. The recorded mutation swapped the first two. The third was untouched by any test, and both of its orderings are reachable from shipped traits alone.

An acting unit with Wake whose left neighbour is a corpse makes one `act` both spawn a continuation and produce a death. Moving the `deaths` loop above `spawned`:

```
✖ a death's triggers queue behind the acting unit's own continuations
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    actual:   [ 'act', 'gainPower', 'attack', 'afterAct' ]
    expected: [ 'act', 'attack', 'afterAct', 'gainPower' ]
ℹ tests 55   ℹ pass 53   ℹ fail 2
```

The unit swings at its printed 3 with the loops in order and at 5 with them moved, so this is a damage number and not only a trace.

Swapping `produced` with `deaths` needs both sources non-empty at one checkpoint: a Relay unit's `afterAct` while a corpse sits at zero to its left. Both are reactions, so "continuations before reactions" cannot separate them; what does is that `produced` events are pushed to the event stream before `deaths` are, and the triggers follow the stream.

```
✖ reactions queue in the order their events were emitted: an effect's own, then the checkpoint's deaths
  AssertionError [ERR_ASSERTION]: Relay answers the afterActed it was emitted with, before Wake answers the death
    actual: [ 4, 6 ], expected: [ 6, 4 ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

### The latent crash, and the two answers the engine gave to one situation

All five `apply` cases called `requireEntity` before their `!e.alive` guard, and `checkStateBased` removes dead non-heroes from the board. So an effect queued against a living unit that dies before the effect comes up reached `requireEntity` and threw. Aimed at a **hero** the same sequence was silent, because line 181 keeps dead heroes on the board and the `!e.alive` guard caught them. One situation, two answers, decided by a filter that exists to anchor the right end of the line.

The fix is to skip: `findEntity`, then `if (e === null || !e.alive) return { events: [], spawned: [] }`. `ARCHITECTURE.md:74` says deaths are batched precisely so this does not depend on evaluation order, and the throw could not have been a useful diagnostic either — `findEntity` returns null identically for "died and was removed" and "never existed".

Reached through `resolvePhase`, the real entry point, with a test-only trigger keyed to `acted` that queues an action against a named entity — `Echo`'s shape in `docs/design/game.md`, "repeat the base action of the unit that resolved immediately before me". Mutation: `requireEntity` restored in all five cases.

```
✖ an effect naming an entity that has left the board is skipped, and a hero answers the same way
  Error: state: no entity with uid 5 is on the board
      at requireEntity (src/engine/state.ts:159:11)
      at apply (src/engine/resolver.ts:117:17)
      at drain (src/engine/resolver.ts:350:43)
      at resolvePhase (src/engine/resolver.ts:392:20)
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

The split itself, under that same mutation, by running one half of the test at a time. Hero half only:

```
ℹ tests 55   ℹ pass 55   ℹ fail 0
```

Unit half only: the throw above. Same sequence, same trigger, same queued effect — the only difference is whether the victim is filtered off the board.

**Behaviour held still.** The review measured this path unreachable at this revision: 72,000 fights, 79,946,615 effect applications, zero effects naming an absent or dead entity. `npm run verify` before and after the fix is identical line for line apart from its wall-clock line — same 400-seed arms, same 2,454 compared rounds, same 2,167/4,238 differing placements, same 40 distinct final hashes, same 15.25 pp gap. The fix only changes what happens on a path that throws today, so any reachable difference would have shown up as a crash rather than as a different number.

### The seam's `null` default, and why this one gate reads source

Changing `drain`'s `extraTriggers` default from `null` to a no-op `TriggerRule` left the whole suite green, and no fixture can separate them: `triggersFor` asks a no-op rule and it returns nothing. So the test reads the declaration and the call sites instead of the behaviour. What it defends is not the token but what the token buys — the seam is off unless a caller asks, and no caller in `src/` asks.

```
✖ the test seam is off in production: its default is null, and nothing in src/ passes one
  AssertionError [ERR_ASSERTION]: both entry points default the seam to null, so an omitted argument is no rule at all
    actual: [ [ 'drain', '() => []' ], ... ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

And the other half, adding a fifth argument to one of the four `resolvePhase` calls in `src/engine/fight.ts` — a no-op rule and the same iteration cap, so nothing about the fight changes:

```
✖ the test seam is off in production: its default is null, and nothing in src/ passes one
  AssertionError [ERR_ASSERTION]: production passes the seam nothing
    actual: [ 'src/engine/fight.ts:248  resolvePhase is handed a trigger rule' ]
    expected: []
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

The call scan asserts it reached at least four call sites before it reports zero offenders, so "did not run" cannot come back as "passed". Bound: it proves nothing about a rule handed in at runtime from outside `src/`.

### The iteration cap's boundary

`iterations >= maxIterations` → `>` shifts the cap by exactly one effect and nothing else in the engine notices. The gate holds both sides of the boundary: `act` spawns `attack` and `afterAct`, so the cascade is exactly three effects; at `maxIterations = 3` it finishes, and at `2` it throws having applied exactly two.

```
✖ the iteration cap is the exact number of effects that may be applied
  AssertionError [ERR_ASSERTION]: Missing expected exception: a drain needing maxIterations + 1 effects throws
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

The half that fired here is the `maxIterations = 2` half; the `= 3` half holds the other direction, so a cap that starts throwing one effect early is caught too.

### What this round does not prove

The interleave test uses one shipped trigger and one seam rule on one line. A three-way interleave, or one that spans both sides, is not covered. The simultaneous-death tests reach the checkpoint through a unit parked at zero Health, which is the state AoE will produce but is not AoE. The seam test reads `src/`, so a rule reaching `drain` from anywhere else is invisible to it. And `npm run verify` holding still is evidence about the 400 seeds it runs, not a proof that no fight anywhere queues an effect against a departed entity — it is evidence that this fix changed nothing that was already happening.

## 2026-09-06 — `npm run verify`, the optimal-vs-random gap

Claim: at the primary encounter, over the seed window the run names, a bot that searches insertion positions beats a bot that places at random by at least 5.00 percentage points, by a margin whose 95% paired interval excludes zero. Bound stated in `src/sim/measure.ts` — at `gapVerdict` for the threshold and inline at the `--verify` block for what a green run does and does not prove.

Before this, the gate could not go red on the claim it exists to defend. `--verify` set `process.exitCode = 1` for card-identity and determinism failures only, so a gap that collapsed to zero still exited 0 while `ARCHITECTURE.md` described it as "a number that can go red in CI".

### The threshold, and why it is 5.00 pp

Two conditions, both required, and they bind at opposite ends of the seed count.

1. The paired 95% interval must exclude zero. This keeps the gate sound at any `--seeds` value — at 20 seeds the floor alone could be cleared by luck.
2. The gap must reach `MIN_GAP_PP = 5.00`. This keeps the gate meaningful at large seed counts, where condition 1 degenerates: at 20,000 seeds an interval excluding zero needs a gap of only 0.74 pp, which is the size of a collapse rather than the size of a decision.

The number comes from the measurement's own two null arms rather than from the headline. The cascade-stripped negative control runs a 0.92 pp gap at `even`; the noise floor — two identical random policies separated only by their stream name — runs -0.26 pp over 20,000 seeds (95% CI -0.98..0.47). A genuine collapse therefore lands at or below about 1 pp. Against that, the paired standard error at the gate's 400 seeds is about 2.7 pp, so a single seed window can sit 5 pp either side of the population value for no reason at all. 5.00 pp is one such half-width above zero: below it a 400-seed run cannot separate the gap from zero anyway. With the population gap at 18.80 pp (95% CI 18.06..19.53 over 20,000 seeds), the floor sits 5.1 standard errors below it, so a false red needs a 5-sigma excursion.

Deliberately not a third condition: "the gap must beat the measured noise floor". A 95% interval on a null comparison excludes zero one run in twenty by construction, so gating on the control's interval would flake 1 in 20 on any change to the seed set, and a flaky gate is a gate that gets disabled. The control is printed for a human instead.

### Red 1 — both arms pointed at the same placement policy

Mutation, in `src/sim/measure.ts`:

```ts
export const BOTS: Record<string, BotFactory> = {
  lookahead: (seed) => randomPlacer(seed, 'placement-a'),   // was lookaheadPlacer(DEFAULT_LOOKAHEAD)
  ...
```

`npm run verify`, exit 1:

```
- The claim itself: FAIL. The A - B gap is 0.00 pp (CI 0.00..0.00); it must reach 5.00 pp and its interval must exclude zero. Enforced: --verify exits non-zero.

FAIL: placement is no longer measurably a decision at encounter "even" over 400 seeds (1..400).
  - the optimal-vs-random gap is 0.00 pp with a 95% interval of 0.00..0.00 pp, whose lower bound is not above zero. Over 400 seeds this run cannot distinguish optimal placement from random placement, so it is not evidence that placement is a decision. ...
  - the optimal-vs-random gap is 0.00 pp, below the floor of 5.00 pp this gate defends. ...
  Arms: A optimal 41.50% (166/400), B random 41.50% (166/400); measured noise floor B - B2 1.50%.
```

### Red 2 — Bot A replaced by a real policy that is no better than random

`lookahead: () => appendLeftPlacer()`. Append-left is a genuine fixed rule, not a copy of the control arm, and it is worth nothing. `npm run verify`, exit 1:

```
FAIL: placement is no longer measurably a decision at encounter "even" over 400 seeds (1..400).
  - the optimal-vs-random gap is -5.25 pp with a 95% interval of -10.39..-0.11 pp, whose lower bound is not above zero. ...
  - the optimal-vs-random gap is -5.25 pp, below the floor of 5.00 pp this gate defends. ...
  Arms: A optimal 36.25% (145/400), B random 41.50% (166/400); measured noise floor B - B2 1.50%.
```

### Red 3 — the floor firing where the interval does not, on unmutated code

The two conditions are not the same condition wearing different clothes, and this is the run that shows it. No source change: the gate run at an operating point where the gap is statistically real and substantively collapsed.

```
node src/sim/measure.ts --verify --seeds 20000 --sweep-seeds 1 --search-check 0 --encounter trivial
```

Exit 1:

```
- The claim itself: FAIL. The A - B gap is 1.55 pp (CI 1.28..1.83); it must reach 5.00 pp and its interval must exclude zero.

FAIL: placement is no longer measurably a decision at encounter "trivial" over 20000 seeds (1..20000).
  - the optimal-vs-random gap is 1.55 pp, below the floor of 5.00 pp this gate defends. ...
  Arms: A optimal 97.17% (19433/20000), B random 95.61% (19122/20000); measured noise floor B - B2 0.04%.
```

Only the floor condition fired: the interval 1.28..1.83 excludes zero, so condition 1 passed on a gap that is a fortieth of the headline. A gate written with condition 1 alone would have called this green.

All three reverted; `npm run gates` returns to exit 0, reporting `The claim itself: PASS. The A - B gap is 15.25 pp (CI 10.06..20.44)`.

### What this gate does not prove

It is bound to one encounter — `even` by default, the one tuned so both arms straddle 50%. The same gap is 1.55 pp at `trivial` and about 19 pp at `hard`, so a green run says nothing about the other three; `npm run measure` reports all four. It is bound to bots: Bot B places uniformly at random and no human does, and against "always append next to the hero" the gap is roughly 9 pp, which is the honest figure for a person not thinking about placement. And it catches collapse, not drift — a gap that quietly halved would still pass.

## 2026-09-06 — `npm run gate:banned-apis`, extended to the clock constructor

Claim, added to the existing one: `new Date()` with no arguments, and `Date()` called without `new`, appear nowhere under `src/` or `test/`. Both read the wall clock, and a fight seeded off `new Date()` is exactly as unreproducible as one seeded off `Date.now()` — which the gate already banned. Bound stated in `tools/gates/banned-apis.ts`.

`ARCHITECTURE.md` names three APIs and the gate was built to that list, so the same hidden input in a different syntax was uncovered.

### Scoping, without a file-name exemption

`tools/heraldry-probe/shoot.ts:113` stamps its manifest with `new Date().toISOString()`, which is the manifest's whole point. The new rule is scoped to `src/` and `test/` rather than exempting that file, because `tools/` is not code the engine's determinism depends on **by construction rather than by assertion**: `npm run gate:boundaries` fails when anything under `src/engine/` imports from `tools/`, so nothing there can enter a fight. A second probe may stamp its own manifest tomorrow without editing the gate. The three original names keep the wider `src/`, `test/`, `tools/` scope they had.

This is checked by the clean tree rather than argued: `shoot.ts` still contains its `new Date()` and the gate is green.

### Red — every syntax the rule claims to catch, in one mutation

Appended to `src/sim/bots.ts`:

```ts
export const stampA = (): string => new Date().toISOString();
export const stampB = (): string => Date();
export const coin = (): boolean => Math.random() < 0.5;
export const fixedIsFine = (): Date => new Date(0);
```

and to `src/sim/measure.ts`:

```ts
export const bare = (): Date => new Date;
export const viaGlobal = (): Date => new globalThis.Date();
export const stamped = (): number => Date.now();
export const ticked = (): number => performance.now();
// A comment naming new Date() and Math.random must not count.
export const inAString = 'new Date() and Date.now() in a string must not count';
```

`npm run gate:banned-apis`, exit 1:

```
Banned API gate FAILED: 7 hidden input(s) into the engine.

  3 use(s) of Math.random, Date.now or performance.now outside src/engine/rng.ts:
    src/sim/bots.ts:241:36  Math.random
    src/sim/measure.ts:624:38  Date.now
    src/sim/measure.ts:625:37  performance.now

  4 wall-clock read(s) via the Date constructor under src/ or test/:
    src/sim/bots.ts:239:37  new Date()
    src/sim/bots.ts:240:37  Date()
    src/sim/measure.ts:622:33  new Date
    src/sim/measure.ts:623:38  new globalThis.Date()
```

Seven, not nine. `new Date(0)` is absent from the list on purpose — a `Date` built from an argument is a pure function of that argument and is not banned anywhere — and so are the `new Date()` and `Date.now()` sitting in a comment and a string literal, which is the property that makes this gate parse rather than grep. This run also re-proves the three original names under the rewritten detector; the earlier proof was against the previous implementation.

Reverted; green again at exit 0, reporting 21 files scanned for the member rule and 17 for the clock rule.

### Red — the self-test, so "did not run" cannot come back as "passed"

The self-test now counts violations **per rule**, because a total-only count passes with one rule dead and the other over-firing. Mutation, in the detector itself:

```ts
if (objectName(node.expression) === 'Date' && argc === 99) record(node, 'clock');   // was argc === 0
```

Exit 2, before any file is read:

```
GATE BROKEN: the banned-API detector found 1 "clock" violation(s) in its own self-test, expected 4. It cannot be trusted to report an absence. Found: member@1:Math.random | member@2:Date.now | member@3:performance.now | member@4:globalThis.Math.random | member@5:Math['random'] | member@6:{ now } = Date | clock@13:Date()
```

The gate also exits 2 if either rule ends up with no files in scope, for the same reason.

## 2026-09-06 — `src/sim/bots.test.ts`, placement policies hold no state

Claim: every placement policy is a pure function of the fight it is handed, so a warmed instance places identically to a fresh one, one instance hoisted across a sweep gives the same fights as one instance per fight, and a policy asked the same question twice gives the same answer. Bound stated in the file header.

The defect was live at `26e55a8`: `lookaheadPlacer` carried a `salt` counter across calls and `randomPlacer` built its generator outside the returned closure, so a policy's decisions depended on how many fights its instance had already seen. `src/sim/measure.ts` builds a fresh policy per fight, which made this reproduce — but only by convention, and hoisting the construction out of that loop for speed would have changed every placement and every final hash in the measurement with every gate still green.

The tests live beside `bots.ts` rather than in `test/` because `test/` was being edited by another worker in the same wave; `node --test` discovers `**/*.test.ts` and the file is inside `tsconfig.json`'s `include`, so both `npm test` and `npm run typecheck` cover it.

**Correction, 2026-09-06.** That seam is gone and the file moved to `test/bots.test.ts`. The proof above was run at the old path and is left as it was recorded; re-running it today reads `node --test test/bots.test.ts`. Coverage at the new path was re-checked rather than assumed: `node --test` still reports 47 tests and `node --test test/bots.test.ts` runs 3 of them, and `npm run typecheck` was made to go red on a deliberate type error inserted in the moved file (`test/bots.test.ts(125,7): error TS2322`) before it was reverted.

### Red — the base revision's stateful policies

Mutation: `src/sim/bots.ts` restored to its `26e55a8` content, i.e. the `salt` counter and the hoisted generator put back.

`node --test src/sim/bots.test.ts`, exit 1, all three tests red:

```
✖ a warmed policy instance places exactly as a fresh one does
  AssertionError: lookahead: a warmed instance placed differently from a fresh one on seed 1
✖ one policy instance hoisted across a sweep gives the same fights as one per fight
  AssertionError: lookahead: hoisting the policy changed the placements on seed 2
✖ a policy asked the same question twice gives the same answer
  AssertionError: lookahead: two calls on the same fight and hand returned different indices
```

The first failure's diff shows the concrete divergence — the same card going to index 1 in the warmed instance and index 0 in the fresh one on round 1 of seed 1, and diverging further every round after.

Reverted; `npm test` green at 37/37 — taken at `4b45a7e`, where the suite is 37 tests. This branch's merge with the resolver-ordering one made the suite 47 at `49f017b`.

### What these tests do not prove

They cover the four policies listed in `POLICIES`. A stateful policy added later is caught only if it is added to that list. They also say nothing about the engine's own determinism — `test/determinism.test.ts` owns that, and these would pass just as happily on an engine that was deterministic and wrong.
## 2026-09-06 — the resolver's ordering contract (`test/resolver-order.test.ts`)

Claim: the ordering properties `ARCHITECTURE.md` promises — trigger order is board order, board order means board *index*, it is a queue and not a stack, deaths are batched after every effect, the acting order is snapshotted, and direct continuations are queued ahead of reactions — each fail when they are broken. Bound stated in the test file's header.

These six were the reason for the work. An independent review at `26e55a8` found the engine correct and the suite weak: of 28 mutations that reintroduce a defect the code or docs claim to prevent, **10 left 34/34 green**, and six of those ten were resolution order. They were not untested by oversight — they were **unobservable**. With the shipped pool every trigger is keyed to one uid (`event.uid === e.uid`, or `event.rightUid === e.uid`), so no event can match two units and the board-order loop decides nothing; and no shipped effect both spawns a continuation and produces an event anything triggers on, so the order of those two queue pushes decides nothing either. No fixture built from Relay, Guard, Wake and Ward can tell the correct resolver from any of these broken ones.

Three of the six therefore needed a trigger rule that fires for more than one unit, and the game has none. **Narrowed after review:** that is a claim about the exact recorded mutations *in `triggersFor`*, and it was first written as though it were a claim about resolution order. It is not. Sibling orderings at `checkStateBased` and at `drain`'s third push loop are reachable from Wake alone, were ungated, and are gated in the entry above with no seam at all. `drain` and `resolvePhase` gained an optional `extraTriggers` parameter for exactly that: it defaults to `null`, every production caller passes nothing, and `triggersFor`'s doc comment carries the argument for why it exists. **This is the one engine-source change in this round that is not behaviour**, and it is here because a gate nobody can make go red is not a gate.

Taken at `bcd7dc9`, where the suite is **44 tests**. Every transcript quoted below is from that revision, so its `ℹ tests 44` lines are correct there and nowhere else: `49f017b` merged this branch with the one carrying `src/sim/bots.test.ts` and the suite became 47, and the round after this one took it to 55. All seven mutations were re-run at `49f017b` with that later round applied; the same tests fail, and the re-run column below carries the denominators as they stand there.

Each mutation was applied to the stated file, `npm test` run against the whole suite, and the tree restored. Where a mutation fails *only* tests added in this round, that is the review's finding reproduced: the 34 that existed before it do not see the defect.

Line numbers are as they stood at `26e55a8`, which is how the review named them.

| mutation | site | failed, of 44 at `bcd7dc9` | re-run, of 55 | which |
|---|---|---|---|---|
| sides and lines iterated in reverse | `resolver.ts:181-182` | 2 | 3 | both trigger-order tests, plus the later interleave test |
| line ordered by `uid` instead of index | `resolver.ts:182` | 1 | 2 | the index-not-uid test, plus the later interleave test |
| Ward's block moved above Relay's | `resolver.ts:186-199` | 1 | 1 | the within-unit tie-break test |
| `queue.shift()` → `queue.pop()` | `resolver.ts:254` | 7 | 14 | six of this round's tests and the rewritten act guard, plus seven added later |
| `checkStateBased` deferred to the end of the drain | `resolver.ts:258` | 2 | 3 | the batching test and the act guard, plus the later departed-entity test |
| acting order read live by index | `resolver.ts:285-289` | 1 | 1 | the snapshot test |
| the two `queue.push` loops swapped | `resolver.ts:264-265` | 1 | 2 | the continuations-before-reactions test, plus the later departed-entity test |

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

Taken at `bcd7dc9`, where the suite is 44 tests; the `ℹ tests 44` lines below are that revision's.

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

Taken at `bcd7dc9`, where the suite is 44 tests; the `ℹ tests 44` lines below are that revision's.

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

Taken at `bcd7dc9`, where the suite is 44 tests; the `ℹ tests 44` lines below are that revision's.

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
