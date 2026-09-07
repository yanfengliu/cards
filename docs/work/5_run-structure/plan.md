# Map, acts and the run loop

Status: complete
Owner: coordinator
Created: 2026-09-07
Updated: 2026-09-07

## Problem and outcome

The game had one fight and no run. `docs/design/game.md` asks for three acts, each a branching map, each ending in a boss, with node types fight / elite / event / shop / forge / rest and a target run length of thirty minutes.

Built: `src/run/`, a headless deterministic run that carries a hero and a deck from the first node of act 1 to the boss of act 3, and `src/sim/runmeasure.ts`, which measures it. The engine is composed through its existing API — `setupFight`, `runFight`, `replayFight`, `CardPool` — and nothing under `src/engine/` or `src/content/` was touched.

The invariant that had to hold: **a whole run is a pure function of its seed and its ordered list of choices.** `replayRun` is that sentence as code, and `npm run verify:run` enforces it over 200 seeds.

### Which instrument produced these numbers

`node src/sim/runmeasure.ts --seeds 1000 --encounters --check-seeds 40`, at the revision this plan closes. Every number below is the placement bot's and the router's, and that bound is restated where it matters.

## Scope

In: `src/run/` (map generation, the run loop, node behaviours, run state, the run hash, the run's content), `src/sim/runbots.ts`, `src/sim/runmeasure.ts`, `test/run.test.ts`, the two new npm scripts, and the two `AGENTS.md` Gates lines that name them.

Out, and deliberately: **sigils.** They are the run's progression system and they are a system of their own. What this unit leaves is a seam and nothing else — `RunState.sigils`, a `SigilGrant` type, a comment at the elite/boss reward where a hero sigil is granted in the design, and `hashRun` covering the list so the day sigils land the run hash notices instead of agreeing with itself. A test asserts the seam is inert.

Not touched: `src/engine/`, `src/content/`, `src/render/`, `src/sim/measure.ts`, `docs/design/game.md`, `ARCHITECTURE.md`.

## Approach

### The map

A layered directed graph per act: eight rows, one node visited per row, so a path is eight nodes and a run twenty-four. Row 0 is always a fight, row 6 is the run-up to the boss (rest, shop or forge, never a fight), row 7 is the boss.

Two rules make it a map rather than a decoration:

- **No two nodes in one row share a type.** A row of three is a choice between three different things, every time. This is structural, not statistical — the row's types are a weighted draw *without replacement*.
- **Edges never cross.** The base edge set is monotone by construction and every extra edge is checked against the same monotonicity, so a node's column is a position a player can read. Coverage falls out of the same arithmetic: no unreachable node, no dead end, with no repair pass.

"A map where every path is equivalent is not a map" is then a measurable claim rather than a hope. `pathSpread` computes, by dynamic programming over the rows in reverse, the exact minimum and maximum count of each node type over **every** entry-to-boss path. On the shipped shape the route decides **5.82 of the 7 node types** on an average act map, and no map in 120 had none.

### Randomness, and why the fights are insulated

One generator, `RunState.rng`, on the stream `run`, derived by `makeRng(seed, 'run')` exactly as a fight's `deck` and `combat` streams are derived from the fight seed. It is threaded through map generation at setup and through every reward offer, shop shelf and event draw after it.

**No fight ever reads it.** A fight's seed and its encounter are `mixSeeds(runSeed, act, nodeId, tag)` — a pure function of *which node it is*, and of nothing the player did on the way there. So the fight at act 2's node 11 is the same fight whatever route reached it and however many draws the run stream has taken. That is the assignment's "a different routing choice cannot perturb a fight's internals" as arithmetic rather than as a convention, and it is checked two ways: burning 37 draws on the run generator moves no fight seed (and no map), and two differently-routed runs of one seed agreed on **181/181** shared fight nodes.

All three act maps are generated at setup, before the first choice, so the map is a function of the seed alone and two routes through one seed are comparable.

### The forge, and why it needed no engine change

A run deck is a list of *instances*, not card ids, because "permanently upgrades one card" has to be able to pick one of three Squires. Each instance carries an id like `u_squire#7` and its own permanent bonuses.

The fight is handed a deck of instance ids and a `CardPool` that resolves them (`runPool`). A +1 Power Squire arrives at `makeUnit` as an ordinary `UnitCard` with a power of 2. The pool seam in `src/engine/state.ts` already did this job; nothing in the engine had to learn that a run exists. Cost is clamped at zero at resolution, so a wasted cost forge is a decision the player can make badly.

### The choice list

Every decision returns one integer: which node, which reward (or `-1` to decline), which forge, which shop item (or `-1`), which event option. A run is therefore a seed plus a list of integers. `runChoices(log)` flattens it.

`replayRun` takes that log and **no agent at all**: maps regenerated, every offer recomputed from the run stream, each fight replayed from its own recorded action list through `replayFight`. Nothing derived is read back from the log — only the choices. There is exactly one node code path, `visit`, shared by the live run and the replay, which is the same shape `runRound`/`replayFight` already use for a fight.

### Measurement

`src/sim/runmeasure.ts`, beside `measure.ts` rather than inside it. Four arms — two route styles crossed with two placement styles — so a route comparison holds placement fixed and is a statement about routing.

`--encounters` prints every shipped encounter fought on its own, which is what the act curve was tuned on. It exists so the win rates written into `src/run/content.ts` are reproducible from a clean checkout instead of being a claim about a scratch script that no longer exists.

## Acceptance criteria

- [x] Three acts, a branching map per act with real routing choices, ending in a boss.
- [x] A run loop that enters a node, resolves it and carries state forward.
- [x] Hero Health persists across fights and is healed at rest nodes; the deck grows through card rewards; the run ends when the hero dies or the final boss falls.
- [x] Fight and elite nodes compose the existing fight engine; forge permanently upgrades one card by +1 Power, +1 Health or −1 cost; shop, event and rest move run state.
- [x] Sigils out of scope, with a clean inert seam.
- [x] A whole run replays to an identical final state from seed plus choice list.
- [x] The run generator is on its own stream and cannot perturb a fight.
- [x] Simulation reports win rate per act, where runs end, and run length in fights.
- [x] `npm run gates` green; `npm run verify`'s fight numbers unchanged.
- [x] Every new gate watched going red, recorded in `docs/learning/gate-proofs.md`.

## Implementation steps

- [x] `src/run/types.ts`, `map.ts`, `deck.ts`, `nodes.ts`, `run.ts`, `hash.ts`, `content.ts`.
- [x] `src/sim/runbots.ts` (two route styles, three placement styles) and `src/sim/runmeasure.ts`.
- [x] `test/run.test.ts` — 23 tests, split into structure (against the shipped content) and behaviour (against a fixture, so a rebalance cannot make them red).
- [x] `npm run measure:run` and `npm run verify:run`; `verify:run` chained into `npm run gates`.
- [x] Calibrate the content against the encounter report; thirteen mutations watched going red.

## Outcome

### The headline, 1000 seeds

| arm | win rate | 95% CI | mean acts cleared | mean fights | mean rounds/fight | mean end deck |
|---|---|---|---|---|---|---|
| greedy route / search placement | 16.80% | 14.61..19.24 | 1.65 | 9.66 | 7.47 | 27.2 |
| random route / search placement | 8.00% | 6.47..9.85 | 1.25 | 7.46 | 7.18 | 22.2 |
| greedy route / append right | 9.10% | 7.47..11.04 | 1.29 | 8.12 | 7.35 | 25.1 |
| random route / append right | 3.10% | 2.19..4.37 | 0.99 | 6.42 | 6.95 | 21.1 |

### Win rate per act, conditioned on entering it

| arm | act 1 | act 2 | act 3 |
|---|---|---|---|
| greedy / search | 89.90% (899/1000) | 64.29% (578/899) | 29.07% (168/578) |
| random / search | 82.50% (825/1000) | 42.30% (349/825) | 22.92% (80/349) |
| greedy / right | 78.80% (788/1000) | 52.28% (412/788) | 22.09% (91/412) |
| random / right | 73.90% (739/1000) | 29.36% (217/739) | 14.29% (31/217) |

A real gradient, and it is the gradient the content was tuned for: act 1 is survived, act 2 is where a run's shape shows, act 3 kills seven runs in ten that reach it.

### Where runs end

Strongest arm, 1000 seeds. `timeout` is a fight that ran out of rounds and is counted as a loss.

| act | cause | node | runs | share |
|---|---|---|---|---|
| 1 | killed | fight | 29 | 2.90% |
| 1 | killed | elite | 27 | 2.70% |
| 1 | killed | boss | 45 | 4.50% |
| 2 | killed | fight | 155 | 15.50% |
| 2 | killed | elite | 64 | 6.40% |
| 2 | killed | boss | 99 | 9.90% |
| 2 | timeout | boss | 3 | 0.30% |
| 3 | killed | fight | 186 | 18.60% |
| 3 | killed | elite | 71 | 7.10% |
| 3 | killed | boss | 152 | 15.20% |
| 3 | timeout | boss | 1 | 0.10% |
| 3 | won | boss | 168 | 16.80% |

### Run length, and what it says about thirty minutes

A won run is **12.1 fights of 7.8 rounds** across 24 nodes; the mean over all runs is 9.66 fights of 7.47 rounds, median 10, p10 5, p90 13. Minutes cannot be measured headlessly and are not claimed. What the fight count implies against `ARCHITECTURE.md`'s "total resolution stays near three seconds at realistic width": 12 fights x 8 rounds x two phases is about 190 resolutions, so animation alone is roughly ten minutes of the thirty, leaving twenty for the twelve fights' placement decisions and the twelve non-fight nodes. That is tight but not obviously wrong. **The row count is the dial** if it needs to move — eight rows an act is one number in `MAP_SHAPE`.

### Does the route matter?

Paired, same seeds, placement held fixed.

| placement held at | greedy route | random route | gap | 95% CI |
|---|---|---|---|---|
| search | 16.80% | 8.00% | 8.80 pp | 5.96..11.64 |
| append right | 9.10% | 3.10% | 6.00 pp | 3.90..8.10 |

Routing is worth 8.8 points of run win rate at fixed placement. That is the behavioural counterpart to the structural claim that the paths differ.

### Determinism

- Same seed, same agent, three runs each over 40 seeds: one hash. 40 distinct hashes across those seeds, so the hash is not constant.
- Replay from the choice list alone, no agent in the loop: identical hash on every seed, in the test window (25 seeds) and in `verify:run` (20 seeds x every run).
- `hashRun` covers the run generator's state *and* draw count, the deck instance by instance with its permanent upgrades, all three maps with their edges, the sigil list, and every counter. A replay that agreed on Health while disagreeing on the generator would still fail.
- `npm run gate:banned-apis` is green: no `Math.random`, `Date.now`, `performance.now` or wall-clock `new Date()` anywhere in the new code.

### What the design under-specifies, and what this unit decided

These are the owner's to confirm. Each is a number or a rule the design does not give.

1. **Hero Health for a whole run.** `docs/design/game.md` says Health "persists across the whole run" and gives no number; the 30 in `src/content/cards.ts` is a single-fight probe value. Set to **80**, calibrated: a won act-1 fight costs the bot 5-27 Health and a won act-3 fight 18-33, so 80 is about three act-3 fights between rests.
2. **What a rest heals.** Not specified. Set to **40% of maximum**, i.e. 32 Health, at least 1.
3. **What a timeout means for a run.** Not specified. A fight that runs out of rounds is **a loss that ends the run**, on the grounds that a fight you cannot finish is not a win. It is rare — 4 runs in 1000 — and it is reported as its own cause rather than folded into deaths, so the decision stays visible. `RUN_MAX_ROUNDS` is 20 rather than the probe's 12 for the same reason: at 12, nine per cent of run fights timed out.
4. **Whether damage outside a fight can kill.** Not specified. It cannot: `hurtHero` floors at 1, so **only a fight ends a run**. This follows `ARCHITECTURE.md`'s "never end a run to invisible variance" — an event that kills you is the purest form of it.
5. **Act length and map width.** Not specified. Eight rows an act, rows 1-6 two to four wide. This is the run-length dial.
6. **Starting deck size and the shape of the growth curve.** The design says "a small curated deck" and "perhaps thirteen units in a twenty-card mid-run deck". Sixteen cards, growing to about 27. See the finding below on why it cannot be much smaller.
7. **Gold.** Not mentioned in the design at all. A shop needs a currency, so there is one: 25/35/45 a fight by act, 55/70/90 an elite, 90/120/150 a boss, and a card costs 30 + 25 per point of cost.
8. **Events.** The design names the node type and no event. Three events, two options each, effects limited to heal, damage, gold and a card. Minimal but real.

### Findings the owner should see

**Deck size is the game's real difficulty dial, and the enemy hero's Health is very nearly a no-op.** Measured across 250 seeds a cell: an act-1 elite runs 38.7 / 36.7 / 36.3 per cent at 16 / 18 / 20 enemy Health, and an act-3 boss runs 29 / 29 / 29 at 30 / 34 / 40. Once the boards have settled the enemy hero is a formality; what decides a fight is how many bodies the enemy can field. Between eight and ten enemy cards the bot's win rate falls off a cliff — at act 1, 100 per cent at eight, 97 at ten, 87 at twelve, 70 at eighteen. `src/content/cards.ts` calls the enemy hero's Health "this probe's difficulty dial", which is true of that probe, and is not true of the run. Enemy Health is still the *length* dial.

**Neither deck reshuffles inside a fight, so deck size is a resource budget and a smaller deck is strictly worse.** `drawTo` stops when a deck runs out, and the design's "cycled roughly once a fight" says that is intended. The consequence is worth stating because it inverts a Slay-the-Spire instinct the design also names: **"deck thinning as a skill" does not work under this rule.** A ten-card starting deck stops playing cards around round four while the enemy keeps going; it won 0 of 200 runs. If thinning is wanted as a skill, the fight needs a reshuffle, or thinning needs a different reward than consistency.

**An all-1-cost starting deck deals literally nothing.** Squire, Shieldbearer and Pikeman top out at 2 Power, and every enemy from the Shieldwall up carries Armour 1. The flat version of the starting deck won 0 of 200 runs; adding two Berserkers and an Ironguard is what made the run playable at all. This is the design's armour rule working exactly as written — it is not a bug — but it means a starting deck is a curve decision before it is a count decision.

**Act 3's normal fights are won 99-100 per cent of the time and still end 18.6 per cent of runs.** They cost 18-20 Health each. This is the intended shape — Health is the run's life bar and attrition is what ends runs — and it is worth the owner seeing it stated, because "the fight you always win" and "the fight that kills you" are the same fight here.

### Limitations, stated plainly

- **Every win rate is evidence about the bot.** The greedy router reads Health and node type off a hand-written table; the placement bot is `bots.ts`'s greedy search. Neither is a person, and nothing here says the run is fun or thirty minutes long.
- **`verify:run` gates structure, not balance.** It catches a run that has become a fixed point — never won, or never lost — and not one that has quietly got harder. A win-rate band would be a claim about the bot and would go red on a content change that improved the game. The printed tables are for drift.
- **The gates run seed windows, not the seed space.** 60 seeds for map structure, 25 for run determinism, 20 seeds x 3 runs in `verify:run`. A property that fails one seed in ten thousand is not covered.
- **The encounter table is an upper bound.** A run arrives hurt and with whatever deck its own rewards gave it; `calibrationDeck` is a stand-in for that distribution, not a measurement of it.
- **The tuning sweeps that produced the content numbers were scratch** under `.probe/` and are untracked. The *conclusions* are reproducible: `npm run measure:run -- --encounters` reprints the per-encounter table the curve was tuned on. The deck-size and enemy-Health sweeps behind the two findings above are not, and promoting a sweep mode to `runmeasure.ts` is the integration owner's call.

### For the integration owner

- **`src/run/content.ts` probably belongs in `src/content/`.** It is data only, and it sits under `src/run/` because `src/content/` belonged to another work unit while this one was being written. Moving it is a file move and one import line.
- **`AGENTS.md` gained two lines** in the Gates section: `npm run gates` now chains six commands, and `npm run verify:run` has its own bullet. `AGENTS.md` is on the repo's independent-review list; these are the two lines to look at.
- **`package.json` gained `measure:run` and `verify:run`**, and `gates` gained `&& npm run verify:run`. `npm run gates` went from about 10 seconds to about 20.
- The test suite went **55 to 78**. `npm run verify`'s fight numbers are byte-identical before and after; only its own elapsed line differs.
