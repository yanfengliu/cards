# ARCHITECTURE.md — cards

How the game gets built, verified, and improved. The game itself is [`docs/design/game.md`](docs/design/game.md); this is the engineering that has to hold it up.

Status: **planned**. No code exists. Commands described here as gates are planned gates — `AGENTS.md` lists a gate only once the command that satisfies it exists.

## The keystone: determinism

One invariant carries almost everything else in this document:

> Given a seed and an ordered list of player actions, a match replays to a byte-identical final state.

That is already an invariant in `AGENTS.md`. It is worth restating here because of how much hangs off it — it is not a testing convenience, it is the load-bearing wall:

- **Every bug report becomes a reproduction.** A seed plus an action list is the whole repro, small enough to paste into an issue.
- **Balance becomes measurable.** Thousands of runs can be simulated and compared, because a run is a pure function.
- **Regressions become detectable.** A corpus of golden replays either still produces the same outcomes or it does not.
- **Random targeting becomes safe to ship.** Random is not the enemy of determinism; *unseeded* random is. A seeded PRNG threaded through state is fully reproducible.
- **PvP stays cheap if it is ever wanted.** A fight against a snapshot needs no netcode beyond the seed and the board.

Everything below assumes it. Break it and the rest of this document stops working.

## Module graph

The architecture is one rule: **`engine` depends on nothing, and everything depends on `engine`.**

```
                 ┌─────────┐
                 │ content │  data only, no logic
                 └────┬────┘
                      │
   ┌──────────┐  ┌────▼─────┐  ┌────────┐
   │   sim    │──▶│  engine  │◀─│ render │
   └──────────┘  └──────────┘  └────┬───┘
    headless      pure, no DOM       │
    batch runs    no Math.random  ┌──▼──┐
                                  │ ui  │  input → actions
                                  └─────┘
```

```
src/
  engine/     state.ts  actions.ts  resolver.ts  effects.ts  rng.ts  replay.ts
  content/    cards.json  sigils.json  enemies.json  encounters.json
  sim/        agents/  run.ts  metrics.ts
  render/     board.ts  card.ts  anim.ts
  ui/         input.ts
```

**Make this a lint rule, not a good intention.** An import-boundary rule (`eslint-plugin-boundaries` or equivalent) that fails the build when `engine/` imports from `render/`, `ui/`, or the DOM. An architecture that is only written down erodes; one that is a gate does not. Same for a rule banning `Math.random`, `Date.now` and `performance.now` anywhere outside `engine/rng.ts` — those three are how determinism dies quietly.

## The resolution graph

This is the hardest engineering problem in the game, and the answer to "what is the graph engineering here" in its more interesting reading.

A turn is not a loop over units. It is a cascade: a unit acts, which emits events, which fire triggers, which can kill units, which emit death events, which fire more triggers — some on units that have not acted yet. This is where card games get their worst bugs, and the fix is well known from Magic and Hearthstone: **an explicit event queue with one documented order, never recursion.**

```
resolve(state, action) -> state'

queue: Effect[]
while queue is not empty:
    effect = queue.shift()
    events = apply(effect, state)        # the ONLY place state mutates
    checkStateBased(state)               # health <= 0 -> mark dead, emit Death
    for event in events:
        for trigger in triggersMatching(event) ordered by board position:
            queue.push(trigger.effect)
```

Four properties this buys, each of which is a bug class it forecloses:

- **One mutation site.** `apply` is the only function that writes state. A card that reaches around it is a lint failure, not a debugging session six months later.
- **Deaths are batched.** Health is checked at defined checkpoints, not the instant damage lands. This is what stops "A kills B, B's death trigger kills A, but A already acted" from depending on evaluation order.
- **Trigger order is board order.** Two units triggering on the same event resolve left to right. Deterministic, and explainable to a player in one sentence.
- **It is a queue, not a stack.** Effects resolve in the order they were created. A stack gives you Magic's last-in-first-out semantics, which are powerful and famously incomprehensible.

**Guard the loop.** A cap of some thousands of iterations that throws with the full queue trace. A hang is strictly worse than a crash: a crash names its cause, a hang produces a bug report saying "it froze."

### Echo is a termination hazard, and it is a design bug I shipped you

`Echo — repeat the action of the unit that resolved immediately before me` does not terminate under adjacency. Two adjacent Echoes: B copies A, A copies whatever preceded it, and if that is also an Echo the chain walks backwards indefinitely. Worse, a future *Echo Sigil* makes this trivially reachable — the player can just build it.

An iteration cap would catch it, but as a crash, which is the wrong answer for something a player can construct deliberately.

**Fix it as a game rule, not an engineering hack:**

> **Echo copies the previous unit's base action, never a copied action.**

This terminates by construction — there is no recursion to bound — and it is one line on a card that a player can read and understand. Rules that are self-limiting beat engine guards that catch violations after the fact.

The general principle for the effect vocabulary: **a trait may read state, but a trait that reads *another trait's output* needs an explicit termination argument before it is written.**

## Rendering

Reading "graph engineering" the other way: the visual stack.

**DOM and CSS, not Canvas or WebGL.** Cards are rectangles with text, and that is what the DOM is best at — text rendering, layout, accessibility, and inspectability all come free, and CSS transforms and transitions handle the animation this game actually needs. Canvas wins for thousands of particles, which is not this game. Keep a Canvas overlay in reserve for effects if it is ever earned; do not start there.

**The unlimited board must compress, never wrap.** A flex row with `min-width: 0` and shrinking cards. Wrapping to a second line destroys the left-to-right reading that every adjacency trait depends on — the moment "the unit to my right" is on the next row, the player cannot see the cascade any more. Compression degrades gracefully; wrapping breaks the game's core legibility.

### Animation is the tutorial

This is the part that is easy to get wrong by treating it as polish.

Units act without taking orders. That means the resolution animation is the **only channel** through which a player learns why anything happened. If Relay's +2 does not visibly travel from one unit to its neighbour, the player has no way to discover that adjacency matters — and adjacency is the entire game.

So motion has a functional specification, not just an aesthetic one:

- Every state change is attributable on screen to the thing that caused it.
- Buffs travel visibly from source to target.
- The acting unit is unambiguously highlighted, so resolution order is observable rather than inferred.
- Total resolution stays near three seconds at realistic width, which means batching the *visual* while the *logic* stays strictly sequential.
- A speed control and an instant-resolve option, because the tutorial value decays once a player knows the rules and then the animation is a tax.

### Making it beautiful

- **Design tokens first** — colour, spacing, type scale, elevation as variables. Coherence is a system property; it cannot be retrofitted card by card.
- **Readability outranks flourish.** A player scans the board every turn. Power and Health must be legible at a glance at the smallest size the board compresses to, which is the real constraint on card art.
- **Verify by looking**, per fleet canon: screenshots at the viewport sizes and board widths that matter — 1 unit, 5, 10, 15 — inspected individually at native resolution. A contact sheet answers "is there one of each" and never "is each one right".
- States are part of the visual surface: hover, drag, targetable, dying, buffed, Guarded.

## Fair but challenging

"Fair" has a precise meaning here, and it is not "deterministic".

> **Fair means the odds were visible before you committed.**

Random targeting is fair when the player could have played around it, and unfair when they could not. That turns a feeling into requirements:

- **Show the odds before commit.** Three Guards alive means each is a 33% target. Put that number on screen. A player who commits knowing the odds and loses the roll has lost fairly; one who did not know has been cheated.
- **Telegraph enemy intent**, including AoE, a full turn ahead. This is already the mitigation named for the design's top open risk.
- **Never end a run to invisible variance.** If a player could not have seen it coming, it is a bug in the presentation even when the simulation is correct.

### Measuring "challenging"

Win rate alone is a bad target — 40% overall can be a good game or a terrible one. Measure the distribution and the gradient:

| Metric | What it catches |
|---|---|
| Win rate per act | Difficulty spikes and dead acts |
| Where runs end | A game that always dies in act 1 is not the same as one that dies at the final boss |
| Card pick rate | A card nobody takes is a dead card; one everybody takes is a mandatory card |
| Card win-rate delta | Which cards actually change outcomes rather than merely appearing in winning decks |
| Build diversity | Entropy of winning deck composition. If every win has the same five cards, the design has collapsed |

### The metric that tests the design's core claim

The design asserts that **placement is a decision**. That is falsifiable, and it should be a gate:

> Run the same decks with a bot that places optimally and a bot that places randomly. **If their win rates are the same, placement is not a decision and the central claim of the design is false.**

The gap between those two numbers is the game's reason to exist, expressed as a number that can go red in CI. It is also the fastest way to answer the design's top open questions without arguing about them — including whether the unlimited board and the AoE-only counter actually work.

Extend it into a **skill gradient**: random < greedy < one-turn lookahead < deeper lookahead should be monotonic and well separated. Two adjacent tiers with equal win rates mean that layer of thinking is not being rewarded.

**State the bound honestly.** All of this measures *bots*. A bot's win rate is evidence about the bot, and human play differs — humans misread boards, tilt, and find lines a greedy agent never tries. Simulation catches degenerate and dead cards cheaply; it does not establish that the game is fun. Per fleet canon, the gate names its bound in its own header.

## Finding and fixing bugs

Determinism makes most of this mechanical.

**Property tests** — invariants that must hold over thousands of randomly generated games:

- Replay determinism: same seed and actions produce the same state hash. This one is the foundation; run it first and run it always.
- Termination: the effect queue always drains.
- Conservation: energy spent never exceeds energy available.
- Sanity: health never negative, no unit acts twice in a turn, no unit acts after dying.

**Fuzzing.** Random decks, random legal actions, thousands of games, asserting every invariant. This finds the card interactions nobody thought to write a test for, which in a game with cards × sigils is most of them.

**Golden replays.** A tracked corpus of recorded matches. A rules change either leaves their outcomes identical or it does not — and if it does not, that is either a bug or an intentional change that gets acknowledged explicitly in the commit. This is the regression net that a combinatorial design otherwise cannot have.

**Replay bisection.** Because a match is a pure function of seed and actions, a failure can be bisected to the exact turn and the exact effect in the queue where an invariant first broke. Bug reports become "seed 41293, turn 6" rather than a paragraph of prose.

**The defect register**, per fleet canon: a defect the user reports is recorded in `docs/learning/defect-register.md` with the symptom as they saw it, and gated by a check covering the defect's whole *class* — not the single instance. In a card game the class is usually the interaction shape, not the card: "trigger fires after its source died" rather than "Wake was broken."

## Iterating and self-improving

Fleet canon is specific here, and it rules out the tempting version:

> A standing loop sources its next task by running the artifact the way its user does — never by reading code for something to improve.

So the loop is driven by **playing the game**, not by auditing the source:

1. Run a batch of simulated runs at the current content and balance.
2. Read the metrics table above. Dead cards, mandatory cards, collapsed diversity, and a flat skill gradient are the findings.
3. Change **data, not code** — the `AGENTS.md` invariant that costs, stats and weights live in tracked data files exists precisely so a balance pass is a reviewable diff rather than a code change.
4. Re-run. Compare against the previous batch.
5. Periodically, play it as a human, because step 1 cannot tell you whether it is fun.

Two traps worth naming in advance, both from fleet canon and both cheap to fall into here:

- **Hold the tree still across an A/B.** Comparing two balance batches while also editing content means the arms differ by more than the variable under test, and the result still reads like a finding.
- **Verify the instrument before trusting the measurement.** Confirm the seed set is the population you meant, that the flag took effect, and that the control reproduces. A balance conclusion drawn from a bot that was silently failing to draft is worse than no conclusion.

## Workflow and orchestration

The module graph is also the delegation plan, because `engine`'s independence is what makes parallel work possible at all.

**Phase 0 — serial, one owner, no parallelism.** Agree the contracts: the state shape, the action union, and the effect vocabulary. Everything downstream imports these, so a change here invalidates work everywhere. Per fleet canon, shared contracts are agreed before parallel implementation, not during it.

**Phase 1 — parallel, isolated worktrees.** Three independent tracks against the frozen contract:

| Track | Owns | Verifies with |
|---|---|---|
| Engine core | `engine/` — resolver, effects, rng | Property tests, determinism |
| Sim harness | `sim/` — agents, batch runner, metrics | Runs against engine; produces the metrics table |
| Render skeleton | `render/`, `ui/` | Screenshots at several board widths |

These touch disjoint directories, so they merge without collision. Each lands on `main` when its own gates pass — fleet canon counts nothing as done on a branch.

**Phase 2 — a loop, not a phase.** Content authoring and balance simulation are coupled and iterate together, driven by the metrics above. This is where most of the calendar time goes and it has no natural end, only a good-enough.

**The first thing to build**, before any of that, is a headless prototype of one turn: resolution order, random targeting, Guard, armour. It is small, it is the acceptance step already recorded in [work unit 0](docs/work/0_game-design/plan.md), and it answers the design's top open question by observation rather than argument.
