# Defect register

A defect the user reports is recorded here and gated, never only fixed. One `##` section per defect, newest first: the symptom as it was reported, what the investigation found, the root cause, and how it is checked from now on.

This file is not a queue. Unlike a lesson in `docs/learning/lessons.md`, an entry stays after it becomes a gate — the register is the standing list of what the gates could not see, which is where the next defect comes from. The gate's own red-proof lives in `docs/learning/gate-proofs.md`; this file says why the gate exists.

## 2026-09-23 — the reward shelf printed the new Health against the old maximum

**Symptom, as reported.** Finding F2 of the final acceptance review of `main` at `9b36329`: after the Sigil of the Oak, the reward shelf read "146 of 180 Health" while the HUD above it read 146/210.

**Investigation.** `src/ui/runapp.ts:832` built the shelf's opening line itself and read the maximum from `s.hero.maxHealth`. The hero sigil offer in `src/ui/sigils.ts:54` built the same line from the phase's `maxHealthAfter` and was right. The HUD read the phase for Health, maximum and gold, but its sigil chips read `heldHeroSigils(state)`, so the Oak was missing from the HUD until the shelf was answered: a second defect of the same kind. Reproduced at the shipped line headlessly as W1, `knight seed 1 greedy, reward screen at node 21: the screen says "192 of 200 Health" and the replay sets 192 of 230`, and through the page as P1, `the reward screen says "140 of 180 Health", the HUD says 140/210` on seed 2 as the Ranger. An independent review of the fix found a third: over a fight's end banner, before "Take your reward" hands the fight over, the phase is still `fight`, so the HUD kept what the hero walked in with, 200/200 and 0 gold under "Your hero finished on 194 of 200 Health" on Knight seed 7's first fight.

**Root cause.** From the moment a fight ends until its node commits, the canonical run state is stale by design: `src/ui/run.ts` moves it when the node commits. Over the end banner the finished fight says what `visit` will set, and from `finishFight` on the phase carries it. Three surfaces in that window read the state instead. No test could see any of them, because the shelf's sentence and the HUD are written inside `startRunApp`, which needs a document.

**How it is checked from now on.** Every surface in the window reads one function, `heroNow(state, phase, ended)` in `src/ui/run.ts`: the shelf and the hero sigil offer through `wonLeadHtml`, and the HUD's numbers and chips over the end banner and after it. What a finished fight settles is one helper, `afterFight`, that `finishFight` uses too. `test/ui-won.test.ts` plays 24 runs (three classes, seeds 1..4, two routes). At every fight's end, won or lost, it holds what `heroNow` gives the HUD to what a second controller's replay sets. It renders every hero sigil, reward and attach screen those runs reach through the functions `runapp.ts` calls, and holds every "<n> of <m> Health" and gold statement on them, and the HUD's numbers and chips, to the same replay, not to `heroNow`. It requires the gold line wherever it requires Health, and a shelf after a maximum-moving sigil for each class, so the case the defect lived in cannot fall out of the window. W1–W7 and W9–W11 in `docs/learning/gate-proofs.md` are its red-proofs. `tools/ui-probe/run.ts` reads the opening line, the HUD's Health and its sigil chips off the page at every hero sigil screen and shelf, and the HUD's Health over every end banner, and holds each to the run (P1–P5).

**What is still not covered.** The unit gate cannot see whether `runapp.ts` wires these functions in: cutting the HUD from `heroNow`, or not handing it the finished fight, leaves it green (W8c, W12c). The probe sees both, but it needs Chrome and a server and is outside `npm run gates`, so only the probe rule in `docs/policies/local-rules.md` makes anyone run it. A statement about the hero in any shape other than the two the test parses is not read. And the end banner's "of" is the fight's maximum, which is the Health the hero walked in with, so after a damaged fight it differs from the HUD's maximum by design; nothing holds that number to the run.

## 2026-09-10 — the report printed a style word the API refuses: `placement: 'search'`

**Symptom, as reported.** A probe written to count tribal drafts passed `placement: 'search'` to `makeRunAgent` and died inside the fight with `TypeError: policy is not a function`. The error named neither the bad input nor what would have satisfied it. `docs/devlog/detailed/2026-09-10-tribes.md:33` recorded the incident at the time.

**Investigation.** The probe was a `.mjs` file, so nothing typechecked its argument. `'search'` is the word every table `npm run measure:run` prints — the arm was labelled `greedy route / search placement` — and it is not a word the API has ever accepted: `PlacementStyle` was `'lookahead' | 'random' | 'right'`, and `lookaheadPlacer`, `LookaheadOptions`, `DEFAULT_LOOKAHEAD` and `measure.ts`'s `BOTS.lookahead` all say "lookahead". Four label strings in one file said "search"; nothing anywhere read across the two, so neither side could notice the other had drifted. The labels were hand-written strings passed to `runArm` as its first parameter, beside the style values, and had been since unit 8.

Reproduced on the shipped tree with the `default:` arm deleted from `placementFor`, through the same `.mjs` shape the probe had:

```
makeRunAgent returned; agent.placement is undefined
TypeError: policy is not a function
```

The second half of the investigation is what made this worth a register entry rather than a rename. `makeRunAgent` read `opts.route === 'greedy' ? GREEDY_CHOICES : randomAgentChoices(opts.seed)`, so the **route** dial had the same hole with a worse failure: an unknown route was not a crash, it was the random router. Measured at seed 5, placement held at `right`, with the old ternary in place:

```
route "greedy"     -> 58794c0c3f1ae76d
route "random"     -> 334776f7879e8dba
route "greedy-ish" -> 334776f7879e8dba
```

A misspelt route returned a complete, plausible, wrong measurement under the label the caller asked for.

**Root cause.** Two switches with no `default:` arm, behind a label the report wrote by hand. TypeScript treats a switch covering every union member as exhaustive and adds nothing at run time, so the only thing standing between a caller and `undefined` was the compiler — and the callers that matter here are `.mjs` probes, which the compiler never sees. Nothing bound the printed word to the accepted value, so the two were free to drift, and the report is exactly where a probe author reads the word from.

**How it is checked from now on.** Four things, in `src/sim/runbots.ts`, `src/sim/runmeasure.ts` and `test/runbots.test.ts`:

1. `ROUTE_STYLES` and `PLACEMENT_STYLES` are the single source of the accepted set — the unions are read off the arrays, so the list a refusal prints and the list the type describes cannot differ.
2. Both switches have a `default:` arm that refuses by name: what happened, the exact value (through `String(...)`, with its `typeof`, so a number, `undefined`, an object or a symbol all print legibly), and the whole accepted set. The `const unreachable: never = style` guard inside that arm makes a member added to either array with no `case` a typecheck failure as well.
3. `runArm` takes no `name` parameter. An arm names itself through `armLabel(route, placement)`, so the report has no seam where a word the API refuses could be written.
4. `test/runbots.test.ts` holds seven gates covering the class rather than the instance: the refusal on both dials, for strings and non-strings; every member of both arrays building something that actually works; and the arm label containing no word that is not an accepted style value. Nine mutations, all red — `docs/learning/gate-proofs.md`, entry of 2026-09-10.

**What is still not covered.** The gates say the label a reader copies is a value `makeRunAgent` takes. They say nothing about another file inventing its own arm label — what stops that is the missing parameter, not a check. And `npm run measure:ablate` and `src/sim/measure.ts` name their arms in prose (`A optimal placement`, `C append right`); those are bot names in a fight report rather than API values, and no API takes them.
