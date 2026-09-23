# 2026-09-23 — closing a final review of the run layer

Branch `worktree-agent-ae75d48e5bf3f6327`, cut from `9b36329`. A final acceptance review of `main` returned six run-layer findings. A first worker did most of the work on 2026-09-22 and ran out of session limit while timing its gate runner, having committed nothing. The coordinator saved its tree verbatim as `3d113b0`, with a message that certified nothing. This session verified that tree, finished it, and committed the result as `1a72436`. The suite is 280 tests, from 276 at `9b36329`. Every mutation, its failure text and the runner are in `docs/learning/gate-proofs.md` under 2026-09-23.

## Five defects passed all seven gates

**Timestamp:** 2026-09-22 evening (predecessor) to 2026-09-23 10:23 (`1a72436`)

**Action:** Reproduced each defect on an archive of `9b36329`, then gated it. `heroSpecFor` rebuilt without `traits`, so the Ranger swings once and the Mage never burns. Both Chorus cards gated on First Blood, so no class can draft Chorus at a fresh profile. A sigilled card's race set to human on its way into a fight. A Ranger or Mage run at a partial unlock set, recording its set with the owned half emptied, or replayed without its set. At `9b36329`, `npm run gates` exited 0 on every one.

**Result:** Two checks now read what the engine is handed rather than what the run layer holds. `fightSigilProblems` walks every field of each resolved card and of the hero, read off both objects, so a race, a name or a hero's traits cannot move on the way in. A new test reads the hero entity the engine built inside every fight of every class, through the agent's placement hook. A third new test replays every class from its saved log, through JSON and `migrateRunLog`, at all six rungs of the unlock ladder: 216 runs. A fourth asks every class for every tribal trait and every player race at all 32 sets the five deeds can produce. All of them went red on their defects at `1a72436`.

**Reasoning:** Each defect travelled through a spread: `...hero` in `heroSpecFor`, `...card` in `resolveDeckCard`. The type system promised *a* field and nothing promised the right one. The Knight, the one class `verify:run` plays, has no hero traits, so no amount of widening that gate could see F1. The test that read `run.content.hero` said "fights are handed the class's hero", which is not what it compared, and it now says what it compares.

**Validation:** Thirty-five mutations at `1a72436`, each as its row expects, with the runner's three self-probes passing and the blinded runner exiting 2. The bounds: seeds 1..6 per class, both route styles for the ladder, the setup a fight is handed rather than a resolved fight, and "a class can be offered each trait" rather than "a seed offers it".

## Four guards could never say no

**Timestamp:** 2026-09-23, 09:23–10:23

**Action:** Four guards asked whether an unlock set changed what a run did: `verify:run`'s `seedsSeparated`, and three in `test/unlocks.test.ts`. All four compared `hashRun`, which names the unlock set on purpose, so two sets always hash apart. They compare `hashPlayed` now, which is every line of the digest except the set.

**Result:** At `9b36329`, with `startRun` narrowing by `null` so every set drafted the whole pool, `verify:run` exited 0 and printed `20/20 seed(s) reached a different run at a different set`. The three test guards passed. At `1a72436` the same mutation reads `0/20` and exits 1, and all four guards plus two new ones go red.

**Reasoning:** This is the sixth check this repo has recorded that was built from the value it checks. The unlock line is right to be in `hashRun`; it is wrong for this one question. `verify:run` also counts each pair of neighbouring rungs on its own, because the middle rung is the one that catches a set recorded with its owned half dropped.

**Validation:** A seventh mutation turns `hashPlayed` back into `hashRun`, the regression that would blind all of them at once, and *owning everything gated plays the same run as no unlock layer* goes red on it.

## The gated list had drifted from its own rule

**Timestamp:** 2026-09-23, 09:23–10:23

**Action:** Gated `u_runesmith`, `u_marshal` and `u_elflord`, all three handed over by First Blood; both are the coordinator's decisions. `GATED_IDS` stays hand-written, and a new test holds it to the rule in its header in both directions, with `RULE_EXCEPTIONS` as the written way out.

**Result:** Units 11 and 12 were built side by side from `dcf2cdf`. Unit 11 added six tribal cards to every pool, and after the merge the rule selected ten cards while the list held seven. The header's figures were checked at `cf2092f`, the commit that wrote them: the gated weights (24, 16, 10) were right, and two of the three pool totals were wrong (the Knight's pool weighed 95, not 87; the Mage's 82, not 78). The figures are gone from the header; `npm run measure:run -- --unlocks none --class <id>` prints them. A fresh profile now drafts 12 of the Knight's 21 cards (85 of 116 pool weight), 13 of the Ranger's 20 (83 of 106) and 13 of the Mage's 19 (85 of 101). Every class can still draft every tribal trait there, through its 2-cost carrier only. The thinnest are the Knight's Chorus (the Songkeeper, weight 2 of 85) and the Ranger's Kindle (the Kindler, weight 2 of 83).

**Reasoning:** No number on any card moved; the rule was applied to its data. What moved is the fresh-profile instrument. At `9b36329` and at `1a72436`, `npm run measure:run -- --unlocks none` over 1000 seeds of the Knight drafts from 15 then 12 of 21 cards, and its strongest arm won 823 then 803 runs. That is bot evidence, and it is not gated.

**Validation:** The rule test is red on the list as it stood at `9b36329`, naming all three cards, and red both ways on a moved weight. It is green when a departure is written down with a reason.

## The gate chain starts npm once

**Timestamp:** 2026-09-23, 09:55–10:20

**Action:** `npm run gates` runs `tools/gates/chain.ts`, which reads each gate's command from `package.json` and runs it directly. `verify:run` plays only the arm its verdicts read; the other three arms are `measure:run`'s.

**Result:** Warm, five interleaved runs each, on a 32-thread machine at about 80% CPU from other work: `npm run gates` took a median 31.7s at `9b36329` and 21.0s at `1a72436`, with the four new tests included. `verify:run`'s own command went from 9.3s to 6.8s. Each `npm run` start costs about 0.45s.

**Reasoning:** The predecessor's figures, 2.6s of a 19.2s gate and 3.1s of an 8.4s `verify:run`, were taken on 2026-09-22. This session measured again, interleaved, and `tools/gates/chain.ts` and `src/sim/runmeasure.ts` now carry today's figures and the load they were taken under. The same code through the old `&&` chain took 28.1s against 21.0s: more than seven npm starts explain, so the per-start figure is the one to trust.

**Validation:** The chain went red and stopped with the right status on a type error (exit 2), a failing test (exit 1), an unchained `gate:*` script and a misspelt link (exit 2 each). Each of the seven gates still runs alone as `npm run <name>`, all exiting 0. `npm run verify` printed the same output at both revisions apart from its `Elapsed:` line.

**Code reviewer comments:** A separate Claude agent reviewed `9b36329..69c44bc` read-only and found nothing material. Its first minor finding was real in wording and too strong in effect. The ladder test's name promised each fight is held to its class's hero, and inside the test that check was only borrowed: the test held each fight to `run.content.hero`, while two tests in `test/unlocks.test.ts` held that hero to the class across the unlock sets. A hero swapped whenever a set is passed was therefore already red at `1a72436`. The ladder test now makes the check itself, red on that mutation. The chain's no-argument message suggested a list the chain refuses, and one comment misdescribed a mutation; both are fixed. The multi-CLI review this repo asks for on an `AGENTS.md` change has not run.

**Notes:** The predecessor's test comments pointed at a 2026-09-22 entry in `docs/learning/gate-proofs.md` that was never written. They point at this round's entry now, and every figure in it was taken here.
