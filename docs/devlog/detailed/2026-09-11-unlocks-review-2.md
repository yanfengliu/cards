# 2026-09-11 — a second review of the unlock layer

Branch `worktree-agent-ac7c36708d963e2ab`, cut from `d59a8cb` with `main` at `308d91c` merged in. Eight findings from an independent review, every one confirmed by reproduction before it was fixed. 276 tests, from 248 at the base and 273 at the merge.

The review **passed** what mattered most, and none of it was redone: `canonicalUnlockSet` closes the live-vs-replay hash split at every entry point, `migrateRunLog`'s refusal is reachable and well worded, `storageAllowed` survives a browser attack end to end, and `ATTRIB` genuinely reproduces the old runner's failure on both reporters.

## The gate that was aimed at an idiom this repo never writes

`tools/gates/boundaries.ts` guarded its DOM and storage checks with `!isNameSlot(node)`. `isNameSlot` returns true for the `.name` of a `PropertyAccessExpression` — which is right for `someObject.document` and catastrophic for `globalThis.document`, because the TypeScript checker resolves the second to exactly the symbol the bare identifier resolves to.

Every storage access in this codebase is written through the global object. `src/ui/profile.ts:199,225`, `src/ui/runapp.ts:128,137,146`, `tools/ui-probe/run.ts:152,200,278`. **There is not one bare `localStorage` under `src/`.** So the storage half of that gate could not see a single real storage access, and the DOM half had the same hole.

What makes this worth a section rather than a line is how it stayed hidden. The gate's own instrument check — the thing that exists so "did not run" cannot come back as "passed" — emitted `export const probeStore0: unknown = localStorage;`. Bare identifiers. And the recorded red-proof N13 used the bare form as well. The detector, the self-check that blesses the detector, and the evidence file that records the blessing were all written in the same spelling, and it was not the spelling the code uses. Three independent-looking things agreeing, none of them touching real code.

Reproduced at the base revision: `globalThis.localStorage?.getItem(\`b\`)` in `src/run/run.ts` passed `gate:boundaries`, `tsc` and `gate:banned-apis`, and `gate:boundaries` printed that the file referenced *none* of `localStorage, sessionStorage, indexedDB`. The controls were live the whole time — bare `localStorage` exited 1, `document.title` exited 1 — which is the mechanism, not a footnote: everything anyone thought to test was written in the one spelling the code does not use.

The detector now reads a global bare, through the global object (`globalThis.x`, `window.x`, `self.x`, and chains) and through a string index on it. For the index form the checker carries the symbol on the **argument** — `globalThis['document']` as a whole resolves to nothing — which a probe established before the gate was built on it. The storage half goes further and matches by name wherever the name is *read*, whatever the base, so an alias (`const g = globalThis; g.localStorage`) cannot get past it; the DOM half cannot do that, because it asks the checker and the checker resolves `someElement.title` into `lib.dom` just as readily, so it tests the base and misses an aliased DOM global. That asymmetry is in the file's header rather than left to be rediscovered.

The probe was rebuilt around a different idea: fifteen global spellings, each on its own line, each required to fire **on that line**. The old probe asked "did anything fire for `localStorage`?" and one bare line answered for every spelling at once. Reintroducing the exemption now exits 2 and names the seven shapes that went silent.

## "No persistent power" had moved its boundary, and the escape moved with it

Two walks guarded the rule. One covers `unlockedContent`'s output; one covers `startRun`'s returned `RunState` with `MAY_DIFFER = {content, unlocked}`. `contentForClass` sits between them, and `RunState` copies only `hero`, `startingGold`, `mapShape` and `startingDeck` out of `RunContent`'s eighteen fields. Everything else a run obeys — `restHealFraction`, `shopBasePrice`, `maxRounds`, `rewardOffers`, `cardSigilChance` — reaches it through `run.content`, and `content` was skipped wholesale.

Both reproductions were **273/273 green**: `restHealFraction + 0.25` while anything is still locked, and `shopBasePrice: 0` with `maxRounds + 5`. Both are literally what the walk's own failure message forbids — *"An unlock adds rows to a draw table; it may not move a number, a card or a map."*

The walk covers `run.content` now, excepting `rewards`, `sigils` and `classes[].rewards` — which is not a new list but exactly what the sibling walk already enumerates as what `unlockedContent` may touch.

**A method note that cost nothing and could have cost the finding.** The first draft of the `restHealFraction` mutation was conditioned on a flag that was always `null`, so it added zero. It compiled, it applied, it passed 273/273 — and a no-op reproduction is indistinguishable from a real one in a summary line. What caught it was reading the condition rather than the result. The runner now refuses a replacement that changes nothing, which catches the mechanical version of this; it cannot catch a mutation that changes text and means nothing.

## A mutation runner that could refuse but could not agree

`SELF` (a mutation that cannot compile) and `ATTRIB` (a real mutation under the name of a test it does not break) were the runner's two self-probes. Both assert that the runner **refuses** to credit something. Nothing asserted it could ever credit anything.

Blank `failingLines(out)` to `return []` and both still report "came back unconfirmed, as they must". Every mutation reports unconfirmed. The summary reads `0 of 2 came back red`. The process exits **0**. A completely blinded attribution detector passes the runner's own guard, and the runner then reports on gates.

The third probe, `POSITIVE`, is `ATTRIB`'s mutation under the name of a test it *does* break, required to come back RED before any summary prints. Using the same mutation for both is the point: together they prove the runner is reading the name and not the exit status, which is the defect both exist for. Re-blinded, `POSITIVE` is the only probe that fails and the runner exits 2.

One repair came out of the runner's own output. Its crash guard fired whenever a *failing* run's output held a word like `TypeError` — which an assertion diff is full of — so `ATTRIB` was reported as a crash rather than as an unattributed red: the right verdict for the wrong reason, which is a worse state than a wrong verdict because nothing looks off. A run whose reporter marked tests failed did not crash; it ran and failed checks. `CRASHED` now also requires that nothing was marked failed.

## Two things a player could see and was not told

`parseSavedRun` returned `null` for "nothing stored" and for "stored, and this build refused it" alike. So `opened` stayed `'fresh'`, the notice bar said nothing, and `migrateRunLog`'s carefully worded refusals — which name the format, the seed and what to do next — reached the console and never the player, whose run had just disappeared. The unreadable blob also stayed in storage, to be refused again on every reload until a new run overwrote it.

`readSavedRun` keeps the reason. The notice bar says it, and the blob is cleared. Checked in a browser: planting `{"seed":7,"format":99,...}` and reloading now reads *"The saved run on seed 7 could not be read and has been discarded. Reason: written in format 99, and this code reads formats 1 and 2. …"*, and `localStorage.getItem('cards.run.7')` comes back `null`.

The first draft of that sentence spliced the refusal into a lead — `said.replace(/^run log: /, 'The saved run ')` — and produced *"The saved run written in format 99"*. It passed its own test, because the test asked whether the format was named and not whether the sentence parsed. It was the screenshot that caught it. The refusal gets its own clause now: its three shapes begin "written in", "not a run log" and "the format 1 log", and no one connective fits all three.

`profileNotice()` said *"nothing this run earns is saved to your profile"*. But `storageAllowed` is false for the whole pinned session, so the **run** is not saved either: `?unlocks=all`, twenty minutes, a reload, and it is gone — having been warned about the wrong thing. The sentence is `pinnedNotice`, pure and exported for the same reason `PICKABLE_CLASSES` is, and gated; the notice bar says it on the first screen rather than only on the collection screen.

## The wiring gate, and the rule it broke in one half of one file

`wiringOf` recognised `dom.<key>.innerHTML = …` and nothing else. Route a panel's write through a two-line local helper and remove its listener, and it passed 2/2 with a dead button — and `src/ui/sigils.ts` already exports `attachHtml`, so a helper-shaped refactor was not hypothetical.

The sharper half: it **restated** its file list (`src/ui/runapp.ts`) in the test body, while the escaper half of the same file walked `src/` off the filesystem. *A gate whose subject is a list reads that list, it never restates it* landed in `docs/policies/local-rules.md` in `299fede` — four commits before this file was written.

The subject is discovered now: every file under `src/ui/` holding a `dom` map. `src/ui/app.ts` is excused **by name, with the reason**, and a file in neither list goes red.

Why app.ts is excused rather than covered is worth recording, because the obvious widening is a trap. It reaches its controls through `wireInput(document.body, …)`. Treating a click listener on `document.body` as covering everything would bring it in — and `runapp.ts` **also** attaches one, a narrow filter for the theme and hatch buttons that is not a delegation root. That rule would have made this gate pass an app whose every panel was dead. Being honest about the bound beat widening it wrongly.

## Smaller

The "no second escaper" check was `.includes("'&amp;'")` — a single-quoted substring search, in a repo with no formatter to make quote style mean anything. A second escaper written with double quotes was invisible, and the reviewer reintroduced the original `>` → `&quot;` defect that way and it passed 2/2. It reads string literals off the AST now, so quote style is irrelevant, and it counts a file writing **any** HTML entity as an escaper. That threshold is not a guess: exactly one file under `src/` writes an entity at all, which also means a partial escaper handling `<` and `>` and never `&` is caught.

`parseUnlockSet` ran before the unknown-format refusal, so a format-99 log carrying a malformed set was refused for the set and never named the format — the one fact the player needs about a log this build was never going to read. The format is read first.

The `persist` threading was prose: nothing checked that every call site passed it rather than `true`. `test/ui-markup.test.ts` already read that file as an AST, so the check had a home. The list of storage functions is derived — a function whose **last parameter is `persist`** — so a fourth written tomorrow is in the gate the day it exists.

## Numbers

276 tests, from 248 at `d59a8cb` and 273 at the merge with main. Fifteen mutations, all fifteen red for their own reason, in `docs/learning/gate-proofs.md`. `npm run verify` and `npm run verify:run` differ from the merge revision only in their `Elapsed` line — every measured number unmoved, which is what "no balance changes" has to mean.
