# Core game design: board roguelike deckbuilder

Status: active
Owner: Yanfeng Liu
Created: 2026-09-06
Updated: 2026-09-06

## Problem and outcome

The repo existed with a README and no design. The owner wants a card game drawing on Hearthstone, Slay the Spire, and Grail (Sokpop, 2026-09-01) — three games that disagree with each other on almost every axis, so the outcome is a design that assigns each influence a distinct job rather than averaging them.

Outcome: a design of record at [`docs/design/game.md`](../../design/game.md) that a prototype can be built from without further interviewing.

## Scope

Included: combat rules, resolution order, targeting, card types, races and classes, run structure, progression systems, and the open questions a prototype must answer.

Excluded: any implementation, card lists beyond illustrative examples, art direction, and audio. No engine, build or test tooling exists yet — `AGENTS.md` Gates say so explicitly rather than listing commands the repo cannot run.

Dependencies: none. This repo joined the fleet census in the same session (`fleet` commit `a7bdf58`, `cards` commit `d6422a0`).

## Approach

Design settled by structured interview — five rounds of choices, with each round's answers narrowing the next. The transcript of decisions is preserved as **[owner]** markers in the design document, so a later session can tell an owner decision from an agent's inference and knows which ones it may not quietly reverse.

Consequential tradeoffs, each an owner call:

- **Random targeting** replaced lane targeting. This dissolved the design's largest risk: lanes and cascade order were two positional systems competing for one placement decision. Placement now means cascade only.
- **Unlimited board width.** Initially assessed as high-risk; the owner pointed out that units require cards, which require drafting. The arithmetic supports them — energy, hand size and deck composition cap the board at six to nine units in practice and about fifteen at the extreme. The board rule needs no cap; **token generation** does, and that is now open question 2.
- **Relics merged into hero sigils**, so one system covers both card modification and run-wide effects rather than two systems doing one job.
- **AoE spells are the sole designated counter to wide boards.** Chosen over structural alternatives with the narrowness risk stated. Recorded as open question 1 with a zero-cost mitigation to try first: telegraph enemy AoE a turn ahead, which turns a draw-dependent coin flip into a read.

## Acceptance criteria

- [x] A design of record exists at `docs/design/game.md` covering combat, card types, races and classes, run structure, and progression.
- [x] Every owner decision is marked `[owner]` and distinguishable from an agent inference.
- [x] The rules are walked through by hand in a worked example with exact numbers, per the Gate in `AGENTS.md`.
- [x] Open questions are ranked, and the first names a specific mitigation to try before adding systems.
- [ ] The core turn is prototyped and the top open question is answered by observation rather than argument.

## Implementation steps

- [x] Join the fleet census; author `AGENTS.md` and `CLAUDE.md`.
- [x] Establish the three influences' distinct jobs.
- [x] Settle combat, card types, classes, races, and progression by interview.
- [x] Write the design of record.
- [ ] Prototype the core turn headlessly: resolution order, random targeting, Guard, armour. Answers open question 1.
- [ ] Decide the token-generation budget before the first summon card exists (open question 2).

## Outcome

Pending. The design of record is written and the open questions are ranked, but nothing is prototyped, so no claim here rests on observed behaviour. Every number in the design is a reasoned starting guess, and the document says so in its first line.
