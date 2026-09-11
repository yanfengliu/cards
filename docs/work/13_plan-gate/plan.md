# A malformed work plan goes red at commit

Status: active
Owner: coordinator
Created: 2026-09-11
Updated: 2026-09-11

## Problem and outcome

A malformed `plan.md` never hurts the plan it is in. It stops the *next* allocation, in someone else's session: `work-docs.mjs create` validates every existing unit before it reserves an ID, so one bad Status line blocks the sequence. That happened three times in one day, each time found by whoever tried to allocate the next unit rather than by whoever wrote the bad plan. The shapes were `Status: complete, on branch worktree-agent-...`, `Status: implemented, on a branch`, and `Status: implemented on <date>` with `## Scope` and `## Implementation steps` gone.

Outcome: a malformed plan goes red at commit time, in the repo that owns it. `npm run gate:work-plans` is in the `npm run gates` chain, so it runs before every commit that touches code, the same way `gate:boundaries` and `gate:banned-apis` turn `ARCHITECTURE.md`'s rules into something that can fail.

## Scope

In: `tools/gates/work-plans.ts`, its `package.json` wiring, a bullet in `AGENTS.md`'s Gates section, the red-proof record in `docs/learning/gate-proofs.md`, and repairs to any existing plan the gate rejects.

Out: no change under `src/`, so no behaviour changes — `npm run verify` and `npm run verify:run` are content-identical apart from their wall-clock line. Also out: `registry.json` contiguity, the `docs/work/.gitattributes` bytes, the allocation lock and journal, and the registry's Git history. Those are the allocator's checks, run in the primary checkout by `work-docs.mjs`, and duplicating them here would put a per-commit gate at the mercy of a lock another session holds.

Dependency: the rules come from `fleet/docs/work-docs.md`'s "Plan format" section and `fleet/scripts/lib/work-docs-format.mjs`. Nothing in this repo's gate path requires that checkout to be present.

## Approach

The rules are reimplemented here rather than shelled out to `../fleet`, for three reasons recorded in the gate's own header. The decisive one: a gate whose only implementation lives outside the repo degrades to a no-op the moment that outside thing is missing, and a skipped gate is indistinguishable from a passing one. `../fleet` in particular does not resolve from a worktree, which is where this repo's commits are made — `ROOT` is the worktree root, so `../fleet` is `<repo>/.claude/worktrees/fleet`, absent. That one spelling is fixable, and the cross-check below proves it: a search up the ancestors finds the real checkout from inside the worktree. What is not fixable is a fresh clone, a CI runner, or any machine with no `fleet/` at all, where a shell-out gate reports "fleet is not here" and skips. With the rules here, the gate still runs on all of those and only the cross-check is skipped. The other two reasons: `work-docs.mjs check` takes a lock in the Git common directory and replays the registry through its whole history, so a coordinator allocating a unit while a worker commits turns the gate red for a reason unrelated to the code; and allocation identity belongs to the allocator, while plan format is what a commit here can break.

The cost of reimplementing is drift, so drift is made to go red too. When a `fleet/` checkout is reachable — found beside this repo or beside any ancestor of it, or named by `FLEET_DIR` — the gate imports fleet's own `validatePlan` and compares **verdicts**, not source text, over every probe case and every real plan. A cosmetic refactor upstream is therefore not a failure and a rule change is. When no checkout is reachable, or the one found rejects the gate's well-formed control plan, the cross-check is skipped and says so; it can only ever add a failure, never remove one.

The gate follows the two properties `boundaries.ts` and `banned-apis.ts` established: it states its own bound in its file header, and it fires every rule on a built-in probe before it is trusted to report an absence. The probe's well-formed case must trip nothing, so a detector that has started matching everything fails as loudly as one that has gone quiet, and each malformed case is built from the well-formed text by an edit whose anchor must match exactly once — a probe case that silently became a no-op would otherwise read as a pass.

## Acceptance criteria

- `npm run gates` green with `gate:work-plans` in the chain, ahead of `npm test`. Checked: exit 0, 218/218 tests, all four gate lines printed.
- Each of the three shapes that blocked the allocator goes red on a real plan. Checked: M1, M2, M3 in `docs/learning/gate-proofs.md`, exit 1 with the offending value quoted.
- A missing section, an empty section, missing metadata, an impossible date, a missing `plan.md` and a folder that is not `<id>_<theme>` each go red. Checked: M4–M9.
- The detector cannot report "did not run" as "passed". Checked: M10–M12 — two dead-rule mutations and one broken probe anchor, all exit 2.
- "Fleet is not here" is not a failure, and the gate still catches a malformed plan without it. Checked: M13 (malformed plan red with `FLEET_DIR` pointing nowhere), M15 and M16 (unusable fleet, still green and still checking 14 plans).
- Drift between this gate and fleet's validator goes red. Checked: M14, exit 2.
- No behaviour change. Checked: `git diff dcf2cdf -- src/ test/` is empty, and `verify` and `verify:run` each reproduce line for line apart from `Elapsed`.
- Every plan under `docs/work/` passes.

## Implementation steps

- Read `tools/gates/boundaries.ts`, `tools/gates/banned-apis.ts` and `tools/gates/scan.ts`, and fleet's `validatePlan`, before writing anything. Done.
- Write `tools/gates/work-plans.ts`: the transcribed rules, the probe, the tree checks, the optional fleet cross-check. Done.
- Wire `gate:work-plans` into `package.json` and into the `gates` chain after `gate:banned-apis`. Done.
- Prove it red: sixteen mutations through `.probe/mutate-plans.mjs`, each restored and its digest compared. Done; recorded in `docs/learning/gate-proofs.md`.
- Repair any existing plan the gate rejects. None needed — all fourteen passed unmodified, and fleet's own checker agrees.
- Add the gate's bullet to `AGENTS.md`'s Gates section and a devlog line. Done.

## Outcome

Implemented on branch `worktree-agent-ae829ffbddee3454e`, cut from `dcf2cdf`. Not merged and not reviewed; the integration owner holds acceptance, so this stays `active` rather than `complete` — and recording the branch here rather than on the Status line is the thing the gate exists to enforce.

`npm run gates` exits 0 with the new gate third in the chain: 14 plans checked, every probe rule fired, and the fleet cross-check agreed with `fleet/scripts/lib/work-docs-format.mjs` on all 23 texts. 218 tests pass. `git diff dcf2cdf -- src/ test/` is empty, and `verify` and `verify:run` reproduce line for line apart from `Elapsed` (60 and 80 lines compared).

Sixteen mutations are recorded with their exact failure text in `docs/learning/gate-proofs.md`. No existing plan needed repair.

Limitations, stated in the gate's header and repeated here because they are what the next defect will come from: the gate says nothing about whether a plan is **true**. `Status: complete` on unfinished work passes, and so does an `## Outcome` reading "Pending" on a closed unit. It does not check `registry.json`, the allocation lock, or Git attributes. And it does not check `reviews/<round>_<stage>.md` format, because no review round exists in this repo yet and a rule that scans nothing reports "did not run" as "passed" — that hole is named rather than covered by a rule with no inputs.
