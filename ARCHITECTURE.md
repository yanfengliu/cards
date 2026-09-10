# ARCHITECTURE.md — cards

How the game gets built, verified, and improved. The game itself is [`docs/design/game.md`](docs/design/game.md); this is the engineering that has to hold it up.

Status: **partly built**. A headless deterministic prototype of one fight exists — `src/engine/`, `src/content/`, `src/sim/` — alongside the SVG heraldry renderer in `src/render/`. There is no UI layer. Four of the gates described below are real commands today: `npm run gate:boundaries`, `npm run gate:banned-apis`, `npm test` and `npm run verify`, each named in `AGENTS.md`, which lists a gate only once the command that satisfies it exists. Everything else here is still a plan, and is written in the future tense where it is.

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
  content/    cards.json  sigils.json  enemies.json  encounters.json   (blazons live on the cards)
  sim/        agents/  run.ts  metrics.ts
  render/     board.ts  card.ts  anim.ts  heraldry.ts  charges/
  ui/         input.ts
```

**Make this a lint rule, not a good intention.** An architecture that is only written down erodes; one that is a gate does not. Both rules exist now, and both read the TypeScript AST rather than grepping, because `rng.ts` and `measure.ts` name the banned APIs in comments in order to say they are never called and a grep gate is red on a clean tree.

`npm run gate:boundaries` fails when anything under `src/engine/` imports from `src/content/`, `src/render/`, `src/ui/` or `tools/`, or references a global that only `lib.dom` declares.

`npm run gate:banned-apis` bans the hidden inputs a replay does not carry, and it covers **four** of them rather than the three this document first named:

- `Math.random`, `Date.now` and `performance.now`, anywhere under `src/`, `test/` or `tools/`, with `src/engine/rng.ts` the one file allowed to name them.
- A wall-clock read through `new Date()` or a bare `Date()`, anywhere under `src/` or `test/`, with no file exempt. It was an omission rather than a decision that this document listed only three: a fight seeded off `new Date()` is exactly as unreproducible as one seeded off `Date.now()`. `new Date(x)` with an argument is a pure function of `x` and is not banned, and `tools/` is out of the clock rule's scope because the boundaries gate already makes `tools/` unreachable from the engine.

## The resolution graph

This is the hardest engineering problem in the game.

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

Five properties this buys, each of which is a bug class it forecloses:

- **One mutation site.** `apply` is the only function that writes state. A card that reaches around it is a lint failure, not a debugging session six months later.
- **Deaths are batched.** Health is checked at defined checkpoints, not the instant damage lands. This is what stops "A kills B, B's death trigger kills A, but A already acted" from depending on evaluation order. It is also what makes mutual damage well defined: an attack applies both blows inside one `apply` call, so the single checkpoint after it announces whichever of the two died and neither death can cancel the other's blow.
- **Trigger order is board order, and board order means board *index*.** Two units triggering on the same event resolve left to right — the player's line first, then the enemy's. Left to right is where a unit stands, never its `uid`, which records only when the unit was made; insert a unit between two others and it triggers between them. Deterministic, and explainable to a player in one sentence.
- **Inside one unit, traits fire in the source order of the `if` blocks in `triggersFor`.** There is no priority number on a trait, so moving a block moves the rule. This used to be reachable — a unit carrying both Relay and Ward granted the power first and the ward second — and **it is not reachable any more**: Ward was removed by the owner, and the two remaining shipped triggers key on different events, so no card and no test seam can make two shipped blocks answer one event. The rule stands and is currently unobservable; `test/resolver-order.test.ts` pins the *reason* instead, so the day a second `afterActed` trait is written the test goes red and its author has to gate the order. Board index is still gated there directly, and it too needs the seam: every shipped trigger is keyed to one `uid`, so no event matches two units.
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

## The art system

Heraldic flat vector, rendered as SVG. The choice is driven by the compression constraint rather than by taste: at fifteen units on the board a card is roughly seventy pixels wide, and no illustration survives that. Heraldry is, literally, a system built to make identity legible at distance — which is the problem this board has.

### Art is data, not assets

Real heraldry has a formal description language. *Azure, a lion rampant or, a bordure engrailed argent* fully specifies a device; two heralds reading it draw the same arms. That gives the cleanest possible answer to "how do 250 unique cards get art":

> **A card's art is a blazon string in its data file, rendered to SVG by code. There are no image assets.**

What this buys, and each of these is a problem it removes rather than an advantage it adds:

- **Unique per card is affordable.** Uniqueness comes from combinatorics over a charge library, not from 250 bespoke drawings. Thirty to fifty charges across tinctures, ordinaries and attitudes yields far more distinct, *recognisable* devices than the card pool needs. The production cost is the charge library; the cards are then a line of text each.
- **No blob problem.** Fleet canon caps what enters ordinary Git — 256 KiB needs a reason, 512 KiB binary never. Two hundred and fifty PNGs would strain that; 250 blazons are a few kilobytes total.
- **It diffs.** A balance pass, an art revision and a rename are all reviewable text changes. An artwork change shows up in review as the line that changed.
- **It scales losslessly**, which is exactly what a board that compresses to arbitrary widths requires.
- **Coherence is structural.** Everything is drawn by one renderer from one library, so the pool cannot drift the way independently produced pieces do.

### Four channels, because heraldry has four

The premise that seventy pixels gives you two readable channels is true of arbitrary illustration. Heraldry beats it, because separating identity into independent layers is the whole design of the idiom — and that lets Guard take the strong channel, as chosen, without losing tribe.

| Channel | Carries | Why it survives compression |
|---|---|---|
| **Numbers** | Power and Health | Corner-set, high contrast, never occluded by the device |
| **Card outline and bordure** | **Guard** | Shape reads faster than colour at small size, and it is unmissable in peripheral vision — a Guard is a shield-shaped card with a heavy bordure, everything else is a plain rectangle |
| **Field tincture** | Tribe | A flat background colour is still scannable in a row at seventy pixels, which is what adjacency traits like Kindle need |
| **Charge** | The individual card | The one channel that legitimately needs the expanded tier, and the only one that does |

Guard on the silhouette is the strong version of the owner's choice. Colour would have competed with tribe for the same perceptual channel; shape does not compete with anything.

### The two-tier read

Forced by the board, not chosen:

- **Compressed** — outline, bordure, field tincture, numbers. Everything needed to make a placement decision and to read the incoming turn.
- **Expanded**, on hover or inspect — the full charge, the card text, sigils, and the trait rules. Everything needed to plan.

The design rule that follows: **no information required for a turn decision may live only in the expanded tier.** If a player must hover to play correctly, the compressed tier has failed.

### Reviewing 250 devices

Fleet canon carries badge's lesson directly, and it applies here harder than anywhere: a 63-source contact sheet read as cohesive while ten sources were wrong, and the lesson recurred four days later against 48px proof sheets.

So: **every device is reviewed individually at native resolution, in both tiers, and the review binds to the digest of the bytes inspected.** A grid of 250 crests will look magnificent and will tell you nothing about whether any individual one is right. Regenerating the sheet strands its review rather than inheriting it.

The specific failure to watch for is tincture collision — two tribes whose field colours are distinguishable side by side in a palette and indistinguishable at seventy pixels under an animation overlay. That is a per-pair check at the real size, not a palette check.

## Fair but challenging

"Fair" has a precise meaning here, and it is not "deterministic".

> **Fair means the odds were visible before you committed.**

Random targeting is fair when the player could have played around it, and unfair when they could not. That turns a feeling into requirements:

- **Show the odds before commit.** Three Guards alive means each is a 33% target. Put that number on screen. A player who commits knowing the odds and loses the roll has lost fairly; one who did not know has been cheated.
- **Telegraph enemy intent**, including AoE, a full turn ahead. The design lists this as an open presentation item. It makes a read of the board possible; it is not a lever on whether any option is good, because AoE is one option among the spells and the game does not guarantee it is worth casting.
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

The gap between those two numbers is the game's reason to exist, and it is now a number that does go red rather than one that only could. **It roughly halved when combat became mutual and Ward was removed, from 18.80 pp to 8.38 pp over 20,000 seeds** (95% CI 7.80..8.96, against a noise floor of -0.21 pp); the gate's floor was deliberately left where it was rather than moved down with it, and `docs/work/6_trade-and-thin/plan.md` records that. `npm run verify` runs the measurement over 400 seeds at the `even` encounter and exits non-zero unless **both** of these hold:

1. **The paired 95% interval's lower bound is above zero.** This is what makes the gate sound at small seed counts — a 20-seed run cannot pass on luck.
2. **The gap reaches `MIN_GAP_PP`, which is 5.00 percentage points.** This is what makes it mean something at large seed counts, where condition 1 degenerates: over 20,000 seeds an interval excluding zero needs a gap of only about 0.74 pp, which is the size of a collapse rather than the size of a decision.

The floor is set from the measurement's own null arms, not as a fraction of the headline. The two-identical-random-bots noise floor sits within half a point of zero, and the cascade-stripped negative control runs between -1.25 and 2.00 pp across the four encounters, so a real collapse lands far below 5 pp. At the gate's 400 seeds the paired standard error is about 2.1 pp, so 5.00 pp is roughly one 95% half-width above zero — below that a 400-seed run cannot tell the gap from zero anyway, and above it seed choice alone starts tripping the gate. What the gate catches is collapse, not drift; drift is what the printed table and the difficulty sweep are for. The threshold states that bound in its own header in `src/sim/measure.ts`.

**Which trait carries the gap is a separate measurement, and it needs a separate instrument**, because removing a trait also changes how hard the fight is and a win-rate gap is squeezed by the floor and the ceiling. `npm run measure:ablate` reads the enemy hero's Health as a continuous dial, calibrates each ablated card set on the random arm alone to bracket a chosen baseline, and reports A against B at both bracketing values. It exists as a tracked command because the previous round's version of it lived in untracked scratch and its table could not be reproduced from a clean checkout.

The measurement is also the fastest way to answer the design's open questions without arguing about them — how wide a line the rules actually produce, how often a spell is worth its energy. What it returns is a description of what the rules produce, and per the owner's ruling of 2026-09-09 (`docs/policies/local-rules.md`) that is where its authority ends: a measurement showing an option is weak is information for the player, not a defect to tune out of the pool. The measured line is two units wide today; the unlimited board is a setting rather than a target, and nothing is re-costed to widen it.

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

One bound on step 3, set by the owner's ruling of 2026-09-09 (`docs/policies/local-rules.md`): a finding describes what the rules produce, and it is not a target. The loop does not re-cost content so that a particular board shape, card or strategy comes out viable, and a measurement showing an option is weak is information for the player, not a defect in the pool. Measuring is exactly what the ruling asks for; acting on a measurement by re-tuning content toward a shape is what it rules out. What the loop may still act on is what the player can see — the odds, the enemy's intent, a card's own text.

Two traps worth naming in advance, both from fleet canon and both cheap to fall into here:

- **Hold the tree still across an A/B.** Comparing two balance batches while also editing content means the arms differ by more than the variable under test, and the result still reads like a finding.
- **Verify the instrument before trusting the measurement.** Confirm the seed set is the population you meant, that the flag took effect, and that the control reproduces. A balance conclusion drawn from a bot that was silently failing to draft is worse than no conclusion.

## The agent graph

How agents are organised to build this. The module graph above is the *input* to this one — `engine`'s independence is what makes any parallelism possible at all — but the agent graph has its own constraints, and they are not the same constraints.

```
                  ┌─────────────────────────────┐
                  │  0. CONTRACT      (serial)  │   no worktree — nothing concurrent
                  │  types · fixtures · stubs   │
                  └──────────────┬──────────────┘
                                 ▼
                  ┌─────────────────────────────┐
                  │  0′. REVIEW    MANDATORY    │   zero possible gates, 3 lanes downstream
                  └──────────────┬──────────────┘
                                 │  fan-out gate: merged to main
           ┌─────────────────────┼─────────────────────┐
           ▼                     ▼                     ▼
   ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
   │ 1a. ENGINE    │     │ 1b. SIM       │     │ 1c. RENDER    │
   │  worktree A   │     │  worktree B   │     │  worktree C   │
   └───────┬───────┘     └───────┬───────┘     └───────┬───────┘
           ▼                     ▼                     ▼
   ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
   │ 1a′. REVIEW   │     │  gates only   │     │ visual insp.  │
   │  MANDATORY    │     │  risk-scaled  │     │   = review    │
   └───────┬───────┘     └───────┬───────┘     └───────┬───────┘
           └──────────┬──────────┴─────────────────────┘
                      ▼
            ┌──────────────────────┐
            │  2. INTEGRATION      │  mandatory; the combined result
            └──────────┬───────────┘
                       ▼
         ┌──────────────────────────────────┐
         │  3. CONTENT ⇄ BALANCE   (cycle)  │  simulate, do not read
         └──────────────────────────────────┘
```

### Nine properties this graph has on purpose

**1. The fan-out gate is the contract, not a working engine.** Node 0 ships *types, fixtures and throwing stubs* — not an implementation. Once the state shape, action union and effect vocabulary are frozen on main, all three lanes can start, and the engine's implementation is just one of them. Waiting for a working engine before starting render would serialise the whole project behind its hardest node.

**2. Fixtures are what decouple the lanes.** Node 0's other deliverable is a set of hand-authored `GameState` values covering the interesting shapes: empty board, wide board, all-Guards, hero exposed, mid-cascade. Render draws them and Sim measures them without a resolver existing. Without fixtures, lanes 1b and 1c can write code but cannot verify any of it, which is not parallel work — it is deferred work.

**3. Edges are commits on main, not messages.** Agents cannot see each other's chats, memory, or working trees, and fleet canon says never to assume otherwise. So an edge in this graph means exactly one thing: *the upstream node's artifact is merged and verified, and it is in the downstream node's base revision.* Anything an agent needs to know must be in a file. A design that requires two agents to talk is a design with a node missing.

**4. Fan-out width is set by directory disjointness, not by ambition.** Three lanes because there are three non-overlapping directory sets. A fourth agent would have to share files with one of them and the graph would be buying merge conflicts with no throughput gain. Widen the graph by *making* things disjoint, never by adding agents to contested files.

**5. The event log is the render contract, which removes the worst cross-lane collision.** The predictable failure is the render agent needing `isCurrentlyActing` on a unit and adding it to `GameState` — engine-state pollution that collides at integration and corrupts the determinism hash. The rule that prevents it: **render consumes the resolver's event stream and derives its own view state; it never adds a field to `GameState`.** The resolver already emits events, so this costs nothing and makes animation correct-by-construction against the logic.

**6. Cycles collapse into one agent.** Content and balance are a feedback loop — a card is only balanced relative to every other card, and balance findings rewrite content. That is not a DAG edge and cannot be two parallel agents; it is one owner iterating, or a strict alternation with the coordinator holding the baton. Splitting a cycle across agents produces two workers each invalidating the other's last result.

**7. Content authoring fans out; balance never does.** Cards are embarrassingly parallel to *write* — N agents can own disjoint card sets. They are global to *balance*, because the metrics are whole-pool properties. So node 3 may fan out for authoring under one balance owner, and the balance judgement stays with a single agent holding the global view.

**8. The effect vocabulary is frozen, and needing a new verb escalates.** This is what makes content fan-out safe. Given freedom, four card authors invent four different verbs for "deal damage to a neighbour", and the resolver grows four code paths. `AGENTS.md` already says a card needing a new `if` means the vocabulary is missing a verb; the orchestration consequence is that adding a verb is a coordinator decision, never a worker's.

**9. Review is a node with an edge, allocated by blast radius times gate weakness.** Review sits *between* worker and integration, because a review after merge is a report rather than a gate. But it is not uniform, and uniform review would not be more rigorous — it would be *unweighted*, spending the same attention on flavour text as on resolver ordering, and a review that always passes proves as little as a gate that always passes.

| Node | Blast radius | Gate strength | Verdict |
|---|---|---|---|
| 0. Contract | all three lanes | **none possible — it is types** | **mandatory, independent** |
| 1a. Engine | everything | strong, but subtle ordering bugs pass tests | mandatory, independent |
| 1b. Sim | metrics only | medium; control runs self-check | risk-scaled |
| 1c. Render | visual only | weak automated, strong human | looking at it *is* the review |
| 2. Integration | everything | the combined gates | mandatory — that is its definition |
| 3. Content | pool-wide | balance simulation is strong | simulate, do not read |

**Node 0 carries the highest-value review in the graph**, ahead of the engine's. It maxes both axes: a type contract cannot be tested at all, and getting it wrong invalidates three downstream lanes before anyone notices. The inverse is content — human review of "is this card balanced" is unreliable, and a mis-costed card passes every test that exists, so simulation is the right instrument and reading is not.

Keep the two claims distinct in reports, per fleet canon: **verified** (gates green) and **reviewed** (someone independent read it) are different, and a node can honestly be one without the other.

### Worktrees

File disjointness and worktrees solve different problems, and one does not substitute for the other. **Disjoint files buy clean merges. Worktrees buy safe concurrent operation.**

Three agents sharing one working tree collide on things unrelated to which source files they touch: the index, `HEAD`, `node_modules`, build output, dev-server ports, and test caches. The index is the dangerous one — an agent running `git add -A` sweeps in another's half-finished edits and ships a commit whose message lies about its contents.

So the rule is about concurrency, not about files:

- **Node 0 is serial and needs no worktree.** Nothing else is running.
- **Each phase-1 lane gets its own worktree**, and its own `npm install`, since `node_modules` is not shared between them.
- **Content fan-out needs one per concurrent author**, for the same reason.
- **Sequential agents need none** — commit between them and the next one's base revision is simply main.

Worktrees do share the repository's common Git directory. That is a feature rather than a hazard: it is exactly how fleet's work-document allocator takes its lock, so two worktrees cannot reserve the same unit ID.

### What the coordinator actually does here

It does not implement — fleet canon is explicit that every change is delegated, however small, because the coordinator's session is where the next request arrives. Its hands stay on four things:

- **Owning node 0 personally is the exception worth naming.** It is the one node that cannot be parallel and that everything else depends on, so it is written as an assignment and delegated like the rest — but the coordinator inspects and accepts it before opening the gate, because a wrong contract invalidates all three lanes.
- **Holding the fan-out gate.** No lane starts before the contract is on main. This is the single highest-value thing the coordinator does, and the most tempting to skip.
- **Integration as real work.** Worker success does not establish integration success. Node 2 means reading the actual combined diff and exercising engine-plus-render together, because the state-contract bugs live exactly where two green lanes meet.
- **Assignments that stand alone.** Owner, outcome, context, contracts, base revision, workspace, allowed and excluded paths, verification, and expected handoff — because the worker cannot ask a follow-up question mid-task.

### Improving the graph itself

The graph is a hypothesis about where the seams are, and each wave tests it. After every wave the coordinator records what actually happened, in the repo rather than in a chat:

- **What collided.** Two lanes touching the same file means the seam was in the wrong place. The fix is to promote that file into node 0's contract, not to ask agents to coordinate.
- **What blocked.** A lane idle waiting on another means a missing fixture, not a missing message.
- **What was redone.** Work thrown away after integration means the contract was underspecified — that is a node 0 defect, and it is the expensive kind.

Per fleet canon this lands as a lesson anchored to a gate, and the lesson is deleted in the commit that lands the gate. A graph observation that can name no gate is folklore and gets dropped.

### Where to start

Before any of this, one agent builds a headless prototype of a single turn — resolution order, random targeting, Guard, armour. It is deliberately outside the graph: it is small, it is throwaway, and its purpose is to answer the design's top open question by observation. Building the full contract before knowing whether placement is a decision would be committing the whole graph to an unverified premise.
