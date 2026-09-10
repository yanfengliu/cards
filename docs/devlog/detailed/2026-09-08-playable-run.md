# 2026-09-08 — the playable run

Detail a later session could trip over. The summary line is in `docs/devlog/summary.md`; the round's own record is `docs/work/8_playable-run/plan.md`.

## The run loop cannot be driven by a screen, and the fix is to never drive it

**Timestamp:** 2026-09-08 20:15–20:40

**Action:** `src/ui/run.ts` advances a run by appending a node record to a `RunLog` and calling `replayRun` from the seed. It never calls `runRun`, and it never calls `step` or `visit`, which are not exported.

**Reasoning:** `runRun` is a synchronous loop that asks an agent for each integer and plays each fight itself with `runFight`, whose card choice is the bot's `selectPlays`. A person chooses their own cards on their own clock, so there is no agent to hand `runRun` that reproduces a hand-played fight; the only run-API entry that takes a fight the caller played is `replayRun`, through the record's `fight` list. The alternative — exporting `step` or adding a suspendable driver to `src/run/` — was outside the assignment's allowed paths, and turned out not to be needed. Replaying from the seed after every node costs microseconds; a whole run is at most 24 nodes and about 15 fights.

**What the design still has to duplicate:** an offer must be shown before the choice that completes the record, so each is previewed by cloning the canonical state and calling the `nodes.ts` function `visit` calls, in the order `visit` calls it. That is one fact per node type, and it is the one thing that can drift. `test/ui-run.test.ts` compares every preview with what `runRun` handed a bot on the same seed; the controller also re-checks the replayed state against the preview's promise after every commit and throws.

**Validation:** the paired gate over 84 runs; the two-seed probe hash check; and a mutation the gate could not see, recorded in `docs/learning/gate-proofs.md` — drawing the reward offer on the live state instead of a clone has no observable effect, because the live state is thrown away by the next replay. That is the design absorbing a defect, not the gate missing one.

## Rebuilding the SVG on hover eats the click

**Timestamp:** 2026-09-08 20:50–20:58

**Action:** `setFocus` in `runapp.ts` used to re-render the whole map SVG when the pointer entered a lit node. Now `applyMapFocus` toggles classes on the elements that are already there.

**Result:** the first click on a hovered node went from doing nothing to travelling. The a11y ref the browser tool had for the node also stopped going stale on hover.

**Reasoning:** `pointerover` fires before `mousedown`; replacing `innerHTML` in that handler detaches the element the pointer is over, and the click that started on it never completes. No console error, no exception — the run simply did not move, which is exactly the class of defect a render-call harness is blind to and a real click finds in one press.

## `hidden` loses to any author `display`

**Timestamp:** 2026-09-08 20:44

**Action:** `[hidden] { display: none !important }` at the top of `app.css`.

**Result:** the fight's empty enemy and player lines stopped showing under the map on the first load.

**Reasoning:** the user agent's `[hidden] { display: none }` has lower precedence than the `.screen { display: flex }` the run and fight sections share. Every section that is ever hidden needs this or a class-based show/hide; the attribute alone is not a promise.

## The HUD is shared, so it has to know whose clock it is on

**Timestamp:** 2026-09-08 21:00–21:20

**Action:** the run's `renderHud` reads the node and the numbers from the controller's *phase* rather than its state — the reward screen shows the Health and gold the replay is about to produce — and skips the subtitle during a fight, which the fight screen owns. The fight screen gained `idle()`, called whenever the run takes the page back.

**Result:** three defects, one cause. The subtitle said "choose where to start" during a fight; the reward panel said "you now have 25" beside a HUD reading 0; and a window resize after a fight re-rendered the finished fight's HUD over the map's. The third was found by Playwright's full-page screenshot, which resizes the viewport, and would have reached a person who resized the window.

**Reasoning:** a finished fight is `over`, not `idle`, and `over` still renders on resize and theme change. Off screen has to mean idle.

## Every player card in a run was a stranger

**Timestamp:** 2026-09-08 20:25

**Action:** `baseId` in `src/render/blazons.ts` strips the run's `#n` instance suffix as well as `_nc`.

**Result:** `blazonFor('u_squire#17')` went from `azure, a eagle argent` to the Squire's `azure, a sword argent`. Before the fix every card in a run deck — all of them instance ids — was drawn with a hashed device, in the hand, on the board, at the forge and on the shelf. Unit 3 could not see this because a single fight uses card ids; unit 5 could not see it because it has no screen.

**Validation:** `test/ui-run.test.ts`, "a deck instance keeps its card's device", built through `makeDeckCard` so the separator is `deck.ts`'s own.

## The fight's maximum Health is the run's current Health

**Timestamp:** 2026-09-08 21:05

**Action:** none — reported.

**Reasoning:** `fightSetupFor` hands the fight `{ ...content.hero, health: run.hero.health }`, and `makeHero` sets `maxHealth` from that, so a fight entered at 91 shows "you 91/91" while the run's readout says 91/200. The run API has nothing that carries the run's maximum into a fight. The run's HUD stays above the fight, so both numbers are on screen; a fight-side "of 200" needs a run-API change and is not this unit's to make.

## Numbers that moved

- Test suite 156 → 164.
- `npm run verify` and `npm run verify:run` unchanged apart from `Elapsed`.
- Probe: seed 1 light lost in act 3 after 17 nodes, page hash `156ba9eaa0210673` = headless = mirror; seed 7 dark won after 24 nodes and 14 fights, page hash `94ff2460abecaf26` = headless = mirror. The append-right bot wins 20 of seeds 1..400.
- Icons 19 → 28.

## The hand-played run

See the summary line for the minutes and the finish; the account is in the plan. The point a later session should keep: playing it made the open balance question concrete — the line collapses to one or two units nearly every round under mutual damage, so the cascade the design is built on is rarely on the board — and nothing here moved a number, because that decision is the owner's.
