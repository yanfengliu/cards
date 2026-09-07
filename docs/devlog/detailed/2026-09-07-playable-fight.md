# 2026-09-07 — the playable fight

Detail a later session could trip over. The summary line is in `docs/devlog/summary.md`; the round's own record is `docs/work/3_playable-fight/plan.md`.

## What was believed and proved false

**"The odds are a display detail."** They are the fairness contract, and they were wrong. `ARCHITECTURE.md` defines fair as the odds being visible before you commit, and the board was reporting `1 / legalTargets.length` against the *pre-commit* board. Ward is granted during your own resolution. So a line with a Ward to the left of your only Guard displays "100% onto your Guard" and then produces four fizzled enemy attacks — every legal target removed. Not incomplete: inverted. Fixed by `projectOwnPhase`, which is exact rather than sampled because nothing on your own side can be hurt during your own phase, so every Ward and every Relay lands with no dependence on a roll.

**"14 units is close enough to 15, just find a better seed."** No seed reaches 15 with the shipped deck at 3 energy. Twenty cards, drawn to five a turn, roughly two placed a turn against attrition — 14 is the ceiling the content produces, and hunting seeds for a fifteenth was the wrong instrument. Squeezing the viewport at 14 puts the layout under strictly more pressure than a fifteenth card at 1440 would, and it is measurable: distinct card tops per row, which is 1 when the row has not wrapped.

**"A `width` transition on a card is cosmetic."** The row measures its own overflow immediately after painting in order to re-fit the cards, and a width still gliding to its new value makes that measurement describe the previous layout. The re-fit undershot by 21px at one viewport and looked like an arithmetic bug for a while. The transition now lives only on the dying collapse, where nothing measures.

## What the visual pass caught that the tests could not

Four of five. Listed in the plan; the pattern is what matters. Each one lived in the input path or in the browser's own layout, and every one of the six new gates is arithmetic or a state comparison. A board can pass all six and still clip the acting ring, overflow when you pick up a card, or show a header on a different clock from the board underneath it.

The skip control is the sharpest example. "Resolve now" finished the playback it was holding, and a committed round is three segments — your line, the enemy's placements, the enemy's line. Pressing skip during the first left you watching the half you had asked to skip. No test could see it; one press did.

## Decisions a later session should not silently reverse

**`src/ui/session.ts` duplicates two private pieces of `engine/fight.ts` on purpose.** `runRound` drops the event stream `resolvePhase` returns, and that stream is the whole input to the animation layer. The alternatives were an additive hook on `runRound` — rejected because `src/engine/` was another lane's this round — or diffing two boards and guessing, which `ARCHITECTURE.md` forbids. The duplication is safe only because `test/ui-session.test.ts` compares `hashFight` after every round across 160 fights. **If that gate is ever weakened to compare only final hashes, the duplication stops being safe.**

**Buff provenance is reconstructed, and should not be.** `powerGained` carries `{uid, amount}`; the `gainPower` effect carries `sourceUid` and the event does not. `attributeBuff` recovers the source from the position of the event in the stream, and its argument is sound for exactly the shipped trait set: Relay fires on `afterActed` and targets the actor's right neighbour on the actor's own side, Wake fires on `died` and targets the dead unit's right neighbour on the dying side, and an attack only ever reaches the other side, so the two cases cannot both claim one event. **A third power source breaks that argument.** The gate is honest about it — anything unattributable comes back `unknown` and fails rather than drawing an arrow from the wrong card. The fix is one field on two events, no `GameState` change and no behaviour change, and it is the resolver owner's to make.

**The Relay forecast is a badge, never a bigger number in the Power disc.** Folding it into the numeral makes the stat read 3 before you press commit and 1 immediately after, then climb back as the buff travels. A number that moves backwards when you press the button is worse than one that waits.

**`projectOwnPhase` does not project Wake.** Wake answers a death, and which of your units dies is a targeting roll. Projecting it would turn an exact forecast into a guess presented in the same typeface as the exact ones.

## Numbers that moved

- Test suite 55 → 63.
- `npm run verify` unchanged: same 2,454 compared rounds, same 40 final hashes, same 15.25 pp gap, identical line for line apart from `Elapsed`.
- Card width at 14 units: 86px at a 1440 viewport, 44px (the reviewed floor) at 820 and below.
- Resolution budget: 3,000 ms at realistic width, compressed with a floor of 0.3 on the per-beat duration so no beat becomes a flicker.

## A design finding, left for the owner

Ward on your only Guard makes your entire side untargetable, and it is the opening rather than an edge case. Two cheap cards on turn one; zero damage taken for a whole fight against the `even` encounter. `src/engine/resolver.ts` already recorded that this combination is not covered by `docs/design/game.md` and pointed at `docs/work/1_turn-prototype/plan.md`; what playing adds is that it is the strongest thing a beginner can do, and it is consistent with the measurement putting Ward at about 2.5 times Relay's share of the placement gap. Nothing was changed about it. The cheapest options to weigh: Ward could exclude Guards, or a side with no legal target could fall back to the full pool instead of fizzling.
