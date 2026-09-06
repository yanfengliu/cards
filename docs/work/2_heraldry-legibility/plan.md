# Probe: is a heraldic card legible at 70px?

Status: complete
Owner: worker (render probe), coordinator integrates
Created: 2026-09-06
Updated: 2026-09-06

## Problem and outcome

`ARCHITECTURE.md`'s art system rests on one premise: at fifteen units the board compresses a card to roughly seventy pixels, and heraldry stays legible there where illustration would not. Four channels are asserted to survive that compression — corner numerals for Power and Health, silhouette and bordure for Guard, field tincture for tribe, charge for card identity.

The premise had never been looked at. This probe builds the renderer the spec describes, rasterises it to real pixels, and answers the question by looking.

**Verdict: yes, with one defect that must be fixed before the pool is authored.**

At 70 device pixels all four channels read. Guard reads at a glance in a fifteen-card row and is the strongest channel by a wide margin. All six tribe-colour pairs are separable at 70px on both light and dark grounds. The numerals read, including a two-digit Health, but they are close to their floor at 70 device pixels — comfortable at 70 CSS pixels on a 2x display, which is the realistic case.

The defect is not a tincture collision between two tribes. It is a collision between the **sable field and a dark board background**: a non-Guard dragon card has no visible boundary on a dark ground, so the card stops existing as an object and only its numerals and charge float in space. It is fixed by the card outline, not by the palette — see Outcome.

## Scope

Included:

- An SVG heraldry renderer driven by blazon strings in card data: field tincture, an optional bordure, one charge from a library.
- A charge library of eight, chosen for silhouette spread rather than coverage.
- Two tiers: compressed at 70px, expanded at 250px.
- A rasterising probe: 158 shots at two device scale factors, each a real PNG at native size.

Excluded, deliberately:

- Any engine or game logic. Nothing under `src/engine/` is imported or created. The probe is driven by hand-written fixture data in `src/content/`.
- A full charge library. Eight is enough to judge the idiom; `ARCHITECTURE.md` puts the real number at thirty to fifty.
- Animation, hover behaviour, sigils, and the enemy side.
- Blazon beyond the stated subset — no ordinaries, partitions, attitudes, or multiple charges.

## Approach

The renderer is `src/render/heraldry/`: `tinctures.ts`, `blazon.ts`, `charges.ts`, `card.ts`. Card data is `src/content/cards.fixture.json` (sixteen cards, four tribes, eight charges, six Guards, one two-digit Health) and `src/content/tribes.fixture.json` (two candidate palettes).

`tools/heraldry-probe/` builds one HTML page whose every shot is an element carrying `data-shot`, then Playwright takes an element screenshot of each. A single-card shot is the card at its own native pixel size plus a fixed margin of background, because how a card separates from its ground is one of the things under test and a shot cropped to the card's bounding box cannot show it.

Two consequential choices:

**Two device scale factors, not one.** A 70px card at dsf 1 is 70 device pixels; on the displays this game will run on it is 140. Shooting both separates "the design fails" from "the raster is too coarse", and those have opposite remedies. The distinction turned out to matter: the numerals are near their floor at dsf 1 and comfortable at dsf 2.

**Aggregate views are supplements, never evidence.** Per canon, every one of the sixteen cards was inspected individually at native resolution in both tiers, on both backgrounds. The rows exist to answer the adjacency question, which is genuinely a question about the aggregate; they were not used to certify any individual card.

## Acceptance criteria

- [x] A blazon string in card data renders to SVG with no image assets.
- [x] Both tiers render; compressed is 70px, expanded is 250px.
- [x] Guard is carried by silhouette and bordure; non-Guard is a plain rectangle.
- [x] Each of sixteen cards inspected individually at native resolution, both tiers, both backgrounds.
- [x] All six tribe pairs checked side by side at 70px on both backgrounds.
- [x] A fifteen-card row checked at compressed size on both backgrounds.
- [x] `tsc --noEmit` clean.

## Implementation steps

- [x] Blazon subset, tincture table, eight-charge library.
- [x] Two-tier card renderer with the Guard silhouette.
- [x] Fixture cards and palettes.
- [x] Playwright rasteriser at dsf 1 and 2, with a sha256 manifest so a regenerated set cannot inherit an old review.
- [x] Visual sweep and verdict.

## Outcome

Verified revision: the commit this document lands in, on branch `worktree-agent-a22b130a4b8422c9d`, cut from `5e9d66f`. Not merged — the coordinator integrates.

Gates run. `npx tsc --noEmit` clean. `npm audit --audit-level=moderate`: 0 vulnerabilities, re-run because this commit adds the repo's first dependencies. `node tools/heraldry-probe/shoot.ts` produced 158 shots at two device scale factors, 316 PNGs.

This is the repo's first code commit, so `AGENTS.md`'s Gates section is now due the replacement it describes: `.nvmrc` and typecheck exist; a unit suite, lint/format, and the import-boundary rule `ARCHITECTURE.md` calls for do not. Flagged, not fixed — `AGENTS.md` was out of scope for this probe.

### Channel by channel, at 70 device pixels

| Channel | Verdict | Detail |
|---|---|---|
| **Corners — Power / Health** | Works, near its floor | Every value from 1 to 10 read on both grounds. Two digits ("10") read. At dsf 1 they are working hard; at dsf 2 they are comfortable. |
| **Outline + bordure — Guard** | Works, strongest channel | A shield among rectangles is unmistakable in a fifteen-card row, at a glance, on both grounds. It also survives well below 70px. |
| **Field tincture — tribe** | Works for all six pairs | No two tribes collide at 70px. But see the sable defect. |
| **Charge — identity** | Better than spec claims | The spec assigns the charge to the expanded tier only. At 70px the eight charges are still separable from one another, so the compressed tier gets card identity as a bonus. |

### Tribe-colour pairs, palette A (gules / vert / azure / sable)

All six checked side by side at 70px on both grounds. **None collide.**

| Pair | Light | Dark | Note |
|---|---|---|---|
| dwarf (gules) vs elf (vert) | pass | pass | |
| dwarf (gules) vs human (azure) | pass | pass | |
| dwarf (gules) vs dragon (sable) | pass | pass | |
| elf (vert) vs human (azure) | pass | pass | **tightest pair** — dark green against medium blue; separable but the least margin of the six |
| elf (vert) vs dragon (sable) | pass | pass | |
| human (azure) vs dragon (sable) | pass | pass | |

The luminance-contrast numbers say the opposite and are the wrong instrument: dwarf-vs-human computes to 1.07:1, which would condemn the pair, while red against blue is one of the easiest discriminations on the board. This is exactly why `ARCHITECTURE.md` calls for a per-pair check at the real size rather than a palette check, and the probe confirms the instruction rather than the metric.

### The defect: sable loses its boundary on a dark board

The failure the spec anticipated was two tribes colliding with each other. The one that actually occurred is a tribe colliding with the **background**.

A sable field is `#26262b`. The card outline is `#0d0d12`, darker than both the field and a `#15171c` board. On a dark ground a non-Guard dragon card therefore has no edge at all: the numerals and the charge float, and a player cannot see where one card ends and the next begins. In a fifteen-card row three of the fifteen cards simply are not there. Adjacency traits — Relay, Wake, Kindle, Ward — all depend on reading which card is next to which, so this is a correctness problem for the game, not a polish problem.

Guards escape it, because their heavy bordure supplies the silhouette the outline failed to.

**It is an outline defect, not a palette defect, and the cheap fix works.** A pale mount (`#9aa0ad`) stroked outside the dark outline gives every card an edge on any ground. Verified: `evidence/row15-70px-dark-with-mount.png` against `evidence/row15-70px-dark.png`, same fifteen cards, same size, same background. On a light ground the mount is invisible and costs nothing.

The renderer exposes this as `RenderOptions.mount`, opt-in, so both arms of the comparison stay reproducible. **The recommendation for the real renderer is to turn it on by default.** Palette B (dragon moved to purpure, dwarf to tenne) also removes the defect and was checked across all six pairs on both grounds, but it is the more expensive answer to a problem the outline causes.

### Bordure tincture is background-dependent

An `or` (gold) bordure reads strongly on both grounds. An `argent` (near-white) bordure is excellent on a dark ground and weak on a light one — against `#f1ede4` its outer edge merges with the background and the bordure's heaviness is halved. The shield silhouette still carries Guard, so nothing breaks, but **content authoring should prefer `or` for bordures**, or the board background must be fixed to dark.

### Where the floor is

A width ladder at 44 / 54 / 62 / 70 / 84 / 100 px, inspected at both scale factors:

- **44px** — Guard silhouette and tribe tincture still read. Single-digit numerals are at the edge; the two-digit "10" is a smudge at dsf 1 and legible at dsf 2.
- **54px** — single digits read; "10" is tight at dsf 1.
- **62px** — comfortable at dsf 1 apart from crowded two-digit values.
- **70px** — comfortable. Charges still separable.

So **the numerals set the floor, and the floor is about 60 device pixels**, not 70. Everything else in the system survives to 44px and below. If the board ever needs to compress past fifteen units, the numerals are what breaks first and they are what would need a redesign — not the heraldry.

### What this changes for the art direction

Nothing structural. The four-channel split holds and the compression premise is sound. Three specific amendments are worth carrying into the real renderer:

1. Every card gets a mount, so no field tincture can lose its boundary against the board.
2. Bordures default to `or`; `argent` bordures need a dark board.
3. The charge earns its place in the compressed tier. The spec's rule that no turn-decision information may live only in the expanded tier is unaffected — this is information arriving earlier than promised, not later.

### What was not checked

- **No animation overlay.** `ARCHITECTURE.md` names tincture collision "under an animation overlay" specifically. Nothing here is animated, so the pairs were judged on a static field. A translucent damage or buff overlay compresses the tincture range and could reopen a pair the static check passed — elf-vs-human has the least margin and is the one to re-check first.
- **No human eye.** The verdict is a vision-model reading of PNGs at native pixel size. That is a proxy for a person at a normal viewing distance, not the same thing. The dsf 1 / dsf 2 split brackets it, but a five-minute look by the owner at the promoted PNGs would settle it properly.
- **Eight charges, not fifty.** Silhouette separability was checked across a deliberately spread eight. A library of fifty will contain near-collisions the spread of eight cannot predict; that is a per-pair check the content phase owes, on the same instrument.
- **One aspect ratio and one gap.** 5:7 cards with a 6px gap. Compression that shrinks the gap rather than the card was not modelled.
- **No colour-vision-deficiency check.** Tribe is carried by hue. Deuteranopia would likely collapse gules against vert, which is a real accessibility question this probe did not open.

### Evidence

Promoted under `docs/work/2_heraldry-legibility/evidence/`. Review binds to these bytes; regenerating the probe strands this review rather than inheriting it.

| File | sha256 | What it shows |
|---|---|---|
| `row15-70px-light.png` | `cc98c2c88b7e16e20b94ab41698be7f191221c905855ca9baf0745e1b785ee01` | Fifteen cards at 70px, light ground. Five Guards countable at a glance. |
| `row15-70px-dark.png` | `d1eef8c9f4cd97eb0c59880ee5dbce9b5b3b11c8920ee77c349d4fa0b4a4a9dc` | The defect: sable non-Guards at positions 7, 14, 15 have no boundary. |
| `row15-70px-dark-with-mount.png` | `f3acb0fb8b17ef39d9ef215c3a0045694e452384adf5dd8b6cbb08603fa5fdbc` | Same row, mount on. Every card has an edge. |
| `pair-elf-vs-human-70px-light.png` | `39945ccb77165c8de5de484f679e98fae4107980121725a7970f94ed9af665e3` | The tightest tribe pair at the real size. |
| `shieldbearer-compressed-70px-light.png` | `d21fe9f0f72bb02ed7c6d123875594c3e7e4cc6bc34a95e174ae43c21d631f9e` | Compressed tier, one Guard, native size. |
| `shieldbearer-expanded-250px-light.png` | `ef57bb00c17325f6d5199ca381551cd53cf39012ee6e17852a914e2a4cd2fbb1` | Expanded tier, same card. |
| `ladder-44px-light.png` | `1475352dd65dcdb628dd9877961360b1731592525dc324fe9c07f2597a97691f` | Below the floor: silhouette and tincture survive, "10" does not. |

The other 309 PNGs are task-run evidence under the ignored `.probe/`, with a sha256 manifest at `.probe/manifest.json`. Reproduce with `npm run probe:heraldry`.

### Defects found in the renderer while building it

Recorded because each is a class of bug the next renderer author will hit.

Caught by looking, after they had been written and rendered:

- **A near-360-degree elliptical arc leaves a hairline sliver.** `a36 36 0 1 0 0.1 0` renders a stray ring. Circles must be two half-arcs.
- **A crescent is not a disc minus a disc.** The biting circle protrudes past the outer one, and both `evenodd` and `nonzero` fill that protrusion. It has to be traced as one outline between the circles' intersection points. The first fix produced a plain blob, which is what a wrong sweep flag looks like — only the render distinguished the two failures.
- **A stroke drawn outside the silhouette is clipped by the SVG viewport.** The mount showed only at the corners until the silhouette was inset far enough to make room. Nothing errors; the halo is simply absent.
- **Two charges were unusable at any size** — a wyvern's head that read as a blob, an eagle that read as a scarecrow. Both were rewritten. Neither would have been caught by any test, and both were caught in the first minute of looking at the expanded tier.

Caught by reading, before it could render — recorded because the render would not have caught it:

- **Duplicate SVG element ids across cards on one page.** The first draft gave every card `id="cardclip"`, which would have made every card after the first clip to the first card's silhouette. It was fixed before the first screenshot, so it was never observed. Recorded because a single-card test cannot see it and a multi-card row would have shown it as a subtle wrong shape rather than an error.
