# cards

A single-player roguelike deckbuilder where your line of adventurers fights **without taking orders**.

You spend three energy a turn adding units to a line, casting spells, and equipping your hero. Then you commit, and the line resolves left to right on its own — each unit acting, and often changing what the unit beside it does. Your hero swings last, so whatever the line hands forward lands on the hero's attack.

Attacks pick their targets at random, so you never choose who gets hit. What you do choose is how your damage is *packaged* — and because armour is subtracted from every attack while overkill is wasted, concentrating and spreading are both right, against different enemies. That choice is the game.

Three influences, three distinct jobs:

- **Hearthstone** — a persistent board, a hero with equipment, and races as mechanical tribes.
- **Slay the Spire** — a branching run, a small curated deck, and telegraphed enemy intent.
- **Grail** — you build a machine and then watch it run.

## Status

**A whole run is playable in the browser.** Three acts, each a branching map you route through; fights, elites and a boss fought on the board; rewards, a forge that upgrades a card for good, shops, events and rests between them; a hero whose Health carries across the whole run; and a deck that grows. The run ends when the hero falls or the last boss does, and then you start another.

What is still missing: sigils, classes, races as mechanical tribes, unlocks, and most of the content. The card pool is a few dozen cards against a design that implies hundreds.

Every number in the design is a reasoned starting guess, not a balanced value.

- [Design of record](docs/design/game.md) — the rules, a worked example with exact numbers, and the ranked open questions.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the module graph, the resolver contract, the balance metrics, and how agents are organised to build this.
- [Work unit 3](docs/work/3_playable-fight/plan.md) — the fight screen, and what a fight is actually like to play.
- [Work unit 5](docs/work/5_run-structure/plan.md) — the run: the map, the acts, and where runs end.
- [Work unit 8](docs/work/8_playable-run/plan.md) — the run on screen, and what a whole run is like to play.

## Running it

Node 24 (see `.nvmrc`). Node runs the TypeScript directly, so there is no build step.

```
npm install
npm start        # then open http://127.0.0.1:5175/src/ui/index.html
```

The page opens on a run. `?seed=42` picks the run's seed; the same seed and the same choices replay the same run, and the end screen prints the run's hash and its replay log. A run in progress is saved in the browser between page loads and picked up where it stood between nodes; `?fresh=1` ignores the saved one, and the HUD's Restart button abandons it.

A single fight, on its own, is still addressable: `?encounter=hard&seed=42&theme=dark`.

## Checking it

```
npm test            # rules, the design's worked example, determinism
npm run measure     # the A/B: does optimal placement beat random placement?
npm run measure:run # whole runs: win rate per act, where runs end, run length
npm run gates       # typecheck, both boundary gates, tests, both instrument checks
```

`npm run gates` is what passes before any commit that touches code.
