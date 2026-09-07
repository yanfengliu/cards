# 2026-09-07 — mutual damage, no Ward, decks that reshuffle

Branch `worktree-agent-a57a336d565027bad`, cut from `b79abf9`. History, not status; the plan is `docs/work/6_trade-and-thin/plan.md`.

## What was believed and proved false

**"Making combat mutual will make the game harder."** It made the single fight *easier* and the run *impossible*. At the `even` encounter the optimal bot went from 56.75% to 66.48% — your side has more bodies than the enemy's on most turns, so mutual damage is a bigger buff to you than to it. Meanwhile the run went to 0 wins in 1000. Those are not in tension: a fight in isolation starts at full Health and a fight in a run does not, and what broke was the Health carried between them, not the fight.

**"The design's worked example will need its numbers nudged."** It needed replacing. Both of its bodies are 1-Power against Armour 2, so both deal zero and both die to a 3-Power Troll's answer — and a Relay unit that dies mid-swing never reaches `afterAct`, so the trait the whole example is about never fires. Arrangements A and B became identical, which is the one thing a worked example about a decision may not be. The rewrite is built on Wake instead, where the decision is "put the body that answers a death to the right of the body that is going to die".

**"The enemy hero's Health is very nearly a no-op"** — measured last round and written into `src/run/content.ts`. Not re-tested here, and it should be: a hero now retaliates when struck, so its Power is live in a way it was not, and `src/sim/ablate.ts` bisects on enemy Health as a continuous dial and finds it moves the random arm's win rate by 5-7 points per point of Health at the `even` opening. The old claim was about a different rule set.

**"Removing a trait is a deletion."** Six gates in the suite used Ward *incidentally* — to empty a target pool, to queue two effects whose order mattered, to build a two-trait unit. Each needed a different fixture rather than a deletion, and `docs/learning/gate-proofs.md` had said so in advance, which is the only reason it was checked before cutting.

## What a gate caught that the author would not have

**`npm run verify:run`'s degeneracy check.** The first full-gate run after the three rules landed failed with "the strongest arm won 0/200". Nothing in the fight tests noticed; every fight-level gate was green and every shipped encounter still won 87-100% of the time in isolation. That gate is deliberately not a win-rate band — a band would go red on a content change that improved the game — and it is exactly the shape that caught this: not "the run got harder" but "the instrument can no longer see a difference".

**The view-drift gate.** Mutual damage lets one attack put two entities at zero at one checkpoint, so a single effect now emits two `died` events followed by the Wake triggers answering them. `src/render/view.ts` kept only the most recent death when attributing a buff, so the *first* death's Wake matched nothing and the animation had no arrow to draw. Nobody looked for this; the existing gate went red on seed 7, round 1.

## What number moved and from what

Before is `b79abf9`; after is this branch. Seed counts are named because none of these is a fact about the game without one.

| | before | after |
|---|---|---|
| optimal-vs-random gap, `even`, 20,000 seeds | 18.80 pp | **8.38 pp** (CI 7.80..8.96) |
| the same at a matched 40% baseline, 4,000 seeds | 18.65 pp | **9.28 pp** |
| cascade-stripped control, matched baseline | 1.51 pp | **0.83 pp** |
| noise floor, two random bots | −0.26 pp | −0.21 pp |
| optimal vs append-right | 11.89 pp | 10.09 pp |
| what Ward carried | 10.84 pp | trait deleted |
| what Relay carries alone | 4.25 pp | **5.99 pp** |
| what Wake carries alone | 0 outcomes changed in 20,000 fights | **4.28 pp** |
| run win rate, 1,000 seeds | 16.80% | **10.60%** |
| act clear rates | 89.9 / 64.3 / 29.1 | **100.0 / 81.6 / 13.0** |
| routing worth, placement fixed | 8.80 pp | 5.70 pp |
| hero Health | 80 | **200** |
| `PLAYER_DECK` | 20 cards | 18 |
| run starting deck | 16 cards | 14 |
| suite | 117 | 133 |

**The direct answer: placement is still a decision, at roughly half its old size.** 8.38 pp is about ten times the negative control and forty times the noise floor, with a 95% interval nowhere near zero over 20,000 seeds. Ward was carrying most of the old figure and Ward is gone.

Two reasons the after-figure understates rather than overstates. `even` was tuned so both arms straddle 50% and now runs 66.5% against 58.1%, so the gap is compressed by the ceiling — matched back to 40% it is 9.28 pp. And no card was re-costed for a world where attacking has a price.

## Trip hazards for a later session

**`PLAYER_DECK` is 18 cards, not 20.** Removing the Elf Warden left two slots and nothing was minted to fill them, because inventing a card to hold a deck slot is a balance decision. So every before/after comparison in this round differs by two cards as well as by three rules, and no attempt was made to separate them. If you re-run any of the old numbers, that is why they will not line up.

**`easy` and `trivial` measure nothing now.** 96.9/95.1 and 99.7/99.6 — both arms at the ceiling. The four-encounter sweep still prints them and the two bottom rows should be read as "no information", not as "the gap is small there".

**`MIN_GAP_PP` is still 5.00 and its headroom fell from 5.1 standard errors to about 1.6.** A seed window can now trip `npm run verify` without a rules change, roughly one run in twenty. That was left alone deliberately: lowering the number a gate defends because the thing it defends got smaller is how a gate stops being one. If it starts flaking, the fix is content, not the constant.

**`src/ui/` and `src/render/` were edited by a worker who did not own them.** Removing Ward *entirely* is impossible without it — `'ward'` is in the `Trait` union, `warded` is an `Entity` field and a `GameEvent` kind, and `typecheck` is inside `npm run gates`. Every line is listed in `docs/work/6_trade-and-thin/plan.md` so it can be re-applied by hand if the other branch wins the merge.

**`projectOwnPhase` is now an upper bound, not exact.** A unit can die mid-phase to retaliation and never grant its Relay, and Wake can fire during your own phase and is not projected. The pre-commit odds on screen are therefore optimistic, which `ARCHITECTURE.md`'s definition of fair cares about. Its gate now excludes phases in which something of the player's died, and asserts such phases exist so it cannot become vacuous — but the underlying display question is open and belongs to whoever owns `src/render/`.

**The ablation is a tracked command now.** `npm run measure:ablate`. Last round's version of that table lived in untracked scratch under `.probe/` and could not be reproduced from a clean checkout; that was flagged at the time and is fixed. Its calibration arm is Bot B alone and never Bot A, because calibrating on the arm under test tunes the difficulty until the measured thing has a chosen value.
