# AGENTS.md — cards

## What this is

A single-player roguelike deckbuilder: tactical card combat on a board, fought across a branching run, with a class layer that changes what a deck can become. `docs/design/` is the design of record; `docs/work/` holds the rounds that produced it.

Non-goals: multiplayer, live-service economy, real-money purchases, and a collection metagame. One player, one run. There is no raster art pipeline either, but that is a consequence rather than a goal — card art is a heraldic blazon in the card's own data, rendered to SVG by code, so there are no image assets to pipeline. See `ARCHITECTURE.md`.

Stack: TypeScript on Node 24 (`.nvmrc`), browser front end. Node runs the `.ts` sources directly by stripping their types, so there is no build step and no compiled artifact to fall out of sync. What exists today is a whole run playable in the browser: a headless deterministic rules engine (`src/engine/`) under a run layer (`src/run/`), both fed by data in `src/content/` and measured headlessly by `src/sim/`, drawn by an SVG heraldry renderer (`src/render/`) and played through the browser UI in `src/ui/`. A run starts at a class pick, crosses three acts of branching map with fights, rewards, sigils, shops, events and rests, and can earn unlocks that widen the pool every later run drafts from. Gates below say what exists today; each grows its real command in the same commit that introduces the tool, and a Gate is never written ahead of the command that satisfies it.

This repo's own rules live in [docs/policies/local-rules.md](docs/policies/local-rules.md). They add repository constraints consistent with the fleet constitution below.

<!-- FLEET-CANON:BEGIN sha=fa6416c07600 generated from ../fleet/FLEET.md by `npm run sync-canon` — do not edit inside this block; this repo's own rules go in docs/policies/local-rules.md -->
## Fleet constitution

Shared rules for every repo under `github/`, kept in `../fleet/FLEET.md`; `../fleet/` is fleet's checkout beside this repo's primary checkout. Where a rule gives its reason, use the reason to judge cases the rule does not name; each `[Rn]`'s history is in `../fleet/docs/canon-rationale.md`. This repo's `docs/policies/local-rules.md` may add rules but cannot change these permissions or limits. [R13]

The main agent owns delivery and may implement directly. Use subagents when bounded, independent work or independent judgment materially improves speed or quality; keep small or tightly coupled work with one agent (owner directive, 2026-11-07). [R2, R3]

The designated coordinator reads `../fleet/docs/skills/coordinator.md` before planning and after each compaction, and any agent reads that file's "Delegate" section before delegating. Before these kinds of work, read the matching section of `../fleet/docs/work-rules.md`: standing loops and unattended runs; editing skills, agent instructions or rules; handing off or stopping mid-task.

### Permissions

- Commit, merge to main and push without asking. Force-pushing and rewriting history (they destroy history), and deploying and publishing (they reach other people), need the owner's OK. [R14]
- Ask before a major architecture or product change, a new major dependency, a change to a persistent format or a security boundary, or any other consequential action outside this machine, such as posting or sending something. [R8]
- Change fleet rules (FLEET.md, fleet skills and runbooks, agent memory) or add a rule to a repo's `docs/policies/local-rules.md` only when the owner asks, because the owner sets policy. You may add a proposal with its evidence to `../fleet/canon-candidates.md`, but not edit its entries. [R8]

### Sharing the machine

- Other Claude and Codex sessions may be working in this checkout, and you cannot see them. Do anything beyond a quick read in your own worktree, because two sessions in one tree spoil each other's gates and commits. Never revert, overwrite or delete changes you did not make. When resuming, check which worktrees, branches and files already exist. [R7]
- Done means merged to main and pushed: the owner archives sessions, and work left on a branch is lost. Merge on your branch, get the gates passing there, then move main, because other worktrees build on local main. Judge the merged result itself, not a worker's summary. Then remove your worktree and branch, and report where any unmerged work is. [R14]

### Doing the work

- The repo's gates must pass on the tree that is handed back or reaches main. Unless the repo's own rules ask more of a commit, commit on your own branch at every stopping point and say in the message what was not checked, because a session can end without warning. Docs-only changes need content checks and any gate the repo names for docs, not runtime tests or CI waits. [R14]
- Check the thing that should have changed (the file, the page, the number), not just the exit code or a tool's report: both can pass over a defect. Retest a blocker you inherit before repeating it. Never weaken a test or hide a failure to get green. [R9]
- Look at visual and interactive work rendered at full resolution, through the real controls, from fixed and random views, because passing tests say nothing about pixels. Run it headless unless a visible window is needed. [R16]
- Slowness on the critical path, such as a gate rendering on the CPU of a machine with a GPU, is a defect to fix. [R22]
- After pushing code, follow CI to the end; read a failed job's steps before blaming the code, since a billing limit fails jobs before any step runs. [R15]
- If a fix fails twice for one reason, rethink it. After five real repair attempts at one problem, whatever the approach and counting earlier sessions, stop and report, unless the owner set another limit; for a problem that keeps winning, run the search in `../fleet/docs/skills/hard-problem.md`. Stop when the task's criteria are met; do not invent follow-up work. [R11]
- For substantial or high-risk changes, use independent review when available. High-risk includes persistence and migrations, security and auth, concurrency, money, supply chain, and code changes in another repo. Review the exact revision against the task's criteria, and say so when review was unavailable. Fix the findings that matter and have those fixes checked; note minor ones instead of starting another round. `../fleet/docs/skills/multi-cli-review.md` provides the review mechanics. [R10]
- A defect the owner reports gets a test for its whole class and an entry in `docs/learning/defect-register.md`, because a fix without a check tends to come back. [R17]
- Sessions run long: take new requests in the same session, and never hand off to a new session to shed context. Split work expected to need more than about 200k tokens of context into milestones, each merged to main. [R6]

### Records, sized to the work

- Read `docs/learning/lessons.md` at session start; it lists this repo's known traps, and its header says how to add one. [R18]
- Every change that alters behaviour adds a dated line to `docs/devlog/summary.md` (`../fleet/docs/devlog-template.md`) when it lands, because later sessions orient from its newest entries. Work that spans sessions, has several agents writing, or gets an independent review also keeps its plan and review records in `docs/work/` (`../fleet/docs/work-docs.md`); other work needs none. [R24]
- Raw output (logs, captures, screenshots) stays in ignored folders. Never commit a binary over 512 KiB or any file over 1 MiB; LFS needs the owner's OK. [R23]

### Style and environment

- Plain words; one line per paragraph, no hard wrapping. A report says what changed, how it was checked (including any check skipped or failed) and what is not done. [R25]
- Node 24 is the baseline. Products pin the model IDs they call in their own repo, and nowhere else. Reviewer model pins live only in `../fleet/docs/skills/multi-cli-review.md`. Runtime model calls are allowed and paid for; make per-item calls one-shot, not agent sessions. [R28, R29]
<!-- FLEET-CANON:END -->

## Gates

Each line is a gate and what it checks. [docs/policies/gates.md](docs/policies/gates.md) holds each one in full, with its bound and the reasoning behind it: read a gate's entry there before changing the gate or relying on it.

- **Node 24**, pinned by `.nvmrc` and by `engines.node` in `package.json`; run against v24.18.1. A version mismatch here is not a code failure, so check it before reading a red gate as one.
- **`npm run gates` is the gate**, and it passes before any commit that touches code. It runs seven commands in a fixed order — the four static checks, then the tests, then the two measurements — and stops at the first that fails; each is also runnable alone: `npm run typecheck` (`tsc --noEmit`, `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`), `npm run gate:boundaries`, `npm run gate:banned-apis`, `npm run gate:work-plans`, `npm test` (`node --test`), `npm run verify`, `npm run verify:run`.
- **`npm run gate:boundaries`** fails when anything under `src/engine/` imports from `src/content/`, `src/render/`, `src/ui/` or `tools/`, or when anything under `src/engine/` or `src/run/` references a global that only `lib.dom` declares or names `localStorage`, `sessionStorage` or `indexedDB`.
- **`npm run gate:banned-apis`** covers four hidden inputs, under two rules with different scopes.
- **`npm run gate:work-plans`** fails when a `plan.md` under `docs/work/` is one `work-docs.mjs create` would refuse.
- **`npm run verify`** re-runs the placement measurement over 400 seeds at the `even` encounter and exits non-zero on any of four things.
- **`npm run verify:run`** re-runs the whole-run measurement over 200 seeds and exits non-zero on any of eleven things.
- **`npm run audit`** (`npm audit --audit-level=high`) is the dependency-audit gate; re-run it on any dependency change.
- **There is no lint gate and no format gate, because this repo has no linter and no formatter.** Do not write either line here until the tool is installed and has been run once. A Gate written ahead of its command is the specific failure this section exists to prevent.
- A change to `docs/design/` restates the affected rule as a concrete play example — the exact sequence, the numbers, the resulting board — because a mechanic that cannot be walked through by hand is not yet specified. `npm run sync-canon` from `../fleet` must stay green when this file changes.
- Simulation is this repo's instrument, and it has three runners: `npm run measure` (is placement a decision, at four preset encounters), `npm run measure:run` (how far a whole run gets), and `npm run measure:ablate` (what each cascade trait is worth, at a baseline matched by reading the enemy hero's Health as a continuous dial). One of them is the first probe for any balance or rules question, and a scratch script that re-implements combat instead of calling it is not evidence.

## Invariants & boundaries

- **The rules engine is headless and deterministic.** Given a seed and an ordered list of player actions, a match replays to a byte-identical final state. Rendering, animation, input, and timing live outside it and may not be imported by it. Every balance claim is a seeded batch through this engine, never a hand-played impression.
- **Card behavior is data plus a named effect, never bespoke branching.** A new card that needs a new `if` in the resolver is a signal the effect vocabulary is missing a verb — add the verb.
- **The resolver owns ordering.** Triggers, deaths, and queued effects resolve in one documented order in one place. A card may not reach around it to mutate state directly.
- **Numbers live in data, not in code.** Costs, stats, weights, and curves sit in tracked data files a balance pass can diff.
- Locally high-risk, so it escalates to independent review (`../fleet/docs/skills/multi-cli-review.md`): the resolver's ordering rules, the RNG and seeding path, save/replay format, and any change to `AGENTS.md` or `docs/design/`.
- Save and replay compatibility is a contract: a format change ships with a migration and a fixture of the old format that still loads.

## Conventions

- One card, one entry, one id. Ids are stable forever — a rebalanced card keeps its id, a redesigned card gets a new one, and ids are never reused.
- Design docs state a mechanic's *purpose* — the decision it puts in front of the player — alongside its rules. A mechanic with no decision attached is a candidate for deletion.
- Devlog per canon: `docs/devlog/summary.md`, newest first, with detail in `docs/devlog/detailed/`.
- `README.md` stays user-facing: what the game is and how to run it.
- `ARCHITECTURE.md` holds module boundaries, the resolution-queue contract, the balance metrics, and the delegation plan. `docs/design/` holds the game; `ARCHITECTURE.md` holds what builds it. A change to module boundaries or the resolver's ordering belongs there, not in a work-unit plan.
