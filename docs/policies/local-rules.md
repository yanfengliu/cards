# Local rules — cards

Rules that are true for this repo and are not fleet canon. The fleet constitution lives in `../../AGENTS.md` inside the `FLEET-CANON` block and is never edited here.

## Balance measures options; it does not tune content toward a shape

Balance work does not tune content to produce a particular board shape or to make a specific card or strategy viable. The game offers options; the player makes them work. A measurement showing an option is weak is information for the player, not a defect in the pool.

**Why.** Owner ruling, 2026-09-09. Mutual damage landed and the measured player line fell to two units at every viewport; that was reported as a defect, with a proposal to re-cost the card pool until boards widened. The owner refused the framing: "The unlimited board is just a setting. Don't just try to reach unlimited board for its own sake. I never [said] AoE is a good option. It is simply an option. It is up to the player to choose their strategies and make it work." Measurements describe what the rules produce; they do not prescribe what content must be tuned to produce. The design of record states the same principle under **[owner]** in `docs/design/game.md`, and `ARCHITECTURE.md` bounds its balance loop with it.

**Bound.** Measuring is what the ruling asks for, so every metric in `ARCHITECTURE.md` keeps being run. What is ruled out is acting on a measurement by re-tuning content toward a shape. A change to what the player can see — the odds, the enemy's intent, a card's own text — is not balance work and is not covered here.

## The engine reports what reached a target; the view decides what is worth saying

**The resolver announces every effect that reached a target and nothing about one that found none.** *Reached a target* is not *changed the board*: an effect that lands on a body whose Armour eats the whole point is reported at 0, and so is a 0-Power defender's retaliation. Whether a 0 is worth putting in front of a player is decided in `src/render/` and `src/ui/`, never in `apply`.

Today that judgement is one rule, in `buildBeats`: once a hero is down the fight is decided, and a blow that moved no Health is not drawn. A `fizzled` is exempt — it is the receipt for spent energy, not a blow — and an attack and the retaliation it drew are one blow, kept or dropped together. `src/render/odds.ts` answers the same way on the forecast side: a unit taking nothing is absent from the burn rather than present at zero.

**Why.** Unit 10 wrote the rule down as "the resolver announces every change it makes and nothing it does not", in four places, and that is not what the code does — the `scorch` loop pushes `damaged` for every living non-hero, `dealt === 0` included, and `test/hero-attacks.test.ts` pins `{raw: 1, dealt: 0}` as correct. A second independent review measured 163 zero-change announcements surviving the fight-ending `died` across the shipped encounters, and `src/ui/app.ts` played every one, so a player read "**Warchief** dies." and then "scorches **Orc Shieldwall** for **0**". A wrong rule in four places is worse than no rule: the next author implements the sentence, not the code. Suppressing it in `apply` would have been implementing the sentence.

**Bound.** This is where the judgement lives, not a list of what it decides. The one rule above is gated by "once the fight is decided the screen stops narrating blows that moved nothing" and "a trade after the fight is decided is drawn whole or not at all", both in `test/render-view.test.ts`, over the corpus of decided fights the three classes produce. A second such rule belongs beside the first, in the view, with its own gate.

## A change to a screen re-runs every probe that navigates to it

The probes under `tools/ui-probe/` are outside `npm run gates` — they need Chrome and a running `npm start`, so a per-commit gate cannot hold them. That means nothing notices when one stops working. So: **a change to which screen the app shows first, to an element id or a `data-` attribute a probe waits on, or to the flow between screens, re-runs every probe that touches it, in the same session.** Today that is `tools/ui-probe/play.ts`, `run.ts`, `pick.ts` and `icons.ts`, and each names in its header what it navigates to.

**Why.** Unit 10 put the class-pick screen in front of the map. `tools/ui-probe/run.ts` opens `?seed=&theme=&fresh=1` and waits for `#run-map svg`, which is inside the panel the pick screen hides — so the repo's own instrument for playing a whole run through the browser died on a 30-second Playwright timeout, and stayed dead for a whole unit while `npm run gates` was green throughout. It was found by writing a second probe, not by any check. A probe that is not run by a gate rots exactly like a test that is not run, and there is nothing here that would have noticed.

**Bound.** This is a rule, not a gate, and it is a rule because the gate is not available: running a probe needs a browser and a server. It fails the way any remembered rule fails. If the probes ever become runnable in CI, this entry is replaced by that job.

## A saved log is a list of indices into offers, so content retires it, not just format

A `RunLog` records *which option was picked*, never what the option was. Every reward pick, shop buy and event choice in it is an index into a shelf the replay redraws from the content of the day. So **a change to the reward table, the shop, the event list or a card's own numbers retires every log recorded before it, and `RUN_LOG_FORMAT` says nothing about that.** A golden log kept as a migration fixture pins the content it was recorded against, in the test, beside the log — or it is re-recorded and the old one deleted. It is never left in the tree replaying against `RUN_CONTENT` and hoping.

**Why.** Unit 9 inherited `test/golden/run-log-format-1-seed-6-random.json` and `-seed-7-greedy.json`, recorded at `c13a0cc` against `REWARD_TABLE`'s ten entries. Unit 10 replaced that table with the Knight's fifteen at different weights. Replaying either log against today's content does not hash differently — it throws `run pool: no deck instance "u_shieldbearer#14" in this run's deck`, because a `reward` pick of index *n* now names a different card and the fight's action list then names an instance the deck never minted. The format was fine the whole time. `test/sigils.test.ts` pins the ten-entry table as `LEGACY_REWARDS`, and both logs then replay to a canonical string that, with unit 10's deliberate `class=` line removed, hashes exactly to what each recorded: `f5abcf3d2118a2b9` and `94ff2460abecaf26`.

**Bound.** The pin is a standing cost, and this rule is the reminder that it is one. It covers the reward table today; the next content change that touches something those two runs draw needs the same pin or the goldens re-recorded. The gate is `the two golden format 1 logs replay to the runs they recorded` in `test/sigils.test.ts`, and it fails loudly rather than silently — a retired golden throws inside `replayRun`.
