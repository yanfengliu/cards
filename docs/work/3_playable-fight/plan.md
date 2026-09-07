# A fight you can actually play

Status: complete
Owner: worker (playable fight), coordinator integrates
Created: 2026-09-07
Updated: 2026-09-07

## Problem and outcome

Before this round the repo had a headless engine, a measurement rig and a card renderer, and no way for a person to play. No `src/ui/`, no entry point, no `start` script.

Now there is one. `npm start` serves the app; a person opens a browser, sees their hand and both lines, spends three energy placing units into a chosen gap, commits, watches the line resolve left to right with the hero last, and plays a fight through to a win or a loss.

I played it. Seed 42, `even`, light theme, six rounds, won at 30 of 30 Health. What that felt like is in Outcome, including the two things it taught me about the design that a simulation had not.

## Scope

Included:

- `src/ui/` — the entry point, the turn state machine, input, and the fight driver that keeps the resolver's event stream.
- `src/render/` — the view model derived from that event stream, the board DOM, the beat scheduler, the transient effects, the target odds, and the card-id-to-blazon table.
- `tools/serve.ts` — the dev server. It strips TypeScript types on the way out, so the browser runs the source files with no build step, matching `AGENTS.md`'s "no compiled artifact to fall out of sync".
- `tools/ui-probe/play.ts` — a Playwright harness that plays the app through its real controls and photographs it.
- `.claude/launch.json`, and `start`/`dev` scripts.
- Four new gates, all proved red.

Excluded, deliberately:

- Any change to `src/engine/`. `npm run verify` is byte-identical to its pre-round output apart from the wall-clock line.
- `src/content/` and `src/run/`, which other lanes own. The blazon table that belongs in `cards.ts` sits in `src/render/blazons.ts` until that lane can take it.
- Spells and equipment. Built against today's unit-only card shape; unknown card ids already render rather than throw.
- Sound, mobile layout, and the run around the fight.

## Approach

**The UI drives the fight itself rather than calling `runRound`.** `resolvePhase` returns the event stream and `runRound` drops it, and that stream is the whole input to the animation layer. `src/ui/session.ts` runs the same round out of the same exported engine pieces and keeps the events. It carries two small replications of logic `engine/fight.ts` keeps private — `settle`, and the enemy's draw-select-append turn — and that risk is gated rather than accepted: `test/ui-session.test.ts` replays recorded bot fights through it and requires `hashFight` to agree after **every round** across 160 fights.

The alternative was a four-line additive hook on `runRound`. It was not taken because `src/engine/` is another lane's, and the gate makes the duplication safe.

**Render derives its own state and adds no field to `GameState`.** `src/render/view.ts` holds `EntityView.acting`; the engine never hears about it. `viewDrift` compares the derived view against the engine's own state at the end of every phase, in the app at runtime and in `test/render-view.test.ts` over 120 fights.

**Buff provenance is reconstructed, not carried.** The `powerGained` event carries `{uid, amount}`; the `gainPower` *effect* carries `sourceUid` and the event does not. The animation needs the source, because a Relay `+2` that does not visibly leave the card that granted it teaches nothing. `attributeBuff` recovers it from the two shipped power sources and the position of the event in the stream, and the argument that the two cases cannot collide is in the function's comment. **Recommended engine change, for whoever owns the resolver: put `sourceUid` on the `powerGained` and `warded` events.** It costs no `GameState` field and no behaviour, and it retires the inference.

**The odds are computed on a projection of the player's own phase.** See Outcome — this started as a display detail and turned out to be a correctness bug.

## Acceptance criteria

- [x] A browser page shows the hand, both lines, and the hero at the right end of each.
- [x] Three energy a turn, spent by choosing a card and then a gap in the line; placements are provisional and can be taken back.
- [x] Commit resolves the round; the line animates left to right with the hero last.
- [x] The acting unit is unmistakably highlighted; every other card dims.
- [x] A Relay buff visibly travels from source to right-hand neighbour, and the log names both.
- [x] Damage, armour absorption, overkill, death and Guard redirection are each attributable on screen.
- [x] Total resolution near three seconds at realistic width; a speed control and an instant resolve.
- [x] Target odds on screen before commit, exact rather than sampled.
- [x] The board compresses and never wraps, checked by measurement at six viewport widths.
- [x] Light and dark.
- [x] A fight played end to end by a person.
- [x] `npm run gates` green; `npm run verify` unchanged.
- [x] Every new gate made to go red.

## Implementation steps

- [x] `src/ui/session.ts` — the human driver, with the round-for-round hash gate.
- [x] `src/render/view.ts` — beats from events, and the drift check.
- [x] `src/render/board.ts` — the compressing row, cards, hero, slots, reconciliation by key.
- [x] `src/render/anim.ts` — the beat clock on rAF deltas, with the three-second budget.
- [x] `src/render/fx.ts` — beams, travelling tokens, floating labels.
- [x] `src/render/odds.ts` — exact target chances, and the own-phase projection.
- [x] `src/render/blazons.ts` — card id to blazon, with a derived fallback for ids it has never seen.
- [x] `src/ui/app.ts`, `input.ts`, `index.html`, `app.css` — the screen.
- [x] `tools/serve.ts`, `.claude/launch.json`, `npm start`.
- [x] `tools/ui-probe/play.ts` — sweep, narrow and film modes, with a sha256 manifest.
- [x] Visual review at native resolution, both themes, 1 to 14 units, six viewport widths.

## Outcome

Verified at the branch head listed above. `npm run gates` exits 0: typecheck, both AST gates, **63 tests** (55 before this round), and `npm run verify` whose report is identical line for line to the pre-round baseline apart from `Elapsed`.

### What it is like to play

It plays. The turn has a real decision in it, and the decision is legible from the screen without needing the rules open.

Round two of the fight I played was the design's own worked example, arrived at from the board rather than from the document. The enemy had an Orc Shieldwall — 1 Power, 5 Health, **armour 1** — and its Guard was forcing every one of my attacks onto it. My line was four bodies of 1 Power each, and the intent line said they would swing for 4 Power total. Armour 1 per attack meant four attacks of 1 would deal **nothing at all**. So I bought a Berserker (4 Power) and put a Squire (Relay) immediately to its left, and the on-screen forecast moved to 11 Power. The Berserker swung for 6, dealt 5 through the armour, and killed the Shieldwall outright. "Against armour, concentrate" is a sentence in `docs/design/game.md`; here it was a thing I worked out from two numbers on a card and a badge under it.

The animation earns its section in `ARCHITECTURE.md`. The spotlight makes resolution order something you watch rather than infer, and the `+2` crossing the gap from the Squire to the Berserker is the moment adjacency becomes obvious. The log underneath doubles it in words, which matters more than expected: "Human Hornblower's Relay sends +2 Power to Knight for this turn" is the rule, stated about the thing that just happened.

Three sizes of friction, smallest first. The hover preview is large enough to cover the row above it; it never blocks a click and it goes away when you move, but it is the roughest edge left. Six identical goblins on the enemy line read as a wall — that is the content's problem, not the renderer's. And the first turn of a fight, with no cascade card in hand, has no placement decision in it at all: you are choosing between identical gaps. That is honest rather than broken, but it means the game's first impression is its weakest turn.

### Two things playing it taught that simulating it had not

**Ward on your only Guard makes your whole side untargetable, and it is the opening.** `legalTargets` narrows to the Guards and then removes the warded ones. One Guard, warded, leaves nothing, and every enemy attack fizzles. I built it on turn one out of a 1-cost Shieldbearer and a 2-cost Warden, and then took **zero damage for the entire fight** — six rounds, 30 of 30 Health, against the `even` encounter. The harness stumbled into the same lock unprompted on `hard`. `src/engine/resolver.ts` already notes that Ward-after-Guard is not covered by the design document and points at `docs/work/1_turn-prototype/plan.md`; what playing adds is that it is not an edge case reachable by a specialist, it is the strongest thing a beginner can do with two cheap cards. It is also consistent with the measurement, which puts Ward at about 2.5 times Relay's share of the placement gap. **This is the owner's call and I have changed nothing about it.** The cheapest fixes to consider: Ward could exclude Guards, or a side with no legal target could fall back to the full pool instead of fizzling.

**The odds on screen were wrong, in exactly that case, until this round fixed it.** Before commit the board said "each attack is 100% onto your 1 Guard". The truth was 0% onto everything, because the Ward lands during your own resolution and the pre-commit board has not applied it yet. That is not an incomplete number, it is the opposite of what happens, and `ARCHITECTURE.md` names that as the definition of being cheated. `projectOwnPhase` now applies the Wards and Relays the committed line will grant before any chance is computed. It is exact and rolls nothing: during your own phase nothing on your side can be hurt, so every unit acts and every grant lands, with no dependence on a targeting roll. Wake is deliberately not projected — it answers a death, and which of your units dies is a roll.

The Relay half of the projection is a display decision worth recording. The forecast is shown as a gold `+2` badge under the receiving card, never folded into the Power disc, because a stat that reads 3 before you press commit and 1 immediately after is worse than one that waits for the animation.

### Defects found by playing, and fixed

Five, none of which the tests would have caught, and four of which needed the real input path rather than a render call:

- **"Resolve now" skipped one phase, not the round.** A committed round is three segments; pressing skip during the first left you watching the half you had asked to skip.
- **The header ran ahead of the board.** A committed round is already resolved in the engine, so `heroOf(fight.state)` was the end-of-round score above a hero card showing its mid-round Health. The HUD now reads the view.
- **The row clipped everything drawn outside a card.** `overflow-y: visible` next to `overflow-x: auto` computes to `auto`, so the acting ring and a pending card's remove button were cut off by the row's own box.
- **Selecting a card overflowed the row.** The fit did not charge the cards for the drop slots that appear when a card is picked up. It now measures its own overflow after painting and re-fits once, which also picks up the row padding and the hero's separator margin without hard-coding either.
- **The overflow measurement read the previous layout.** `.card` had a `width` transition, so `scrollWidth` was sampled mid-glide. The transition now lives only on the dying collapse, where nothing measures.

### Gates added, and what each does not prove

| gate | claim | bound |
|---|---|---|
| `test/ui-session.test.ts` | the UI driver plays the same game as `runRound` | `hashFight` after every round, 160 fights over two encounters; nothing about timing or the DOM |
| `test/render-view.test.ts` view drift | the view derived from events matches the engine after every phase | 120 fights; corpses excluded by construction; the four shipped traits only |
| `test/render-view.test.ts` attribution | every buff resolves to the card that granted it | a future power source that is neither Relay nor Wake reports `unknown` and fails, which is the intended answer |
| `test/render-view.test.ts` projection | the Wards and Relays shown before commit are the ones that land | skips rounds that end the fight, where `resolvePhase` stops early and the forecast has no next turn to be about |
| `test/render-view.test.ts` fit | the row fits whenever cards could still shrink | pure arithmetic; the DOM half is covered by measurement in `tools/ui-probe`, not by a test |
| `test/render-view.test.ts` blazons | every shipped card parses and keeps the bordure as the Guard channel | the shipped pool only |

Each was made to go red; the mutations and failures are in `docs/learning/gate-proofs.md`.

### Visual review

Shots are `.probe-ui/` (git-ignored) with a sha256 manifest, 239 files. Every one named below was opened individually at its own native resolution; the contact-sheet trap is what the manifest exists to prevent, so the digests are recorded here and regenerating the set strands this review.

| shot | sha256 (first 16) | what it showed |
|---|---|---|
| `sweep-even-42-light-one/playerrow-01units.png` | `b8398dc7eff3c6c0` | 1 unit: cards at the 92px cap, hero foot level with the card foot |
| `sweep-even-42-light-one/playerrow-06units.png` | `3b92a67b997403a4` | 6 units: trait pips, the `+2` forecast badge, two pending cards |
| `sweep-hard-7-light-all/playerrow-10units.png` | `4698e561a7024d01` | 10 units: ward marks, Guard silhouette, 50% badges on the pending pair |
| `sweep-hard-7-dark-all/playerrow-14units.png` | `139f6f67943d346f` | 14 units at 86px: every channel still reads |
| `sweep-hard-7-dark-all/enemyrow-08units.png` | `d58a898dca7da58a` | 8 enemies: the Guard is unmistakable at a glance |
| `sweep-hard-7-light-all/page-final.png` | `6c1225550a53c3d3` | the whole screen at a win, 15 cards in the line |

Compression was measured rather than eyeballed, at 14 units:

| viewport | card width | distinct card tops | overflow |
|---|---|---|---|
| 1440 | 86px | 1 | 0px |
| 1180 | 68px | 1 | 0px |
| 980 | 54px | 1 | 2px |
| 820 | 44px | 1 | 22px |
| 700 | 44px | 1 | 142px |
| 560 | 44px | 1 | 282px |

One distinct card top at every width: the row never wraps. Below the 44px legibility floor it scrolls instead, and the hero is `position: sticky` so the one thing that must stay visible does.

The resolution animation was reviewed as frames, 220ms apart, in both themes — `film-hard-3-dark/` and `film-hard-3-light/`. The frames carrying the load: the acting spotlight with a beam landing on a Guard and a `GUARD` tag over it, and a `+2` caught in flight between two cards.

### Limitations

- **14 units, not 15.** Fourteen is the widest line the shipped deck and 3 energy produce in a real fight; the sweep reached it repeatedly and never got past it. The 15-slot case is covered instead by squeezing the viewport at 14, which puts the layout under more pressure than a fifteenth card would.
- **The hover preview overlaps the row above it.** It is `pointer-events: none` so it cannot block a click, and it clears on move, but it is the roughest edge left.
- **The blazon table is in the wrong module.** `src/render/blazons.ts` should be a `blazon` field on each card in `src/content/cards.ts`. Moving it changes nothing in the renderer.
- **The odds are per attack, not per phase.** "Each attack is 33% onto each of your 3 Guards" is exact. It is not the same as "the chance this unit dies this turn", which would need rollouts and a different label.
- **`.claude/launch.json` was written but could not be exercised from this worktree** — the preview tool reads the main checkout's copy. The server was started directly instead, and the browser driven against it.
