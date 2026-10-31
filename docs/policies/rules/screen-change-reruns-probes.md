# A change to a screen re-runs every probe that navigates to it

One of [cards' local rules](../local-rules.md).

The probes under `tools/ui-probe/` are outside `npm run gates` — they need Chrome and a running `npm start`, so a per-commit gate cannot hold them. That means nothing notices when one stops working. So: **a change to which screen the app shows first, to an element id or a `data-` attribute a probe waits on, or to the flow between screens, re-runs every probe that touches it, in the same session.** Today that is `tools/ui-probe/play.ts`, `run.ts`, `pick.ts` and `icons.ts`, and each names in its header what it navigates to.

**Why.** Unit 10 put the class-pick screen in front of the map. `tools/ui-probe/run.ts` opens `?seed=&theme=&fresh=1` and waits for `#run-map svg`, which is inside the panel the pick screen hides — so the repo's own instrument for playing a whole run through the browser died on a 30-second Playwright timeout, and stayed dead for a whole unit while `npm run gates` was green throughout. It was found by writing a second probe, not by any check. A probe that is not run by a gate rots exactly like a test that is not run, and there is nothing here that would have noticed.

**Bound.** This is a rule, not a gate, and it is a rule because the gate is not available: running a probe needs a browser and a server. It fails the way any remembered rule fails. If the probes ever become runnable in CI, this entry is replaced by that job.
