# 2026-09-23 — closing the final acceptance review of `907c8e9`

Branch `worktree-agent-ae84844a610590c1d`, cut from `907c8e9`. The review found the code acceptable and the record not: two blockers (D and B), two low findings (C and A), four nits and one known issue to record. The commits start at `09b82db`, one or more per finding, and each section below names its own. The suite is 288 tests, from 286. Every mutation, its failure text and the runner are in `docs/learning/gate-proofs.md` under "closing the final acceptance review of `907c8e9`".

## "Every fight is handed its ledger" was one setup at an ordinary fight

**Timestamp:** 2026-09-23 17:58–18:20 (`0a1c8fd`, `e3c2d54`)

**Action:** `foughtSigilProblems` reads one live fight at its first placement - the pool the engine resolves cards through, the hero entity it built, the enemy hero and the deck it shuffled - and holds it to the run's content plus its ledger at that node. `watchFights` hands it every fight a run plays through the agent's placement policy, the hook the hero test already used. The ladder test watches all 216 of its runs, and `verify:run` watches its 20 check runs.

**Result:** The review's three changes to what elite and boss fights are handed - card sigils stripped (129 of 360 runs played differently), a sigilled card's race moved (4 of 360), hero-sigil Power and Armour dropped (163 of 360) - each passed all seven gates at `907c8e9`. Each is now red in the ladder test, in `verify:run` and in `npm run gates`. `verify:run` held 263 fights on its check seeds: 167 ordinary, 39 elites, 57 bosses. No number it printed before moved.

**Reasoning:** The coordinator chose to make the check real rather than narrow the claim. `fightSigilProblems` stays, because it is the only reading of a grant taken after the last fight, which no fight receives. The watch reads the fight before round 1 resolves, and refuses a later reading rather than guess at one. It does not hold the built hero's `maxHealth`: the engine sets that to the Health a fight is handed, which is known issue 5, and holding it would pin that defect as correct.

**Validation:** Seventeen rows as wanted, with the three self-probes, and the blinded runner exiting 2. Two controls show the readings that were the whole check at `907c8e9` still cannot see the change. A new detector test makes the check and the watch fire on fixture fights at an elite and at the boss, because the ladder test cannot see a blinded detector: it finds nothing wrong in any run and passes (D6c).

## A fix that lived in one call, with nothing calling it

**Timestamp:** 2026-09-23 18:21–18:26 (`fdeeb03`, `ae17e31`)

**Action:** A test runs `checkUnlockReplay` on a content its sets cannot narrow - every gated id taken out of every pool and out of the sigils - and requires it to count no seed separated. It also runs it on the shipped content over the same four seeds, where every neighbouring pair must separate.

**Result:** The review's exact revert (`hashRun` back in the call, `hashPlayed` out of the import) is red in the test and stops the chain. `verify:run` alone stays green on it, and with the narrowing also off still prints the review's `20/20 seed(s) played differently`. So the test, not `verify:run`, is what sees it.

## The race tooltips were one sentence for three classes

**Timestamp:** 2026-09-23 18:27–18:39 (`11fe5db`, `2507cbc`)

**Action:** A starter every class can hold is named plainly, and one some class can never hold is named as the class that starts with it: "the Squire and Berserker, the Ranger's Hornblower, and the Mage's Herald". The gate asks each class on its own, and reads which class a card is given to off the words.

**Result:** The tooltips as they shipped are red on the review's seven (class, card) pairs exactly. Every example they showed before is still in them. On the fight screen, a real hover of a human, a dwarf and an elf card showed the new sentences on the race badge.

**Reasoning:** The simpler fix, naming only cards every class can hold, left the Elf line as "archers and wardens — the Wayfinder", which names neither an archer nor a warden. That would have traded one untrue sentence for another. Making the panel class-aware would have meant threading the class through `explainCard` and the fight screen for a low finding.

**Validation:** A first run wanted a control (A1m: the as-shipped tooltips against the gate with its per-class question merged back) to come back green, and it came back red. The gate's other half, which requires some tooltip to give a card to a class, caught the as-shipped sentences first. So A1m was not isolating the per-class question. A4 does: one class-limited card named plainly while the others keep their class is red, and green with the question merged back (A4m), which is the review's finding reproduced.

## Two traps in the tooling

**Notes:** `sed -i` in this machine's Git Bash rewrote `src/run/sigils.ts` from CRLF to LF without saying so, and `tsc` still passed on it. A line-ending check caught it before the commit. Use the editor tool or a Node script on these files, and check the endings after. And `docs/work/12_unlocks/plan.md` holds both endings - 26 of its 142 lines end in CR - and `docs/work/.gitattributes` stores it byte for byte. Its two lines were edited by a script that splits on `\n` and keeps each line's own ending, and the file was read back to confirm the edit landed and no ending moved.

## The record

**Action:** Unit 12's plan records its merge at `efcd8f6` (B). "Cheapest first" is gone from `AGENTS.md`, `README.md` and `tools/gates/chain.ts`, where the chain's own timing contradicted it, and the order is kept and described as what it is. The README no longer says you cast spells or equip your hero, which no mode deals, and it lists unit 9. Unit 13's plan says its `Created:` is the allocator's UTC date, so a merge at 18:10 on 09-10 at -0700 is not a merge before creation. The fight screen's maximum Health is its own open entry in `docs/learning/defect-register.md`, with the fix direction, and is not fixed. The run-layer devlog carries a dated correction to its "cannot move on the way in".

**Code reviewer comments:** None this round. No independent review of these commits has run. `AGENTS.md` changed on two lines, 114 and 121, and the multi-CLI review this repo asks for on an `AGENTS.md` change has not run.
