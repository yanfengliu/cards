# AGENTS.md — cards

## What this is

A single-player roguelike deckbuilder: tactical card combat on a board, fought across a branching run, with a class layer that changes what a deck can become. `docs/design/` is the design of record; `docs/work/` holds the rounds that produced it.

Non-goals: multiplayer, live-service economy, real-money purchases, and a collection metagame. One player, one run. There is no raster art pipeline either, but that is a consequence rather than a goal — card art is a heraldic blazon in the card's own data, rendered to SVG by code, so there are no image assets to pipeline. See `ARCHITECTURE.md`.

Stack: TypeScript on Node 24 (`.nvmrc`), browser front end. Node runs the `.ts` sources directly by stripping their types, so there is no build step and no compiled artifact to fall out of sync. What exists today is a whole run playable in the browser: a headless deterministic rules engine (`src/engine/`) under a run layer (`src/run/`), both fed by data in `src/content/` and measured headlessly by `src/sim/`, drawn by an SVG heraldry renderer (`src/render/`) and played through the browser UI in `src/ui/`. A run starts at a class pick, crosses three acts of branching map with fights, rewards, sigils, shops, events and rests, and can earn unlocks that widen the pool every later run drafts from. Gates below say what exists today; each grows its real command in the same commit that introduces the tool, and a Gate is never written ahead of the command that satisfies it.

This repo's own rules live in [docs/policies/local-rules.md](docs/policies/local-rules.md). They add repository constraints consistent with the Fleet Orchestration Policy below.

<!-- FLEET-CANON:BEGIN sha=e54f2a9ae007 generated from ../fleet/FLEET.md by `npm run sync-canon` — do not edit inside this block; this repo's own rules go in docs/policies/local-rules.md -->
## Fleet constitution

Reasons and evidence per `[Rn]`: `../fleet/docs/canon-rationale.md`. `../fleet/` is fleet's checkout beside the repo's primary checkout, also from a worktree. The designated coordinator reads `../fleet/docs/skills/coordinator.md` before planning and after each compaction, and any agent reads that file's "Delegate" section before delegating. Before these kinds of work, read the matching section of `../fleet/docs/work-rules.md`: visual and interactive work; games, simulations and research; measuring, debugging and slow steps; writing error messages; toolchains, dependencies and model calls; standing loops and unattended runs; pushing executable changes; a user-reported defect; editing skills, agent instructions or rules; run output and files over 256 KiB; handing off or stopping mid-task.

### Fleet Orchestration Policy

Deliver the requested outcome with verified correctness, coherent architecture and minimal necessary complexity. Optimize useful progress, not agent count, code volume or maximum reasoning. Adapt rigor to risk. This policy grants no new permissions or capabilities. [R1]

**Roles.** Only an explicitly designated agent coordinates; each scope has one accountable integration owner. [R2]

Workers own bounded outcomes and local implementation decisions. [R3]

Inspect instructions, code, docs, tree state and active tasks; set outcome, non-goals, acceptance criteria, dependencies and verification; settle ambiguity with evidence and reversible defaults. [R4]

**Session size** (owner directives, 2026-09-23 and 2026-10-22). Sessions run long: take new requests as separate assignments in the same session, and never hand off to a successor session to shed context; auto-compaction carries the session. Split tasks expected to exceed about 200k context tokens into milestones within that budget, each committed and merged to main once green. Milestones are task boundaries; a compaction never justifies wrapping up or handing off. [R6]

**Coordinate safely.** Beyond a trivial read, each session or agent defaults to its own worktree; serialize overlapping writes only when none is available, and say why. Finish each bounded increment in its session: merge to main, push, then `git worktree remove`, remove completed task-owned branches and unneeded temporary files, and explicitly transfer the ownership and location of still-needed resources. Report any merged worktree left and its location as a defect. Never overwrite or discard another participant's work. On resumption, first inspect surviving worktrees, artifacts and task status, assuming nothing survived until checked; recover what exists and preserve unfinished work. [R7]

Workers act autonomously in scope; escalate cross-task interfaces, persistent formats, security boundaries, major dependencies and scope changes to the coordinator for resolution within the approved mandate. Unapproved major architecture or product changes and consequential external actions need human authorization. Fleet rules (FLEET.md, the fleet's skills and runbooks, canon candidates, and agent memory) change only when the owner asks (owner directive, 2026-10-28). Agents propose changes instead of making them. The one exception: they may add a proposal to `../fleet/canon-candidates.md`, with the lesson, its evidence and the rule it would change (owner directive, 2026-10-29). They never change, promote or delete an entry: the owner decides each one, and the session the owner asks makes the change. Never reset consumed allowances. [R8]

**Implement and verify.** Inspect, implement a coherent increment, check, diagnose, fix, recheck. Preserve architecture; no unrelated rewrites, speculative abstractions or unnecessary dependencies. Implement when requested. Use task-appropriate evidence and baselines; prototype uncertain ideas before generalizing. Never weaken tests or conceal failures to claim success. Docs-only work uses content and version checks; skip runtime tests and CI waits. [R9]

During authorized work and within scope and budget, proactively improve products and the task's orchestration, learn from recorded outcomes and propose improvements to fleet rules. Read `../fleet/docs/skills/self-improvement/SKILL.md` when proposing a fleet-rule change or turning a mistake into a gate (owner directive, 2026-10-29). [R33]

Obtain independent, preferably read-only review for substantial or high-risk changes when available. Review the exact revision against acceptance criteria. Report unavailable review; fix justified findings, rerun affected checks, and obtain focused re-review when fixes invalidate earlier review. [R10]

**Integrate, report, and stop.** Reassess after two failures for one reason. Unless another budget is set or the user authorizes more, cap automatic repair at five substantive attempts, then report; explicit overrides hold for their stated scope without asking again. Keep updates brief and decision-relevant. Stop when acceptance criteria and material findings are resolved; invent no follow-up work. [R11]

**Final acceptance gate.** The integration owner integrates in dependency order and on the final integrated revision's actual changes and evidence, not worker summaries, checks every acceptance criterion, runs relevant automated checks and exercises affected end-to-end behavior and cross-task interactions. Substantial or high-risk work gets independent read-only review of the integrated changes, integration fixes included. Confirm the merge to main; report that revision, review status and every failed, skipped or unavailable check and unmet criterion. Nothing is fully verified with an open material finding or required check. [R12]

### Fleet conventions

- Repository rules add local constraints consistent with this policy; they cannot override its permissions, adaptive workflow or stopping limits. [R13]
- Gates pass before any commit touching code, a merge included: merge on a detached HEAD or its own branch and move main to it once its gate passes. The user's standing grant covers committing, merging to main and pushing in their repos; force-pushing, rewriting history, deploying and publishing still need authorization. Work is done only once merged to main, regardless of green branch or worktree gates; report unmerged work's location. [R14]
- For substantial or high-risk changes, use independent review when available. High-risk includes persistence and migrations, security and auth, concurrency, money, supply chain, and executable changes in sibling repos; `../fleet/docs/skills/multi-cli-review.md` provides the review mechanics. [R10]
- Reviewer model pins live only in `../fleet/docs/skills/multi-cli-review.md`; every model a product calls is pinned in its calling repo. No model IDs are hardcoded elsewhere. [R29]
- Read `docs/learning/lessons.md` at session start. Record the session's lessons there; each names its retiring gate and is deleted in the commit landing it. A gate counts only after going red with the defect reintroduced, following `../fleet/docs/lessons-template.md`. [R18]
- Gates prove nothing beyond their bounds: name the bound in the header and pin every reproducing input. Distinguish passed from did-not-run; a check built from its checked symbol proves only self-agreement. [R19]
- Verify outcomes beyond exit status, red or green, and return values: read the artifact that should have changed. Retest inherited blockers before repeating them. [R20]
- Keep plans and every authored review round in permanent `docs/work/<id>_<theme>/` folders (`../fleet/docs/work-docs.md`). Record history, not status: a dated devlog line per behaviour-changing session in `docs/devlog/summary.md` (`../fleet/docs/devlog-template.md`). [R24]
- Use common words with the same meaning in chat, docs, commits, PRs, comments and errors. One idea per sentence unless a rule needs more. Cut length, not facts: keep exact terms, numbers and evidence. Quotes and pastes are exempt; do not copy this canon's style. One line per paragraph, no hard wrapping. [R25]
- When blocked, immediately hand over the redacted artifact with the named blocker, before analysis; continue safe independent work. [R27]
- The owner's directions that outlive a task land that session in `../fleet/FLEET.md` if fleet-wide, otherwise the repo's `docs/policies/local-rules.md`; report where. [R31]
- When a hard problem blocks progress, run the search in `../fleet/docs/skills/hard-problem.md`. [R32]
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
- **`npm run audit`** (`npm audit --audit-level=high`) is the dependency-audit gate canon requires; re-run it on any dependency change.
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
