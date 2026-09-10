# Play a whole run in the browser

Status: complete
Owner: worker (playable run), coordinator integrates
Created: 2026-09-09
Updated: 2026-09-08

## Problem and outcome

One fight was playable (`src/ui/`, unit 3) and a whole run existed headlessly (`src/run/`, unit 5), and they were not connected. Now they are. A person opens the page on a run, sees the act's map, picks a path, fights the node they chose on the existing fight screen, takes the reward, forges, rests, shops, resolves events, beats or loses to each boss, continues into the next act or sees the run end, and starts another.

The invariant that had to hold: **a run played by hand is a run `replayRun` replays.** The screen produces choices in exactly the shape `npm run verify:run` checks, advances the run through nothing but `replayRun`, and the end screen prints the run's hash and its replay log. A run played through the browser's real controls by a bot hashed identically to the same run played headlessly by `runRun`, on a lost seed and a won one.

The other outcome the assignment asked for: the map's routing decision has to be *visible*, because unit 5 measured it at 5.70 points of win rate and a decision the player cannot see does not exist for them. The whole act is drawn at once, every node with its type's icon and its label and every fight with its encounter's name; hovering or focusing a lit node lights everything it still leads to and says, exactly, which node types the routes beyond it hold.

## Scope

In: `src/ui/run.ts` (the run controller), `src/ui/runapp.ts` (the run screens), `src/ui/app.ts` (the fight screen refactored to be handed a fight and hand back its record), `src/ui/main.ts`, `src/ui/index.html`, `src/ui/app.css`, `src/ui/input.ts` (one selector), `src/render/map.ts` (the act map as SVG), `src/render/icons.ts` (nine icons), `src/render/blazons.ts` (one fix), `src/render/view.ts` (one helper), `tools/ui-probe/run.ts` (the whole-run probe), `test/ui-run.test.ts`, `test/map-render.test.ts`, `README.md`'s status and running instructions, this plan, the devlog and `docs/learning/gate-proofs.md`.

Not touched, as the assignment required: `src/engine/`, `src/content/`, `src/run/`, `src/sim/`, `AGENTS.md`, `docs/design/`. Card costs and run numbers are under an open owner decision and none of them moved; `npm run verify` and `npm run verify:run` print the same report before and after, apart from their wall-clock lines.

Out, deliberately: sigils (still an inert seam), any change to what a fight is, spells and equipment on the run screens (the shipped run deals only units), a save format beyond the log itself, and any balance judgement.

## Approach

### The controller drives the run through `replayRun`, and nothing else

`src/run/run.ts` is a synchronous loop. `runRun` asks an agent for every decision and plays every fight itself through `runFight`, which selects cards with the bot's `selectPlays`; a person decides on a different clock and picks their own cards, so neither `runRun` nor its agent seam can carry a hand-played run. What can is `replayRun`: it takes a seed and a list of node records, recomputes every offer from the run stream, and applies the recorded choice. So `src/ui/run.ts` keeps exactly that list. **The canonical state is `replayRun(content, log)` and nothing else** — every choice the player makes is appended as the `RunChoice` the replay reads back, the log is re-replayed from the seed, and the result is what the screen shows. There is no second way to advance the run.

The one thing replay cannot do is show an offer *before* the choice is made. So an offer is previewed by cloning the canonical state (`cloneRunState`) and calling the same `nodes.ts` function `visit` calls, at the point in the node where `visit` calls it: `shopStock`, `drawEvent`, `rewardOffer`, `forgeOffers`. That duplicates one fact per node type — which draw comes when — and it is gated two ways: `test/ui-run.test.ts` drives the controller with the decisions a bot made inside `runRun` and requires every previewed offer to equal what the bot was handed, and after every commit the controller checks the replayed state against what the preview promised and throws, naming both numbers, if they differ.

The fight is the one node the preview cannot mirror, and it does not have to: the fight screen records each committed round as the `RoundRecord` `replayFight` reads, and the record goes into the node's `fight` list exactly as `runRun` would have written a bot's.

### The fight screen was made embeddable rather than rewritten

`startApp()` became `createFightScreen(hooks)`: idle until handed a `FightSetup`, recording each round, reporting the finished fight through `onFightOver`, and taking its energy from the pool it was handed rather than from the content constant. `startApp()` is now a thin wrapper that keeps the single addressable fight (`?encounter=hard&seed=42`) exactly as unit 3 left it, so `tools/ui-probe/play.ts` still runs unchanged. The fight's own logic — `session.ts`, the view, the animation — was not touched.

### The map shows the decision

`src/render/map.ts` renders an `ActMap` as one SVG string: rows top to bottom, non-crossing edges as curves, every node a disc with its type's icon and its label, fight nodes captioned with their encounter's name, and five states as classes with the words on `aria-label` — walked, here, reachable, further on, not taken. Reachable nodes are the controls: `role="button"`, a tab stop, Enter or Space to travel. A hovered or focused lit node lights its whole reachable subgraph, and the panel beside the map says what the node is (the encounter's hero, deck and opening; what a rest heals; what a shop charges) and what lies beyond it — `spreadFrom`, which is unit 5's own `pathSpread` run on the sub-map the node roots, so the words on screen are the instrument's numbers and not a guess.

The first version rebuilt the SVG on every hover. That replaced the element under the pointer before the click completed, and the first click on a hovered node did nothing. Hover now toggles classes in place (`applyMapFocus`).

### A saved run is its log

The run in progress is kept in `localStorage` as its `RunLog` and replayed on the next load through the same `replayRun`. A node in progress is not in the log, so a reload returns the player to the map at the last completed node, and the notice says so. `?fresh=1` ignores the saved run; the HUD's Restart abandons it.

### What the run API could not express

Nothing that blocked the outcome. Two things are worth the owner's eye:

- A fight is handed the hero's *current* Health as its maximum (`fightSetupFor` sets `playerHero.health = run.hero.health`), so the fight's subtitle reads "you 91/91" while the run's readout reads 91/200. Nothing in the run API carries the run's maximum into the fight. The run HUD stays visible above the fight, so both numbers are on screen; a fight-side "of 200" would need `fightSetupFor` to carry it.
- `forgeOffers` is asked for nothing when the deck is empty, and `visit` then records only the travel. The controller handles that branch, though no shipped run can reach it.

## Acceptance criteria

- [x] Start a run, see the act's map, choose a path: the whole act is drawn with every node's type, the lit nodes are the choice, and a chosen node's consequences (what it is, what pays, what lies beyond) are shown before commit.
- [x] Fight the chosen node on the existing fight screen; the run's intro is in the log and the run's readouts stay in the HUD.
- [x] Take the reward (or none), forge one card and see its numbers move, rest, shop with prices against gold in hand, resolve an event with each option's effect spelled out.
- [x] Beat or lose to the boss; continue into the next act, or see the run end — won and lost — with the run's numbers, its hash and its replay log; then start another.
- [x] A hand-played run replays byte-identically from its choices: the controller gate over 84 paired runs, and the probe's page-hash-equals-headless-hash on a lost seed and a won one.
- [x] `npm run verify` and `npm run verify:run` unchanged apart from wall-clock lines; no `Math.random`, `Date.now`, `performance.now`, `new Date()`.
- [x] Light and dark, every screen, inspected individually at native resolution and bound to digests.
- [x] `npm run gates` green; every new gate made to go red.

## Implementation steps

- [x] `src/ui/run.ts` — the controller: phases, previews on a clone, commit through `replayRun`, post-commit checks, resume from a log.
- [x] `test/ui-run.test.ts` — the paired-run gate against `runRun`, the refusals, resume, the blazon instance fix.
- [x] `src/render/icons.ts` — fight, elite, event, shop, forge, rest, boss, gold, deck.
- [x] `src/render/map.ts` — the SVG map, `spreadFrom`, `applyMapFocus`; `test/map-render.test.ts`.
- [x] `src/ui/app.ts` — `createFightScreen` with hooks, round recording, `idle`, pool-driven energy; `startApp` kept for the single fight.
- [x] `src/ui/runapp.ts`, `index.html`, `app.css`, `main.ts` — the run screens, the HUD readouts, the end screen with the replay log, save and resume.
- [x] `tools/ui-probe/run.ts` — a whole run through the real controls, screenshots of every screen, the DOM-to-headless hash check.
- [x] Play a run by hand, both themes reviewed, defects fixed, docs.

## Outcome

Verified on the branch at the commit this plan lands in. `npm run gates` exits 0: typecheck, both AST gates, **164 tests** (156 at the base `ea8852c`), `npm run verify` and `npm run verify:run` identical line for line to their pre-round output apart from `Elapsed`.

### What a whole run is like to play

See the devlog line for the numbers of the hand-played run; the account below was written while playing it.

It is a run. The map reads: on seed 7's first act the entry fight leads into a fan of fights, events and a forge, and hovering the Event on row 2 says the routes beyond it hold `0–1 fight, 1–2 events, 1–2 shops, 1–4 forges`, which is a real reason to take it over the Fight beside it when the deck already hits hard enough. The forge is the best screen in the run: twenty-odd cards laid out, one picked, and three buttons that say `+1 Power 3 → 4`, `+1 Health 4 → 5`, `−1 Energy 3 → 2`; taking the Captain to 2 Energy changed every later hand. Events say what they do before you choose, and the shop says how short you are.

The fights are the same fights as unit 3, and the two things that made them good — the Relay `+2` visibly crossing to its neighbour, and the target odds on the board — are what a run decision turns on: Squire-then-Berserker through a Guard's armour was the play that won most of the first act. What the run adds is that the Health bar matters: a fight won at 196 of 200 is a different result from one won at 146, and the map's rests become something you route for.

The thing that is *not* right is the balance the assignment said to leave alone, and playing it makes the coordinator's sentence concrete: **the board collapses to two units.** Almost every body dies to the retaliation its own attack draws, so a line is rebuilt from scratch nearly every round, the Knight fights alone more often than not, and a fight that should be a build-up is a sequence of one-turn trades. The rounds are quick but they are not the design's cascade.

### Time

Minutes are in the devlog line: the first act, played through the browser pane one round trip at a time and interleaved with fixing the four defects it surfaced, is not a clean measurement; the second act was timed on its own.

### Defects found by playing, and fixed

- **The fight's empty lines showed under the map.** `.screen { display: flex }` outranked the user agent's `[hidden]`; `app.css` now has `[hidden] { display: none !important }`.
- **The first click on a hovered map node did nothing.** The hover re-rendered the SVG and replaced the element under the pointer; hover now toggles classes in place.
- **The HUD read the wrong clock.** The run's subtitle overwrote the fight's during a fight, the reward screen said "you now have 25" beside a HUD reading 0, and after a fight a window resize (which a full-page screenshot also causes) re-rendered the finished fight's HUD over the map's. The HUD now reads the phase, previews the reward's numbers, and the fight screen goes `idle` when it leaves the screen.
- **Every player card in a run was drawn as a stranger.** `blazonFor` stripped `_nc` but not the run's `#n` instance suffix, so a Squire in a run deck got a hashed device instead of its sword. Fixed and gated.
- **A probe shot caught mid fade-in read as a blank page.** The probe waits out the 240ms screen animation before it shoots.

### Gates added, and what each does not prove

| gate | claim | bound |
|---|---|---|
| `test/ui-run.test.ts` paired run | the controller previews what `visit` computes and its log replays to `runRun`'s hash | 30 fixture seeds + 12 shipped, two route styles, population asserted; nothing about the DOM or a fight the screen plays differently |
| `test/ui-run.test.ts` refusals | illegal travel, foreign fight, unaffordable purchase are refused with the reason | the fixture; one shop reached |
| `test/ui-run.test.ts` resume | a run resumes from its log to the same hash; a log on the wrong seed is refused | one fixture seed, between nodes |
| `test/ui-run.test.ts` blazon | a deck instance keeps its card's device | three cards, one instance number |
| `test/map-render.test.ts` | every node and edge drawn and labelled; reachable nodes are the only controls; `spreadFrom` equals `pathSpread` and brute force | 40 seeds x 3 acts of the shipped shape; markup, not pixels; not `applyMapFocus` |
| `tools/ui-probe/run.ts` | a run through the real controls hashes to the headless run | two seeds, one bot, needs Chrome; not in `npm test` |

Each was made to go red; the mutations and failures are in `docs/learning/gate-proofs.md`, including the one mutation the design absorbs rather than the gate catching.

### Visual review

Shots are `.probe-ui/run-1-light/` and `.probe-ui/run-7-dark/` (git-ignored) with a sha256 manifest, 28 files, every one opened individually at 1440x900 native resolution. Digests are the first sixteen hex characters from `.probe-ui/manifest.json`; regenerating the set strands this review.

| shot | sha256 (first 16) | what it showed |
|---|---|---|
| `run-1-light/act1-map.png` | `8dc78b126fd8da54` | the whole act, entry lit, captions readable over edges, deck beside it |
| `run-1-light/map-hover.png` | `e07f81810c01cd6d` | the entry hovered gold, the reachable graph in azure, the panel with Orc Scouts' numbers and "1–5 fights, 0–1 elite ... then the boss" |
| `run-1-light/fight-enter.png` | `bc3507668aca72bc` | the fight opening with the run's intro in the log and the run readouts in the HUD |
| `run-1-light/fight-won.png` | `bcbf1fb57c09b117` | the win banner and the run's continue button under it |
| `run-1-light/fight-lost.png` | `3282f48d9ec26e84` | the round-cap draw against Gate Guard, "A draw counts as a loss for the run", the continue button |
| `run-1-light/reward.png` | `d8fbc15a0055cdeb` | three cards with cost bubbles and stats, the HUD already at 188/200 and 25 gold |
| `run-1-light/forge.png` | `930eef91f1eef06f` | 24 cards, the Sentinel picked, `2 → 3`, `6 → 7`, `3 → 2`; subtitle "row 5 of 8 · forge" |
| `run-1-light/shop.png` | `de1320009ac16277` | three prices against 100 gold, Leave |
| `run-1-light/rest.png` | `acc5b25423686c1e` | "Health 138 → 200 of 200 (+62)" |
| `run-1-light/act-1-cleared.png`, `act-2-cleared.png` | `e4813e9a0839a8f5`, `1047c6851daf0dc4` | the act break naming the boss and the next act |
| `run-1-light/act2-map.png`, `act3-map.png` | `a1a634ce56a4dc75`, `0e5ebdf6f96a6de8` | the next acts' maps, a three-column act 3 |
| `run-1-light/end-dead.png` | `0ea31d4cd938e7f2` | "Your hero ran out of rounds against Gate Guard in The Black Gate, row 1 of 8", the numbers, the hash, the replay log, New run |
| `run-7-dark/act1-map.png`, `map-hover.png` | `6d6b1ec2f03c899a`, `4f5e5982adf17066` | the same map in dark, focus subgraph in light azure |
| `run-7-dark/fight-enter.png`, `fight-won.png` | `c8df65df683e51e3`, `07a86f996c689a0e` | the fight in dark, Relay pips under the Squires at the win |
| `run-7-dark/reward.png`, `forge.png`, `shop.png`, `event.png`, `rest.png` | `0f73c279bcf1e566`, `07335f3d85d566ea`, `1611159e77ee22b7`, `0b8e2ac4b64733df`, `24e06f7c671134e3` | every node screen in dark |
| `run-7-dark/act-1-cleared.png`, `act-2-cleared.png`, `act2-map.png`, `act3-map.png` | `3ee46843e2b76847`, `52144a6eb8a287d6`, `d9b9c07d0697653b`, `1a0fc7c154989d1e` | the act breaks and the later acts, the forged Captain's `−1E` badge on the deck |
| `run-7-dark/end-won.png` | `7aac207f259e4008` | "The run is won — You beat Gate King, the boss of The Black Gate", 24 nodes, 14 fights, hash `94ff2460abecaf26` |

### Limitations

- **The probe is a bot on the real controls, not a person.** It proves the DOM path agrees with the headless path; it says nothing about whether the run is fun, and the hand-played account above is one run of one seed.
- **Minutes are one sample**, measured through a browser automation pane that adds seconds to every action a person does in one; the devlog line says what was measured and under what conditions.
- **The map's hover highlight (`applyMapFocus`) has no headless gate** — it needs a DOM — and is covered by the probe's `map-hover` shot and by playing.
- **The fight's own maximum Health reads as the carried Health** (see the run-API note above).
- **`AGENTS.md` still says "there is no UI layer yet."** It is on the independent-review list and was not touched; the integration owner should update that sentence.
- **`src/run/content.ts` and the blazon table** are still where units 5 and 3 left them, and the notes there still apply.
