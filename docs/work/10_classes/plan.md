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

## Four sessions, four commits

A later reader will find three commits and should know why.

- `2c13ea9` "WIP: preserved by coordinator after rate-limit death; unverified" - the first worker, on branch `worktree-agent-a0855ebc014eb8227`. It produced the class content, the run plumbing, the whole render and UI layer (class-pick screen, crests, class terms, the icons and blazons the three heroes need) and a first pass at the engine. It wrote no tests and was not verified. The coordinator preserved the tree rather than lose it.
- `5b901b2` - the coordinator's merge of that WIP into the second worker's branch.
- `8b4177c` "Classes: Volley and Scorch as resolver verbs, a run started as a class, and the gates for both" - the second worker, on branch `worktree-agent-a5b3c70c8b60a7b3a`. It finished the engine (Scorch became its own effect kind), corrected the run plumbing, restored `src/sim/runmeasure.ts` to main and gave it `--class` alone, and wrote the 769 lines of tests that are this unit's gates. It also died to a rate limit, before proving any of those gates could go red and before the plan, the measurements or the devlog existed.

This document, the red proofs in `docs/learning/gate-proofs.md` and the per-class measurements are the third session, which changed no behaviour.

The fourth session closed the independent review, on branch `worktree-agent-a2039c8da0f15808d` cut from `2781bab`. It is the first of the four to change behaviour that a player sees.

## Acceptance criteria

- [x] Three classes exist as data, each a hero, a starting deck and a pool of known cards - `test/classes.test.ts`, first test.
- [x] Each hero is the design's attack: the Knight swings for 2, the Ranger for 1 twice, the Mage for 1 with a rider - `test/classes.test.ts`, and the verbs themselves in `test/hero-attacks.test.ts`.
- [x] Every class pool holds every race the player's cards come in, read off the cards rather than listed - `test/classes.test.ts`. All three pools hold human, dwarf and elf.
- [x] A run started as a class is that class from its first node to its hash, and three classes on one seed are three different runs sharing one map - `test/classes.test.ts`.
- [x] A log written before classes existed still replays to the hash it always did - `test/classes.test.ts`, against a fixture of the old `{ seed, nodes }` shape.
- [x] Volley and Scorch are gated on the event stream and the effect trace, not only on final state - `test/hero-attacks.test.ts`.
- [x] Every load-bearing claim above has been made to go red by reintroducing its defect - 19 mutations in `docs/learning/gate-proofs.md`, entry of 2026-09-10, covering every mutation the two files name for themselves and eight more.
- [x] Each class measured on its own and reported - `npm run measure:run -- --class <id>`, 1000 seeds each, in Outcome below.
- [x] `npm run gates` passes and `npm run verify` is unchanged.
- [x] Independent review of the resolver's ordering changes, which `AGENTS.md` makes high-risk. Commissioned by the coordinator against `8b4177c`. It found the resolver **sound** — all 22 mutations the test files claim to catch go red, deaths stay batched, ordering intact, mutual damage takes no new special case — and found four things in the surfaces the new verbs feed.
- [x] The review's findings closed, each with a gate watched going red. Session four, below.
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

**Red proofs.** Nineteen mutations, each applied to the shipped source, run against the shipped test command, and reverted; all nineteen went red. That covers the eleven the two test files name in their own comments plus eight more. `docs/learning/gate-proofs.md` carries each mutation, its site and the test's own failure text. Nothing in these two files was found to be a gate that cannot fail.

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

## Session four — the review's findings, closed

**Verified at** branch `worktree-agent-a2039c8da0f15808d`, cut from `2781bab`. `npm run gates` passes: **195 tests, 195 pass, 0 fail**, up from 189. Node v24.18.1. `npm run verify` and `npm run verify:run` print tables byte-identical to the base — every number, every hash — which is the evidence that none of this moved an outcome. Fourteen mutations in `docs/learning/gate-proofs.md`, all the colour they were meant to be.

**F1 — the class-pick screen had no test and no probe.** `test/classes.test.ts` built its own `renderClassPick` call and never touched `src/ui/runapp.ts`, so dropping the Mage from what the screen is handed left the suite green. That was not a sample: at `2781bab` **no file under `test/` named `runapp` at all**, so nothing inside it could be gated. The two decisions are now `PICKABLE_CLASSES`/`classPickHtml` and `pickableClassId`, exported and DOM-free, and both callers of a class id from outside the app — `?class=` and the clicked button — go through the one guard. `tools/ui-probe/pick.ts` is new and is the visual half.

The probe found something on its first run: **`tools/ui-probe/run.ts` had been broken for a whole unit.** It waited for `#run-map svg` and the class pick now stands in front of that, so the repo's own instrument for playing a run through the browser had been dying on a timeout with nothing saying so. It clicks the Knight now, and seed 7 plays through and hashes `3d135f5e12b240ea`, identical to headless.

**F2 — the render layer hardcoded Volley's number** while its header said it derives it. `VOLLEY_SWINGS` was never imported under `src/render/`; "twice" was typed in four places. All four are now built from `timesWord(VOLLEY_SWINGS)`, and `src/sim/runbots.ts`'s third copy is `card.power * (VOLLEY_SWINGS - 1)` — identical at 2, following the constant at 3. The gate measures the swings off a real drain and looks the word up in a table the test file owns, because a test asserting `VOLLEY_SWINGS === 2` is repaired by editing the test.

**F3 — the odds understated a Mage's turn fourfold.** Scorch was absent from `src/render/odds.ts` entirely, and `swingsOf`'s use there was ungated. `IncomingOdds` gains `scorchers` and `burnOn`; the intent line adds "Your Scorch burns N more across the line, whatever the rolls", or says the Armour stopped it. Both gates compare the promise against a resolved phase rather than against themselves, and the corpus now walks all three class heroes.

**F4 — an act keeps resolving after its own blow ended the fight, and the commit was inconsistent about it.** Measured at 43 stray `fizzled` in 499 Ranger wins and 62 stray `damaged` in 491 Mage wins, over 500 `trivial` seeds with append-right placement, driven through `src/ui/session.ts`'s `beginRound`/`commitRound` — the shipped seam, the same one `test/render-view.test.ts` walks. Nothing in that probe re-implements combat or targeting. **The probe itself is scratch under the ignored `.probe/`, so this table cannot be re-run from a clean checkout;** the rule it measured is gated by "an act that ended the fight finishes, and says nothing it did not do", and promoting the probe to `tools/` is the integration owner's call rather than this session's — `AGENTS.md` names three simulation runners and adding a fourth is an edit to a file this session was told to touch on one line only. **The rule chosen: the act finishes, and the resolver announces every change it makes and nothing it does not.** So an attack with no legal target says nothing — matching the Scorch rule that was already there — while a burn that lands is still announced, because the board really did change, and a *spell* into an empty line still fizzles, because energy was spent on it. Stopping the queue instead would have been a change to the resolution contract and would have dropped board changes the view had already been told about. The rule is in the resolver's header and in `ARCHITECTURE.md`; the Ranger's stray fizzles are 0 after it and the win counts are unchanged.

**F5 — the documents that own these rules.** `ARCHITECTURE.md` now lists the effect vocabulary and records `scorch` as **authorised by the coordinator**, which its own point 8 requires; it also states the F4 rule. `docs/design/game.md` gains the Mage's rider and the Volley death rule, both marked agent-decided and open to the owner, each with a walked example — and both examples are gated in `test/hero-attacks.test.ts`, number for number. `AGENTS.md` gained `--class` on one line of its Gates section, outside the canon block; `npm run sync-canon` from `../fleet` reports 27 repos current.

**F6 — bounds.** Stated in each gate's own header: the Scorch/Wake test builds all four units on one side and is blind to a side-order reversal (`test/resolver-order.test.ts` is where that lives); `verify:run`'s eight invariants run the Knight alone, and pointing `--verify` at the Mage fails its eighth check for a reason that is not a code failure.

**Not done here.** The merge to main, which belongs to the coordinator, and a re-review of these changes — the resolver's `attack` case was touched, which `AGENTS.md` makes high-risk. Until the merge, this work is on branch `worktree-agent-a2039c8da0f15808d`.

## Session five — a second review's findings, closed

**Verified at** branch `worktree-agent-ac92c8ed9709f58e2`, cut from `8a37fcf`. `npm run gates` passes: **199 tests, 199 pass, 0 fail**, up from 195. Node v24.18.1. `npm run verify` and `npm run verify:run` print tables byte-identical to the base — every number and every hash, with only the wall-clock `Elapsed:` line differing. Seventeen mutations in `docs/learning/gate-proofs.md`, all the colour they were meant to be, no broken anchor. No cost, stat, pool weight or class number moved.

**F-1 — the rule session four wrote down is not the rule the engine implements.** The resolver's header said a Scorch that burns announces it "because the board really did change". False when Armour ate it: the `scorch` loop pushes `damaged` for every living non-hero including `dealt === 0`, and `test/hero-attacks.test.ts` pins `{raw: 1, dealt: 0}` as correct. Measured through the shipped pipeline — `beginRound`/`commitRound` plus `buildBeats`, per segment, the way `src/ui/app.ts` runs it — **215 zero-change beats survived the fight-ending `died` over 4500 fights** (three classes × three encounters × 500 seeds): 67 Ranger `attack`, 148 Mage `spell`, 0 `retaliate`. On screen that is "**Warchief** dies." then "scorches **Orc Shieldwall** for **0**".

The code was right and the sentence was wrong, so the sentence was corrected in all four places — the resolver's header, `ARCHITECTURE.md`, the session-four devlog entry (marked as a dated correction rather than rewritten), and `docs/policies/local-rules.md`, which gains it as a standing rule. **The resolver announces every effect that reached a target and nothing about one that found none**, 0 included, because *reached a target* and *changed the board* come apart exactly where Armour is at least the damage, and a 0-Power defender hitting back for 0 is a blow that bounced rather than one that never came.

The player-facing half went to the view, where it belongs: `buildBeats` drops a blow that moved no Health once a hero is down. It leaves a `fizzled` alone — that is the receipt for spent energy, not a blow — and it treats a trade as one blow, so "hits back" never appears with no swing above it. After it the same 4500-fight sweep reports **0**, with the decided-fight counts unchanged. `src/render/odds.ts` already answered the same way on the forecast side, so this makes two surfaces agree rather than inventing a third rule.

**F-2 — the last `fizzle` producer is a spell and the log called it an attack.** `src/ui/app.ts` said "has no legal target — the attack fizzles"; after session four the only producers are `damageOne`, `damageAll` and `buffAll`, all cast from a card that cost energy. It now names the caster and says "spell", because a spell is not an `act` and has no "X acts." line above it to carry the subject. Latent: nothing casts through `src/ui/session.ts`.

**F-3 — the reachability argument discriminated nothing.** The header argued the empty-target case is unreachable for `attack` because an empty pool means the defending hero is dead — true, and irrelevant, because `damageOne` calls the same `legalTargets` on the same boards. **The discriminator is the energy**, and the header now says so. On `fight.ts`'s `applyCasts` running before `settleResult` with no result check between casts: a `damageOne` that kills the enemy hero followed by a second spell does print `fizzled` under a `died`, and that is left alone — the second spell's energy was spent whatever the first one did. No shipped content reaches it.

**F-4 — a gate whose claim about itself was false.** `test/rules.test.ts` asserted `trace.map(kind) === ['attack']` with the message "the effect was applied, not skipped". `drain` pushes to `trace` *before* calling `apply`, so it recorded dequeuing. Confirmed at this revision: replacing the whole `attack` case with `return { events: [], spawned: [] }` leaves every assertion in that test's empty-pool arm passing. It now runs the same effect once against a board that *has* a target and asserts the `attacked`/`retaliated` that come back; under the same mutation the control is the first assertion to fail. The rest of the suite was checked for the shape — every other `trace` assertion sits beside an event assertion that observes application.

**F-5 — the broad gate excluded the population under test.** `test/render-view.test.ts`'s odds corpus skipped on `died || result !== 'ongoing'`, which is exactly the fight-ending phase. The two exclusions are now counted separately and both asserted non-empty, and the header says the gate is blind to the decided phase in both directions and names what covers it. That is the new corpus walk, whose whole population *is* decided fights.

**F-6 — the doc gate was one-way.** "the two play examples in docs/design/game.md walk exactly as written" transcribed the document's numbers. It now reads the file: every number both fixtures are built from is parsed out of `game.md` by a helper that fails loudly when the sentence it reads is no longer there. Three mutations prove the new direction — the Shieldwall's Armour edited to 2, the Ranger's wall edited to 17, and the Archer's line reworded so the parse misses — and the old direction still goes red.

**F-7 and F-9 — the two small ones.** `src/render/odds.ts`'s `damageIfHit` read `e.armour` where `state.ts` says every damage site reads `armourOf`; it had **no consumer anywhere**, so it was deleted rather than repaired. The gate for the class is a text check and says why it is one: equipment is the only thing that makes the two differ, only heroes have slots, and the burn never reaches a hero, so no board can tell them apart today. `buffAll`'s fizzle is unreachable from `cast.ts` — a buff is aimed at the caster's own side and the caster is alive past the guard — and it was **marked and gated rather than removed**: it is reachable through the effect vocabulary, it is the correct answer there, and deleting it would make the first card that aims a buff elsewhere fail silently.

**The probe plays all three classes now.** `tools/ui-probe/run.ts` hardcoded the Knight, so the Ranger and the Mage — the two classes the unit added — had never been played through the DOM. The class is a parameter and `all` is the default. Seed 7, light: the Knight dies after 18 nodes and 13 fights, the Ranger after 12 nodes and 9, the Mage after 9 nodes and 7, and all three page hashes match their own headless runs (`3d135f5e12b240ea`, `05c0abc0051e0c26`, `00d9697c77f5df89`). The probe also prints the log's last eight lines at every banner, because a screenshot shows only the log's scrolled viewport and the lines this change is about are the ones that scroll off it. `tools/ui-probe/pick.ts` was re-run for the same reason and is green.

**Not done here.** The merge to main, and an independent re-review — `src/engine/resolver.ts` was touched, though only its comments, and `AGENTS.md` makes that file high-risk. Until the merge, this work is on branch `worktree-agent-ac92c8ed9709f58e2`.
