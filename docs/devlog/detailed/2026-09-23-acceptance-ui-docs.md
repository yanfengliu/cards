# 2026-09-23 — final acceptance: the UI and document findings

Branch `worktree-agent-ae9d688c1c25fc728`. It finishes a tree a predecessor left at `8ff8e0c`, cut from `9b36329`, when its session limit ran out in the middle of verifying. That tree's fixes were right, one of its gates was blind (below), and nothing in it had been run. So the gates ran first, the diff was read as a list of claims, and every number it quoted was measured again. 282 tests, from 276.

## A won node's run state is stale by design, and a screen that reads it is wrong

Between a won fight and its commit, `src/ui/run.ts` keeps the canonical state where it stood before the node: the Health carried in, the maximum from before any hero sigil, and the sigils from before it too. The phase holds what the replay will set. The reward shelf built its opening line inside `startRunApp` and read the maximum off the state, so after the Sigil of the Oak it said "146 of 180 Health" under a HUD reading 146/210. The HUD's sigil chips read the state as well, so the Oak that had just made the bar 210 had no chip until the shelf was answered.

Anything new drawn in that window, such as a fourth decision after a won fight or another number on the shelf, reads `heroNow` and not `state`, and over the end banner it hands `heroNow` the finished fight. The shelf, the hero sigil offer and the HUD already do. `test/ui-won.test.ts` holds everything they state to what a second controller's replay sets. That test cannot see `runapp.ts`'s wiring: W8c cuts it and the test stays green. The browser probe's `checkWonLine` does see it (P2 red), and the probe is outside `npm run gates`.

## The window opened a screen earlier, and a review of the close found it

An independent read-only review of `9f03978` accepted it with fixes, all low severity. It was one lane, an in-harness Claude reviewer. The finding worth a section: from the moment a fight ends until "Take your reward" hands it over, the phase is still `fight`. `heroNow` knew only the won phases, so it returned the state, and the HUD over the end banner read 200/200 and 0 gold under "Your hero finished on 194 of 200 Health" (Knight, seed 7, first fight). That was there before this work. What this work added was a docstring saying the state was the truth there, and that is what the review caught. `afterFight` now computes what `visit` sets when a fight ends, `finishFight` and `heroNow` both use it, and `runapp.ts` redraws the HUD when the banner goes up. The unit gate checks every fight's end against the replay (155 won, 22 lost); the probe checks the page.

The review also found that nothing watched the HUD's chips on the page, and that the gold half of the unit gate could pass with nothing to read. Both are gated now (P3 and W9 in `docs/learning/gate-proofs.md`).

## A probe check that was wrong about the page

The first version of the end-banner check compared both numbers in "Your hero finished on 186 of 194 Health" with the run's 186 of 200, and went red on a correct page. A fight's hero is handed the run's Health and not its maximum (`heroSpecFor`), so the banner's "of" is the Health the hero walked in with. The check now compares only the first number. The two maximums on one screen are pre-existing and unchanged, and a player could reasonably ask about them.

## The gate for the tooltip examples shared the code's filter

The race tooltips named the Captain, the Champion and the Sentinel, and all three are gated for a new player. The inherited fix derived the examples, starting-deck cards plus the cheapest tribal card a fresh profile can draft, and gated "no tooltip names a card a fresh profile cannot draft". Its list of those cards came through `unlockedRewards(FRESH_UNLOCKS, …)`, the same call the glossary picks its examples with. A narrowing that let one gated card through put "The Kindler carries Kindle" in the Dwarf tooltip while `u_kindler` was gated, and the inherited gate stayed green (R3o in `docs/learning/gate-proofs.md`). The list is read off `GATED_IDS` now, and the same mutation is red (R3). The test also works out a card's short name itself instead of through the glossary's `nameInRace`, which is no longer exported.

## Documents that describe the disk, and a test that holds them to it

`ARCHITECTURE.md`'s source tree named `actions.ts`, `effects.ts`, `replay.ts` and four `.json` files that never existed, and had no `src/run/`. It is the disk now. `test/docs.test.ts` fails when a line names a file that is not there or leaves out one that is, and prints the block to paste. So adding, renaming or deleting any file under `src/` is also an edit to `ARCHITECTURE.md`, in the same commit. The same test holds the two status paragraphs to every top-level directory and the README to every address parameter the app reads.

`ARCHITECTURE.md` also said every gate `AGENTS.md` lists is chained by `npm run gates`. `npm run audit` is listed and deliberately left out of the chain, so the sentence no longer counts or lists the gates.

## Measured again rather than inherited

- `npm run gates` on the inherited tree: exit 0 at 282 tests. `verify` and `verify:run` against a clean extraction of `9b36329`: 46 and 62 lines, none differing apart from `Elapsed`, with the comparer shown to go red on swapped inputs.
- The gate runs of the three merges the plans now cite, from clean extractions with their own `package.json`: 199, 218 and 236 tests at `a974d04`, `5f51827` and `299fede`; a 9.75 pp gap at all three; the strongest `verify:run` arm winning 31/200, 176/200 and 178/200. The inherited plan text had these right.
- `test/ui-won.test.ts`'s population, through a scratch copy that prints its tally. The inherited numbers were right.
- The inherited `gate-proofs.md` entry was taken out and rewritten from this session's own runs, because nothing this session could see had run its mutations.
- The fleet canon: the `AGENTS.md` change sits outside the FLEET-CANON block, and fleet's own `classifyAgents` reads the file as `current` (and a copy edited inside the block as `modified`).

## What the page showed

Seed 2 as the Ranger, the shelf after the Goblin Pack elite in act 1: "Your hero stands at **140** of 210 Health. **+55 gold** — you now have 105.", under a HUD reading 140/210 and 105 gold, with the Oak chip beside them. `reward-max-health-moved.png`, 1440x900, sha256 `3986f405e7e40b4d…e831`. The Knight's first fight on seed 7, over the end banner: the HUD read 200/200 and 0 gold before the review's fix (`fight-won.png`, `4f3d67bf…26d3`) and reads 194/200 and 25 gold after it (`d6539c07…5b59`), under "Your hero finished on 194 of 200 Health". On seed 7 all three classes played through the page with every check held: each shelf's and hero sigil screen's line, the HUD's Health and chips there, and the HUD over every end banner. The Knight won after 24 nodes, the Ranger and the Mage died after 9 and 5, and every page hash equalled its headless run.
