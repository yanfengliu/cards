# Races become mechanical tribes

Status: active
Owner: coordinator
Created: 2026-09-11
Updated: 2026-09-11

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
- [ ] **Independent review of the engine changes.** Not run by the worker, per the assignment. Every resolver change is listed in the handoff for the coordinator to commission.
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
- [ ] Independent review, then merge. Coordinator's.

## Outcome

Pending integration. Implemented and locally verified on branch `worktree-agent-a8d4d25fe3d5ac7c5`, cut from `dcf2cdf`.

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
