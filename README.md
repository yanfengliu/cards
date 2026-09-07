# cards

A single-player roguelike deckbuilder where your line of adventurers fights **without taking orders**.

You spend three energy a turn adding units to a line, casting spells, and equipping your hero. Then you commit, and the line resolves left to right on its own — each unit acting, and often changing what the unit beside it does. Your hero swings last, so whatever the line hands forward lands on the hero's attack.

Attacks pick their targets at random, so you never choose who gets hit. What you do choose is how your damage is *packaged* — and because armour is subtracted from every attack while overkill is wasted, concentrating and spreading are both right, against different enemies. That choice is the game.

Three influences, three distinct jobs:

- **Hearthstone** — a persistent board, a hero with equipment, and races as mechanical tribes.
- **Slay the Spire** — a branching run, a small curated deck, and telegraphed enemy intent.
- **Grail** — you build a machine and then watch it run.

## Status

**One fight is playable in the browser.** A run also exists — three acts, a branching map, node types, forge upgrades, persistent hero health — but it is headless: the UI plays a single fight, and the two are not wired together yet.

What is still missing: sigils, classes, races as mechanical tribes, unlocks, and most of the content. The card pool is a few dozen cards against a design that implies hundreds.

Every number in the design is a reasoned starting guess, not a balanced value.

- [Design of record](docs/design/game.md) — the rules, a worked example with exact numbers, and the ranked open questions.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the module graph, the resolver contract, the balance metrics, and how agents are organised to build this.
- [Work unit 3](docs/work/3_playable-fight/plan.md) — the screen, and what the fight is actually like to play.
- [Work unit 5](docs/work/5_run-structure/plan.md) — the run: the map, the acts, and where runs end.

## Running it

Node 24 (see `.nvmrc`). Node runs the TypeScript directly, so there is no build step.

```
npm install
npm start        # then open http://127.0.0.1:5175/src/ui/index.html
```

A fight is addressable: `?seed=42&encounter=hard&theme=dark`.

## Checking it

```
npm test            # rules, the design's worked example, determinism
npm run measure     # the A/B: does optimal placement beat random placement?
npm run measure:run # whole runs: win rate per act, where runs end, run length
npm run gates       # typecheck, both boundary gates, tests, both instrument checks
```

`npm run gates` is what passes before any commit that touches code.
