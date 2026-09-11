# 2026-09-11 — closing an independent review of the unlock layer

Branch `worktree-agent-a6980105037cf39af`, cut from `cf2092f` (unit 12). What a later session could trip over.

## What the review did not find, and why that matters

It attacked the keystone — "`replayRun` reads the unlock set out of the log and nowhere else" — and could not break it. Making `isUnlocked` narrow by a live list instead of by the log's own half goes red. The deeds are pure functions of the finished run. The two golden format 1 logs reproduce. So the thing unit 12 was most worried about was the thing that held.

Everything it *did* find was a gate hole: a defect-shaped mutation that survived all 237 tests. Three of them share one shape, and it is the shape to look for next time.

## The three shapes

**A window that cannot distinguish the defect from the truth.** Every replay assertion in `test/unlocks.test.ts` ran at `owned: []`. A `startRun` that records `{gated, owned: []}` while still narrowing by the real set is *correct* at a fresh profile — so at that window the mutation and the fix are the same program. The reviewer's ladder probe put six unlock sets against twelve seeds and **48 of 72 runs stopped replaying with nothing going red**. The half-unlocked profile is the ordinary case for a real player and was the one case nothing covered.

**A claim bounded by a function rather than by the rule.** "No persistent power" was gated by walking `Object.keys(RUN_CONTENT)` over `unlockedContent`'s output — a good gate, and it stops where that function stops. A starting-gold catch-up bonus scaled by how much is still locked, one frame up in `startRun`, is outside it and was green. The equivalent on `maxHealth` was caught, but by accident: the hero's bar happens to be compared elsewhere.

**One direction of a two-directional claim.** Every narrowing check asked whether the filter let too much through. Dropping the first *ungated* card whenever anything is locked, and dropping an ungated sigil, were both green — and that is the direction "every run is winnable from the first one" actually cares about.

## The latent one nothing shipped could reach

`UnlockSet` is a bare structural type: two readonly string lists. `makeUnlockSet` sorts and dedupes, and `src/run/types.ts` documents the set as canonical — but nothing forced a caller through it, and `startRun` stored what it was handed. `replayRun` reads its set through `parseUnlockSet`, which always canonicalises. So a run started from an unsorted list hashed differently from its own replay while being, draw for draw, the same run.

Measured at `cf2092f`, seed 7, `owned: [u_captain, u_sentinel]`:

| set | live | replay |
|---|---|---|
| canonical | `7898f6b3167f47f3` | `7898f6b3167f47f3` |
| reversed gated | `66a15e37743ca569` | `7898f6b3167f47f3` |
| duplicate in owned | `f8d0ba432a63b7a2` | `7898f6b3167f47f3` |
| unsorted owned | `174d5b7b9185bbee` | `7898f6b3167f47f3` |

No shipped caller reaches it — `FRESH_UNLOCKS`, `ALL_UNLOCKS`, `unlocksFor` and `parseUnlockSet` all go through `makeUnlockSet`. That is exactly why it was worth fixing: the next caller is the one that does not.

`startRun` now funnels every set through `canonicalUnlockSet`. One thing this broke on the way, and it is worth knowing about: `createRunController`'s refusal guard compared `options.unlocked` **raw** against the log's canonicalised set, so once the canonicalisation existed the guard refused a resume on list order alone. It compares the canonicalised value now.

## `?unlocks=` leaked across exactly one reload

`unlockSetFrom('all', …)` returns `null` — no unlock layer — which is the right answer and is also indistinguishable, in a saved log, from a run written before unlocks existed. So the pinned run's save carried no `unlocked` field; a reload without the parameter resumed it (the log decides, correctly); and with no override in the address that time, `profileWritable` was true and the run wrote its deeds into the player's collection. The comment saying `?unlocks=` "never writes the profile" was false across one save/reload.

The fix is a different rule, not a patched one: **a pinned session touches no stored state**. `storageAllowed(override)` decides once and `loadSavedRun`, `saveRun` and `forgetRun` all take it. The third is the one that is easy to miss — without it, opening `?seed=7&unlocks=all` would `forget()` the real run in progress on seed 7.

A pinned run therefore does not survive a reload. That is the point of a debug pin and is now said out loud.

### Why the refusal guard is not on the app's path

`createRunController` refuses to resume a log against a set the caller names that is not the log's. `runapp.ts` never passes `unlocked` when it resumes, so in the app that guard is unreachable — and it should stay that way. A player who unlocks something on another seed and comes back to this one is the ordinary case, not an error. Handing the guard today's profile would refuse, and the app's `catch` around the resume would then `forget()` a perfectly good run. The log's set wins; the guard stays a contract for a caller that insists. Both halves are gated now.

## Eight escapers, seven right

`esc()` in `src/ui/runapp.ts` mapped `>` to `&quot;`. It was one of eight hand-copied five-line escapers under `src/` — four in `src/render/`, four in `src/ui/` — and the other seven were correct. **Nothing was wrong on screen**: no card name, no node line, no event label and no encounter name in the shipped content contains a `>`, checked rather than assumed. It would have gone wrong the first time one did.

There is one now, `src/render/escape.ts`, and the gate holds `src/` to having no second copy of it, so a ninth cannot appear and drift.

## A save from a unit 8 build was read and then thrown away

`loadSaved` parsed the stored JSON and handed it straight to `createRunController`. A log written before unit 9 has no `format` field, `replayRun` refuses anything but the current format, the caller caught the refusal and `forget()`-ed the run. `migrateRunLog` — the upgrade path that exists for exactly this — had no caller here. Pre-existing since unit 9, and squarely inside the save/replay contract.

Reproduced in a browser with a format 1 log recorded against today's content:

```
cards: the saved run did not replay and was discarded Error: run replay: this log was
written in format 1 and this code replays format 2. Upgrade it with migrateRunLog first…
```

After the fix, the same blob resumes onto the map, two nodes in, with the ordinary notice. `parseSavedRun` is split out of `loadSaved` so `node --test` can reach the shape checks, the migration and the refusal without a browser.

The opposite case is now refused: a format 1 log **naming** an unlock set is one no version of this code wrote — unlocks landed with the format already at 2 — and honouring it would narrow shelves the recorded picks were taken from with nothing gated.

## The mutation runner reported a red it had not measured

`.probe/mutate-unlocks.mjs` did `const named = out.includes(m.expect)`. `node --test` prints `✔ <name>` for a **passing** test, so a passing test satisfied the check and the evidence line the runner printed quoted that passing line. The reviewer demonstrated it: a mutation whose named gate passed while a different test failed came back RED.

Unit 12's sixteen recorded entries are sound — the reviewer re-ran all sixteen against a green baseline with strict attribution and got 16/16 — but the instrument was wrong and the next unit would have inherited it. This is the second flawed mutation runner in three units.

`.probe/mutate.mjs` closes it two ways, and the second is the general one:

1. The command runs with `--test-reporter=tap` and the expected text must appear on a line the reporter marked failed — `not ok N - <name>`. A passing line can no longer satisfy it.
2. **Every distinct command is run once on the unmutated tree first.** It must exit 0, and its output is kept; a mutation's expected text must be absent from that green baseline. This works for a gate and a simulation as well as for a test file, where there are no test names to attribute to.

Fix 2 immediately repaired something fix 1 did not: the crash guard was firing on every mutation, because `test/unlocks.test.ts` logs an expected `SyntaxError` from a deliberately unreadable saved run and the guard matched it. Crash strings the green baseline also printed do not count.

There are now **two** self-probes and both must come back `NON-ZERO, REASON UNCONFIRMED`: `SELF`, a mutation that cannot compile, and `ATTRIB`, a real compiling mutation paired with the name of a test it does **not** break — the old runner's exact failure, kept live so the fix is itself checked on every run.

## A rule that was false, caught by the gate's own probe

Extending `gate:boundaries` to forbid `src/run/` from reading browser storage looked like one line: `localStorage` is a `lib.dom` global and the gate already flags identifiers whose declarations are all in `lib.dom`. The probe said otherwise on the first run — `it tripped 0 and 0`. `@types/node/web-globals/storage.d.ts` declares `localStorage` too, so it is not DOM-only and the checker rule can never see it, the same way it deliberately does not see `console` or `fetch`.

`localStorage` and `sessionStorage` are therefore banned by **name**; `indexedDB` is DOM-only and the checker catches it. Each is proved to fire on the probe every run, and the probe check counts either half as having fired, because which one catches a given global is a fact about the type declarations rather than about the rule.

## Numbers

- 237 tests at `cf2092f` → **248**. Nine new in `test/unlocks.test.ts`, two in the new `test/ui-markup.test.ts`.
- `npm run verify`: byte-identical to `cf2092f` apart from `Elapsed`. Same 9.75 pp gap.
- `npm run verify:run`: identical apart from `Elapsed` and one added instrument-check line. Every measured number unmoved — 176/200, 109/200, 155/200, 73/200; act maps 60; shared fight seeds 156/156.
- The new `verify:run` line: 60 runs across 20 seeds × 3 unlock sets, 20/20 seeds reaching a different run at a different set.
- `node .probe/mutate.mjs`: 16 of 16 red, both self-probes unconfirmed.
- Browser: `tools/ui-probe/run.ts 7 light knight` page/headless/mirror all `fd0f2f2b58a0503e`; `… knight fresh` all `623b19a4b43f8177`, the hash unit 12 recorded, with the profile round-tripping through real `localStorage`.

## Two traps for the next session

**Which tree the browser is serving.** The shared pane moved between two workers' servers this round and a reviewer found port 5175 serving a different tree entirely. Everything above was shot against a server started on **5186** from this worktree, with `CARDS_URL` pointed at it, and the tree was confirmed by fetching `src/render/escape.ts` — a file that exists only on this branch — before any probe ran. Both `tools/ui-probe/run.ts` and `pick.ts` read `CARDS_URL`; `tools/ui-probe/icons.ts` and `tools/heraldry-probe/shoot.ts` do not need a server at all.

**`tools/heraldry-probe/shoot.ts` clears `.probe/`.** Its `OUT` is `.probe`, and it wipes the directory before writing. Running it mid-session deleted this round's mutation runner, its baseline captures and three scratch probes in one go — nothing tracked, and everything recoverable, but the mutation run had to be repeated. The two probe directories are not interchangeable: `.probe-ui/` is where the UI probes write into per-run subfolders, `.probe/` is the heraldry probe's and it owns the whole directory.
