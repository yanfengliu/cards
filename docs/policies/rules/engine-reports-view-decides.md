# The engine reports what reached a target; the view decides what is worth saying

One of [cards' local rules](../local-rules.md).

**The resolver announces every effect that reached a target and nothing about one that found none.** *Reached a target* is not *changed the board*: an effect that lands on a body whose Armour eats the whole point is reported at 0, and so is a 0-Power defender's retaliation. Whether a 0 is worth putting in front of a player is decided in `src/render/` and `src/ui/`, never in `apply`.

Today that judgement is one rule, in `buildBeats`: once a hero is down the fight is decided, and a blow that moved no Health is not drawn. A `fizzled` is exempt — it is the receipt for spent energy, not a blow — and an attack and the retaliation it drew are one blow, kept or dropped together. `src/render/odds.ts` answers the same way on the forecast side: a unit taking nothing is absent from the burn rather than present at zero.

**Why.** Unit 10 wrote the rule down as "the resolver announces every change it makes and nothing it does not", in four places, and that is not what the code does — the `scorch` loop pushes `damaged` for every living non-hero, `dealt === 0` included, and `test/hero-attacks.test.ts` pins `{raw: 1, dealt: 0}` as correct. A second independent review measured 163 zero-change announcements surviving the fight-ending `died` across the shipped encounters, and `src/ui/app.ts` played every one, so a player read "**Warchief** dies." and then "scorches **Orc Shieldwall** for **0**". A wrong rule in four places is worse than no rule: the next author implements the sentence, not the code. Suppressing it in `apply` would have been implementing the sentence.

**Bound.** This is where the judgement lives, not a list of what it decides. The one rule above is gated by "once the fight is decided the screen stops narrating blows that moved nothing" and "a trade after the fight is decided is drawn whole or not at all", both in `test/render-view.test.ts`, over the corpus of decided fights the three classes produce. A second such rule belongs beside the first, in the view, with its own gate.
