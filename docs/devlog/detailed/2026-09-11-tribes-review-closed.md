# 2026-09-11 — Closing the tribes review, and a tripwire that never worked

Unit 11's review round, on branch `worktree-agent-aacf45b44fe4cb1d7` cut from `8efbbb2` with `main` at `5f51827` merged in. This is history, not status; `docs/work/11_tribes/plan.md` holds status.

The review passed the resolver work — Chorus goes through one mutation site, announces nothing by hand, is gated on board index, uses a queue rather than a stack, does not recurse, and the act-case ordering is right and gated. It returned six findings, and every one of them is a property that is **true in the shipped code and untested**. Nothing in this round changes what the game does.

## The finding worth remembering

`ARCHITECTURE.md` said, of the inside-one-unit tie-break: `test/resolver-order.test.ts` "pins the *reason*, so the day a second `afterActed` trait is written the test goes red and its author has to gate the order."

That day arrived at `8efbbb2`. Chorus was written into the same `afterActed` branch as Relay. Nothing went red.

The first question was whether the test had been changed. It had not. **It was never able to do what the document claimed.** What it asserted was this:

```ts
const both = f.add('player', card('test:relay+wake', 1, 5, 0, ['relay', 'wake']));
const afterAct = drain(f.state, [{ kind: 'afterAct', uid: both.uid }], makeRng(2, 'combat'));
assert.deepEqual(afterAct.trace.map((e) => e.kind), ['afterAct', 'gainPower']);
```

A fixture body carrying two named traits, asserting one effect comes out of `afterActed`. A *third* trait keyed to `afterActed` does not appear on that body. Its block never runs for that fixture, the trace stays two entries long, and the test passes. The tripwire could only have fired if the author of the new trait had also added the new trait to that fixture's hand-written list — the one edit that author has no reason to make, and the edit the tripwire existed to make unnecessary.

The general shape, which cost this repo twice in one review: **a gate built from a hand-written list of the thing it checks can only see what somebody remembered to write into it.** F3 is the same failure wearing different clothes — `test/tribes.test.ts`'s one-comparison-site check listed the six files in `src/engine/` by name, so adding a seventh file containing exactly the whole-board race count that gate exists to forbid left `npm run gates` at exit 0.

Both are now read rather than written: the trait list comes off the `afterActed` branch's AST, the file list comes off the filesystem through `tsFilesUnder`.

## It is shipped content, not a hypothetical

The comment being corrected said the tie-break was "reachable only through the `extra` seam". It is reachable through a run:

- `si_relay` grants the `relay` trait to a deck card. `attachSigil` refuses only when the card already prints that trait.
- `u_songkeeper` and `u_elflord` print `chorus` and not `relay`, so the refusal does not fire.

The reviewer got there through `runPool` and observed `u_songkeeper#1, tribe elf, traits [chorus, relay]` emitting three buffs in stream order `[right +2 Relay, left +2 Chorus, right +2 Chorus]`. Note that the *entity's* trait array reads `[chorus, relay]` while the emission order is Relay first: the order is the source order of the blocks in `triggersFor`, not the order of the traits on the body. That is exactly the rule the tie-break states, and it is now pinned by a fixture as well as by the AST check, because the two say different things — the AST says which traits are in the branch and in what order, the fixture says what a body carrying two of them actually emits.

## Four mutations that all 230 tests could not see

Each of these was applied to the shipped tree at `8efbbb2` and left the suite green. Each now has a fixture and a red.

**Chorus granting to an adjacent living hero.** Every existing hero gate fights the *count* — what a tribal trait sees when it looks at a hero — which is `adjacentKinOf`'s `isHero` guard. The grant goes through `adjacentAllies`' `isHero` skip, a different function, and nothing had ever read a hero's `bonusPower` after a trait fired beside it. `src/engine/state.ts` said the rule held "both ways round" and `test/tribes.test.ts` said "both directions"; both meant the two polarities of the count, and both were corrected. The board is not a corner case — the rightmost unit's right-hand neighbour is always the hero, so every line ending in a Chorus body is this board.

**`tribalOnAct` moved inside the swing loop.** A Volley body then takes one count before each swing instead of one per act. Invisible because no fixture anywhere gave a tribal trait to a Volley body, and not reachable from shipped content: no tribal card prints Volley, no Volley card prints a tribal trait. The fixture is written for the day a Volley sigil or a Volley tribal card lands.

**Chorus moved from `afterActed` to `acted`.** Death is the only board that separates them. A body that dies to the retaliation its own swing drew never reaches `afterAct`, because `apply` skips an effect naming an entity that has left the board; a trigger on `acted` fires before the swing is applied, so the grant outlives the body and lands on a neighbour that watched it die. Every Chorus fixture before this round was fought into a 0-Power Guard — deliberately, so that nothing in the line dies and the walk is arithmetic — and nothing in the line dying is exactly what hides this. The new fixture ships with a one-Health-more control, so it cannot pass on an engine where Chorus never fires at all.

**`u_songkeeper` changed from elf to human with its id kept.** `hashFight`'s canonical form omits the race deliberately, and the review confirmed that omission is correct: a race is recoverable from `cardId` on every path it could reach. But that rests on `ARCHITECTURE.md`'s "changing a card's race mints a new id", which had no gate. The mutation passed `npm run gates`, `npm run verify` and `npm run verify:run` while changing what Chorus does in every fight that card appears in, and while leaving every hash recorded against `u_songkeeper` claiming to describe a fight it no longer describes. `RACE_OF` in `test/tribes.test.ts` closes it: every shipped card's race written out, pinned and not derived. Derived from the pool it would be the same tautology `verify:run`'s sigil ledger was caught being in its first draft — a check built from the helpers the code under test is built from can only prove the code agrees with itself.

## The document half

The three walked examples parse their *card* numbers out of `docs/design/game.md` through `stated()`, which is what makes the document the source rather than a copy. The Chorus walk's step-by-step running totals — "The wall is on 199", "on 198" — were transcribed and never read, so changing 199 to 198 left the suite green and the document contradicting itself two lines later.

They are bound twice now, and the two bindings do not cover each other:

- against the walk's own subtraction chain, so a total that does not follow from the swing above it is red with the engine untouched;
- against the wall's Health after each step in the engine, so a change in what the engine deals per step is red with the document untouched.

The engine-side assertion is placed *before* the `bonusPower` assertions in that test, because an earlier assertion firing first would leave the later one unreachable and therefore unprovable.

## What was believed and proved false, in the runner

The mutation runner was rebuilt from scratch — the previous round's lived under the ignored `.probe/` path and did not survive the branch. Two of its guards paid for themselves inside an hour.

**A red is a claim about the command.** M3's first draft used `leftNeighbour`, which `src/engine/resolver.ts` does not import. Six tests went red on `ReferenceError: leftNeighbour is not defined`, and because the `expect` string was the loose phrase `'a hero'` — which appears in unrelated test names — the runner reported it as red for its own reason. Tightening `expect` to the assertion's own sentence turned it into the `RED-BUT-NOT-ITS-OWN` it was. The mutation was rewritten to use `rightNeighbour`, which is in scope and is the hero's position anyway.

**A mutation that duplicates is not a mutation that moves.** M6's first draft added an `acted`-keyed Chorus block alongside the `afterActed` one. That doubles every grant and turned six tests red — for the doubling, not for the timing, which would have recorded a gate that does not exist. Moved properly, with the original block deleted, exactly one test goes red: the new fragile-singer fixture. That single red is the reproduction of the reviewer's claim.

**A cleanup step is a command like any other.** M4 creates a new engine file and deletes it afterwards. The first version shelled out to `node -e "require('node:fs').rmSync(...)"`, and the Windows path's backslashes broke the eval string, so `src/engine/tribecheck.ts` was left sitting in the tree. Had that gone unnoticed, the next run would have read a runner failure as a gate failure.

## Numbers

236 tests, from 230 at `8efbbb2`. Eleven mutations, all red for their own reason, with the mutation, the failure and the bound in `docs/learning/gate-proofs.md`.

`npm run verify` is byte-identical to `8efbbb2`'s, line for line apart from `Elapsed`: 66.25% optimal against 56.50% random, gap 9.75 pp (CI 5.61..13.89). That is the check on the whole round — the only `src/` edits are comment text in `resolver.ts` and `state.ts`, and no constant, card, weight or deck was touched. No dependency changed, so the audit gate was not re-run.

`main` was merged into this branch rather than kept out of it, because `npm run gate:work-plans` entered the `npm run gates` chain at `5f51827` and a plan edited without that gate in the chain is a plan nothing checked. Unit 13 touches no `src/`, so the merge cannot have moved `verify`, and the diff confirms it did not.
