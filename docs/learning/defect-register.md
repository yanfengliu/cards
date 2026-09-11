# Defect register

A defect the user reports is recorded here and gated, never only fixed. One `##` section per defect, newest first: the symptom as it was reported, what the investigation found, the root cause, and how it is checked from now on.

This file is not a queue. Unlike a lesson in `docs/learning/lessons.md`, an entry stays after it becomes a gate — the register is the standing list of what the gates could not see, which is where the next defect comes from. The gate's own red-proof lives in `docs/learning/gate-proofs.md`; this file says why the gate exists.

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
