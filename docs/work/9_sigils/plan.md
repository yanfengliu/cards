# Sigils: the run-long progression layer

Status: complete
Owner: coordinator
Created: 2026-09-10
Updated: 2026-09-10

## Problem and outcome

`docs/design/game.md` calls sigils "the run's progression system" and gives them two targets: a sigil on a card grants it a trait, a sigil on the hero applies to the whole run. Relics went here rather than into a second system.

Unit 5 left an inert seam for all of it — a `RunState.sigils` ledger that stayed empty, a run hash that covered it, and a `verify:run` check that failed if anything ever filled it. The outcome of this unit is that the seam is live: sigils are offered, taken, attached, hashed, replayed and drawn, the inert check is replaced by a live one, and nothing under `src/engine/` changed.

## What was inherited, and from whom

Three trees, and only the third was ever run.

**`worktree-agent-ad9313118b65ea59d` at `c67e92f`** — the original build, killed by a rate limit. It wrote `src/content/sigils.ts`, `src/run/sigils.ts`, `src/ui/sigils.ts`, `src/render/sigil-terms.ts`, `test/sigils.test.ts` and the edits to `src/run/deck.ts` and `nodes.ts`. It **also changed the engine**: `SideRules` on `Entity` and `HeroSpec` in `state.ts`, a `sideRulesOf` reader in `resolver.ts`, and a `rules(...)` clause in `hash.ts`, so that a hero sigil could bend `RELAY_POWER` and `WAKE_POWER` for one side.

**`worktree-agent-a63625c20e9925af7` at `802dae5`** — a finisher, also killed by a rate limit. It merged the above and **took the engine change back out**, replacing the rule-bending hero sigils with three that move numbers the run already owns: `maxHealth`, `heroPower`, `heroArmour`. It added the log-format migration, `migrateRunLog`, and the two golden format 1 logs under `test/golden/`. Its tree does not typecheck: the revert left `src/ui/app.ts`, `src/ui/runapp.ts` and the whole of `test/sigils.test.ts` still calling the API it had deleted.

**This unit** merged `802dae5` onto `a974d04` (nine conflicts, all in files unit 10 had also touched), finished the revert, and did the work below.

## Scope

In: sigils as a run-long progression layer — card sigils that grant a trait, hero sigils that bend the run, the offers that grant them, their place in the choice log and the run hash, and the screens that show them.

Out: any engine knowledge of what a sigil is (applied at pool resolution, like a forge upgrade); sigils for `volley` and `scorch`, whose words exist through a `Record<Trait, Term>` totality check but whose content does not; and any balance change, which `docs/policies/local-rules.md` forbids.

Dependencies: unit 10 (classes) merged first, at `a974d04`, because both lanes' predecessors had edited each other's files.

## Approach

A sigil is applied at pool resolution in `src/run/`, exactly the way a forge upgrade already is.

- A **card sigil** is the trait's own word merged into one deck instance by `resolveDeckCard`. `runPool` hands `makeUnit` an ordinary `UnitCard`, and the resolver cannot tell a sigil-granted Relay from a printed one — `test/sigils.test.ts` fights both and compares the events.
- A **hero sigil** is a number on the `HeroSpec` the run already hands in (`heroSpecFor`), or the run's own Health bar (`maxHealth`, applied at the moment it is taken so the reward is felt at the boss it was won from).
- **Where a trait came from** is a run-layer question, so it never touches the engine's card. `src/render/view.ts` takes a `SigilTraitsOf` callback and the run answers it; the pip, the hover panel and the deck grid read that.
- **Offers are node-keyed**, drawn from `mixSeeds(runSeed, act, nodeId, tag)` and not from the run stream. That is what makes a log recorded before sigils existed still index the shelves it indexed, so `migrateRunLog` has only a decline to insert per won elite or boss.

## Decisions this unit made

**The engine change is not required, and it is out.** Every shipped sigil reaches the fight through a seam `src/engine/` already had. The predecessor's `SideRules` was needed only for hero sigils that bend a resolver constant for one side — "Relay hands +3 on your line" — and no such sigil ships. `src/content/sigils.ts` records what that would cost, so it is not re-added as a data row by someone who does not know.

**`CARD_SIGIL_TERMS` stays keyed by the engine's `Trait` union**, so a trait added to the engine cannot ship without sigil words. Unit 10's `volley` and `scorch` therefore have words here and no sigil in `CARD_SIGILS`: the table is the vocabulary, the content file is the shipped pool, and whether to offer either is a content decision nobody has made. Same for `CARD_SIGIL_VALUE` in `src/sim/runbots.ts`.

**The `verify:run` sigil check is two comparisons, not one.** `sigilProblems` holds the ledger to the deck. `fightSigilProblems` holds the ledger to the `CardPool` and `HeroSpec` the run hands the engine. The first draft of the second one derived its expected value from `grantedTraits` and `heldHeroSigils` — the same helpers the subject side is built from — so it proved only that the code agreed with itself. It now re-reads `run.sigils` and `content.sigils` with its own loop.

**The two golden logs were retired by unit 10, not by unit 9.** Replayed against today's `RUN_CONTENT` they throw: the Knight's reward table is not the `REWARD_TABLE` they were recorded against, so every `reward` pick in them names a different card. Pinning that one table brings them back to life, and they then replay to a byte-identical **pre-class** canonical string — unit 10's `class=` line is the only difference, which `test/classes.test.ts` already documents as deliberate. That pin is a standing cost and the test says so.

## Acceptance criteria

- [x] `npm run gates` green — 218 tests, up from 199 on `a974d04`.
- [x] `verify:run` check 7 is a live check: a granted sigil is in the pool the next fight resolves, and one that was never granted is not. Proved red by four mutations (M1, M2, M3 and the deck/ledger drift arms).
- [x] `replayRun` reproduces a run that acquired sigils byte-for-byte, with the card a sigil went on in the choice log (`{kind: 'attach', deckIndex}`) and in the hash (`deck=[...~fx_relay=relay...]`, `sigils=[t_grunt#0:fx_relay]`).
- [x] `hashRun` covers sigils: the per-instance list, the ledger, and the order they were taken in.
- [x] The engine is unchanged. `git diff a974d04 -- src/engine/` is empty.
- [x] UI: the reward shelf offers a card sigil, a won elite or boss offers hero sigils, the attach screen lists the deck with reasons, and both the card panel and the hero panel name them in words derived from the type system. Shot in both themes through `tools/ui-probe/run.ts`.
- [x] Red-proofs: ten mutations in `docs/learning/gate-proofs.md`.

## Implementation steps

- [x] Merge both predecessors' preserved trees (`c67e92f`, `802dae5`) onto the merged classes engine.
- [x] Card sigils (`si_relay`, `si_wake`, `si_guard`) and hero sigils (`si_oak`, `si_lance`, `si_bulwark`), applied at pool resolution so the engine stays ignorant of them.
- [x] Grants recorded in the choice log as `{kind:'attach', deckIndex}` and covered by `hashRun`, so `replayRun` reproduces a sigil run byte-for-byte.
- [x] Replace `runmeasure.ts`'s "sigils are out of scope" check with two real comparisons — ledger against deck, and ledger against the pool the engine is actually handed.
- [x] Reward shelf, attach screen, and sigils listed in plain words on the card and hero panels, derived from the type system rather than hardcoded.
- [x] Eleven red-proofs recorded in `docs/learning/gate-proofs.md`.

## Outcome

Verified at the branch head of `worktree-agent-a8f54ea252ca36f0b`. `npm run gates` exits 0; all four UI probes run clean, and `tools/ui-probe/run.ts 16 <theme> knight` reports the page, the headless run and the controller mirror at one hash.

**Open, and for the owner rather than for this unit.** Sigils move the run's difficulty a long way. Measured with `runArm` over seeds 1..200, the strongest arm (greedy route, search placement) wins **31/200 with the sigils stripped and 176/200 with them in** — 15.5% to 88.0%. Act 3 clears at 15.5% against 88.0%. The stripped arm is what `a974d04` measures, because a sigil offer takes no run draw and the bots' random choices are derived per decision rather than from a shared stream. `verify:run` deliberately does not band a win rate, so it stays green; `docs/policies/local-rules.md` forbids tuning content toward a shape, so nothing here was re-costed. The numbers are the report.

Two smaller questions left open: whether a Volley or Scorch sigil should be offered at all, and whether three hero sigils against `heroSigilOffers: 2` is the right ratio — the greedy arm holds 2.93 of the 3 by the end of a run, so the choice mostly resolves itself.
