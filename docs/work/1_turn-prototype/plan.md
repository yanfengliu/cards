# Probe: is placement a decision?

Status: complete
Owner: coordinator
Created: 2026-09-06
Updated: 2026-09-06

## Problem and outcome

The design asserts that where you put a unit matters. `ARCHITECTURE.md` says that claim is falsifiable and should be a gate:

> Run the same decks with a bot that places optimally and a bot that places randomly. **If their win rates are the same, placement is not a decision and the central claim of the design is false.**

Outcome: a headless deterministic prototype of one fight, and that measurement, run.

**Answer: placement is a decision.** Over 20,000 seeded fights, optimal placement wins **55.89%** and random placement wins **40.02%** — a paired gap of **15.87 percentage points** (95% CI 15.13..16.61) against a measured noise floor of **0.04 pp** (95% CI -0.69..0.77). The result is not near the noise.

The claim's bound: this measures **bots**, and a wide one. Bot B places uniformly at random, which no human does. Against a naive but sensible fixed rule — always append next to the hero — the gap is **9.47 pp**, and that is the more honest estimate of what placement is worth to a person who is not thinking about it.

Two findings the measurement was not looking for, both in [Outcome](#outcome): **Ward carries most of the decision and Relay carries much less**, and **Wake is a dead trait for the side that resolves first**.

## Scope

Included: one fight. Unlimited-width board with units inserted anywhere in the line, 3 energy a turn with no carryover, strict left-to-right resolution with the hero acting last from the rightmost slot, seeded random targeting, Guard, Armour, no damage carry, and the traits Relay, Guard, Wake and Ward. Fifteen hand-authored cards — eleven the player places, four the enemy fields. Two bots, a shared card-selection policy, and the A/B harness.

Excluded, per the assignment: the run and map structure, sigils, equipment, spells, classes, meta-progression, Echo, Kindle, tribes as mechanics, and all rendering. No DOM, no browser, nothing visual.

Dependencies: none. Base revision `5e9d66f` on `main`.

## Approach

### The engine

`src/engine/` follows the resolver contract in `ARCHITECTURE.md`. An explicit effect queue, never recursion. `apply` is the only function that writes state. Deaths are batched at a state-based checkpoint that runs after every effect, so health is never inspected at the instant damage lands. Trigger order is board order. The loop has an iteration cap that throws with the queue trace.

The queue is drained once per acting entity rather than once per phase. That is what "resolves left to right, one unit at a time" means: a unit's whole cascade finishes before its neighbour starts, and an effect that a unit spawns still lands before the next unit acts.

**The hero is simply the last element of its side's board array.** This makes "the hero acts last" and "an adjacency trait on the rightmost unit reaches the hero" the same fact rather than two rules that have to be kept in agreement.

Node 24's native type stripping runs the TypeScript directly, so there is no build step and no runtime dependency. `typescript` and `@types/node` are dev-only, for `npm run typecheck`. `tsconfig.json` sets `erasableSyntaxOnly`, so the typecheck fails if anything is written that type stripping cannot run.

### Holding card selection constant — the methodology

This is the part that makes the number mean anything, so it is stated precisely.

**`selectPlays(hand, energy)` is a pure function of hand and energy. It never reads the board.** Both bots call it. It returns the indices of the cards to play; the bot is then handed that card list and returns one insertion index per card. A bot cannot add, drop or reorder a card.

That the hands stay identical between the arms follows by induction: both arms shuffle the same deck from the same `deck` RNG stream, so the draw order is fixed; `selectPlays` is a function of the hand alone, so the same cards leave the hand; therefore the next hand is the same. Board divergence never reaches it.

**Two separate RNG streams**, derived from the seed by name. `deck` shuffles both decks once at setup. `combat` picks targets. They are separate because optimal placement changes how many targeting rolls a fight consumes, and on one shared stream that would shift the draw order too — the arms would then differ by more than the variable under test.

The argument above is not trusted on its own. The harness re-derives it from the actual runs: over **122,420 compared rounds** it checks that the two arms held the same hand and played the same card ids in the same order on every round both fights reached. It passes. The same check runs across all five arms in `test/methodology.test.ts`.

### The bots

- **Bot A, optimal placement.** Greedy search over insertion positions for the cards it is already committed to playing, one card at a time, scoring each candidate by rolling the round forward four times through the real resolver on a cloned fight. The rollouts use their own generators keyed by fight seed, round, candidate and rollout index — they never touch `combat`, so the search cannot see the targeting rolls the round is about to make. It is a bot, not an oracle. The rollout also skips the enemy's card plays, so the search cannot read the enemy's hand.
- **Bot B, random placement.** Uniform over legal insertion indices.
- **Bot B2**, the control: random placement on a different placement stream. Two policies that are identical in every way except their stream, so their gap is the measurement's noise floor.
- **Bot C, append right** and **Bot D, append left**: fixed rules, no search, for the skill gradient.

### Instrument checks, before trusting the measurement

Applying `ARCHITECTURE.md`'s guidance directly:

- **The seed set is the population meant.** Seeds 1..20,000, contiguous, every arm ran every seed. Stated in the output, not assumed.
- **The control reproduces.** Bot B against Bot B2 over 20,000 seeds: 40.02% against 39.98%, gap 0.04 pp (CI -0.69..0.77). The interval contains zero, and it bounds what any gap has to beat.
- **Both bots really play identical cards.** Checked over 122,420 rounds, and separately as a test over all five arms.
- **Placement really did differ.** 108,413 of 210,141 placed cards (51.59%) went to a different slot in the two arms. A check that both arms played the same cards would also pass if the bots had been placing them identically.
- **The hash is not degenerate.** A determinism test that a constant hash would pass proves nothing, so the suite also asserts that different seeds produce mostly different final hashes and that a one-field change moves the hash.
- **The search is not the bound.** Exhaustive search over the full product of insertion positions scores -0.30 pp against greedy (CI -1.96..1.36) over 2,000 seeds, so greedy is not leaving the conclusion on the table.
- **The tree held still.** Every arm runs in one process against one frozen revision. Content was tuned to its operating point *before* the measurement, never between arms.
- **A negative control**, described below, which is the check that actually establishes what the gap is made of.

### Choosing the operating point

A win-rate gap is squeezed against 0% and 100%, so the operating point is a real methodological choice and it was made before the headline run. The primary encounter (`even`) was tuned so both arms straddle 50%. Enemy card stats and the enemy hero's Health were the dials; the player's deck and hero were not touched.

Because the choice matters, the measurement runs at four difficulties and reports all of them.

## Acceptance criteria

- [x] A headless deterministic prototype of one fight, following the resolver contract in `ARCHITECTURE.md`.
- [x] `node --test` green, including a determinism property test.
- [x] The A/B measurement run, with real numbers, and its methodology stated.
- [x] Card selection held constant across arms, and verified against the actual runs rather than argued.
- [x] Determinism verified: same seed plus same action list produces an identical final state hash, over many trials.
- [x] Seed set, control reproduction and arm equivalence checked before the result is reported.
- [x] Nothing imported from a browser, DOM or renderer; `Math.random`, `Date.now` and `performance.now` absent from the engine, enforced by a test.

## Implementation steps

- [x] `.nvmrc` at 24; `package.json` with zero runtime dependencies.
- [x] `src/engine/rng.ts` — seeded generator, named independent streams, the only source of randomness.
- [x] `src/engine/state.ts` — board with the hero as the rightmost element; insertion at any slot.
- [x] `src/engine/resolver.ts` — effect queue, one mutation site, batched deaths, board-order triggers, iteration cap.
- [x] `src/engine/fight.ts` — rounds, energy, draw, the shared card-selection policy, replay.
- [x] `src/engine/hash.ts` — canonical serialisation of the whole fight, and its digest.
- [x] `src/content/cards.ts` — fifteen cards, four encounters, and the cascade-stripped control set. Data only.
- [x] `src/sim/bots.ts` — the placement policies.
- [x] `src/sim/measure.ts` — the A/B, the difficulty sweep, the negative control, the instrument checks.
- [x] `test/worked-example.test.ts` — the design's worked example, checked number by number.
- [x] `test/rules.test.ts`, `test/determinism.test.ts`, `test/methodology.test.ts`.
- [x] Calibrate the operating point, then freeze and measure.

## Outcome

Verified at commit `3209bbe` on branch `worktree-agent-a877008f8c5f44d63`. `npm run typecheck` clean, `node --test` 34/34, `npm audit` 0 vulnerabilities. Not merged — the coordinator integrates.

### The headline

20,000 contiguous seeds, encounter `even`, every arm on every seed.

| arm | win rate | 95% CI | mean rounds |
|---|---|---|---|
| A optimal placement | **55.89%** | 55.20..56.58 | 6.64 |
| C append right | 46.41% | 45.72..47.11 | 6.80 |
| B random placement | **40.02%** | 39.34..40.70 | 6.79 |
| B2 random placement (control) | 39.98% | 39.30..40.66 | 6.80 |
| D append left | 39.51% | 38.83..40.19 | 6.72 |

| paired comparison | gap | 95% CI | A-only wins | B-only wins | agreed |
|---|---|---|---|---|---|
| A optimal − B random | **15.87 pp** | 15.13..16.61 | 4,658 | 1,484 | 13,858 |
| A optimal − C append right | 9.47 pp | 8.81..10.14 | 3,340 | 1,445 | 15,215 |
| B random − B2 random (noise floor) | **0.04 pp** | -0.69..0.77 | 2,785 | 2,777 | 14,438 |

The gap is more than twenty times the half-width of the noise floor's interval. It is not a null result and it does not need rescuing.

The skill gradient `ARCHITECTURE.md` asks for is present but not uniformly spaced: random 40.02% ≈ append-left 39.51% < append-right 46.41% < greedy one-turn lookahead 55.89%. Append-left is indistinguishable from random, which is the expected shape — a fixed rule is not automatically better than no rule, it is better only if it is the right rule. Append-right captures about 40% of the available value; the remaining 9.47 pp is contextual and a fixed rule cannot reach it.

### The gap depends heavily on difficulty

5,000 seeds per cell.

| encounter | A optimal | B random | gap | 95% CI | noise floor |
|---|---|---|---|---|---|
| hard (Warchief 26 HP, two bodies out) | 23.90% | 6.12% | 17.78 pp | 16.65..18.91 | 0.28 pp |
| even (Warchief 18 HP, one body out) | 56.14% | 40.58% | 15.56 pp | 14.08..17.04 | -0.56 pp |
| easy (Warchief 12 HP, empty board) | 87.00% | 81.48% | 5.52 pp | 4.46..6.58 | -0.14 pp |
| trivial (Warchief 8 HP, empty board) | 96.54% | 95.46% | 1.08 pp | 0.52..1.64 | -0.32 pp |

The gap is real at every difficulty and largest where the fight is hard. Reporting a single operating point would have overstated or understated it by a factor of fifteen depending on which one was picked, which is why the sweep is part of the deliverable rather than an appendix.

### The negative control — what the gap is actually made of

The same eleven cards with every trait that reads a neighbour removed (Relay, Ward, Wake), Guard kept because Guard does not care where it stands. What placement can still touch is act order alone: who swings before the last enemy Guard dies.

| encounter | card set | A optimal | B random | gap | 95% CI |
|---|---|---|---|---|---|
| even | Relay/Ward/Wake intact | 56.14% | 40.58% | 15.56 pp | 14.08..17.04 |
| even | cascade stripped | 5.32% | 4.40% | 0.92 pp | 0.29..1.55 |
| easy | Relay/Ward/Wake intact | 87.00% | 81.48% | 5.52 pp | 4.46..6.58 |
| easy | cascade stripped | 30.18% | 29.28% | 0.90 pp | -0.14..1.94 |
| trivial | Relay/Ward/Wake intact | 96.54% | 95.46% | 1.08 pp | 0.52..1.64 |
| trivial | cascade stripped | 62.52% | 62.12% | 0.40 pp | -0.56..1.36 |

Run at every difficulty on purpose, because a gap shrinks near a floor for reasons that have nothing to do with the cascade. The load-bearing row is `trivial`: at a 62% baseline, nowhere near either bound, the gap is 0.40 pp with an interval containing zero.

**So the cascade traits are the whole effect.** Without them, act order alone is worth at most about 1 pp. The design's central claim is confirmed, and confirmed for the reason the design gives — adjacency, not ordering in general.

### Which traits carry it — and the surprise

Per-trait ablation. Removing a trait also weakens the deck, which moves the operating point, and the gap is difficulty-dependent — so the comparison is between cells with similar Bot-B win rates, not between cells with the same encounter. 4,000 seeds each.

| dropped | encounter | A optimal | B random | gap |
|---|---|---|---|---|
| nothing | even | 56.57% | 40.80% | 15.78 pp |
| relay | easy | 50.68% | 36.15% | 14.52 pp |
| ward | even | 38.80% | 31.42% | 7.38 pp |
| relay + ward | trivial | 62.40% | 62.08% | 0.33 pp |

At matched baselines, removing **Ward** more than halves the gap; removing **Relay** barely moves it. **Ward is the dominant carrier of the placement decision, not Relay.**

This is worth the owner's attention because Relay is the design's flagship cascade trait and the worked example is built on it — and the design already contains the reason. Its own analysis says "Both arrangements deal the same raw total — Relay's flat +2 goes somewhere either way", and argues the value is in *packaging* against armour and overkill. The measurement agrees with the arithmetic and says the packaging effect is the smaller half. Ward, by contrast, changes what can be hit at all, and its position determines whether the hero is the thing protected.

None of this weakens the headline. It relocates it: **the decision is real, and it is mostly about protection, not about buff routing.**

### Wake is a dead trait for the side that resolves first

Ablating Wake changed the outcome of **not one fight** — every arm reproduced to the digit. The mechanism, measured over 2,000 fights and 5,718 rounds:

- Player-side deaths during the **player's own** phase: **0**
- Player-side deaths during the **enemy's** phase: 1,111
- Wake grants that landed on a player unit: 59

Wake fires. It just always fires after its unit has already acted for the round, and the buff expires at the turn boundary before that unit acts again. A player unit can only die while the enemy is attacking, and the enemy attacks after the player's whole line has resolved.

This is symmetric and structural, not an artifact of this prototype's numbers: **Wake works only for the side that resolves second.** Enemy-side deaths during the enemy's own phase were likewise 0, and enemy-side deaths during the player's phase were 3,983 — so an enemy Wake unit does get to use its bonus, and a player one never can.

It holds under every reading of "buffs granted during resolution last until end of turn" that expires them at a turn boundary. Making Wake live for the player needs a rule change, not an engine change: the grant would have to persist until the unit's next action rather than until the end of the turn. **That is the owner's call and this probe did not make it.**

### Determinism

- Same seed, same bot, 3 runs each over 40 seeds: identical final-state hashes. PASS.
- Seed plus recorded action list replayed with no bot in the loop, 60 seeds: identical to the live run. PASS. This also proves the placement search consumes no fight randomness — replay does no searching, so any leak would diverge.
- 40 distinct hashes across 40 seeds, and a one-field mutation moves the hash. The determinism claim is therefore about a hash that varies.
- The hash covers the board, both hands, both deck cursors and both generator states — a replay that agrees on the board while disagreeing on the RNG has not reproduced the fight.

### Where the design is ambiguous or wrong

Reported, not fixed. Design changes are the owner's.

1. **Wake is dead for the player**, above. The most consequential of these.
2. **The worked example under-specifies its own targeting.** It says "Enemy board — one Stone Troll" and then lands every player attack on the Troll, but the same document makes the enemy hero a legal target with only Guard able to redirect. Taken literally the example does not reproduce: some attacks hit the hero. `test/worked-example.test.ts` gives the Troll a Guard to supply the missing constraint, and carries a second test showing what the example does without it.
3. **Ward's timing is not specified.** "The unit to my right cannot be struck this turn" does not say when the protection starts. Read as after-acting, like Relay, it is useless on the side that resolves second in the round — for the same reason Wake is useless on the side that resolves first. This prototype makes Ward a mark applied when the Ward unit acts, lasting until the start of that side's next turn, so it covers the opposing phase. Given that Ward turns out to carry most of the placement decision, this choice is load-bearing and the owner should confirm it.
4. **Ward and Guard together can leave an attack with no legal target.** Guard narrows the pool to Guards; Ward removes warded entities from it. Warding every living Guard empties the pool. This prototype fizzles the attack. The design does not cover the case.
5. **Adjacency across a dead unit is not specified.** Dead units are removed at the checkpoint here, so "the unit to my right" is the next living one. The alternative — corpses leaving gaps — would change every adjacency trait, and the design should say which it means.
6. **"Until end of turn" is ambiguous about whose turn.** A round contains both sides' resolutions. This prototype expires a buff at the start of the owning side's next turn, which is the reading that lets a player Ward cover the enemy's attacks. Findings 1 and 3 both hang on it.

### Limitations, stated plainly

- **This measures bots.** Bot A is a greedy one-turn lookahead; Bot B is uniform random. Neither is a person. A human would not place at random, so the 15.87 pp headline is an upper bound on what placement is worth against a thinking opponent, and the 9.47 pp against append-right is the better guide. Nothing here says the game is fun.
- **One fight, one deck, one enemy deck, one card set.** Fifteen cards. The gap could move with a different pool, and a deck with no Ward would show much less of one.
- **The gap is difficulty-dependent**, from 17.78 pp to 1.08 pp across the four encounters. Any single figure is a figure about an operating point.
- **The arms do not share targeting rolls.** Different placements consume different numbers of rolls, so the `combat` streams diverge within a fight. That is unavoidable — it is noise, not bias, and the paired design plus 20,000 seeds is what handles it — but it means the arms are not matched on targeting the way they are matched on cards and draws.
- **The per-trait ablation is weaker evidence than the headline.** Removing a trait moves the operating point, so the attribution rests on comparing cells with similar baselines rather than on a clean experiment. The Ward-dominant conclusion is well supported; the exact split between Relay and Ward is not.
- **Not verified: anything requiring a second opinion.** No independent review was obtained. `AGENTS.md` marks the resolver's ordering rules and the RNG and seeding path as escalating to independent review, and that has not happened.
- **`AGENTS.md` Gates still say "Design-stage (now). No code, so no code gates."** That line is now false — `npm run typecheck`, `node --test` and `npm audit` all exist and pass. The assignment excluded editing `AGENTS.md`, so this is left for the coordinator.
- The prototype is throwaway by design, per `ARCHITECTURE.md`: "it is small, it is throwaway, and its purpose is to answer the design's top open question by observation."
