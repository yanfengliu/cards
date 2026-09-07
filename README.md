# cards

A single-player roguelike deckbuilder where your line of adventurers fights **without taking orders**.

You spend three energy a turn adding units to a line, casting spells, and equipping your hero. Then you commit, and the line resolves left to right on its own — each unit acting, and often changing what the unit beside it does. Your hero swings last, so whatever the line hands forward lands on the hero's attack.

Attacks pick their targets at random, so you never choose who gets hit. What you do choose is how your damage is *packaged* — and because armour is subtracted from every attack while overkill is wasted, concentrating and spreading are both right, against different enemies. That choice is the game.

Three influences, three distinct jobs:

- **Hearthstone** — a persistent board, a hero with equipment, and races as mechanical tribes.
- **Slay the Spire** — a branching run, a small curated deck, and telegraphed enemy intent.
- **Grail** — you build a machine and then watch it run.

## Status

One fight is playable. There is no run around it yet — no map, no shop, no sigils — and the card pool is the fifteen the prototype needed.

- [Design of record](docs/design/game.md) — the full rules, a worked example with exact numbers, and the ranked open questions.
- [Work unit 0](docs/work/0_game-design/plan.md) — how the design was settled and what remains.
- [Work unit 1](docs/work/1_turn-prototype/plan.md) — the headless single-fight probe, and what it measured.
- [Work unit 2](docs/work/2_heraldry-legibility/plan.md) — is a heraldic card legible at seventy pixels?
- [Work unit 3](docs/work/3_playable-fight/plan.md) — the screen, and what the fight is like to play.

Every number in the design is a reasoned starting guess, not a balanced value.

## Playing it

Node 24 (see `.nvmrc`).

```
npm install
npm start       # http://127.0.0.1:5175/src/ui/index.html
```

Pick a card, pick a gap in your line, commit. Your line resolves left to right and your hero swings last, so where you put a unit decides who its Relay reaches and who the enemy is allowed to hit. The number under each card is the chance the next enemy attack lands there; it updates as you place, before you commit.

Controls: `1`–`5` pick a card, `Enter` commits, `Esc` clears the selection. Drop slots are ordinary buttons, so Tab and Enter place a unit without a mouse. The speed control and **Resolve now** are there because the animation is a tutorial and stops earning its time once you know the rules.

A fight is addressable: `?seed=42&encounter=hard&theme=dark` opens exactly that one.

There is no build step. `npm start` serves the TypeScript sources with their types stripped on the way out, so what the browser runs is what is on disk.

## Checking it

```
npm test        # the rules, the design's worked example, determinism, and the screen's own gates
npm run measure # the A/B: does optimal placement beat random placement?
npm run gates   # typecheck, both boundary gates, tests, and the measurement's instrument checks
```

`npm run measure` takes `--seeds`, `--encounter` and a few other flags; it prints its methodology and its instrument checks alongside the numbers.
