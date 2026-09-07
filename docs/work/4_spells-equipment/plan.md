# Spells and equipment

Status: complete
Owner: worker (unit 4)
Created: 2026-09-07
Updated: 2026-09-07

## Problem and outcome

`docs/design/game.md` specifies three card types — units, spells and equipment. Only units existed.

The gap that mattered was not symmetry. The design names **AoE spells as the only designated counter to a wide board**, and going wide is what the deck economy currently rewards: uncapped width, cheap bodies, and no board-wide effect anywhere in the engine. Until AoE existed the design had no answer to its own strongest strategy, and the open question the owner ranked first could not be prototyped at all.

Outcome: both other card types exist, are castable from a real fight, replay, and are gated. The unit path is byte-identical.

## Scope

**Included.** Four effect verbs (`damageOne`, `damageAll`, `buffAll`, `equip`); the `SpellCard` and `EquipmentCard` types and the binder from a spell's data to those verbs; three equipment slots on the hero with replacement and an end-of-fight reset; energy accounting across all three card types; a `casts` field on the round record and its replay; five spells and three pieces of equipment as data; 31 new tests.

**Excluded, deliberately.**

- **The measured deck.** `PLAYER_DECK` is unchanged and holds no spell or equipment, so `npm run verify`'s numbers are untouched. Which spells belong in a measured deck is a balance question, and balance is a whole-pool property that `ARCHITECTURE.md` gives to one owner. `PLAYER_DECK_MIXED` exists beside it for the tests.
- **Bots that cast well.** `selectPlays` prices a spell correctly and `splitPlays` routes it, so the existing bots will cast whatever they draw — but no policy reasons about *when* an AoE is worth three energy. A placement bot that cannot evaluate a board wipe is the reason the mixed deck is not the measured one.
- **Telegraphing enemy AoE**, which the design names as the mitigation to try first for its top open risk. That is a presentation change and needs a UI.
- **Sigils, and equipment that grants a trait.** Both would put run-long progression into the per-fight layer, which the design explicitly separates.
- `src/ui/`, `src/render/`, `src/run/`. Other units own them; nothing here touches them.

**Dependencies.** Base revision `06c87c7`. No other unit's work is needed and none is blocked by this.

## Approach

**Four verbs, and no card-specific branching.** A spell is a list of `SpellEffectSpec` rows — a verb and a number — bound to resolver effects by one switch in `src/engine/cast.ts`. The switch is over the verb, never over the card, so a new spell is a row of data. A new *shape* of spell is a new verb and a new `apply` case, which `ARCHITECTURE.md` makes a coordinator decision.

**AoE is one effect.** `damageAll` damages every living enemy unit inside a single `apply`, and the checkpoint runs once after it. That is what puts two deaths at one checkpoint, announced in board order, with the triggers answering them queued in that same order. Splitting it into one effect per target would interleave the deaths with the damage — the mutation is recorded going red in `docs/learning/gate-proofs.md`.

**Equipment is a summand, not a write.** `power()` and the new `armourOf()` add up printed, buffed and worn. Taking a piece off is then exact by construction, and `basePower` keeps meaning "printed Power", which the worked example depends on. A unit's `equipment` is `null` — no slots at all, rather than three empty ones.

**Everything additive is additive at the byte level.** `Entity` gained one field, built only by `makeHero`/`makeUnit`, so no existing call site changed. `CardPool.castable` is optional, so a unit-only pool compiles and behaves as before. `RoundRecord.casts` is left absent rather than empty when nothing was cast. `entityToCanonical` appends its equipment segment only when something is worn. That last one is what makes every hash recorded before this round still reproduce, and it is gated in its own test.

### Consequential trade-offs

- **The round loop changed, in one direction only.** `runRound` gained an optional third parameter defaulting to `null`, and `runFight` now routes its chosen cards through `splitPlays`. Every existing caller compiles and behaves identically. The alternative — leaving casting outside the round entirely — would have made "costing energy from the same 3" a claim with nothing behind it.
- **An energy check was added where there was none.** `checkEnergy` throws on an over-budget round. It cannot fire for a bot, because `selectPlays` caps the spend; it fires for a hand-built round, which is what a UI produces. It is `ARCHITECTURE.md`'s conservation invariant, which had no check.
- **Placements resolve before casts.** The design lists the spend phase as "place units, cast spells, equip the hero" and leaves the order inside it to the player. Fixing it this way is what makes a board-wide buff reach the bodies played that turn.

## Open questions this had to guess at

Three rules the design does not state. Each is a data or one-line change to reverse, and each is gated as it stands, so reversing one goes red rather than passing quietly.

1. **Armour applies to spell damage.** The design says "Armour reduces each incoming *attack*", and a spell is not an attack. Applied anyway, so that "concentrate against armour, spread against a swarm" survives contact with spells — and because armour-piercing spells would be strictly better than attacks and would quietly retire armour. Reversing it is one term in two `apply` cases.
2. **An AoE hits units and never heroes.** AoE is the answer to a wide board; letting it reach heroes makes it a burn spell and a win condition. The design's "the hero is a legal target [owner]" sits under *Targeting*, which is about choosing whom to strike, and an AoE chooses nobody.
3. **An AoE ignores Guard and Ward.** Same reasoning: `legalTargets` is where both live, and it answers "which single entity does this strike". A wide board of Guards is precisely the board AoE is named as the counter to. **This is a decision about Ward's scope and it was taken so that nothing here touches the open question about Ward's *timing*** — that question is untouched, and `startTurn` is unchanged.

Two more, smaller: a board-wide buff reaches the caster's hero (the hero is the rightmost entity of its own line, not a back rank); and a spell that finds nothing to affect fizzles rather than throwing, which is how an attack already answers.

Untouched on purpose, per the assignment: Wake's rule, the worked example's under-specified targeting, and Ward's timing. All three of their tests still pass unchanged.

Worth reporting on Wake even so, because AoE is now the loudest thing that fires it: **it is still inert, and for the same reason.** An AoE kills units on the *opposing* side of whoever cast it, so the Wake it fires still belongs to a side whose `startTurn` runs before it next acts — the player's spell wakes enemy units, and `startTurn(enemy)` clears the +2 later in the same round. AoE makes the trait fire far more often and changes nothing about whether it can be spent.

## Acceptance criteria

- [x] Spells exist as a card type, are cast by the hero, and cost energy from the same three points.
- [x] AoE exists, is one effect, and is the counter to a wide board it is named as.
- [x] The order of the deaths one AoE causes, and of the triggers answering them, is pinned by a test that was watched going red.
- [x] Equipment exists in three fixed slots, replaces within a slot, and resets at the end of every fight.
- [x] No new resolver branch is keyed to a card. Card behaviour is data plus a named verb.
- [x] No new trait, so nothing new counts anything; the cascade rule is untouched.
- [x] `npm run gates` green: 86 tests, up from 55.
- [x] `npm run verify` identical line for line apart from its wall-clock line.
- [x] Every new gate watched going red: 22 mutations, all recorded in `docs/learning/gate-proofs.md`.

## Implementation steps

- [x] `src/engine/state.ts` — the two new card types, the three slots, `equipPower`/`equipArmour`/`armourOf`, `cardCost`, optional `CardPool.castable`.
- [x] `src/engine/resolver.ts` — four verbs, two events, `endFight`.
- [x] `src/engine/cast.ts` — the data-to-verb binder and the two entry points.
- [x] `src/engine/fight.ts` — casts in the round, energy conservation, replay, the end-of-fight reset.
- [x] `src/engine/hash.ts` — equipment in the canonical form, appended only when worn.
- [x] `src/content/cards.ts` — five spells, three pieces of equipment, `PLAYER_DECK_MIXED`.
- [x] `test/spells.test.ts`, `test/equipment.test.ts`, `test/casting.test.ts`.
- [x] Twenty-two red proofs, recorded with their failure text.

## Outcome

Implemented and verified on a branch; **not merged**. `npm run gates` exits 0 with 86 tests. `npm run verify` is byte-identical to the base revision's apart from its wall-clock line, which is the evidence that the unit path is untouched.

### Limitations, stated rather than implied

- **Verified, not reviewed.** No independent review has read this. The resolver's ordering rules are named in `AGENTS.md` as locally high-risk and escalating to independent review, and this round changes `apply` and adds a code path that reaches `checkStateBased` with two deaths at once.
- **Nothing here is a balance claim.** No shipped spell or piece of equipment is in a measured deck, and no measurement has been run over one. Their costs are starting guesses.
- The AoE ordering gates cover one line and one checkpoint. A three-way answer, or one spanning both sides from a single AoE, is not covered.
- The record-format migration is a reader rule, not a real migration: no log has ever been written to a file, so "an older record still loads" is checked against a record built by hand with the field absent.
- `--verify` holding still is evidence about the 400 seeds it runs, all of which draw only units. It says nothing about a fight that casts.
