# Unlocks: what survives a run

Status: complete
Owner: coordinator
Created: 2026-09-11
Updated: 2026-09-11

## Problem and outcome

Nothing survived a run. Every run started from the identical pool and the end screen led nowhere, so the only thing a second run could differ in was its seed.

`docs/design/game.md`: "**Meta-progression is unlocks only.** Finishing runs adds cards and sigils to the pool. No persistent power, no hub to rebuild — every run is winnable from the first one."

The outcome: a profile that lives in the browser beside the saved run and records what the player has unlocked; run-scoped deeds that unlock cards and sigils; a draft pool that is the class pool intersected with what is unlocked, so a locked card is never offered; an end screen that says what the run added; and a collection screen that says what is held and what opens the rest. And the keystone invariant intact — a run still replays byte-for-byte from its seed and choice list, with the unlock set now recorded as one of its inputs.

## Scope

**Included.** `src/run/unlocks.ts` (the filter, the achievement predicates, the unlock-set parser), `src/content/unlocks.ts` (which ids are gated and what opens them), the unlock set as a run input threaded through `startRun`, `runRun`, `replayRun`, `RunLog`, `RunState` and `hashRun`, `src/ui/profile.ts` (`localStorage`, beside `cards.run.<seed>`), `src/ui/unlocks.ts` (the collection and the end-screen block), the wiring in `src/ui/runapp.ts` and `src/ui/run.ts`, a `--unlocks` arm on `npm run measure:run`, `test/unlocks.test.ts`, and the two browser probes that navigate to the screens this touched.

**Excluded.** No balance change: no cost, stat, pool weight or class number moved. No edit to `docs/design/game.md` or `ARCHITECTURE.md`. No edit to `src/content/cards.ts`, `src/engine/` or `src/render/glossary.ts`, which unit 11 owned this round. `npm run verify` and `npm run verify:run` were left alone, and their reported numbers are byte-identical to the base revision.

**Dependencies.** Unit 9's rule in `docs/policies/local-rules.md` — *a saved log is a list of indices into offers, so content retires it, not just format* — is what decided the replay design. Unit 10's `classId` is the precedent the unlock set follows.

## Approach

**An unlock set is an input to a run, in the same sense the class is.** `startRun` takes it, narrows the content once through `unlockedContent` before the class is read out, and stores it on `RunState`; nothing inside the run loop knows unlocks exist. `runRun` writes it into the log; `replayRun` reads it **from the log and nowhere else**. A run's set is fixed at its first node: finishing a run widens the next one, never the one being played.

The set carries **both** halves — what was gated and what was owned — rather than the owned half alone. With only the owned half, narrowing an old log would need today's gated list, and adding a card to that list would silently retire every log written before it. The pair fully describes the filter, so a log survives a content change that adds or removes gated content.

`hashRun` appends the `unlocked=` clause **only when the run had a set**. A run with no unlock layer — every measurement, every fixture, every log written before unlocks existed — canonicalises to exactly the string it did, so no recorded run hash moved. The clause is in the digest at all because two runs that drafted from different pools are different runs even where their states coincide: a run that declines every reward reaches the same deck, gold and generator position whatever was on the shelf.

**Rejected: resolved card ids in the log.** The other option in the brief. It is a format change, it does not help — a reward pick still has to *be on the shelf* the replay redraws — and it would have retired the two golden format 1 logs to fix a problem those logs do not have.

**What is gated.** Seven cards and one card sigil. The rule that chose them: a card in no class's starting deck, weighted 5 or lower by every class that lists it. So a fresh profile is missing the tail of each pool rather than its middle, and nothing a run is handed on turn one is ever absent. No hero sigil is gated: a hero sigil offer draws 2 distinct from the 3 that exist, so gating one would leave the first offer with no decision in it.

**Five deeds**, four reading the run's depth and one reading what the player did, each a pure function of the finished `RunState`.

## Acceptance criteria

- [x] A persistent unlock record in the browser, beside the run save. `cards.profile` next to `cards.run.<seed>`, same guards. Checked by `test/unlocks.test.ts` for the pure half and by `node tools/ui-probe/run.ts 7 light knight fresh` for the storage round trip through the browser's own controls.
- [x] Unlock triggers, kept small. Five deeds in `src/content/unlocks.ts`. Four fire over the 12-seed window in `test/unlocks.test.ts`; the fifth is exercised against a state built for it, so "did not fire" cannot read as "passed".
- [x] The draft pool is the class pool intersected with what is unlocked, and a locked card is never offered. Gated by *a locked card is never offered and a locked sigil is never granted* over 12 seeds × 2 route styles plus every act-1 node's shelf and shop, with the unnarrowed arm asserted to draft gated content so the check cannot pass on emptiness.
- [x] An end-of-run screen saying what was unlocked, and somewhere to see what is held. `runUnlocksHtml` and `collectionHtml`; shot at `.probe-ui/run-7-knight-light/end-won.png` and `.probe-ui/pick-7-light/collection-panel.png`.
- [x] A run still replays byte-for-byte from its seed and choice list. Gated by *a run replays from the unlock set in its log, not from what is unlocked now*, and by the browser probe: the run played through the DOM at a fresh profile hashes `623b19a4b43f8177`, identical to the headless run and the mirror.
- [x] A golden run-log from before the change still replays, or fails loudly naming why. It still replays: gated by *a golden log from before unlocks replays untouched, and names no unlock set*, which re-reaches `f5abcf3d2118a2b9` and `94ff2460abecaf26`.
- [x] No persistent power, expressed as a gate. *narrowing a content touches the reward tables and the sigils and nothing else* walks `Object.keys(RUN_CONTENT)` off the object, so every field an unlock could move is inside the claim. *widening only ever adds rows, and never edits one* holds the ladder of reachable sets to weight-preserving subsequences.
- [x] `npm run gates` green, and every gate watched going red. 237 tests, exit 0. Sixteen mutations in `docs/learning/gate-proofs.md`.
- [x] `verify` and `verify:run` content-identical. Diffed against the base run: the only differences are the file counts the two AST gates report, the test total, and one added line naming which pool `measure:run` measured.

## Implementation steps

- [x] Read the run layer, the UI controller and unit 9's log rule; settle the replay design before writing anything.
- [x] `src/run/unlocks.ts` and `src/run/types.ts`: the `UnlockSet`, the filter, the achievement predicates, the strict parser.
- [x] `src/content/unlocks.ts`: the gated ids, the five deeds, and the module-load checks that hold both to the class pools.
- [x] Thread the set through `startRun`, `runRun`, `replayRun`, `migrateRunLog`, `RunLog`, `RunState` and `runToCanonical`.
- [x] `src/ui/profile.ts`, `src/ui/unlocks.ts`, and the wiring in `runapp.ts` and `run.ts`; CSS for the two panels.
- [x] `--unlocks all|none` on `npm run measure:run`, and measure the fresh-profile question with it.
- [x] `test/unlocks.test.ts`: 19 tests.
- [x] Re-run both browser probes that navigate to the screens this touched, per `docs/policies/local-rules.md`; add a locked-collection shot to `pick.ts` and a `fresh` arm to `run.ts`.
- [x] Sixteen mutations, each watched going red, with a runner whose own crash guard is probed before it is believed.

## Outcome

Complete on branch `worktree-agent-a1d38fd64b9b07e60`, cut from `dcf2cdf`. Not merged; the coordinator owns integration.

**Checks.** `npm run gates` exit 0, **237 tests** (218 at the base). `npm run audit` 0 vulnerabilities, on an unchanged lockfile. `node .probe/mutate-unlocks.mjs`: 16 of 16 red for their own reason, with the runner's own probe unconfirmed as it must be. `node tools/ui-probe/pick.ts 7 light` and `node tools/ui-probe/run.ts 7 light knight` and `… knight fresh` all pass against Chrome; screenshots under the ignored `.probe-ui/`.

**What the measurement says about "winnable from the first one".** `npm run measure:run -- --seeds 200` at both arms, the tree held still between them:

| arm | `--unlocks all` | `--unlocks none` (a fresh profile) |
|---|---|---|
| greedy route / search placement | 176/200 won (88.00%) | 149/200 won (74.50%) |
| random route / search placement | 109/200 (54.50%) | 103/200 (51.50%) |
| greedy route / right placement | 155/200 (77.50%) | 118/200 (59.00%) |
| random route / right placement | 73/200 (36.50%) | 56/200 (28.00%) |

Act 1 clears 200/200 in both. A first run is measurably harder for the bot and is plainly winnable at its level. **The bound**: a bot's run win rate is evidence about the bot, not about a person, and this is the Knight on 200 contiguous seeds. It is an instrument reading, deliberately not a gate — a band around a run win rate goes red on a content change that improved the game.

**Fixed in passing.** The HUD's `[data-run]` buttons were never wired: the header lives outside `#run` and the click listener was on `#run` alone, so Restart has been dead since unit 8. The Collection button would have been dead the same way. The listener is now attached to the HUD as well, and both were exercised in the browser.

**Open for the coordinator.**

1. `README.md`'s "what is still missing" line lost the word *unlocks*. It still names "races as mechanical tribes", which unit 11 owns this round — expect a one-line conflict there.
2. `?unlocks=all|none` is a new address-bar switch, in the style of `?seed=` and `?class=`. It never writes the profile. `AGENTS.md` does not enumerate app parameters, so nothing there is stale, but it is worth a line in the Gates section if the coordinator wants the `--unlocks` arm of `measure:run` written down.
3. `npm run verify:run` still gates nine things, not ten. The unlock invariants are in `npm test` instead, which is inside `npm run gates` either way. Adding a tenth would make `AGENTS.md`'s Gates section stale, and that file is a review-escalating change this unit was told not to make.
4. Unreviewed. No independent review was obtained; the save/replay format is a locally high-risk area under `AGENTS.md`, so one is warranted before merge.
