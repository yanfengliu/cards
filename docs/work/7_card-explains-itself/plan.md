# A card explains all of itself on hover

Status: complete
Owner: worker (UI)
Created: 2026-09-07
Updated: 2026-09-07

## Problem and outcome

The owner asked what "Ward", "Wake" and "hue" meant — about mechanics in their own game. That is not a lapse of memory. Every noun in this game is invented, and the only place any of them was written down was `docs/design/game.md`, which a player will never open. The board is the compressed tier: an outline, a field colour, two numerals, a strip of glyphs. Each of those is a symbol whose meaning lived somewhere unreachable.

**Outcome: a card explains all of itself on hover.** Nothing drawn on a card is left unnamed — Power, Health, Energy, Armour, target chance, race, field tincture, charge, card shape, and every trait by name in plain words, each with an icon drawn in code.

Two defects were fixed on the way:

- The old hover preview covered 24,355 px² of the enemy row when hovering a player unit, and 25,739 px² of the player row when hovering an enemy unit. It hid board state at the moment the player was reading board state.
- Heroes showed no panel at all. `showInspect` returned early on `entity.isHero`, so the card whose Health *is* the fight explained nothing.

## Scope

Included: `src/render/` (new `icons.ts`, `glossary.ts`, `inspect.ts`; changes to `board.ts`, `blazons.ts`'s consumers, `heraldry/card.ts`, `heraldry/tinctures.ts`), `src/ui/` (`app.ts`, `app.css`, `index.html`, `input.ts`), `tools/ui-probe/`, `test/explain.test.ts`, `package.json` probe scripts.

Excluded, and untouched: `src/engine/`, `src/content/`, `src/run/`, `src/sim/`, every existing file under `test/`, `docs/design/game.md`, `ARCHITECTURE.md`. Those belong to the round's other worker, which is making combat mutual and **removing Ward**.

Dependency the design had to absorb: Ward is being deleted while this was written. No trait list is hardcoded anywhere in this work — see Approach.

## Approach

**One glossary, keyed by the engine's own types.** `src/render/glossary.ts` holds every explanation. `TRAIT_TERMS` is `Readonly<Record<Trait, Term>>` over `engine/state.ts`'s union, so deleting `ward` from the engine makes this file stop compiling and adding a trait makes it stop compiling until it is documented. The board's trait strip, the hand's hint line and the hover panel all read that one table, so they cannot drift apart. Numbers are imported from the resolver (`RELAY_POWER`, `WAKE_POWER`), never retyped, so re-tuning a constant re-words the tooltip.

**Icons drawn in code.** `src/render/icons.ts` is nineteen path strings in a 0..24 box, the same way a charge is a path string in a 0..100 box. No icon font, no sprite sheet — `ARCHITECTURE.md` says this repo has no image assets and wants none. `iconSvg` throws when asked for an icon with neither an accessible name nor `decorative: true`, so "an icon is never the only carrier of meaning" fires at render time rather than in review.

**The panel is placed by measuring what it would cover.** The old rule was "below the card if it fits, else above", and above is where the other line is. Placement is now scored over seven candidates — four sides of the card plus the three free bands the two rows cut the window into — weighting the opposite row 6, the card's own row 2, the hovered card itself 8, and anything off-screen 12, with distance as the tie-break. Panel height is a design constraint that follows from this, not an afterthought: at 1440x900 the free bands are 120px, 180px and 270px, so the panel has to fit 270px or it has nowhere to go. Widening it from 452px to 680px and merging nine paragraphs into five brought it from 304px to 266px.

**Colour is never the only carrier of tribe.** Tribe is drawn as field tincture and nothing else, and gules (dwarf) sits beside vert (elf) on the player's own line. Simulated for deuteranopia those two colours are 33.5 apart out of 441 — the same card. Petra Sancta hatching, the printers' convention since 1638, is added to `heraldry/tinctures.ts` as part of what a tincture *is*, and drawn by `heraldry/card.ts` behind a `hatch` flag with a HUD toggle and a `?hatch=1` URL parameter.

**Hatching is off by default, deliberately.** `test/golden/heraldry/` holds seven renders whose sha256 digests are what work unit 2's review is bound to. Hatching by default would strand that review rather than inherit it. The flag absent reproduces the previous bytes exactly, and a test asserts it.

## Acceptance criteria

- [x] Hovering any card — unit, ghost, hand card or hero — names every element it draws, with an icon and a plain sentence for each.
- [x] Every trait is read from the engine's `Trait` union, never a hardcoded list, so a removed trait disappears rather than lingering.
- [x] Trait sentences carry the resolver's own numbers; a retyped literal fails a gate.
- [x] Race is explained honestly: `RACE_HAS_NO_RULE` says nothing in the pool reads it, and a gate fails the day `engine/resolver.ts` mentions `tribe`.
- [x] The panel never covers the opposite row: measured 0 px² for every hovered element at 1440x900, down from 24,355–31,311 px².
- [x] The compressed card stays readable at the 44px floor: the widest trait strip is 19px in a 44px card, and the row never wraps at any viewport from 1440px down to 380px.
- [x] Aria labels extended rather than replaced; icons carry accessible names; the odds badge and the energy pips are named.
- [x] Tribe is separable without colour: every tribe pair whose simulated colours collapse carries a different hatching.
- [x] `npm run gates` green — 137 tests, 0 failures.

## Implementation steps

- [x] Extend `tools/ui-probe/play.ts` with a `hover` mode that measures panel-versus-row overlap rather than eyeballing it, and baseline the defect.
- [x] `src/render/icons.ts` — nineteen icons, each with a stated shape and an enforced accessible name.
- [x] `src/render/glossary.ts` — one table per kind of term, keyed by the engine's types.
- [x] `src/render/inspect.ts` — the panel, sized so it can be placed clear of the board.
- [x] Placement scoring in `src/ui/app.ts`, plus an `is-inspected` ring so the panel and the card it describes are visibly linked.
- [x] Petra Sancta hatching in `heraldry/tinctures.ts` and `heraldry/card.ts`, with a HUD toggle.
- [x] `test/explain.test.ts`, and four mutations proving it goes red.
- [x] Screenshots at both themes, hatching on and off, the 44px floor, and a deuteranopia simulation.

## Outcome

Verified at the tip of `worktree-agent-a2f9237928772992a`. `npm run gates` green: typecheck, boundaries, banned-apis, 137 tests, `verify`, `verify:run`.

**Measured**, by `npm run probe:ui hover 7 even light` at 1440x900:

| hovered | covers the other row, before | after |
|---|---|---|
| player unit | 24,355 px² | 0 px² |
| enemy unit | 25,739 px² | 0 px² |
| hand card | 31,311 px² | 0 px² |
| hero | panel never appeared | 0 px² |

The worst remaining coverage of the card's *own* row is 2,341 px² — a 3px sliver at its bottom edge.

**Looked at**, individually and at native resolution: a card at rest and hovered at full width, the same at the 44px floor, both themes, hatching on and off, the hover anchored to the top row where the overlap bug lived, all nineteen icons at 11px/15px/64px in both themes, and the player line under a deuteranopia filter with hatching off and on.

### Limitations

- **A window shorter than about 830px has no free band large enough.** At 700x760 the bands are 206/180/84px against a 266px panel, so the panel must cover something; the scorer picks the card's own row and still never touches the opposite one. Fixing it properly means a shorter panel or a docked one, and both are larger changes than this round.
- **Hatching is a switch, not the default.** That is the right call while the reviewed goldens are bound to unhatched bytes, but it means the default experience still carries tribe on hue alone. Turning it on by default is a one-line change plus a re-review of the seven goldens.
- **The colour-vision simulation can only fail a design, never pass one.** The screenshots are the evidence; the numbers are the tripwire.
- **`test/explain.test.ts` asserts on strings, never on pixels.** Nothing in `npm run gates` would catch the panel being drawn off-screen or in the wrong colour; that is what `npm run probe:ui hover` is for, and it is a probe rather than a gate.
