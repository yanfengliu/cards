# A mutation runner's red is attributed to a failing line, and differenced against a measured green baseline

One of [cards' local rules](../local-rules.md).

Every unit here proves its gates by mutating the tree and watching them go red, with a scratch runner under `.probe/`. **Three things that runner must do, or its reds are claims about the command rather than about the gate.**

1. **Attribute.** Run `node --test` with `--test-reporter=tap` and require the expected test name on a `not ok N - <name>` line. A bare `output.includes(name)` is satisfied by a *passing* test, because every reporter prints the name either way.
2. **Measure the baseline.** Run each distinct command once on the unmutated tree first. It must exit 0, and keep its output: the expected failure must be absent from it. For a test, "absent" means not on a failing line, since TAP prints every name. This is what makes a red attributable for a gate or a simulation as well, where there are no test names to attribute to.
3. **Difference the crash guard too.** A crash string the green run also printed is not evidence of a crash. `test/unlocks.test.ts` logs an expected `SyntaxError` from a deliberately unreadable saved run, and a guard that did not subtract the baseline called every mutation a crash.

And carry **three** self-probes, all three checked before any summary prints. Two are negative controls, required to come back `NON-ZERO, REASON UNCONFIRMED`: one mutation that cannot compile, and one real mutation paired with the name of a test it does **not** break. The third is a positive control and is a different kind of check: a real mutation paired with the name of a test it **does** break, required to come back `RED`.

**The third is not symmetry for its own sake.** With only the two negative controls, every probe asserts that the runner *refuses* to credit something, and nothing asserts it can ever credit anything. An independent review replaced `failingLines(out)` with `return []` — blinding the attribution detector completely — and both probes still reported "came back unconfirmed, as they must", every mutation reported unconfirmed, the summary read `0 of 2 came back red`, and the process **exited 0**. A fully blinded runner passed its own guard. Reproduced again after this rule landed: blinded, `POSITIVE` is the only probe that fails, and the runner exits 2 instead of reporting.

Pair the second and third probes on the **same mutation** under two different test names — one it does not break and one it does. Then the pair proves the runner is reading the name rather than the exit status, which is the actual defect both of them exist for.

**Why.** This is the third runner in this repo and the second that was wrong. Unit 9's recorded a `ReferenceError` as a gate catching a defect. Unit 12's `.probe/mutate-unlocks.mjs` used `out.includes(m.expect)`, and an independent review demonstrated a mutation whose named gate *passed* while a different test failed being reported RED, with the passing line quoted as the evidence. Unit 12's sixteen entries survived re-checking, so nothing recorded was wrong — the instrument was. The mechanism and the code are in `docs/learning/gate-proofs.md` under 2026-09-11.

**Bound.** This is a rule, not a gate, because the runner is scratch and lives under an ignored path: it is written fresh each unit and there is no tracked artefact to check. What enforces it within one unit is the runner's own two probes, which throw rather than print a summary. If a mutation runner ever becomes a tracked tool, this entry is replaced by that tool's own gate.
