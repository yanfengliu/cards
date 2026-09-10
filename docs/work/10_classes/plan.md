# Classes: Knight, Mage, Ranger

Status: active
Owner: coordinator
Created: 2026-09-10
Updated: 2026-09-10

## Problem and outcome

A run had one hero and one card pool, so every run started the same way and the only thing that told two runs apart was the seed.

`docs/design/game.md` says three things about classes, all marked **[owner]**: "The player picks a class - Knight, Mage, Ranger - which sets the starting deck and the card pool"; "Class sets the pool; races appear across all of it. A Knight drafts dwarves, elves and humans alike"; and "Health, plus a small class-flavoured attack. The Knight swings for 2, the Ranger for 1 twice, the Mage for 1 with a rider."

The outcome is those three sentences made real: three classes a run can be started as, each a hero, a starting deck and a reward pool; a screen that offers them; the class carried in the run log so a run replays as the class it was played as; and `npm run measure:run -- --class <id>` reporting each class on its own.

## Scope

Included: the two class attacks as resolver verbs (`volley`, `scorch`); `src/content/classes.ts`, which is the three classes as data; the run plumbing that carries a class (`classOf`, `contentForClass`, `startRun`, `replayRun`, `RunLog.classId`); the class-pick screen and its wiring into `runapp.ts`; `--class` on the run measurement; and the two test files that gate the halves, `test/hero-attacks.test.ts` for the engine and `test/classes.test.ts` for the content and the run.

Excluded: sigils, which are unit 9 and are still gated out by `verify:run`; any change to `docs/design/game.md` or `ARCHITECTURE.md`; and balancing the three classes against each other, which `docs/policies/local-rules.md` rules out - the per-class numbers below are information about the options, not targets to tune content toward.

Depends on unit 8, a whole run playable in the browser, which is the base this was cut from.

## Approach

A class is data and the engine does not know one exists. The two class attacks are traits the resolver reads for a hero and a unit alike, which is why the engine tests build their own fixtures instead of reaching for the shipped heroes: the verb is the thing being gated, not the Ranger.

Volley spawns `VOLLEY_SWINGS` separate `attack` effects rather than one attack at double Power. That is the whole design decision, and it buys three properties at once: each swing picks its own target from the board as the previous swing left it, each draws its own retaliation, and the resolver's checkpoint runs between them, so a unit killed by the first swing's retaliation never reaches the second. A hero takes no retaliation, so a hero never loses its second swing that way.

Scorch is its own effect kind sharing `damageAll`'s loop rather than copying it, so "spell damage, no trade, Guard does not narrow it, the enemy hero is not in it" holds for both by construction. The two differ in exactly one line: a spell cast into an empty line fizzles, and a rider with nothing to burn says nothing, because a `fizzled` following the same hero's `attacked` would contradict it on screen.

Save and replay compatibility is a contract, so `RunLog.classId` is optional and a log without it replays as the Knight. `defaultClassId` is the first class listed, which makes the Knight's place at the head of `CLASSES` load-bearing; `test/classes.test.ts` is where that is held.

`contentForClass` derives a content that lists one class and starts as it. Without the single-entry list, a derived content would start as the Knight whatever class it was derived for, and `--class` would silently measure the Knight three times.

## Three sessions, three commits

A later reader will find three commits and should know why.

- `2c13ea9` "WIP: preserved by coordinator after rate-limit death; unverified" - the first worker, on branch `worktree-agent-a0855ebc014eb8227`. It produced the class content, the run plumbing, the whole render and UI layer (class-pick screen, crests, class terms, the icons and blazons the three heroes need) and a first pass at the engine. It wrote no tests and was not verified. The coordinator preserved the tree rather than lose it.
- `5b901b2` - the coordinator's merge of that WIP into the second worker's branch.
- `8b4177c` "Classes: Volley and Scorch as resolver verbs, a run started as a class, and the gates for both" - the second worker, on branch `worktree-agent-a5b3c70c8b60a7b3a`. It finished the engine (Scorch became its own effect kind), corrected the run plumbing, restored `src/sim/runmeasure.ts` to main and gave it `--class` alone, and wrote the 769 lines of tests that are this unit's gates. It also died to a rate limit, before proving any of those gates could go red and before the plan, the measurements or the devlog existed.

This document, the red proofs in `docs/learning/gate-proofs.md` and the per-class measurements are the third session, which changed no behaviour.

## Acceptance criteria

- [x] Three classes exist as data, each a hero, a starting deck and a pool of known cards - `test/classes.test.ts`, first test.
- [x] Each hero is the design's attack: the Knight swings for 2, the Ranger for 1 twice, the Mage for 1 with a rider - `test/classes.test.ts`, and the verbs themselves in `test/hero-attacks.test.ts`.
- [x] Every class pool holds every race the player's cards come in, read off the cards rather than listed - `test/classes.test.ts`. All three pools hold human, dwarf and elf.
- [x] A run started as a class is that class from its first node to its hash, and three classes on one seed are three different runs sharing one map - `test/classes.test.ts`.
- [x] A log written before classes existed still replays to the hash it always did - `test/classes.test.ts`, against a fixture of the old `{ seed, nodes }` shape.
- [x] Volley and Scorch are gated on the event stream and the effect trace, not only on final state - `test/hero-attacks.test.ts`.
- [x] Every load-bearing claim above has been made to go red by reintroducing its defect - 15 mutations in `docs/learning/gate-proofs.md`, entry of 2026-09-10.
- [x] Each class measured on its own and reported - `npm run measure:run -- --class <id>`, 1000 seeds each, in Outcome below.
- [x] `npm run gates` passes and `npm run verify` is unchanged.
- [ ] Independent review of the resolver's ordering changes, which `AGENTS.md` makes high-risk. Commissioned by the coordinator against `8b4177c`; not part of this session.
- [ ] Merged to main. The coordinator owns integration.

## Implementation steps

- [x] The class attacks as resolver verbs, and the class content - workers 1 and 2, `2c13ea9` and `8b4177c`.
- [x] The run carries a class, and an old log still loads - workers 1 and 2.
- [x] The class-pick screen and the `--class` flag - workers 1 and 2.
- [x] The two test files - worker 2, `8b4177c`.
- [x] Red proofs for the gates, per-class measurements, this plan, and the devlog - worker 3.
- [ ] Independent review, integration, merge - coordinator.

## Outcome

The code is done and gated; this session added the record of it and changed no behaviour.

**Verified at** `8b4177c` plus this session's documentation commit. `npm run gates` passes: 189 tests, 189 pass, 0 fail. `npm run verify` reports a 9.75 pp optimal-vs-random gap (CI 5.61..13.89) against a 5.00 pp floor, byte-identical before and after this session apart from its `Elapsed` line. `npm run verify:run` passes all eight checks. Node v24.18.1.

**Red proofs.** Fifteen mutations, each applied to the shipped source, run against the shipped test command, and reverted; all fifteen went red. `docs/learning/gate-proofs.md` carries each mutation, its site and the test's own failure text. Nothing in these two files was found to be a gate that cannot fail.

**Per class, `npm run measure:run -- --class <id>`, 1000 contiguous seeds each, strongest arm (greedy route, search placement).**

| class | Health | win rate | 95% CI | mean acts cleared | mean fights | mean rounds/fight | where most runs end |
|---|---|---|---|---|---|---|---|
| Knight | 200 | 16.50% (165/1000) | 14.33%..18.93% | 2.03 | 11.78 | 8.40 | act 3, killed by the boss (23.7%) |
| Ranger | 180 | 0.30% (3/1000) | 0.10%..0.88% | 1.21 | 7.68 | 7.41 | act 2, killed by an ordinary fight (43.7%) |
| Mage | 160 | 0.00% (0/1000) | 0.00%..0.38% | 0.79 | 6.01 | 11.57 | act 2, killed by an ordinary fight (49.3%) |

The Knight is the class every earlier number in this repo was measured with, and it is the only one of the three that wins runs for this bot. The Ranger reaches act 3 and rarely finishes it. The Mage won no run at any of the four arms, and its fights run about three rounds longer than the Knight's - a 1-Power swing plus a 1-point burn that Armour 1 stops entirely, against enemies that carry Armour 1 from the Shieldwall up.

Per `docs/policies/local-rules.md` these are measurements of the options, not defects to tune away, and no cost, stat or pool weight was changed in response to them. They are also a claim about one bot, not about a player: the routing bot is greedy and the placement bot searches one turn ahead.

**One interaction the numbers create.** `npm run verify:run` runs the Knight and stays green, but the same command pointed at the Mage exits non-zero - `node src/sim/runmeasure.ts --verify --seeds 200 --check-seeds 20 --class mage` fails its eighth check, "the instrument can see a difference", because no run in 200 seeds was won. That is the gate working as designed: it is a statement about the seed window's power to detect a change, and a 0% arm has none. It is recorded here so that a later session pointing `--verify` at a class does not read it as a code failure. The gate's own message already draws the distinction, and the 1000-seed run settles it: the Mage's zero is not a seed-window artefact.

**Not done here.** The independent review of the resolver's ordering changes, which `AGENTS.md` makes high-risk, and the merge to main. Both belong to the coordinator. Until the merge, this work is on branch `worktree-agent-aa48bc3f62599eab6`.
