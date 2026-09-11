# Races become mechanical tribes

Status: active
Owner: coordinator
Created: 2026-09-10
Updated: 2026-09-10

Review round 1 is closed: six findings, six gates, eleven mutations. See "Review round 1" below.

## Problem and outcome

Race was decoration. `UnitCard` carried a `tribe`, the heraldry drew it as a field colour, the hover panel named it — and `makeUnit` dropped the field on the way to the board, so no `Entity` had one and nothing in a fight could read one. `src/render/glossary.ts` said so out loud in `RACE_HAS_NO_RULE` ("nothing in the card pool reads it"), and `test/explain.test.ts` held `src/engine/resolver.ts` to it by failing if the file ever mentioned `tribe`.

`docs/design/game.md` has reserved races as mechanical tribes since unit 0 — "cards care about them: *Kindle* counts adjacent dwarves, an elf lord might Relay to every elf beside it". **Kindle did not exist anywhere but that sentence.** No trait, no card, no verb, no test; the only other mentions were a comment in `glossary.ts` explaining that it does not exist and a line in `ARCHITECTURE.md` about field tinctures needing to be scannable for traits "like Kindle".

The outcome: three tribal traits in the engine, six cards carrying them across all three class pools, a hover panel that explains each of them in words derived from the type system, and the design's adjacency bound made into a gate rather than left as an intention.

## Scope

**Included.** `Entity.tribe` and the two accessors that read it; one new effect verb; three traits; six new cards and their blazons; reward-pool entries in all three classes; the glossary, icon, sigil-wording and bot-preference entries the type system forced; the odds projection; buff attribution in the view and its log line; `test/tribes.test.ts`; a strengthened pool gate in `test/classes.test.ts`; the retirement of the race gate in `test/explain.test.ts` and a second paragraph brought under its panel-length gate; the design's own trait list and a walked example; `ARCHITECTURE.md`'s verb list.

**Excluded, deliberately.**

- **Dragon.** The design names dwarf, elf, human and dragon. `Tribe` has no `dragon`, no card is one, and there is no heraldry, icon or glossary entry for one. Adding a race is a content decision the owner has not made; inventing one to fill out a list would be that decision made by an agent. Recorded in `docs/design/game.md` beside the built three.
- **Orc and beast tribal traits.** Giving a shipped enemy card a trait is a balance change to existing content, which this unit is barred from.
- **Tribal sigils.** `src/content/sigils.ts` offers none. The wording exists in `src/render/sigil-terms.ts` because that table is keyed by the engine's `Trait` union, and the bot's preference exists in `src/sim/runbots.ts` for the same reason; whether the run *offers* one is a content decision that file owns.
- **Any change to existing numbers.** No shipped card, weight, constant or deck was altered. `PLAYER_DECK` in particular is untouched, which is why `npm run verify` did not move.

**Dependencies.** None outside the repo. Engine changes escalate to independent review per `AGENTS.md`; the worker did not run it and listed every resolver change for the coordinator to commission.

## Approach

**Three traits, one per race the player can field, each reading the bearer's own race rather than a hardcoded one.** `docs/design/game.md`'s general rule is "a new trait may read its neighbours, its own tribe among its neighbours" — the generic form — and writing them that way keeps `Trait` a flat string union, which is what `TRAIT_TERMS`, `CARD_SIGIL_TERMS` and the hash's `traits.join('+')` all depend on.

- **Kindle** (dwarves, the design's own): before it swings, +1 Power per adjacent unit of its own race.
- **Chorus** (elves): after it acts, each adjacent unit of its own race gains +2 Power this turn. The design's own sketch, "an elf lord might Relay to every elf beside it".
- **Banner** (humans): before it swings, +1 Power per adjacent unit of a *different* race.

Banner is Kindle with the race test inverted, and that is the design content rather than a shortcut: a Kindle dwarf wants to be surrounded by its own, a Banner human wants to stand between races, and on one line they compete for the same slots. A mechanic's purpose is the decision it puts in front of the player; this pair's purpose is that the seam between two clumps is where one of them is worth most.

**One new verb, `tribePower`, authorised by the coordinator and recorded in `ARCHITECTURE.md` beside `scorch`.** Kindle and Banner are a *count*, which the vocabulary had no word for. Chorus is a *grant to a neighbour*, which `gainPower` already is, so it added no verb at all — it is Relay's trigger with a race test and two recipients.

**The count is queued by `act` ahead of the swing.** `attack` reads `power()` when it applies, so a buff queued behind the swing arrives after the blow it was meant to carry — which is exactly the mistake a trigger on `acted` would have made, because a trigger queues behind the acting effect's own continuations.

**One door to the board.** `adjacentAllies` in `src/engine/state.ts` returns at most `MOST_ADJACENT` living non-hero neighbours, and `adjacentKinOf` is the only place in `src/engine/` where two races are compared. `MOST_ADJACENT` is the length of the list of direction accessors the function actually walks, not a `2` typed anywhere, so the glossary's "two neighbours" sentence follows the code.

**A hero is not a race, in both directions.** It is never counted, and — after a gate here found the asymmetry — it never counts either. Without the second half a hero carrying Banner would take +1 every turn for the unit on its left: a bonus for standing at the right end of the line rather than for any race.

**The sentence about races is derived, not written.** `RACE_HAS_NO_RULE` became `RACE_RULE`, built from `TRIBAL_TRAITS` and `TRAIT_TERMS`, so a tribal trait added or deleted re-words it in the same edit. `TRIBAL_TRAITS` is itself `Object.keys` of a fully-specified `Record<TribalTrait, true>`, so the union and the list cannot disagree without failing to compile.

## Acceptance criteria

- [x] **Kindle's status established and reported.** It existed only in `docs/design/game.md`, `ARCHITECTURE.md` prose and two comments; no trait, card, verb or test.
- [x] **At least one tribal trait per race the game has, each adjacency-bounded.** Three, for the three player races. Dragon, orc and beast are excluded with reasons above.
- [x] **No trait counts the board.** Checked by fighting each trait at lines of 3, 5, 11 and 21 and asserting the grant does not move, and by an AST check that `src/engine/` compares two races in exactly one function. Both in `test/tribes.test.ts`, both watched going red.
- [x] **Cards carrying them, spread across class pools.** Six cards, two per trait; all six in all three pools.
- [x] **The pool gate strengthened.** It already asserted "every pool holds every player race", which is stronger than it was described as. It now also asserts every pool can draft every tribal trait — watched going red by removing the Knight's two Chorus printers while leaving its other elves, which the race half does not notice.
- [x] **The hover panel explains each new trait, derived from the type system.** `TRAIT_TERMS` is keyed by `Trait`, so all three were compile errors until explained; their numbers are imported from the resolver; the race sentence names them from `TRIBAL_TRAITS`. No list is hardcoded anywhere.
- [x] **`npm run gates` green.** 230 tests, from 218.
- [x] **Every new gate watched going red**, recorded in `docs/learning/gate-proofs.md` with the revision.
- [x] **Before and after measurements captured and explained**, not suppressed.
- [x] **Independent review of the engine changes.** Commissioned by the coordinator and run. It passed the resolver work — one mutation site, nothing announced by hand, board-index order gated, a queue and not a stack, no recursion, the act-case ordering right and gated, and the hash omission correct — and returned six findings about what was *not* gated. All six are closed below.
- [x] **Every review finding closed with a gate watched going red.** Six findings, six gates, eleven mutations, in `docs/learning/gate-proofs.md`.
- [ ] **Merged to main.** The worker was told to commit on its branch and not merge.

## Implementation steps

- [x] Read the design, the local rules and the engine; establish that Kindle does not exist.
- [x] Baseline `npm run gates` at `dcf2cdf` and capture both measurements.
- [x] `Entity.tribe`, `TribalTrait`, `TRIBAL_TRAITS`, `adjacentAllies`, `adjacentKinOf`, `MOST_ADJACENT` in `src/engine/state.ts`.
- [x] `tribePower` in the `Effect` union, the `act` spawn, the `apply` case, and Chorus in `triggersFor`.
- [x] Follow the compile errors: `TRAIT_TERMS`, `CARD_SIGIL_TERMS`, `CARD_SIGIL_VALUE`. Three icons.
- [x] Six cards, six blazon devices, eighteen reward-pool entries.
- [x] `projectOwnPhase` so the pre-commit forecast is not a wrong number; `attributeBuff` and the log line so a Chorus arrow is drawn and named.
- [x] `test/tribes.test.ts`; retire the race gate; strengthen the pool gate.
- [x] Verify visually: the icon sheet at 11/15/64px light and dark, the hover panel geometry through `npm run probe:ui hover`, a whole run through the DOM with `tools/ui-probe/run.ts`, and each tribal card's panel.
- [x] Mutation-test every new gate; record in `docs/learning/gate-proofs.md`.
- [x] `ARCHITECTURE.md`'s verb list; `docs/design/game.md`'s trait list and walked example; devlog.
- [x] Independent review, commissioned by the coordinator.
- [x] Close all six review findings, each with a gate watched going red; re-run `npm run gates` and diff `npm run verify` against the base.
- [ ] Merge. Coordinator's.

## Review round 1

An independent review of `8efbbb2` **passed the tribal work's core** — Chorus obeys the resolver contract (one mutation site, nothing announced by hand, board-index order gated, a queue and not a stack, no recursion), the act-case ordering is right and gated, and the hash omission survived a serious attack. It returned six findings, every one of them about a property that is *true in the shipped code and untested*. All six are closed on branch `worktree-agent-aacf45b44fe4cb1d7`, cut from `8efbbb2` with `main` at `5f51827` merged in so that `npm run gate:work-plans` is in the chain.

**F1 — a tripwire designed for exactly this event did not fire.** `src/engine/resolver.ts` said the shipped triggers all keyed on different events, so the inside-one-unit tie-break was unobservable; Chorus was added inside the same `afterActed` branch as Relay and made that sentence false in the same commit. It is reachable with shipped content, not hypothetically: `si_relay` grants Relay to a card that does not print it, and `u_songkeeper` and `u_elflord` print Chorus, so a run hands the engine a body carrying both. Moving the Chorus block above Relay's left all 230 tests green.

The comment is corrected, a fixture now pins the stream a body carrying both emits — `[right +2 Relay, left +2 Chorus, right +2 Chorus]` — and **the tripwire is replaced rather than repaired**, because the reason it failed is structural. It asserted that a hand-built body carrying `['relay', 'wake']` produced one effect per event. A third trait keyed to `afterActed` does not appear on that body, so its block never ran for that fixture and the assertion held. The test was never edited; it never could do what `ARCHITECTURE.md` claimed. A gate built from a hand-written list of the thing it checks can only see what somebody remembered to write into it. The replacement reads the `afterActed` branch off the AST and pins the trait names in order.

**F2 — the hero rule was gated in one direction only.** `src/engine/state.ts` claimed it held "both ways round" and `test/tribes.test.ts` said "both directions", but both meant the two polarities of the *count* — what a tribal trait sees when it looks at a hero. Nothing observed a hero's `bonusPower` after a Chorus fired beside it, which is `adjacentAllies`' `isHero` skip and a different function. Making Chorus grant to an adjacent living hero left all 230 tests green. It is the most ordinary board there is: the rightmost unit's right-hand neighbour is always the hero. Gated, and both overstated claims corrected.

**F3 — the one-comparison-site AST gate read a hardcoded list of six filenames.** Complete when written, silently incomplete on the seventh engine file: adding `src/engine/tribecheck.ts` containing the whole-board count the gate exists to forbid left `npm run gates` at exit 0. It now walks `src/engine/` with `tsFilesUnder`, asserts the walk found at least the six files that were there when it was written, and states this bound in its own header alongside the three it already named.

**F4 — two timing rules with no fixture.** `tribePower` is spawned once per act; moving `tribalOnAct` inside the swing loop gives a Volley body one count per swing and left all 230 tests green, because no fixture gave a tribal trait to a Volley body. Not reachable from shipped content — no tribal card prints Volley and no Volley card prints a tribal trait — so the fixture is written for the day a Volley sigil or a Volley tribal card lands. Its sibling: firing Chorus on `acted` instead of `afterActed` also left all 230 green, because death is the only board that separates them and every Chorus fixture was fought into a 0-Power Guard so that nothing in the line dies. A fragile Chorus body that dies to its own swing's retaliation now gates it, with a one-Health-more control so the fixture cannot pass on an engine where Chorus never fires.

**F5 — the design walk's running totals were unparsed prose.** The walks parse their *card* numbers through `stated()`, so a reworded stat line goes red; the step-by-step totals ("The wall is on 199", "on 198") were transcribed and never read, so changing 199 to 198 left the suite green and the document disagreeing with itself. Both are parsed now and bound twice: against the walk's own subtraction chain, and against the wall's Health after each step in the engine. The two are different bindings and neither covers the other, which is why both mutations are in the evidence.

**F6 — the hash omission rested on an ungated rule.** The review confirmed a race is recoverable from `cardId` on every path it could reach, so leaving `src/engine/hash.ts` alone is correct. That rests on `ARCHITECTURE.md`'s "changing a card's race mints a new id", which had no gate: changing `u_songkeeper` from elf to human with the id kept passed `npm run gates`, `verify` and `verify:run` while changing what Chorus does in every fight that card appears in. `RACE_OF` in `test/tribes.test.ts` writes out every shipped card's race, pinned rather than derived — derived it would be the same tautology `verify:run`'s sigil ledger was caught being in its first draft.

**Checks.** `npm run gates` green at 236 tests, from 230 at `8efbbb2`. Eleven mutations, all red for their own reason, in `docs/learning/gate-proofs.md`. `npm run verify` is byte-identical to `8efbbb2`'s apart from `Elapsed` — the same 66.25% against 56.50%, gap 9.75 pp — which is the evidence that this round is gates and comment text and nothing else. No dependency changed, so `npm run audit` was not re-run.

**Not done, and deliberately.** No balance number moved; new fixtures are not new content. Nothing under `src/run/`, `src/ui/`, `src/content/unlocks.ts` or `src/sim/runmeasure.ts` was touched, because another worker is live there. The corrected engine comments are text and were not re-reviewed independently.

**The rule behind F1 and F3, written down after the fact.** Both findings are one shape, and fixing the two instances left nothing that stops the third being written the same way. `docs/policies/local-rules.md` now carries **a gate whose subject is a list reads that list; it never restates it**, with both instances, their dates and `299fede` as the evidence, and a Bound saying that reading the subject is necessary rather than sufficient. Documentation only — no change under `src/`, `test/` or `tools/`, and `npm run gates` stayed at 236 tests.

That entry came with a read-only sweep for the same shape elsewhere, reported to the coordinator and **not fixed here**, because `src/run/`, `src/ui/` and `src/content/unlocks.ts` have a live worker in them. The two worth acting on first are both already stale rather than merely fragile: `src/sim/ablate.ts` still ablates `['relay', 'wake']` in two separate hand-written lists — `ABLATABLE` at line 49, which nothing reads, and `sets` at line 204, which is what the runner actually uses — so the instrument `AGENTS.md` advertises as "what each cascade trait is worth" measures two of the five traits that read a neighbour, the three added by this unit among the missing. And `tools/gates/work-plans.ts:418` enumerates its own four rules by hand inside `selfTest`, which is the loop whose only job is to prove each detector fires before the gate is trusted to report an absence.

## Outcome

Pending integration. Implemented and locally verified on branch `worktree-agent-a8d4d25fe3d5ac7c5`, cut from `dcf2cdf`; review round 1 closed on branch `worktree-agent-aacf45b44fe4cb1d7`, which carries `8efbbb2` and `main` at `5f51827`.

**Checks.** `npm run gates` green: typecheck, both AST gates, 230 tests (218 at the base), `npm run verify`, `npm run verify:run`. `npm audit --audit-level=high` clean — no dependency changed. Sixteen mutations, each applied to the shipped tree, run against the shipped command, reverted, and the bytes compared; all sixteen red for their own reason, in `docs/learning/gate-proofs.md`.

**Measurements.** `npm run verify` did not move at all: 66.25% optimal against 56.50% random, gap 9.75 pp (CI 5.61..13.89), identical to the base revision. That is the expected result and it is the check on the whole change — `PLAYER_DECK` is the measured deck, no tribal card is in it, and the engine addition is inert on a board with no tribal trait on it.

`npm run verify:run` moved, because six cards entered every class's reward table. Greedy route with search placement 88.00% → 89.00%; random route with search 54.50% → 49.50%; greedy with append-right 77.50% → 77.00%; random with append-right 36.50% → 32.50%, all at 200 seeds. **These are not the same runs with tribal cards added.** A `RunLog` is a list of indices into offers, so adding six pool entries makes seed *n* a different run from its first reward node onward; the arms are independent samples at the same seed labels, not a paired comparison. Re-measured at 1000 seeds on the new content, every arm's point estimate lies inside the base revision's own 200-seed interval: 88.80% (86.69..90.61), 49.40% (46.31..52.50), 75.10% (72.33..77.68), 32.60% (29.77..35.57). No arm moved outside the noise of the baseline.

The mechanism behind what movement there is, measured rather than guessed: a probe over 200 seeds a class (`runRun` through `makeRunAgent`, the same two entry points `runmeasure.ts` drives) found finished decks holding 0.43 tribal cards per run as a Knight, 0.77 as a Ranger, 0.35 as a Mage, out of 21–29 cards. So the cards themselves can barely be moving a win rate at that density; what moved is the *shelf*. `cardValue` in `src/sim/runbots.ts` cannot see a race, so the drafting bot values a Kindler as a 1/4 for 2 and prefers the 3-cost tribal bodies it can price — `u_marshal` and `u_runesmith` are the two most-drafted of the six. The pool got wider and the bot got no better at choosing from it. Per `docs/policies/local-rules.md` that is information about the bot, not an instruction to re-cost anything.

**Limitations, and what is not proven.**

- The run measurement is a **floor** for these cards, not a reading of them. The placement bot's rollouts go through the real resolver and so do exploit tribal adjacency; the drafting bot cannot see a race at all. A player who drafts toward a tribe is not modelled by any arm.
- The three walked examples are gated in both directions — the tests parse their numbers out of `docs/design/game.md` — but only the numbers those patterns capture. Prose around them can still drift.
- One design claim in `src/engine/resolver.ts` carries no gate and says so: that the kin count is read in `apply` rather than at the spawn site. `act` queues the effect immediately ahead of the swing, so no fixture can tell the two apart, and a mutation moving the count passes the whole suite. It is written on the general rule, not on evidence.
- The buff arrow for a card carrying two traits that could both have produced one blow — a Relay and a Chorus both reaching the right-hand neighbour, a Kindle and a Banner on one body — is `via: 'unknown'` rather than a guess. No shipped card carries such a pair. The clean fix remains one field: `sourceUid` on the `powerGained` event.
- `tools/ui-probe/` probes are outside `npm run gates`; both that touch the changed screens were re-run by hand, per `docs/policies/local-rules.md`.
