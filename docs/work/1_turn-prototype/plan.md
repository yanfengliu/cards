# Probe: is placement a decision?

Status: complete
Owner: coordinator
Created: 2026-09-06
Updated: 2026-09-06

## Problem and outcome

The design asserts that where you put a unit matters. `ARCHITECTURE.md` says that claim is falsifiable and should be a gate:

> Run the same decks with a bot that places optimally and a bot that places randomly. **If their win rates are the same, placement is not a decision and the central claim of the design is false.**

Outcome: a headless deterministic prototype of one fight, and that measurement, run.

**Answer: placement is a decision.** Over 20,000 seeded fights, optimal placement wins **58.30%** and random placement wins **39.51%** — a paired gap of **18.80 percentage points** (95% CI 18.06..19.53) against a measured noise floor of **-0.26 pp** (95% CI -0.98..0.47). The result is not near the noise.

The claim's bound: this measures **bots**, and a wide one. Bot B places uniformly at random, which no human does. Against a naive but sensible fixed rule — always append next to the hero — the gap is **11.89 pp**, and that is the more honest estimate of what placement is worth to a person who is not thinking about it.

Two findings the measurement was not looking for, both in [Outcome](#outcome): **Ward carries more than twice what Relay carries, but Relay is not negligible**, and **Wake is a dead trait for the side that resolves first**.

### Which instrument produced these numbers

**Every figure below was re-measured on 2026-09-06 against the tree at `49f017b`, and none of it is the number this document carried before.** The whole document was measured once with an earlier instrument, that instrument was then repaired in two rounds, and the repairs moved the result. The stale figures were removed rather than annotated; the two rounds of repair are in `docs/devlog/summary.md`, and the sentences below say what changed and which way.

Two repairs move the numbers:

- **The placement search now uses common random numbers.** Every candidate inside one decision is rolled out against the same targeting draws — the rollout seed is keyed to fight, round, decision and rollout index, and deliberately *not* to which candidate is being scored. The earlier version salted the seed per candidate, so with four rollouts each the search was ranking luck about as often as arrangement. It moved the headline **up**: the figure this document used to carry was 15.87 pp and the re-measurement is 18.80 pp. (The session that made the repair attributes **+2.42 pp paired** to this change alone, isolating it against the salted search; that number is quoted from `docs/devlog/summary.md` and was not re-run here, because the salted search no longer exists in the tree to run an arm against.) The previously published figure was conservative: the design's claim is stronger than the first probe reported, not weaker.
- **The bot policies are stateless.** Both carried state across calls — a `salt` counter in the lookahead placer, a generator that outlived a fight in the random placer — so a policy's decisions depended on how many fights its instance had already seen. They reproduced only because `measure.ts` happens to build a fresh policy per fight. Both are now pure functions of the fight they are handed, gated by `test/bots.test.ts`.

Every arm, at every difficulty, in every control and in the per-trait ablation, was measured with the salted search. So the difficulty sweep, the negative control, the append-right comparison and the ablation are all restated here from new runs, not carried over.

## Scope

Included: one fight. Unlimited-width board with units inserted anywhere in the line, 3 energy a turn with no carryover, strict left-to-right resolution with the hero acting last from the rightmost slot, seeded random targeting, Guard, Armour, no damage carry, and the traits Relay, Guard, Wake and Ward. Fifteen hand-authored cards — eleven the player places, four the enemy fields. Two bots, a shared card-selection policy, and the A/B harness.

Excluded, per the assignment: the run and map structure, sigils, equipment, spells, classes, meta-progression, Echo, Kindle, tribes as mechanics, and all rendering. No DOM, no browser, nothing visual.

Dependencies: none. Base revision `5e9d66f` on `main`; re-measured at `49f017b`.

## Approach

### The engine

`src/engine/` follows the resolver contract in `ARCHITECTURE.md`. An explicit effect queue, never recursion. `apply` is the only function that writes state. Deaths are batched at a state-based checkpoint that runs after every effect, so health is never inspected at the instant damage lands. Trigger order is board order — board *index*, not uid — and the tie-break inside one unit is the source order of the `if` blocks in `triggersFor`. Both are gated by `test/resolver-order.test.ts` and stated in `ARCHITECTURE.md`. The loop has an iteration cap that throws with the queue trace.

The queue is drained once per acting entity rather than once per phase. That is what "resolves left to right, one unit at a time" means: a unit's whole cascade finishes before its neighbour starts, and an effect that a unit spawns still lands before the next unit acts.

**The hero is simply the last element of its side's board array.** This makes "the hero acts last" and "an adjacency trait on the rightmost unit reaches the hero" the same fact rather than two rules that have to be kept in agreement.

Node 24's native type stripping runs the TypeScript directly, so there is no build step and no runtime dependency. `typescript` and `@types/node` are dev-only, for `npm run typecheck`. `tsconfig.json` sets `erasableSyntaxOnly`, so the typecheck fails if anything is written that type stripping cannot run.

### Holding card selection constant — the methodology

This is the part that makes the number mean anything, so it is stated precisely.

**`selectPlays(hand, energy, pool)` is a pure function of hand and energy. It never reads the board.** Both bots call it. It returns the indices of the cards to play; the bot is then handed that card list and returns one insertion index per card. A bot cannot add, drop or reorder a card.

That the hands stay identical between the arms follows by induction: both arms shuffle the same deck from the same `deck` RNG stream, so the draw order is fixed; `selectPlays` is a function of the hand alone, so the same cards leave the hand; therefore the next hand is the same. Board divergence never reaches it.

**Two separate RNG streams**, derived from the seed by name. `deck` shuffles both decks once at setup. `combat` picks targets. They are separate because optimal placement changes how many targeting rolls a fight consumes, and on one shared stream that would shift the draw order too — the arms would then differ by more than the variable under test.

The argument above is not trusted on its own. The harness re-derives it from the actual runs: over **121,990 compared rounds** it checks that the two arms held the same hand and played the same card ids in the same order on every round both fights reached. It passes. The same check runs across all five arms in `test/methodology.test.ts`.

### The bots

- **Bot A, optimal placement.** Greedy search over insertion positions for the cards it is already committed to playing, one card at a time, scoring each candidate by rolling the round forward four times through the real resolver on a cloned fight. The rollouts use **common random numbers**: the generator is keyed by fight seed, round, decision index and rollout index, and *not* by which candidate is being scored, so every candidate in one decision meets the same targeting draws and the comparison measures the arrangement rather than the luck. They never touch `combat`, so the search cannot see the targeting rolls the round is about to make. It is a bot, not an oracle. The rollout also skips the enemy's card plays, so the search cannot read the enemy's hand.
- **Bot B, random placement.** Uniform over legal insertion indices.
- **Bot B2**, the control: random placement on a different placement stream. Two policies that are identical in every way except their stream, so their gap is the measurement's noise floor.
- **Bot C, append right** and **Bot D, append left**: fixed rules, no search, for the skill gradient.

Every policy is a pure function of the fight it is handed. None keeps a counter or a generator across calls, and `test/bots.test.ts` fails on a warmed instance, on an instance hoisted across a sweep, and on a policy that answers the same question twice differently.

### Instrument checks, before trusting the measurement

Applying `ARCHITECTURE.md`'s guidance directly:

- **The seed set is the population meant.** Seeds 1..20,000, contiguous, every arm ran every seed. Stated in the output, not assumed.
- **The control reproduces.** Bot B against Bot B2 over 20,000 seeds: 39.51% against 39.77%, gap -0.26 pp (CI -0.98..0.47). The interval contains zero, and it bounds what any gap has to beat.
- **Both bots really play identical cards.** Checked over 121,990 rounds, and separately as a test over all five arms.
- **Placement really did differ.** 106,714 of 209,611 placed cards (50.91%) went to a different slot in the two arms. A check that both arms played the same cards would also pass if the bots had been placing them identically.
- **The hash is not degenerate.** A determinism test that a constant hash would pass proves nothing, so the suite also asserts that different seeds produce mostly different final hashes and that a one-field change moves the hash.
- **The search is not the bound.** Exhaustive search over the full product of insertion positions scores -1.05 pp against greedy (CI -2.63..0.53) over 2,000 seeds, so greedy is not leaving the conclusion on the table.
- **The tree held still.** Every arm ran against `49f017b` with a clean working tree, before any edit in the session that re-measured. The headline was re-run afterwards and reproduced byte-identically.
- **A negative control**, described below, which is the check that actually establishes what the gap is made of.

### Choosing the operating point

A win-rate gap is squeezed against 0% and 100%, so the operating point is a real methodological choice and it was made before the headline run. The primary encounter (`even`) was tuned so both arms straddle 50%. Enemy card stats and the enemy hero's Health were the dials; the player's deck and hero were not touched.

Because the choice matters, the measurement runs at four difficulties and reports all of them. The per-trait ablation goes further and reads the enemy hero's Health as a continuous dial, so each ablated deck can be measured at the *same* random-placement baseline as the intact one.

## Acceptance criteria

- [x] A headless deterministic prototype of one fight, following the resolver contract in `ARCHITECTURE.md`.
- [x] `node --test` green, including a determinism property test.
- [x] The A/B measurement run, with real numbers, and its methodology stated.
- [x] Card selection held constant across arms, and verified against the actual runs rather than argued.
- [x] Determinism verified: same seed plus same action list produces an identical final state hash, over many trials.
- [x] Seed set, control reproduction and arm equivalence checked before the result is reported.
- [x] Nothing imported from a browser, DOM or renderer; `Math.random`, `Date.now`, `performance.now` and wall-clock reads through the `Date` constructor absent, enforced by `npm run gate:banned-apis`.
- [x] Every published number re-measured on the current instrument, with the seed count stated.

## Implementation steps

- [x] `.nvmrc` at 24; `package.json` with zero runtime dependencies.
- [x] `src/engine/rng.ts` — seeded generator, named independent streams, the only source of randomness.
- [x] `src/engine/state.ts` — board with the hero as the rightmost element; insertion at any slot.
- [x] `src/engine/resolver.ts` — effect queue, one mutation site, batched deaths, board-order triggers, iteration cap.
- [x] `src/engine/fight.ts` — rounds, energy, draw, the shared card-selection policy, replay.
- [x] `src/engine/hash.ts` — canonical serialisation of the whole fight, and its digest.
- [x] `src/content/cards.ts` — fifteen cards, four encounters, and the cascade-stripped control set. Data only.
- [x] `src/sim/bots.ts` — the placement policies, each a pure function of the fight it is handed.
- [x] `src/sim/measure.ts` — the A/B, the difficulty sweep, the negative control, the instrument checks, and the gap gate.
- [x] `test/worked-example.test.ts` — the design's worked example, checked number by number.
- [x] `test/rules.test.ts`, `test/determinism.test.ts`, `test/methodology.test.ts`, `test/resolver-order.test.ts`, `test/bots.test.ts`.
- [x] Calibrate the operating point, then freeze and measure.
- [x] Re-measure the whole suite after the instrument repairs, and replace every number in this document.

## Outcome

Re-measured against the code at commit `49f017b`, on branch `worktree-agent-a1510831d7dd28fba`, on Node v24.18.1. `npm run gates` green (exit 0): `npm run typecheck` clean, `npm run gate:boundaries` and `npm run gate:banned-apis` clean, `node --test` 47/47, `npm run verify` pass. `npm run audit` 0 vulnerabilities. Not merged — the coordinator integrates.

Every number in this section comes from a run made in that session, and each table states its seed count. The command that produced the first four sections is `node src/sim/measure.ts --seeds 20000 --sweep-seeds 5000 --search-check 2000`.

Nothing that runs was changed after the arms were measured — the session's edits are documents, comments and one file move — and that is checked rather than asserted: the same 20,000-seed command re-run after every edit reproduces the earlier output byte for byte.

### The headline

20,000 contiguous seeds, encounter `even`, every arm on every seed.

| arm | win rate | 95% CI | wins/losses/timeouts | mean rounds |
|---|---|---|---|---|
| A optimal placement | **58.30%** | 57.62..58.99 | 11,661 / 8,190 / 149 | 6.59 |
| C append right | 46.41% | 45.72..47.11 | 9,283 / 10,513 / 204 | 6.80 |
| B2 random placement (control) | 39.77% | 39.09..40.45 | 7,953 / 11,999 / 48 | 6.80 |
| B random placement | **39.51%** | 38.83..40.19 | 7,902 / 12,039 / 59 | 6.80 |
| D append left | 39.51% | 38.83..40.19 | 7,902 / 12,074 / 24 | 6.72 |

| paired comparison | gap | 95% CI | X-only wins | Y-only wins | agreed |
|---|---|---|---|---|---|
| A optimal − B random | **18.80 pp** | 18.06..19.53 | 5,054 | 1,295 | 13,651 |
| A optimal − C append right | 11.89 pp | 11.22..12.56 | 3,664 | 1,286 | 15,050 |
| B random − B2 random (noise floor) | **-0.26 pp** | -0.98..0.47 | 2,700 | 2,751 | 14,549 |

The gap is more than twenty-five times the half-width of the noise floor's interval. It is not a null result and it does not need rescuing.

The skill gradient `ARCHITECTURE.md` asks for is present but not uniformly spaced: append-left 39.51% ≈ random 39.51% < append-right 46.41% < greedy one-turn lookahead 58.30%. Append-left and random landing on the same win count is a coincidence of this seed window, not an identity — they win different fights — but append-left being indistinguishable from random is the expected shape: a fixed rule is not automatically better than no rule, it is better only if it is the right rule. Append-right captures about 37% of the available value; the remaining 11.89 pp is contextual and a fixed rule cannot reach it.

### The gap depends heavily on difficulty

5,000 seeds per cell.

| encounter | A optimal | B random | gap | 95% CI | noise floor |
|---|---|---|---|---|---|
| hard (Warchief 26 HP, two bodies out) | 23.88% | 6.46% | 17.42 pp | 16.29..18.55 | -0.10 pp |
| even (Warchief 18 HP, one body out) | 58.52% | 40.20% | 18.32 pp | 16.85..19.79 | -0.48 pp |
| easy (Warchief 12 HP, empty board) | 87.26% | 81.28% | 5.98 pp | 4.91..7.05 | 0.26 pp |
| trivial (Warchief 8 HP, empty board) | 97.12% | 95.50% | 1.62 pp | 1.07..2.17 | -0.12 pp |

The gap is real at every difficulty and largest in the middle. That is a change of shape from the first measurement, which put `hard` at the top: with the search no longer ranking noise it gains more at `even`, where there is more board to arrange, than at `hard`, where the random arm wins 6% of the time and there is less room to be good in. Reporting a single operating point would still have understated or overstated the gap by a factor of eleven depending on which one was picked, which is why the sweep is part of the deliverable rather than an appendix.

### The negative control — what the gap is actually made of

The same eleven cards with every trait that reads a neighbour removed (Relay, Ward, Wake), Guard kept because Guard does not care where it stands. What placement can still touch is act order alone: who swings before the last enemy Guard dies.

| encounter | card set | A optimal | B random | gap | 95% CI |
|---|---|---|---|---|---|
| hard | Relay/Ward/Wake intact | 23.88% | 6.46% | 17.42 pp | 16.29..18.55 |
| hard | cascade stripped | 0.04% | 0.04% | 0.00 pp | -0.06..0.06 |
| even | Relay/Ward/Wake intact | 58.52% | 40.20% | 18.32 pp | 16.85..19.79 |
| even | cascade stripped | 5.40% | 4.54% | 0.86 pp | 0.23..1.49 |
| easy | Relay/Ward/Wake intact | 87.26% | 81.28% | 5.98 pp | 4.91..7.05 |
| easy | cascade stripped | 31.72% | 29.16% | 2.56 pp | 1.50..3.62 |
| trivial | Relay/Ward/Wake intact | 97.12% | 95.50% | 1.62 pp | 1.07..2.17 |
| trivial | cascade stripped | 62.14% | 61.40% | 0.74 pp | -0.23..1.71 |

Run at every difficulty on purpose, because a gap shrinks near a floor for reasons that have nothing to do with the cascade. Two rows are load-bearing and they agree. At `trivial`, a 61% baseline nowhere near either bound, the gap is 0.74 pp with an interval containing zero. And the ablation below re-runs the stripped set at the headline's own 40% baseline, where it is **1.51 pp** against the intact deck's 18.65 pp.

**So the cascade traits are almost the whole effect.** Without them, act order alone is worth 1.5 pp at the operating point the headline is quoted at — about 8% of the gap. It is not exactly zero: the `easy` row is 2.56 pp with an interval excluding zero, so act order is worth something at a 29% baseline, and the earlier claim of "at most about 1 pp" was too tidy. The design's central claim is confirmed, and confirmed for the reason the design gives — adjacency, not ordering in general.

### Which traits carry it — the ablation, at matched baselines

This is the part the first measurement got half wrong, so the method is stated before the numbers.

Removing a trait weakens the deck and therefore **moves the operating point**, and the gap is strongly difficulty-dependent. Comparing a no-Ward deck at `even` with an intact deck at `even` compares two different operating points and reads the difference as a trait effect. The first measurement handled this by picking, for each ablation, whichever of the four preset encounters had the closest random-placement win rate — which left mismatches of several points and only four stops to choose from.

This measurement reads the enemy hero's Health as a **continuous dial** instead. For each ablated deck, Bot B alone is run over a Health grid to find where that deck puts the random-placement baseline; then Bot A, Bot B and Bot B2 are run at the Health values that bracket a baseline of 40%, which is the intact deck's baseline at `even`. Card ids, costs, both decks, the draw order and the shared card-selection policy are untouched by the ablation — only the trait list changes — so the arms stay matched on everything the headline matches them on.

The probe is `.probe/ablation.ts`, run as `node .probe/ablation.ts --seeds 20000 --cal-seeds 3000`. It calls the repo's own instrument and adds nothing of its own to it: fights through `runFight`, placement through `src/sim/bots.ts`, intervals through `measure.ts`'s `pairedGap`. The two dials are the only new code — a `CardPool` built from `PLAYER_CARDS` with one trait filtered out and card ids left alone, and a `FightSetup` whose enemy hero takes an arbitrary Health with the `even` opening. It checks itself twice before reporting: with nothing stripped and Health 18 it reproduces the shipped `even` encounter to the final-state hash on 120 fights across both bots, and stripping Ward is shown to move the state, the placements and the outcome, so "nothing changed" is a finding rather than a dead dial.

**`.probe/` is ignored, so that file is not in Git and this table cannot be re-run from a clean checkout.** `npm run measure` covers everything above this section; nothing in it covers the per-trait ablation, which is why the probe had to exist. Promoting it into `tools/` — where the heraldry probe already lives — would make this section reproducible, and that is the integration owner's call rather than this probe's.

**20,000 seeds per cell.**

| card set | enemy Health | A optimal | B random | gap | 95% CI | noise floor |
|---|---|---|---|---|---|---|
| intact | 17 | 60.60% | 42.73% | 17.88 pp | 17.14..18.61 | -0.50 pp |
| intact | **18** | **58.30%** | **39.51%** | **18.80 pp** | 18.06..19.53 | -0.26 pp |
| intact | 19 | 55.93% | 36.83% | 19.10 pp | 18.36..19.84 | -0.02 pp |
| Relay removed | 8 | 59.05% | 45.84% | 13.21 pp | 12.52..13.89 | 0.12 pp |
| Relay removed | 9 | 53.08% | 38.34% | 14.74 pp | 14.04..15.43 | -0.17 pp |
| Relay removed | 10 | 48.23% | 32.19% | 16.04 pp | 15.34..16.73 | 0.21 pp |
| Ward removed | 15 | 49.88% | 42.25% | 7.63 pp | 6.99..8.27 | 0.08 pp |
| Ward removed | 16 | 45.90% | 37.92% | 7.98 pp | 7.34..8.61 | -0.16 pp |
| Ward removed | 17 | 42.24% | 34.17% | 8.07 pp | 7.44..8.70 | -0.34 pp |
| Wake removed | 17 | 60.60% | 42.73% | 17.88 pp | 17.14..18.61 | -0.50 pp |
| Wake removed | 18 | 58.30% | 39.51% | 18.80 pp | 18.06..19.53 | -0.26 pp |
| Wake removed | 19 | 55.93% | 36.83% | 19.10 pp | 18.36..19.84 | -0.02 pp |
| Relay + Ward removed | 8 | 41.57% | 40.05% | 1.52 pp | 0.99..2.04 | 0.19 pp |
| Relay + Ward + Wake removed | 8 | 41.57% | 40.05% | 1.52 pp | 0.99..2.04 | 0.19 pp |

The intact row at Health 18 is the shipped `even` encounter, and it reproduces the headline to the digit — which is the point of running the ablation through a dial that includes the shipped operating point.

Interpolated to a common Bot-B baseline of exactly 40.00%:

| card set | gap at matched baseline | share of the intact gap | what removing it costs |
|---|---|---|---|
| intact | **18.65 pp** | 100% | — |
| Wake removed | **18.65 pp** | 100% | 0.00 pp |
| Relay removed | **14.40 pp** | 77% | **4.25 pp** |
| Ward removed | **7.81 pp** | 42% | **10.84 pp** |
| Relay + Ward removed | **1.51 pp** | 8% | 17.14 pp |

**Ward carries more of the placement decision than Relay does, by about two and a half to one.** Removing Ward costs 10.84 pp of an 18.65 pp gap; removing Relay costs 4.25 pp. The ordering does not depend on which trait is removed first: with Relay already gone, removing Ward costs a further 12.89 pp; with Ward already gone, removing Relay costs a further 6.30 pp. Ward is ahead by 2.6:1 on the first reading and 2.0:1 on the second.

**But "Relay barely moves it" was wrong, and it was the old instrument that made it look that way.** Relay carries a quarter of the gap — 4.25 pp, an interval nowhere near zero, and more than twice the entire cascade-stripped control. The two traits together carry 17.14 pp of 18.65 pp, which is 2.05 pp more than their separate contributions add up to: they interact positively, because a Ward that keeps a Relay chain alive is worth more than either alone.

The honest summary is therefore narrower than the one this document used to carry. **Placement is mostly about protection, and buff routing is a real second component rather than a rounding error.**

The design already contains the reason Ward should lead. Its own analysis of Relay says "Both arrangements deal the same raw total — Relay's flat +2 goes somewhere either way", and argues the value is in *packaging* against armour and overkill. The measurement agrees with the arithmetic and says the packaging effect is the smaller half. Ward, by contrast, changes what can be hit at all, and its position determines whether the hero is the thing protected.

**The bound of this comparison, stated plainly.** Matching is on the Bot-B win rate through one dial, the enemy hero's Health, and Health is an integer — so no cell lands exactly on 40% and the reported figure is interpolated between the two that bracket it. The nearer bracket is within 2.1 pp of 40% for every variant; the farther one is up to 5.8 pp away, for Relay-removed, where one point of Health is worth seven points of win rate. How much that interpolation can be worth is measurable, and it was measured: the local slope of gap against baseline is -0.208 pp per pp for the intact deck, -0.207 for Relay-removed, -0.054 for Ward-removed and +0.005 for the stripped set. At those slopes a full 2 pp of residual baseline mismatch moves a gap by less than half a point, against effects of 4.25 and 10.84 pp. The ordering is safe. What is *not* established is that Health is the only thing that moved: an ablated deck is a different deck, not the same deck at a different difficulty, and matching one summary statistic does not make two decks equivalent. So read this as "at equal difficulty as the random bot experiences it", not as a clean single-variable experiment.

### Wake is a dead trait for the side that resolves first

Ablating Wake changes **not one outcome and not one placement** — 3 bots × 20,000 seeds, 60,000 fights, at the shipped `even` operating point.

| bot | intact | Wake removed | placements differ | outcomes differ | final state differs |
|---|---|---|---|---|---|
| A optimal | 58.30% | 58.30% | 0/20,000 | 0/20,000 | 174/20,000 |
| B random | 39.51% | 39.51% | 0/20,000 | 0/20,000 | 232/20,000 |
| C append right | 46.41% | 46.41% | 0/20,000 | 0/20,000 | 86/20,000 |

The last column is the one worth reading, because it is not zero and the mechanism is exactly what "dead trait" predicts. In those fights the **only** field that differs is `player.bonusPower`, checked field by field with `.probe/wake-diff.ts`: not health, not the board, not the generator states, not the result. Every one of them ended `enemyWin` or `timeout` — the fight ended inside the enemy's phase that granted the buff, freezing a +2 that was never going to be spent. The `combat` generator is at the same position in both runs, so the +2 never produced an attack, a target roll or a kill.

Three code facts make this structural rather than a numbers problem:

- An attack targets the *other* side, so a player unit can only take damage during the enemy's phase.
- `runRound` resolves the player's whole line before the enemy's, so that phase is always after every player unit has acted.
- `startTurn(state, 'player')` clears `bonusPower` at the top of the next round, before the unit acts again.

So a player Wake grant always lands after its unit has acted and always expires before it acts again. **Wake works only for the side that resolves second.** An enemy Wake unit would get to use its bonus; a player one never can.

Note that the earlier report of this finding said every arm "reproduced to the digit". That was slightly too strong — 492 of 60,000 final states do differ — and the same sentence measured on `hashFight` would have looked far worse, because the canonical form includes each entity's trait list and so changes whenever an Avenger is alive at the end. That is the ablation, not an effect of it. The claim that survives is stronger where it counts: no placement and no outcome moves, anywhere.

It holds under every reading of "buffs granted during resolution last until end of turn" that expires them at a turn boundary. Making Wake live for the player needs a rule change, not an engine change: the grant would have to persist until the unit's next action rather than until the end of the turn. **That is the owner's call and this probe did not make it.**

### Determinism

- Same seed, same bot, 3 runs each over 40 seeds: identical final-state hashes. PASS.
- Seed plus recorded action list replayed with no bot in the loop: identical to the live run. PASS. This also proves the placement search consumes no fight randomness — replay does no searching, so any leak would diverge.
- 40 distinct hashes across 40 seeds, and a one-field mutation moves the hash. The determinism claim is therefore about a hash that varies.
- The hash covers the board, both hands, both deck cursors and both generator states — a replay that agrees on the board while disagreeing on the RNG has not reproduced the fight.

### Where the design is ambiguous or wrong

Reported, not fixed. Design changes are the owner's. All six were found by the first probe and all six still stand at this revision.

1. **Wake is dead for the player**, above. The most consequential of these.
2. **The worked example under-specifies its own targeting.** It says "Enemy board — one Stone Troll" and then lands every player attack on the Troll, but the same document makes the enemy hero a legal target with only Guard able to redirect. Taken literally the example does not reproduce: some attacks hit the hero. `test/worked-example.test.ts` gives the Troll a Guard to supply the missing constraint, and carries a second test showing what the example does without it.
3. **Ward's timing is not specified.** "The unit to my right cannot be struck this turn" does not say when the protection starts. Read as after-acting, like Relay, it is useless on the side that resolves second in the round — for the same reason Wake is useless on the side that resolves first. This prototype makes Ward a mark applied when the Ward unit acts, lasting until the start of that side's next turn, so it covers the opposing phase. Ward carries 58% of the placement decision, so this choice is load-bearing and the owner should confirm it.
4. **Ward and Guard together can leave an attack with no legal target.** Guard narrows the pool to Guards; Ward removes warded entities from it. Warding every living Guard empties the pool. This prototype fizzles the attack. The design does not cover the case.
5. **Adjacency across a dead unit is not specified.** Dead units are removed at the checkpoint here, so "the unit to my right" is the next living one. The alternative — corpses leaving gaps — would change every adjacency trait, and the design should say which it means.
6. **"Until end of turn" is ambiguous about whose turn.** A round contains both sides' resolutions. This prototype expires a buff at the start of the owning side's next turn, which is the reading that lets a player Ward cover the enemy's attacks. Findings 1 and 3 both hang on it.

### Limitations, stated plainly

- **This measures bots.** Bot A is a greedy one-turn lookahead; Bot B is uniform random. Neither is a person. A human would not place at random, so the 18.80 pp headline is an upper bound on what placement is worth against a thinking opponent, and the 11.89 pp against append-right is the better guide. Nothing here says the game is fun.
- **One fight, one deck, one enemy deck, one card set.** Fifteen cards. The gap could move with a different pool, and a deck with no Ward would show a little over 40% of one.
- **The gap is difficulty-dependent**, from 1.62 pp to 18.32 pp across the four encounters. Any single figure is a figure about an operating point.
- **The arms do not share targeting rolls.** Different placements consume different numbers of rolls, so the `combat` streams diverge within a fight. That is unavoidable — it is noise, not bias, and the paired design plus 20,000 seeds is what handles it — but it means the arms are not matched on targeting the way they are matched on cards and draws.
- **The search's own pairing decays through a rollout.** Common random numbers give every candidate in one decision the same rollout *seed*, not the same draw sequence: a placement that changes how many rolls the round consumes puts the streams out of step from that point on. Fixing that needs pre-drawn randomness in the resolver, which is an engine change and was not made.
- **The per-trait ablation is weaker evidence than the headline**, and its bound is stated with it above. Matching is on one summary statistic through one dial. The Ward-over-Relay ordering is well supported and survives both orders of removal; the exact split should be read as "roughly 2:1 to 2.5:1", not as 10.84 against 4.25.
- **Not verified: anything requiring a second opinion.** No independent review of this re-measurement was obtained. `AGENTS.md` marks the resolver's ordering rules and the RNG and seeding path as escalating to independent review; a review of the resolver at this revision was in progress in parallel and its outcome is not recorded here.
- The prototype is throwaway by design, per `ARCHITECTURE.md`: "it is small, it is throwaway, and its purpose is to answer the design's top open question by observation."
