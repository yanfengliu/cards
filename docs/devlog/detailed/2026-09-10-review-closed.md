# 2026-09-10 — the review found the resolver sound and the surfaces around it ungated

Branch `worktree-agent-a2039c8da0f15808d`, cut from `2781bab`. History, not status; the unit's status is `docs/work/10_classes/plan.md` and the evidence is `docs/learning/gate-proofs.md`.

An independent review of the class layer cleared the resolver's ordering work and found four things in the surfaces the new verbs feed. This session closed all four. It is the first session of unit 10 to change behaviour a player sees.

## What was believed and proved false

**"The class-pick screen is gated, because `test/classes.test.ts` has a test called 'the class pick offers the three classes'."** That test constructed its own `renderClassPick({ classes: CLASSES, … })` call. The screen's actual caller is `src/ui/runapp.ts`, and the review proved that handing it `CLASSES.filter(c => c.id !== 'mage')` left the whole suite green. Checking the claim went further than the review had: at `2781bab`, `git grep -l runapp -- test/` returns **nothing**. No test named that file, imported it, or read it as text. **Not one line of `src/ui/runapp.ts` was reachable by any gate**, so the two mutations were not a sample, they were a certainty. `startRunApp` needs a document and `node --test` has none, and everything in the file lived inside it.

The fix is not a DOM shim. The two decisions — which classes the screen is handed, and whether a class id from outside the app is admitted — are now `PICKABLE_CLASSES`/`classPickHtml` and `pickableClassId`, exported and DOM-free, and the two callers that used to have their own membership test (`?class=` at startup, `data-class` on click) both go through the one guard. What the screen *looks* like is `tools/ui-probe/pick.ts`'s, which is new.

**"The probes still work."** `tools/ui-probe/run.ts` navigates to `?seed=&theme=&fresh=1` and waits for `#run-map svg`. Unit 10 put the class-pick screen in front of that, and `#run-body` is hidden while it is up — so the probe had been failing on a 30-second Playwright timeout **for the whole unit**, and nothing said so, because a probe is not in `npm run gates`. It clicks "Play the Knight" now, which is also the honest fix: the headless mirror it compares against is `createRunController` with no class named, and that is the Knight. Seed 7 plays 18 nodes and 13 fights through the DOM and hashes `3d135f5e12b240ea`, identical to the headless run — so the resolver change below crosses the DOM unchanged.

A probe that is not run by a gate rots exactly like a test that is not run, and there is nothing in this repo that would have noticed.

**"`assert.equal(VOLLEY_SWINGS, 2)` next to a tooltip saying 'twice' gates the tooltip."** It gates nothing. When the constant moves, that assertion goes red and the obvious repair is to edit the test to say 3 — which ships a tooltip that still says "twice". The review named this trap and it is the reason the new gate does not mention the constant in its runtime half at all: it builds a Volley entity, drains one act, counts the `attacked` events, and looks the word up in a table `test/explain.test.ts` owns. Two arms prove it: `VOLLEY_SWINGS = 3` with the sentences derived is **green**, and `VOLLEY_SWINGS = 3` with the tooltip retyped as "twice" is **red**. Neither arm alone says anything.

`src/render/class-terms.ts`'s header claimed "The numbers come from the resolver" while `VOLLEY_SWINGS` was never imported anywhere under `src/render/`. Five places typed the count: four sentences here and `src/sim/runbots.ts`'s `+ card.power`. All five derive now. The bot's is `card.power * (VOLLEY_SWINGS - 1)` — numerically identical at 2, and the only one of the five whose *value* is still a heuristic, which its comment now says.

**"The odds are what the side is about to deal."** They were what it was about to *swing* for. Scorch was not in `src/render/odds.ts` at all, so a Mage facing three enemy units read **"1 of yours will swing for 1 Power"** while it was about to deal 1 and then burn 3 more. `ARCHITECTURE.md` defines fair as "the odds were visible before you committed"; a fourfold understatement is the definition of not visible. `IncomingOdds` gains `scorchers` and `burnOn`, and the intent line says "Your Scorch burns **3** more across the line, whatever the rolls" — the last clause because every other number on that line is conditional on a target roll and this one is not.

Volley's half was already computed through `swingsOf` and simply had no test: replacing the two lines with `attackers += 1; totalPower += power(e)` left the suite green, because **every fight the odds had ever been checked against was a Knight's**. The corpus now walks all three class heroes and asserts that a Volley entity and a Scorch entity were actually seen, rather than assuming the walk covered them.

**"A defect that changes no outcome is cosmetic."** The Ranger emitted `fizzled` after the blow that won the fight in 43 of its 499 wins over 500 `trivial` seeds, which on screen reads "…Warchief dies." then "has no legal target — the attack fizzles", with a floating "no target" over the hero that just won. Nothing about the result changed; what changed is whether the game can be trusted to say what happened. The same commit had already suppressed exactly this for `scorch` — with the reasoning written out — and left it live for `attack`'s second swing.

## The rule chosen for F4, and the one that was rejected

`act` spawns its continuations up front and `resolvePhase` breaks between entities, so a Volley's second swing and a Scorch's burn are already queued when the first swing kills the enemy hero.

**Rejected: clear the queue at the checkpoint that killed a hero.** It is the tidiest-sounding fix and it is a change to the resolution contract — the thing the independent review had just cleared and the assignment said not to redesign. It would also drop board changes the view has already been derived from, so `test/render-view.test.ts`'s drift comparison would have had to be weakened to accept it, and it moves final-state bytes for every won fight.

**Chosen: the act finishes, and the resolver announces every change it makes and nothing it does not.**

> **Corrected 2026-09-10, later the same day.** The sentence in bold above is not the rule the engine implements, and a second independent review measured the gap: the `scorch` loop pushes `damaged` for every living non-hero including `dealt === 0`, so 163 zero-change announcements survived the fight-ending `died` and the screen played every one. The code was right and the sentence was wrong. The rule as it actually stands — **the resolver announces every effect that REACHED a target and nothing about one that found none**, 0 included — is in `ARCHITECTURE.md`, in `src/engine/resolver.ts`'s header and in `docs/policies/local-rules.md`, and what a player is shown is `src/render/view.ts`'s. The three bullets below are left as they were written, with the second one wrong; see `docs/devlog/detailed/2026-09-10-review-closed-2.md`.

- An attack that finds no legal target changes nothing, so it emits nothing. The only board on which an attack finds no target is one whose hero is already dead — `legalTargets` returns the living entities of the defending side and a hero is always among them while it lives — so an attack's `fizzled` could only ever be printed under the announcement of the death that ended the fight.
- A Scorch that *does* burn is still announced, dead hero or not, because the board really did change.
- A **spell** cast into an empty line still fizzles. Energy was spent on it and the screen owes the player that; an attack costs no energy.

That makes `attack` agree with `scorch`, which is the inconsistency the review named. The gate asserts both halves in one test, because the attack half alone is satisfied by an `apply` that returns nothing for everything.

After the change the same 500-seed sweep reports 0 stray fizzles and the same win counts — 500, 499, 491. `npm run verify` and `npm run verify:run` print tables byte-identical to the base, every number and every hash, which is what says no outcome moved.

## What moved, and what deliberately did not

195 tests, up from 189. `npm run gates` green on Node v24.18.1.

No cost, stat, pool weight or class number was touched. `docs/policies/local-rules.md` rules that out, and the odds change is explicitly outside it: "A change to what the player can see — the odds, the enemy's intent, a card's own text — is not balance work."

`docs/design/game.md` gained two rules under the owner's class sentence — what the Mage's rider is, and that a Volley body killed by its first swing does not swing again — **marked as agent-decided, not `[owner]`**. Both carry a walked example with exact numbers, and both examples are gated in `test/hero-attacks.test.ts` number for number, so the document cannot drift from the engine without something going red. They walked correctly on the first run; they were written from the rules and the engine agreed.

`ARCHITECTURE.md` now lists the effect vocabulary and records `scorch` as **authorised by the coordinator**. Its own point 8 makes adding a verb a coordinator decision and nothing recorded that it had been one, so a verb that arrived without that line looks exactly like one a worker added on its own.

## A note for whoever audits this next

Every bound this session wrote down is in the gate's own header, and three of them are worth repeating because they are the shape of the next defect:

- "two Wake units answering one Scorch gain Power in board order" builds all four units on the **enemy** side, because a rider only reaches one side. It covers `checkStateBased`'s inner loop and is blind to its outer one — swapping `['player','enemy']` there leaves every assertion in `test/hero-attacks.test.ts` true.
- `npm run verify:run` runs the **Knight alone**. The other two classes' determinism and replay are `test/classes.test.ts`'s, over seeds 1..6 rather than 200.
- The odds corpus's exact comparison **skips** phases in which a player entity died, because a unit that dies to retaliation never swings and the pre-commit number is honestly an over-statement there. The count of skipped phases is asserted to be non-zero, so the exclusion cannot be hiding everything.
