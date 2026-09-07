# 2026-09-07 — A card explains all of itself

Work unit 7. History, not status; `docs/work/7_card-explains-itself/plan.md` carries the status.

## What was believed, and proved false

**"The hover preview is a nice-to-have polish item."** It was the highest-value defect on the screen. The owner — who designed this game — asked what "Ward", "Wake" and "hue" meant. Every noun in this game is invented, and the only place any of them was written down was `docs/design/game.md`. A player never opens that. The compressed card is four channels of pure symbol: an outline that means Guard, a colour that means tribe, two numerals, and a strip of glyphs. Before this round the hover preview answered exactly one question — "what does this card look like bigger" — which is the one question nobody was asking.

**"Panel content is a copy decision; layout will absorb whatever it is."** It is the other way round. At 1440x900 the two board rows cut the window into free bands of 120px, 180px and 270px. A panel taller than 270px has nowhere to go that is not the board, so **the amount you may write is decided by the layout before a word of it is written**. The first draft came out 375px tall and had to sit on the player's own line. Getting under 270 took three moves: widening from 452px to 680px so fewer lines wrap, merging five stat paragraphs into one chip strip plus one sentence with the full rule on each chip's `title`, and merging three heraldry paragraphs into a three-line table. That is 304px → 266px, and it is why the panel is shaped the way it is.

## The overlap defect, and why "below, else above" could never have worked

The previous worker flagged the hover preview covering the row above it as the roughest remaining edge. The rule was: place below the card if it fits, otherwise above. On a two-row board, "above a card in the bottom row" *is* the top row. Measured with the new probe mode at 1440x900:

| hovered | covered of the opposite row |
|---|---|
| player unit | 24,355 px² |
| enemy unit | 25,739 px² |
| hand card | 31,311 px² |

No ordering of "below / above" fixes this, because both candidates are board. The fix is to stop ordering and start **scoring**: seven candidates — four sides of the hovered card plus the three bands the two rows leave — each costed by the area it would cover, weighted opposite-row 6, own-row 2, the hovered card itself 8, off-screen 12, with distance from the card as a tie-break. Every hover now covers 0 px² of the opposite row; the worst own-row coverage is 2,341 px², a 3px sliver.

Two things about that scoring are worth keeping:

- **The hovered card is its own keep-clear rect.** Without that term, hovering a hand card put the panel in the bottom band, directly on top of the card it was describing — and the `is-inspected` ring that links the two was underneath it. With the term, the panel goes to the side instead.
- **The panel does not always land beside what it describes.** Hovering an enemy unit puts it at the bottom of the window, because that is the only band that is free. That is a real cost, paid deliberately, and it is why `.card.is-inspected` draws a ring.

## The trait list that must not exist

The round was run in parallel with a worker **deleting Ward from the engine**. So no trait list is written anywhere in this work. `render/glossary.ts` declares `TRAIT_TERMS: Readonly<Record<Trait, Term>>` over `engine/state.ts`'s union, which gives two things for free:

- Deleting `ward` from the union makes `glossary.ts` fail `tsc` with the excess property, so the explanation cannot outlive the rule.
- Adding a trait to the union makes it fail the same way until the trait is documented, so a new trait cannot ship as an undocumented pip.

The board's trait strip, the hand's hint line and the hover panel all read that one table. `board.ts`'s old `TRAIT_GLYPH` and `app.ts`'s old `TRAIT_RULE` were two separate hand-written copies of the same four rules; both are gone.

## Two gates that were worthless on the first attempt

Recorded in full in `docs/learning/gate-proofs.md`; the short version, because both are shapes that will recur.

**A check built from the same symbol as the thing it checks.** The first version of "trait rules carry the resolver's own numbers" asserted `TRAIT_TERMS.relay.line` matches `/\+2 Power/` with the 2 taken from the imported `RELAY_POWER`. Retyping the sentence with a hardcoded `+2 Power` passed it — the literal happens to equal today's constant. Re-tuning `RELAY_POWER` to 3 also passed — the sentence is interpolated and followed. The check could not tell "derived" from "coincidentally equal", which is to say it proved only that the code agrees with itself. It now also reads `glossary.ts`'s source and requires the interpolation to be present and no `/\+\d+ Power/` literal to be.

**A grep gate against a file that talks about itself.** That source scan then failed on a clean tree, on `glossary.ts`'s own header comment, which explains the rule by quoting `"+2 Power"`. This repo has already paid for this lesson once: `gate:banned-apis` reads the TypeScript AST rather than grepping precisely because `src/engine/rng.ts` names all three banned APIs in a comment in order to say it never calls them, and a grep gate reported sixteen violations on a clean tree. The fix here is a `codeOf()` helper in the test that strips comments first.

## Colour blindness: the number, and why the number was not enough

Tribe is drawn as field tincture and nothing else. Simulated colour distances, sRGB bytes over 0..441:

| pair | sRGB | deuteranopia | protanopia |
|---|---|---|---|
| dwarf (gules) vs elf (vert) | 139.3 | 33.5 | 38.2 |
| elf (vert) vs orc (tenne) | 116.8 | 47.3 | 20.8 |
| dwarf (gules) vs orc (tenne) | 57.0 | 25.6 | 41.0 |

Dwarf and elf stand next to each other on the player's own line and are, to roughly one man in twelve, the same card. The answer is the one print heraldry has used since 1638: Petra Sancta hatching, which lives in `heraldry/tinctures.ts` because it is part of what a tincture *is*, exactly as its hex is.

**The instrument had to be verified before the measurement was trusted.** The first version of the deuteranopia screenshot filter used the common `0.625 0.375 0 / 0.7 0.3 0 / 0 0.3 0.7` RGB approximation while the test used an LMS projection. The two disagreed: dwarf and elf came out visibly different in the filtered screenshot while the number said 33.5. Two arms of one comparison differing by more than the variable under test is exactly the failure canon names. `cvdMatrix` is now exported from `tinctures.ts` and the probe feeds those nine coefficients to `feColorMatrix` in linearRGB, so the picture and the number are the same arithmetic. With that fixed, the unhatched simulated row shows dwarf and elf as *the same olive*, and the hatched one shows vertical against diagonal.

Hatching is **off by default**, and that is not timidity. `test/golden/heraldry/` holds seven renders whose sha256 digests are what work unit 2's review is bound to; hatching by default would strand that review rather than inherit it. A test asserts the flag-absent render is byte-identical to the flag-false render, comparing with clip-path ids normalised — the ids are a per-document counter, so two renders of one card differ in that id and nothing else, and comparing raw strings measures the counter.

## What a later session could trip over

- **Panel height is load-bearing.** Adding a paragraph to `render/inspect.ts` can push it past 270px, at which point it silently starts covering a row again. `npm run probe:ui hover 7 even light` prints the panel size and the area it covers of each row; read those numbers after any content change.
- **`pipIconSize` exists for the 44px floor, not for taste.** A pip is the icon plus 4px padding and 2px border; two pips and their 3px gap must fit inside the card. `test/explain.test.ts` asserts the arithmetic; `npm run probe:ui narrow` measures the rendered result and reported 19px of strip in a 44px card.
- **A window shorter than about 830px has no band big enough for the panel.** At 700x760 the bands are 206/180/84px. The scorer still avoids the opposite row, but it must cover something. Not fixed.
- **`iconSvg` throws** when asked for an icon with neither `label` nor `decorative: true`. That is deliberate — "an icon is never the sole carrier of meaning" fires at render time rather than in review — but it means a new call site with neither will crash the panel rather than degrade.
- **`.probe-ui/` is git-ignored task-run evidence.** The screenshots this round's review is bound to are not in the repository; `npm run probe:ui` and `npm run probe:icons` regenerate them, which strands the review rather than inheriting it.

---

## 2026-09-07 — merged with unit 6, and what that took

Unit 7 was cut from `b79abf9`, before unit 6 removed Ward. This section is the reconciliation, appended here rather than filed separately because everything in it is about this panel.

### The glossary's type error was the design working

`TRAIT_TERMS: Readonly<Record<Trait, Term>>` is keyed by the engine's own union, and the section above says why. This merge is the first time the property was cashed in: `ward` left `Trait`, and `tsc` named the tooltip that described it. Three errors on the whole tree — the `ward` entry in `TRAIT_TERMS`, the `ward` entry in `IconName`/`ICONS`, and two `warded: false` fixtures in `test/explain.test.ts`. Nothing else in the glossary had to be searched for, because nothing else could be wrong without failing to compile.

The prose remnants the compiler could *not* see are the point of the contrast, and there were six: `glossary.ts`'s own header listing "Ward" as an example invented noun, `inspect.ts`'s header quoting the owner's question, `TRIBE_TERMS.elf` still saying elves are "Wardens and Sentinels" when the only Elf card left is the Sentinel, `fx.ts`'s "Buff or ward" comment, `app.css`'s "the ward mark", and `test/explain.test.ts`'s own header. A type is a gate; a sentence is not.

### Taking unit 7's side wholesale is worse than merging

The integration was first attempted as `git checkout --theirs` on `src/render/board.ts` and `src/ui/app.ts`, and that left seven type errors — the two `is-warded` class toggles, `warded: false` in the ghost view, and the `'ward'` beat kind, all of which unit 6 had deleted and `--theirs` restored. Git's own three-way merge leaves the rest of both files correct on its own and conflicts only on the two *declarations* that both branches rewrote: `board.ts`'s `TRAIT_GLYPH` against `traitPipsOf`, and `app.ts`'s `TRAIT_RULE` against `traitRule`. Both resolve to unit 7's derived version, and the rest of both files then needs no hand edit. Three errors, not seven.

### Retaliation had to go in the panel, and the layout decided where

Combat is mutual now: a defender deals its own Power straight back, a unit can die on the swing it started, and a hero is the one exception — it hits back when attacked and takes nothing on its own swing. That is a rule with no symbol on the card. The number is drawn; "and it is also what comes back at you" is not, and the only other place a player meets it is a corpse in the log.

The obvious home was a rule row next to Position, and **the measurement refused it**. The warning three sections up — "adding a paragraph can push it past 270px" — is exactly what happened: a rule row is 50px of text plus a 4px gap, the panel is 266px against a 270px band, and with the row it went to 318px and covered **112,062 px² of the line the hovered card is in**, up from 2,341. So the sentence went into the summary paragraph under the number strip, which was 130 characters and wraps to a third line at about 235, measured in the browser. Cost: zero pixels. The rest of the rule — the 0-Power wall, dying on your own swing — rides on the Power chip's own sentence, which is where every other number's full rule already lives and where that paragraph tells the player to look.

That budget is now a gate rather than a comment: `test/explain.test.ts` renders every shipped card and the hero in both target-chance branches, pulls the `xp__gloss` text back out of the HTML, and fails over 235 characters with a message that says what the extra line does. The `retaliate` icon that the rejected rule row needed was removed with it, so the set is 18 rather than 19 — Ward's icon out, nothing in.

### What a later session could trip over, added to the list above

- **The probe can no longer reach a wide line.** `npm run probe:ui hover|narrow` plays real rounds, and with mutual damage the player's bodies die to the retaliation their own attacks draw: the line tops out at 3 units at `even` and at `trivial` alike, so `08-wide-player-unit`, `10-floor-narrow` and unit 7's measured "19px trait strip in a 44px card" have no state to be photographed in. The arithmetic gate on `pipIconSize` still holds; the *picture* of the compression floor does not exist any more and was not faked. It comes back when the card pool is re-costed for a world where attacking has a price, which is open question 1 of unit 6.
- **The summary paragraph is full.** 235 characters is two lines and it is now at about 210. The next sentence anyone wants there does not fit, and the gate says so rather than the board quietly disappearing.
- **The enemy hero's panel says "Yours acts after every unit on your line."** That is unit 7's copy for the no-trait row, written for the player's hero and reused for the enemy's. Not touched here, because the gate that pins it is bound to the player hero and rewording it is a copy decision this merge has no mandate for.
