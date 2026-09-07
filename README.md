# cards

A single-player roguelike deckbuilder where your line of adventurers fights **without taking orders**.

You spend three energy a turn adding units to a line, casting spells, and equipping your hero. Then you commit, and the line resolves left to right on its own — each unit acting, and often changing what the unit beside it does. Your hero swings last, so whatever the line hands forward lands on the hero's attack.

Attacks pick their targets at random, so you never choose who gets hit. What you do choose is how your damage is *packaged* — and because armour is subtracted from every attack while overkill is wasted, concentrating and spreading are both right, against different enemies. That choice is the game.

Three influences, three distinct jobs:

- **Hearthstone** — a persistent board, a hero with equipment, and races as mechanical tribes.
- **Slay the Spire** — a branching run, a small curated deck, and telegraphed enemy intent.
- **Grail** — you build a machine and then watch it run.

## Status

Design stage, plus a headless prototype. There is no renderer and nothing to play by hand yet, but a whole run — three acts, a branching map, a hero and a deck carried from the first node to the final boss — runs deterministically from a seed and a list of choices.

- [Design of record](docs/design/game.md) — the full rules, a worked example with exact numbers, and the ranked open questions.
- [Work unit 0](docs/work/0_game-design/plan.md) — how the design was settled and what remains.
- [Work unit 1](docs/work/1_turn-prototype/plan.md) — the headless single-fight probe, and what it measured.
- [Work unit 5](docs/work/5_run-structure/plan.md) — the run: the map, the acts, and where runs end.

Every number in the design is a reasoned starting guess, not a balanced value.

## Running the prototype

Node 24 (see `.nvmrc`). TypeScript runs directly, so there is no build step and no runtime dependency.

```
npm install     # dev-only: typescript and @types/node, for the typecheck
npm test        # the rules, the design's worked example, and determinism
npm run measure     # the A/B: does optimal placement beat random placement?
npm run measure:run # whole runs: win rate per act, where runs end, run length
npm run gates       # typecheck, tests, and both measurements' instrument checks
```

Both measurement commands print their methodology and their instrument checks alongside the numbers. `npm run measure` takes `--seeds`, `--encounter` and a few other flags; `npm run measure:run` takes `--seeds` and `--encounters`, the second of which prints every act's encounters fought on their own.
