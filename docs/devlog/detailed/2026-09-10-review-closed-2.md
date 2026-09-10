# 2026-09-10 — the second review: a rule that was written down four times and was not the rule

History, not status. Status is `docs/work/10_classes/plan.md`, session five.

Branch `worktree-agent-ac92c8ed9709f58e2`, cut from `8a37fcf`. 199 tests, up from 195. `npm run verify` and `npm run verify:run` print tables byte-identical to the base — every number, every hash, with only the wall-clock `Elapsed:` line differing. Seventeen mutations, all red, in `docs/learning/gate-proofs.md`.

## What was believed, and what was true

Session four closed a review by choosing a rule and writing it in four places: *the resolver announces every change it makes and nothing it does not*. It is a good sentence. It is not what the code does, and the same session's own evidence file contains the proof — its Mage play example expects `{targetUid: wall, raw: 1, dealt: 0}`, which is an announcement of a change that did not happen.

The `scorch` loop pushes `damaged` for every living non-hero, `dealt === 0` included. So does `attack` when Armour eats the whole point. Measured through the pipeline the screen runs — `beginRound`/`commitRound` plus `buildBeats`, per segment — **215 zero-change beats survived the fight-ending `died` over 4500 fights**: 67 Ranger `attack`, 148 Mage `spell`. The player read "**Warchief** dies." and then "scorches **Orc Shieldwall** for **0**", which is a line about a fight that was already over describing nothing.

**The temptation was to make the code match the sentence**, by dropping the zero inside `apply`. That would have been wrong twice. The engine's convention is deliberate and gated in the other direction: mutating `if (!e.isHero)` to `if (!e.isHero && dealtBack > 0)` turns "a 0-Power defender retaliates for 0" red, because a blow that bounced and a blow that never came are different things and the event stream distinguishes them. And it would have put an animation layer's judgement inside the only function that writes to `GameState`.

So the sentence was corrected — in `src/engine/resolver.ts`'s header, in `ARCHITECTURE.md`, in the session-four devlog entry (marked as a dated correction rather than rewritten), and in `docs/policies/local-rules.md`, which gains it as a standing rule. **The resolver announces every effect that reached a target and nothing about one that found none.** *Reached a target* is not *changed the board*, and the two come apart exactly where Armour is at least the damage.

The player-facing half went to the view. `buildBeats` drops a blow that moved no Health once a hero is down; the same 4500-fight sweep then reports 0, with the decided-fight counts unchanged. `src/render/odds.ts` already answered the same way on the forecast side — a unit taking nothing is absent from the burn rather than present at zero — so this makes two surfaces agree rather than inventing a third rule.

**A wrong rule in four places is worse than no rule.** The next author implements the sentence, not the code. That is the whole reason this was the most severe of the round's findings, when nothing about any outcome had moved.

## Two things the corpus could not see, and what was built for them

**A trade is one blow.** Suppressing a zero-dealt swing while keeping the retaliation it drew would print "hits back for 3" with no swing above it. Across 4500 fights that shape occurred **0 times** — a hero takes no retaliation, and no fight in the corpus had a Volley *unit* land the killing blow and then swing into an armoured body. So the pairing rule had no corpus behind it and would have shipped as an unproven claim. It has a fixture instead: an enemy hero carrying Guard, so the first swing is forced onto it and the second is forced onto the plated body, with no roll anywhere. Deleting the one line that consumes the paired answer turns it red with `['retaliate']` against `[]`.

**The other arm.** A rule that drops zeroes is satisfied by a view that drops *every* zero, which would take away exactly the feedback a Mage's player needs. So the gate asserts the other direction too, over the same corpus: while the fight is live, a blow Armour ate must still be drawn, at 0. Dropping `decided &&` from both suppression tests turns it red on the Knight, seed 1, round 8.

## What a reviewer caught that the author missed, twice in one session

**A gate that recorded dequeuing.** `assert.deepEqual(trace.map(kind), ['attack'], 'the effect was applied, not skipped')`. `drain` pushes to `trace` before it calls `apply`. Replacing the entire `attack` case with `return { events: [], spawned: [] }` leaves every assertion in that arm passing — the trace is still `['attack']`, the events are still `[]`, the attacker is still on 5 Health. The fix is a positive control: the same effect, once, against a board that has a target. Under the same mutation the control is now the first assertion to fail.

**And the fix for it had the same shape.** The new gate for the log's fizzle sentence scanned `src/ui/app.ts` for a quoted string containing "fizzle". `app.ts` is full of template literals, and the gap *between* two of them contains `case 'fizzle':` — so the scan matched a region bounded by two unrelated backticks and asserted about fifteen blank lines and a switch label. It came back green on a fixed file and red on nothing that mattered. It reads the `case 'fizzle':` block up to its `break;` now, and asserts that exactly one such block writes a log line.

## The doc gate that only worked one way

"the two play examples in `docs/design/game.md` walk exactly as written" transcribed the document's numbers into the test. Engine drift went red; document drift stayed green; and the plan and the devlog both claimed it held in both directions. It reads the file now — every number both fixtures are built from is parsed out of `game.md`, and the parser fails loudly when the sentence it reads is no longer there, naming the pattern it was looking for. A reworded example is how a doc gate silently stops reading anything, and that is one of the three mutations.

## The instrument that had never played two of the three classes

`tools/ui-probe/run.ts` clicked the Knight, hardcoded, for the whole unit that added the Ranger and the Mage — so Volley and Scorch, the only two things that unit put in the resolver, had never been drawn through the DOM. The class is a parameter now and `all` is the default. Seed 7, light: Knight dead after 18 nodes and 13 fights, Ranger after 12 and 9, Mage after 9 and 7, each page hash identical to its own headless run.

The probe also prints the log's last eight lines at every banner. A screenshot shows only the log's scrolled viewport, and the lines this whole round is about are the ones that scroll off it — so the evidence for the change is a read-out, and the screenshots are the surrounding board. The Mage's first fight reads *"Goblin Raiders dies. | scorches Goblin for 1 … | scorches Goblin for 1 … | Goblin dies. | Goblin dies."*: an epilogue that still says what it did, because the burn moved Health.

## What deliberately did not move

No cost, stat, pool weight or class number. `docs/policies/local-rules.md` rules that out, and the owner is still deciding the Mage. `verify` and `verify:run` byte-identical is the evidence that nothing about any fight or any run changed.

`fight.ts` runs every cast in `applyCasts` before `settleResult`, with no result check between casts, so two spells in one round can print `fizzled` under a `died`. That is left alone and the reason is now in the resolver's header: the second spell's energy was spent whatever the first one did. No shipped content reaches it — the run deals only units, and nothing casts through `src/ui/session.ts`.

`buffAll`'s fizzle is unreachable from `cast.ts`, and it was marked and gated rather than removed. It is reachable through the effect vocabulary, it is the correct answer there, and deleting it would make the first card that aims a buff anywhere but its caster's own side fail silently.
