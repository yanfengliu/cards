# Mutual damage, no Ward, decks that reshuffle

Status: implemented, gates green, not reviewed, not merged
Owner: worker on branch `worktree-agent-a57a336d565027bad`, cut from `b79abf9`
Created: 2026-09-07
Updated: 2026-09-07

## Problem and outcome

Four owner rulings, all on combat, all of them rules changes rather than balance changes.

1. **Combat is mutual.** "When A attacks B they both do damage to each other." The influences table promised "a persistent board of units **that trade**" and the combat rules never said the defender hits back, so attacking cost nothing and a line was a damage total rather than a set of bodies with a price on using them.
2. **Ward is removed entirely.** "The unit to my right cannot be struck this turn" applied to a side's only Guard emptied `legalTargets` and made that whole side untargetable, permanently, for two cheap cards on turn one.
3. **Wake must become useful.** It had never done anything: your units only died during the enemy's phase, and `startTurn` cleared the +2 before the woken unit next swung.
4. **Decks reshuffle inside a fight.** Neither deck reshuffled, so deck size was a resource budget and a small deck simply ran out — which inverts "deck thinning as a skill".

Outcome: all four implemented, `npm run gates` green, and every number the design rests on re-measured.

## Scope

**Changed.** `src/engine/` (state, resolver, fight, hash), `src/content/cards.ts`, `src/run/content.ts`, `src/sim/` (measure comments, plus a new `src/sim/ablate.ts`), `test/`, `docs/design/game.md` for the four rulings, `ARCHITECTURE.md` where it described the resolver, `AGENTS.md` for one line naming the new instrument.

**Out of scope and deliberately not done.** Re-tuning the four preset encounters, re-costing the card pool for a world where attacking has a price, and minting a card to replace the Elf Warden. Each is a balance decision, and doing any of them would have made the rules change unmeasurable against an unmoved content set.

**Boundary crossed, and it needs reconciling.** `src/ui/` and `src/render/` belong to another worker this round. Removing Ward *entirely* is not possible without touching them: `'ward'` is a member of the `Trait` union, `warded` is a field on `Entity`, and `warded` is a `GameEvent` kind, so `src/render/view.ts`'s `case 'warded'` is a type error the moment the union loses it. `npm run typecheck` is inside `npm run gates`, so leaving them alone would have handed over a red tree. The edits were kept mechanical and they are listed here so they can be re-applied by hand if the other worker's branch wins the merge:

| file | what changed |
|---|---|
| `src/render/view.ts` | `warded` dropped from `EntityView`, `viewOf`, `viewDrift`; the `ward` Beat and its `case 'warded'` replaced by a `retaliate` Beat and `case 'retaliated'`; `attributeBuff` now keeps every death in the phase rather than the last one |
| `src/render/odds.ts` | the Ward half of `projectOwnPhase` deleted, comments rewritten |
| `src/render/board.ts` | the `ward` trait glyph and two `is-warded` class toggles deleted |
| `src/render/anim.ts` | `ward: 380` replaced by `retaliate: 300` in the beat-duration map |
| `src/render/blazons.ts` | the `u_warden` device deleted, the card being gone |
| `src/ui/app.ts` | the Ward trait rule, the ward log line, the ward effect, `warded: false` in the ghost view; a `retaliate` log line and effect added; the "Nothing of yours can be struck once your Wards land" warning reworded |
| `src/ui/app.css` | `.card.is-warded::after` and `.fx--token.is-ward` deleted |
| `src/ui/session.ts` | two `drawTo` call sites take the deck generator, because `drawTo` now reshuffles |

That last one is load-bearing rather than cosmetic: `src/ui/session.ts` carries its own copy of the round, and `test/ui-session.test.ts` compares `hashFight` after every round across 160 fights. A `session.ts` that did not reshuffle would be a different game with a screen on it, and that gate would say so.

## Approach

### Ruling 1 — mutual damage, and the three sub-decisions it forced

Implemented inside the existing `attack` case, as **one effect**. Both blows are computed from `power()` read before either lands, both are applied, and `drain`'s single `checkStateBased` afterwards announces whichever died. That is the same shape `damageAll` already had and it is what makes "simultaneous" a property of the code rather than a comment.

The three open questions the ruling named, decided and written into `docs/design/game.md` with their reasoning:

- **Does the hero retaliate when attacked?** Yes. "The hero is a legal target, not a protected back rank" is an owner ruling, and a hero that did not hit back would be the *safest* thing on the board to attack — which inverts the rule that Guards are what keep it safe.
- **Does the hero take retaliation when it attacks?** No, and this is the one asymmetry in the whole rule. **Units never take orders**: the hero swings every turn whether the player wants it to or not, so retaliation on its own swing is unavoidable chip damage with no decision attached, against the bar that carries a whole run. The arithmetic is not close — a hero swinging into bodies of 1-4 Power takes roughly 2-3 a round over ~8 rounds a fight and ~12 fights a run, against a Health bar of 200 that only rests can refill. `AGENTS.md` calls a mechanic with no decision attached a candidate for deletion; this one would have been a tax.
- **Does a 0-Power unit retaliate for 0?** Yes, and the `retaliated` event is emitted at zero rather than suppressed — a blow that bounced is a different thing from no blow at all, and the animation shows it. So **a 0-Power, high-Health body is a genuine wall**: free to attack into, forever. That is now a card to design toward.
- **Does retaliation trigger `afterActed`?** No. The defender did not act. Gated.

**One consequence was not in the ruling and is the largest thing in the round.** A unit that dies to the retaliation its own attack drew never reaches `afterAct`, because `apply` skips an effect naming a dead entity — the existing "no unit acts after dying" rule, which is itself gated. So a fragile Relay body may die on its own swing and hand nothing forward. This was kept rather than special-cased, because the alternative is a rule written to protect one trait. It is what killed the design's old worked example, and it is open question 1 in `docs/design/game.md` now.

**Spells do not trade.** `damageOne` and `damageAll` deal their number and take nothing back. A spell is cast from behind the line, and this is what keeps AoE the answer to a wide board rather than a way to feed one.

### Ruling 2 — Ward removed

Trait, `warded` field, `grantWard` effect, `warded` event, the Elf Warden card, and every mention in `docs/design/game.md`. Six gates used Ward incidentally to build a fixture and were **retargeted, not deleted**; one gate could not be retargeted and is recorded as lost. Both are in `docs/learning/gate-proofs.md`.

The lost one: "inside one unit, traits fire in the source order of the `if` blocks in `triggersFor`". Relay and Ward were the only two shipped traits that keyed on the same event. The rule still stands and is now **unobservable** — `ARCHITECTURE.md` says so rather than implying a gate holds it — and a replacement test pins the reason, so adding a second `afterActed` trait goes red.

### Ruling 3 — Wake

No change to the trait. Mutual damage fixes it at the root, and it was **verified rather than assumed**, twice: a fixture in which the woken unit must *swing* at its raised Power, and an ablation over 200 real fights requiring some outcome to differ. It is alive.

### Ruling 4 — reshuffle

`drawTo` takes the fight's `deck` generator and reshuffles when the deck runs out. **There is no `discard` field**, and that is the design rather than an omission: `reshuffle` is only ever called with the cursor at the end of the deck, so every card has been drawn and the discard is exactly `deck` minus `hand` as multisets. Deriving it means no new state for `cloneFight` to copy, for `hashFight` to serialise, or for a replay to get wrong.

Determinism holds. The reshuffle runs on the `deck` stream, which is separate from `combat` by construction, and both A/B arms play the same cards on the same rounds — so they run out on the same round and take the same draws when they do. Gated by replay over 60 fights at `hard` that refuses to report success unless some fight actually reshuffled.

## Acceptance criteria

- [x] Mutual damage implemented, simultaneous, with armour on both hits.
- [x] The four sub-decisions decided and documented with reasoning in `docs/design/game.md`.
- [x] Ward removed from trait, effect, cards, tests and design; incidental gates retargeted.
- [x] Wake verified live by measurement, not assumed.
- [x] Decks reshuffle deterministically through the existing seeded stream; whole-fight and whole-run replay reproduce.
- [x] `npm run gates` green.
- [x] Every new or changed gate watched going red and recorded in `docs/learning/gate-proofs.md` naming the revision.
- [x] `npm run verify`, the difficulty sweep, the per-trait ablation and `npm run measure:run` re-measured, before and after recorded.
- [ ] Independent review. Not done — the resolver's ordering rules and `docs/design/` both escalate to it per `AGENTS.md`.

## Measurements: before and after

Before is `b79abf9`. After is this branch. **Every number moved, and that is expected here.**

### The headline: is placement still a decision?

**Yes, and it is worth roughly half what it was.**

| | before | after |
|---|---|---|
| A optimal, `even`, 20,000 seeds | 58.30% | **66.48%** |
| B random, same | 39.51% | **58.10%** |
| paired gap | **18.80 pp** (CI 18.06..19.53) | **8.38 pp** (CI 7.80..8.96) |
| noise floor (two random bots) | -0.26 pp | -0.21 pp |
| against append-right | 11.89 pp | 10.09 pp |
| gap at a matched 40% baseline | 18.65 pp | **9.28 pp** |
| cascade-stripped control, matched baseline | 1.51 pp | **0.83 pp** |

The gap is about **ten times the negative control and forty times the noise floor**, and its 95% interval is nowhere near zero over 20,000 seeds. It is a decision. It is a *smaller* decision, and the reason is exactly the one the assignment predicted: Ward was carrying most of it.

Two things make the after-figure an understatement rather than an overstatement. The `even` encounter was tuned so both arms straddle 50% and now runs 66.5% against 58.1%, so the gap is compressed by the ceiling — matched back to a 40% baseline it is 9.28 pp. And nothing in the card pool was re-costed for a world where attacking has a price.

### The difficulty sweep, 4,000 seeds a cell

| encounter | before, gap | after, A | after, B | after, gap |
|---|---|---|---|---|
| hard | 17.42 pp | 18.48% | 11.28% | **7.20 pp** |
| even | 18.32 pp | 66.35% | 57.40% | **8.95 pp** |
| easy | — | 96.90% | 95.08% | **1.82 pp** |
| trivial | 1.62 pp | 99.72% | 99.58% | **0.15 pp** |

**`easy` and `trivial` are now degenerate** — both arms within a point of the ceiling — so they measure nothing. The four encounters need re-centring and this round deliberately did not do it.

### The per-trait ablation, 4,000 seeds a cell, matched 40% baseline

`npm run measure:ablate` is new. The previous round's version of this table lived in untracked scratch under `.probe/` and could not be re-run from a clean checkout, which was flagged at the time; it is now a tracked command.

| card set | gap |
|---|---|
| intact | **9.28 pp** |
| no Relay | 5.10 pp |
| no Wake | 6.82 pp |
| cascade stripped | 0.83 pp |

- Removing **Relay** costs 4.17 pp; removing **Wake** costs 2.46 pp.
- With the other already gone, Relay is worth **5.99 pp** and Wake **4.28 pp**; the two interact by −1.81 pp.

Before, the same measurement read: intact 18.65 pp, removing **Ward** 10.84 pp, removing Relay 4.25 pp, so **Ward-dominance at about 2.5:1**. After: **no trait dominates.** Relay is the larger of the two and Wake — which used to change the outcome of not one fight in twenty thousand — now carries nearly as much.

### The run, 1,000 seeds

| | before | after |
|---|---|---|
| run win rate, strongest arm | 16.80% | **10.60%** |
| act clear rates (conditioned on entry) | 89.9 / 64.3 / 29.1 | **100.0 / 81.6 / 13.0** |
| routing worth, placement held fixed | 8.80 pp | **5.70 pp** |
| a won run | 12.1 fights of 7.8 rounds | **12.4 fights of 8.8 rounds** |
| hero Health | 80 | **200** |

**The run was unwinnable — 0 of 1000 — before hero Health moved**, and `npm run verify:run`'s degeneracy gate is what caught it. Nothing was too hard: every shipped encounter still won 87-100% in isolation at full Health. The Health economy had stopped adding up, because both new rules push the same way — your bodies die to the retaliation their own attacks draw, so the line protecting the hero thins faster, and the enemy's deck no longer runs dry, so it keeps fielding bodies for the whole fight. The measured cost of a won fight roughly doubled and hero Health was moved by the same rule that set it the first time.

**The act curve's shape moved and hero Health does not fix it.** Act 1 now clears 100% of the time and every run that ends does so in act 2 or 3; act 3 is where 71% of runs die, and 27% of them to a *timeout* rather than a kill. That is a content question for the balance node.

## Open questions this round leaves

1. **The cheap bodies do not survive their own swing.** A 1-Power, 2-Health Squire dies to any 2-Power defender the moment it attacks, so every cheap body is a one-shot and the trait printed on it may never fire. No card was costed for this. First thing a balance pass has to answer.
2. **Should a unit that dies to retaliation still fire its after-acting trait?** Kept as "no", from the existing "no unit acts after dying" rule. It is the largest single effect on Relay and the owner may want the other answer.
3. **The four preset encounters need re-centring.** `even` is above 50% and `easy`/`trivial` are at the ceiling.
4. **The measured deck is two cards smaller than it was.** Removing the Elf Warden left `PLAYER_DECK` at 18 and the run's starting deck at 14. Nothing was minted to replace them. Every before/after comparison here therefore differs by two cards as well as by three rules.
5. **`MIN_GAP_PP` is 5.00 and the gap is 8.38.** The floor's headroom fell from 5.1 standard errors to about 1.6, so a seed window can now trip `npm run verify` without a rules change, roughly one run in twenty. The floor was deliberately **not** lowered: moving the number a gate defends because the thing it defends got smaller is how a gate stops being one. If the owner wants the headroom back it has to come from content.
6. **`RUN_MAX_ROUNDS` is still 20 and 27% of act-3 runs now end in a timeout.** The reason it was raised — decks running dry, leaving two heroes trading — is gone. It is a balance dial and was left alone.
7. **`test/render-view.test.ts`'s projection gate is weaker than it was.** `projectOwnPhase` is now an *upper bound* rather than exact, because a unit can die mid-phase to retaliation and never grant its Relay, and Wake can fire during your own phase and is not projected. The test excludes phases in which something of the player's died and asserts that such phases exist, so it cannot silently become vacuous — but the pre-commit odds on screen are now optimistic in a way `ARCHITECTURE.md`'s definition of fair cares about. That belongs to whoever owns `src/render/`.

## Outcome

Implemented and verified on branch `worktree-agent-a57a336d565027bad`, cut from `b79abf9`. `npm run gates` exits 0: 133 tests (117 before), typecheck, both boundary gates, `npm run verify` and `npm run verify:run`. Sixteen mutations watched going red, recorded in `docs/learning/gate-proofs.md`. Not reviewed, not merged.
