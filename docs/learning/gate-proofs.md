# Gate proofs

A gate counts only once it has been made to go red by reintroducing the defect it claims to catch. This file records the mutation, the exact failure it produced, and the bound the gate carries in its own header. Newest first.

Auditing a gate means reaching what was measured at the time, never the sentence the gate carries about itself — a gate and its claim can be wrong together and look exactly like a gate that is right.

Every entry names the revision its numbers were taken at, and a suite total inside a quoted transcript is that revision's, not today's. This is not pedantry: entries written on parallel branches were merged, and the branch that gated the resolver's ordering recorded "of 44" while the branch that added `src/sim/bots.test.ts` recorded "37/37". Their merge `49f017b` is 47, and this round makes it 55. A numerator reproduces; a denominator is a fact about a tree.

## 2026-09-10 — the class layer: Volley, Scorch, and a run that is the class it was started as (`test/hero-attacks.test.ts`, `test/classes.test.ts`)

Taken on branch `worktree-agent-aa48bc3f62599eab6`, cut from `8b4177c`; the suite is **189 tests** here, 164 at the base before the two files were added. `test/hero-attacks.test.ts` is 13 of them and `test/classes.test.ts` is 12.

Both files were written by a worker that died to a rate limit before it could make any of them go red, and both carry `Mutation watched going red:` comments naming a mutation. **Those comments were claims, not evidence.** Every one of the nineteen below was applied to the shipped source at this revision, the shipped test command was run, and the tree was restored and its digest compared before the next mutation. All nineteen went red — the eleven the comments name, and eight more. `src/engine/resolver.ts` hashes `6ca08197…` and `src/engine/state.ts` hashes `72bd14fa…` before the first mutation and after the last.

The commands were `node --test test/hero-attacks.test.ts` and `node --test test/classes.test.ts`. Failure text below is the `node:test` spec reporter's own, trimmed of stack frames.

### The instrument was wrong first, and said so

The runner writes each mutation by replacing an anchor string. Every source file in this repo is CRLF, and the anchors were written with `\n`, so **eight of the first fifteen matched nothing on the first pass** — the single-line ones matched and the multi-line ones did not. The runner asserts each anchor occurs exactly once before writing, so those eight were reported as `BROKEN-MUTATION` rather than run; without that assertion they would have written nothing, run a clean tree, and come back green, and eight gates would have been recorded as unprovable. A no-op edit and a gate that cannot fail produce the same green.

The same guard caught a real ambiguity: `const cls = classOf(content, classId);` appears in both `startRun` and `contentForClass`, so M15's first anchor matched twice and was refused.

### Volley — `src/engine/resolver.ts`

| mutation | site | of 13 | the failure |
|---|---|---|---|
| `swingsOf` returns 1 for everything | `swingsOf` | 6 | "a Volley act is two attacks from one act": `1 !== 2` |
| one `attack` at `power(e) * swingsOf(e)` — the other way to write "swings twice" | `act`, `attack` | 7 | "a Volley unit that dies to its first swing's retaliation never swings again": `one swing landed, not two` — `18 !== 19` |
| both swings applied inside one `apply`, no checkpoint between them | `act`, `attack` | 5 | same test, on the stream: actual `[acted, attacked, retaliated, attacked, retaliated, died]` against expected `[acted, attacked, retaliated, died]` |
| the `e.isHero ? 0 :` guard deleted, so a hero trades on its own swing | `attack` | 2 | "mutual damage applies to a Volley swing as to any other": `a hero takes nothing back on either swing` — `24 !== 30` |

The second and third are the two ways to get Volley wrong, and they fail differently on purpose. Writing it as one doubled swing keeps the event count right and gets the *damage* wrong (`18 !== 19` is the wall taking 2 from a dead body's single swing); writing it as two swings inside one `apply` keeps the damage right and gets the *checkpoint* wrong, letting a body killed by the first retaliation swing again from off the board. Only the shipped shape — two separate `attack` effects — passes both.

**The third mutation also tripped the seed-window guard**, which is the more interesting half. "the second swing lands before any reaction to the first" searches seeds 1..24 for a roll that sends the second swing at the waker, and asserts at the end: `no seed in 1..24 sent the second swing at the waker, so the Health half of this gate did not run`. Under the mutation that is exactly what came back. A gate that cannot tell "passed" from "did not run" reports the second as the first; this one says which happened, and was made to say it.

### Scorch — `src/engine/resolver.ts`

| mutation | site | of 13 | the failure |
|---|---|---|---|
| the `scorch` spawn dropped from the `act` case | `act` | 7 | trace `[act, attack, afterAct]` against expected `[act, attack, scorch, afterAct]` |
| the `t.isHero` filter dropped from the shared loop | `damageAll`/`scorch` | 5 | a third `damaged` appears; the enemy hero burns |
| the `scorch` spawned ahead of the attacks | `act` | 5 | trace `[act, scorch, attack, afterAct]`; the burn kills the Guard before the swing can hit it, and "Scorch follows the swing" fails with both deaths ahead of the `attacked` |
| `effect.kind === 'damageAll'` dropped from the fizzle condition | `damageAll`/`scorch` | 1 | "a Scorch with nothing to burn says nothing": `and said nothing` — a `fizzled` appears between `attacked` and `afterActed` |
| Scorch made to trade, dealing the burned unit's Power back to the burner | `damageAll`/`scorch` | 1 | "Scorch is spell damage on a unit too": `the swing's trade with the Guard, and nothing from the brute` — `1 !== 8` |

The last one is not a mutation the file's own comments name. It was added because "Scorch is spell damage" is the claim the whole shared-loop design rests on, and the comments only covered Scorch being written *as an attack per unit*; this is the narrower defect of keeping the loop and adding a trade inside it. It goes red, so the claim is held by the loop and not by the loop's shape.

### The content — `src/content/classes.ts`

| mutation | site | of 12 | the failure |
|---|---|---|---|
| the two elves removed from the Knight's pool | `KNIGHT.rewards` | 1 | `the Knight's pool has no elf. Class sets the pool and races appear across all of it; the pool holds human, dwarf and the player's cards come in human, dwarf, elf.` |
| the Ranger's hero given Power 2 | `RANGER.hero` | 1 | "the three heroes are the design's three attacks": `2 !== 1` |

The race gate reads the races off `PLAYER_CARDS` rather than listing them, so it asks the question of every class the day a fourth race lands. Today all three pools hold all three player races.

### The run — `src/run/run.ts`

| mutation | site | of 12 | the failure |
|---|---|---|---|
| `replayRun` ignoring `log.classId`, replaying every log as the default class | `replayRun` | 2 | not an assertion but a thrown domain error: `run pool: no deck instance "u_berserker#13" in this run's deck. The deck holds: u_squire#0, … u_avenger#13. An instance id is minted when a card enters the deck and is never reused.` |
| `contentForClass` keeping the full class list | `contentForClass` | 1 | derived class list `[knight, ranger, mage]` against expected `[knight]` |
| `classOf` falling back to the default class instead of throwing | `classOf` | 3 | `Missing expected exception.`, three times |
| `startRun` ignoring `classId` and reading the content's own fields | `startRun` | 5 | `'knight' !== 'ranger'`, and `200 !== 180` where the controller checks the run's own Health bar |

The `replayRun` mutation is the one the coordinator named as load-bearing, and it is worth recording *how* it fails. It does not reach the hash comparison at all: replaying a Ranger's log as a Knight asks the Knight's deck for a card the Ranger drafted, and the deck says so by name. That is a better failure than a hash mismatch, and it is the run pool's error message doing the work rather than the test's.

### The four the comments name that the coordinator's list did not

Run after the first fifteen, to close out every mutation the two files claim for themselves.

| mutation | site | of 12 or 13 | the failure |
|---|---|---|---|
| `CLASSES` reordered to list the Ranger first | `classes.ts:CLASSES` | 5 of 12 | "a log written before classes existed has no class and replays as the Knight": `'ranger' !== 'knight'` |
| the Mage's hero renamed "Wizard" | `classes.ts:MAGE.hero` | 1 of 12 | `the Mage's hero "Wizard" has no class term` |
| `traits: spec.traits` in `makeHero`, aliasing the spec's array | `state.ts:makeHero` | 1 of 13 | `the spec is untouched by a write to the entity`: actual `[volley, scorch]` against expected `[volley]` |
| the class check on resume dropped | `ui/run.ts:createRunController` | 1 of 12 | `Missing expected exception.` |

The first is the one worth knowing about. `defaultClassId` is the first class listed, so the Knight's place at the head of `CLASSES` is what makes every log written before classes existed still replay to the hash it always did — the save-compatibility contract rests on a list's ordering, and reordering that list breaks five tests including the refusal message, which starts naming `ranger, knight, mage`.

### Bound

- Nineteen mutations against two test files at one revision. A gate proven to fail on one defect is not proven to fail on a different one, and nothing here says the two files are complete — only that no claim checked below is held by a gate that cannot go red.
- The engine gates are fixtures, not shipped cards. No id in `test/hero-attacks.test.ts` exists in `src/content`; Volley is pinned at `VOLLEY_SWINGS` (2) and Scorch at `SCORCH_DAMAGE` (1). A shipped card whose Volley interacts with a trait no fixture carries is outside this.
- The class gates are the shipped content, deliberately, and walk seeds 1..6 per class. A property that fails one seed in ten thousand is not covered; `npm run verify:run` covers 200 seeds of the Knight alone.
- The class-pick screen is checked as HTML, not as pixels.
- Nothing here is a claim about balance. See `docs/work/10_classes/plan.md` for the per-class run measurements, and `docs/policies/local-rules.md` for why they are not targets.

## 2026-09-08 — a run a person plays is the run `replayRun` replays (`test/ui-run.test.ts`, `test/map-render.test.ts`)

Taken on branch `worktree-agent-af6686455b89ab68a`, cut from `ea8852c`; the suite is **164 tests** here, 156 at the base. Every mutation below was applied to the stated file, the stated command run, and the tree restored before the next one. The commands were `node --test test/ui-run.test.ts` and `node --test test/map-render.test.ts`.

### The controller, and the one thing it duplicates

`src/ui/run.ts` advances a run by nothing but `replayRun`, and it *previews* an offer by cloning the canonical state and calling the `nodes.ts` function `visit` will call. That duplicates one fact per node type — which draw comes when — and "the controller previews what visit computes and its log replays to runRun's hash" drives the controller with the decisions a bot made inside `runRun` and compares every preview with what the bot was handed.

| mutation | site | what failed |
|---|---|---|
| the shop shelf previewed from a clone stepped one draw forward | `run.ts:travel`, `shop` case | `fixture seed 1 random: shop shelf previewed [t_grunt,t_wall], runRun offered [t_wall,t_grunt]` |
| the recorded reward pick is `(pick + 1) % offer.length`, not the pick shown | `run.ts:pickReward` | the controller's own post-commit check, not the test's comparison: `run: the screen showed the card taken as t_wall and the replay produced t_grunt. The preview in src/ui/run.ts no longer computes what src/run/run.ts visit() computes` |
| the reward offer drawn on the **live** state instead of a clone (`rewardOffer(state)`) | `run.ts:finishFight` | **nothing — all green.** Not a hole in the gate: the live state's advanced generator is discarded by the next `replayRun`, and the offer itself is drawn from the same position the clone would use, so the mutation has no observable effect. The design absorbs it. Recorded so nobody "fixes" the gate for it. |

The blazon half of the same file went red before its fix existed: `blazonFor('u_squire#17', ...)` returned `azure, a eagle argent` against the Squire's `azure, a sword argent`, because `baseId` stripped only `_nc`. Every player card in a run is an instance id, so every one of them was drawn as a hashed stranger until `src/render/blazons.ts` learned the instance separator.

### The map: what it lights and what it says lies beyond a node

| mutation | site | what failed |
|---|---|---|
| `standingOf` loses its `reachable` branch, so no node is ever `is-reachable` | `render/map.ts` | "reachable nodes are the controls, and only they are": `seed 1: buttons — actual 0, expected 1` |
| `spreadFrom` keeps the rows above the root (`map.rows.map(...)` without `.slice(root.row)`) | `render/map.ts` | "what a node says lies beyond it is pathSpread on the sub-map it roots": `seed 1 node 1: "fight" — actual { min: Infinity, max: -Infinity }, expected { min: 2, max: 3 }` |

### The invariant crossing the DOM, measured rather than argued

`tools/ui-probe/run.ts` plays a whole run through the real controls — a lit node, a shelf card, a hand card and a gap, the commit button — with a bot deciding and a headless `createRunController` mirroring every choice, and at the end compares the hash the page prints with `hashRun` of `runRun` on the same seed and agent. This is a probe, not a test in `npm test`, because it needs Chrome:

| seed | theme | outcome | page hash | headless | mirror |
|---|---|---|---|---|---|
| 1 | light | dead after 17 nodes, 11 fights | `156ba9eaa0210673` | `156ba9eaa0210673` | `156ba9eaa0210673` |
| 7 | dark | won after 24 nodes, 14 fights | `94ff2460abecaf26` | `94ff2460abecaf26` | `94ff2460abecaf26` |

### Bound

- The controller gate runs 30 fixture seeds and 12 shipped seeds, each under the greedy and the random route, and asserts its population: 84 runs, every decision kind compared, at least 5 declines, 5 lost fights and 5 won runs. It proves nothing about the DOM, about timing, or about a fight the screen plays differently from `runFight` — that is `test/ui-session.test.ts`'s claim.
- The map gate counts attributes and classes in an SVG string over 40 seeds x 3 acts of the shipped shape. It proves the markup's structure, not what it looks like, and says nothing about `applyMapFocus`, which needs a DOM.
- The probe's hash comparison is two seeds, one bot, one browser. It is evidence that the DOM path and the headless path agree on those; the per-decision gate above is what covers the population.

Taken on branch `worktree-agent-adcc5f0005b2166d6`, the merge of `worktree-agent-a2f9237928772992a` (unit 7) into `02b4e50` (unit 6 integrated); the suite is **156 tests** here, 155 at the merge before these three gates were added and 133 on `main` before the merge. Every mutation below was applied to the stated file, the stated command run, and the tree restored before the next one.

### The compile-time half, which is the whole reason unit 7 built the table this way

Two mutations, `npx tsc --noEmit`, both non-zero:

| mutation | site | what tsc said |
|---|---|---|
| `'echo'` added to the engine's `Trait` union, undocumented | `engine/state.ts` | `glossary.ts(96,14): TS2741: Property 'echo' is missing in type ... but required in type 'Readonly<Record<Trait, Term>>'` |
| `'retaliate'` removed from `IconName` | `render/icons.ts` | four errors, in `glossary.ts`, `icons.ts`, `inspect.ts` and `test/explain.test.ts` |

The second was run while the rejected rule-row design still had a `retaliate` icon; the icon is gone with that design, so the mutation is recorded and is not reproducible at this revision. The first is, and it is the one that matters: it is the same mechanism that named `ward` when the merge removed it.

**The merge itself is this gate's real red proof, and it was not staged.** Unit 7 was cut before Ward left the engine. Merging it produced exactly three type errors — `TRAIT_TERMS.ward`, `IconName`'s `'ward'` with its `ICONS` entry, and two `warded: false` fixtures in this test file — and nothing else in the tree could be wrong about Ward without failing to compile. What the compiler could not see, and what had to be found by reading, was six prose mentions: two file headers, `TRIBE_TERMS.elf` naming a card that no longer exists, and three comments. That contrast is the bound of the whole design: **a type is a gate, a sentence is not.**

### The three new runtime gates, five mutations, `node --test test/explain.test.ts`

| mutation | site | failed, of 23 | which test |
|---|---|---|---|
| the trade dropped from the summary line | `render/inspect.ts:explainCard` | 1 | "every card says that attacking costs, and a hero says it is the exception" |
| the hero given the unit's sentence | `render/inspect.ts:explainCard` | 1 | same |
| the `e.isHero ? 0 :` guard deleted, so a hero takes retaliation on its own swing | `engine/resolver.ts:apply` | 1 | "the trade the panel describes is the trade the resolver runs" |
| `e.health -= dealtBack` neutered | `engine/resolver.ts:apply` | 1 | same |
| one more sentence appended to `NUMBERS_SUMMARY` | `render/glossary.ts` | 1 | "the summary line stays inside the two lines the panel's placement can afford" |

The third and fourth are also covered by `test/trade.test.ts`, deliberately. That file gates the **rule**; these gate the **claim about the rule**, and their failure messages print the sentence the panel is showing the player and say to rewrite it or restore the behaviour. A resolver change that backs out mutual damage should not merely fail a combat test — it should say which tooltip is now a lie.

### The character budget, and why a proxy for a pixel is written down as one

The fifth mutation is the one that would otherwise never have been caught. Unit 7's devlog says it in one line: "Adding a paragraph to `render/inspect.ts` can push it past 270px, at which point it silently starts covering a row again." That failure is silent by construction — the panel places itself in whichever free band it fits, so when none fits it simply covers the board and no test is red.

The first draft of the retaliation copy was a rule row next to Position, and the probe measured what that costs:

| panel | height | covers the hovered card's own row | covers the opposite row |
|---|---|---|---|
| unit 7 at its tip, and this merge before the copy | 266px | 2,341 px² | **0 px²** |
| with a Trade rule row | 318px | **112,062 px²** | 0 px² |
| shipped: the same sentence in the summary paragraph | 266px | 2,341 px² | **0 px²** |

So the gate is on the paragraph, not on the pixel: `explainCard` is rendered for every shipped card and the hero, in both target-chance branches, the `xp__gloss` text is pulled back out of the HTML, and over 235 characters is red.

**235 is a proxy and the test header says so.** It is where that paragraph wraps to a third line in the 532px text column at `--fs-micro`, measured in Chrome at 1440x900 through `npm run probe:ui hover 7 even light`. A font change or a width change moves it, and the probe — not the number — is what says whether the panel still fits. What the gate buys is that the *next* sentence someone adds goes red at 210+26 characters instead of going unnoticed at 318px.

### Bound

Everything in `test/explain.test.ts`'s header still applies. Added by these three:

- The two panel gates read `PLAYER_CARDS`, `ENEMY_CARDS` and `PLAYER_HERO`, and assert on the HTML string. They say nothing about a card outside those arrays and **nothing about pixels** — 235 characters is arithmetic on text, not a measurement of the rendered panel.
- The resolver gate is a two-unit fixture with one Guard and two heroes, one swing each. It says nothing about spells (which do not trade), about armour on retaliation, or about what happens when both die — `test/trade.test.ts` holds those.
- The overlap numbers above are at **1440x900 only**, from `npm run probe:ui hover 7 even light|dark`. Unit 7's own note stands: below about 830px of window height no band is big enough and the panel must cover something.

### What this round could not measure, and did not fake

`npm run probe:ui hover` prints `08-wide-player-unit: no element for #player-row .card` and `narrow` reports "widest line reached: 3" at both `even` and `trivial`. With mutual damage the player's bodies die to the retaliation their own attacks draw, so the line never grows, and unit 7's compression-floor evidence — "19px trait strip in a 44px card, one distinct card top from 1440px down to 380px" — has no state left to be photographed in. The arithmetic gate on `pipIconSize` still holds and still goes red on its own mutation; the picture does not exist at this revision and no substitute was invented for it. It returns when the card pool is re-costed, which is open question 1 of `docs/work/6_trade-and-thin/plan.md`.

### One row of unit 7's own table is stranded by this merge

The entry below records `Ward removed from u_warden, the only card that carries it` failing "no explanation survives the trait it explains". Both the card and the trait are gone, so that mutation cannot be re-applied. The claim it stood for is now carried by the compile-time half — the `Record<Trait, Term>` key, whose red proof is the merge itself, above — and by the same runtime test, which still fails if any documented trait is on no shipped card. The row is left in place rather than edited, because an entry names the revision its numbers were taken at.

## 2026-09-07 — a card explains all of itself, and cannot explain a rule the game no longer has (`test/explain.test.ts`)

Taken at the tip of `worktree-agent-a2f9237928772992a` with this round's changes applied; the suite is **137 tests** here, 117 before it.

The defect this round fixes is not a crash. Every noun in this game is invented — Ward, Wake, Relay, gules, a mullet — and the only place any of them was written down was `docs/design/game.md`, which a player never opens. The owner asking what "Ward", "Wake" and "hue" meant, about mechanics in their own game, is that defect reported.

The failure mode *after* the fix is the quieter one, and it is what this gate is for: an explanation that outlives the rule behind it. A tooltip describing a deleted trait, or quoting a Power number the resolver has since re-tuned, is worse than no tooltip — the player has no way to tell it is wrong, and neither does a reviewer reading the tooltip.

Four mutations were applied one at a time, `node --test test/explain.test.ts` run, and the tree restored after each.

| mutation | site | failed | which test |
|---|---|---|---|
| every tincture's `hatch` set to `'none'` | `heraldry/tinctures.ts:TINCTURES` | 2 of 20 | "two tribe fields on one line are never told apart by hue alone", "hatching is off by default" |
| `Ward` removed from `u_warden`, the only card that carries it | `content/cards.ts:PLAYER_CARDS` | 1 of 20 | "no explanation survives the trait it explains" |
| Relay's sentence retyped as the literal `+2 Power` | `render/glossary.ts:TRAIT_TERMS` | 1 of 20 | "trait rules carry the resolver's own numbers, not retyped ones" |
| `triggersFor`'s Relay branch made to read `e.tribe` | `engine/resolver.ts:triggersFor` | 1 of 20 | "the 'race carries no rule' claim is still true of the resolver" |

### The two that took a second attempt, and why the first attempt was worthless

**Retyping the number.** The first version of the number check asserted only that `TRAIT_TERMS.relay.line` matches `/\+2 Power/`, built from the imported `RELAY_POWER`. Both obvious mutations passed it: retyping the number as a literal passed because the literal happened to equal today's constant, and re-tuning `RELAY_POWER` to 3 passed because the sentence is interpolated and followed it. The check could not tell "derived" from "coincidentally equal" — canon's *a check built from the same symbol as the thing it checks proves only that the code agrees with itself*. The gate now also reads `glossary.ts`'s **source** and requires `${RELAY_POWER}` to appear and `/\+\d+ Power/` not to; that is the half the retype mutation goes red on.

**Scanning source for a literal.** That source scan then failed on a clean tree, on `glossary.ts`'s own header comment, which explains the rule by quoting `"+2 Power"`. This repo has been here before: `gate:banned-apis` reads the TypeScript AST rather than grepping because `src/engine/rng.ts` names all three banned APIs in a comment in order to say it never calls them, and a grep gate reported sixteen violations on a clean tree. The fix here is a `codeOf()` helper that strips comments before scanning, and the same helper now feeds the resolver check.

### The colour-blindness claim, measured rather than asserted

Tribe is carried by field tincture and by nothing else. The distances, in sRGB bytes over 0..441, between the field colours of tribe pairs — the first of which stand **next to each other on the player's own line**:

| pair | sRGB | deuteranopia | protanopia |
|---|---|---|---|
| dwarf (gules) vs elf (vert) | 139.3 | **33.5** | **38.2** |
| elf (vert) vs orc (tenne) | 116.8 | 47.3 | **20.8** |
| dwarf (gules) vs orc (tenne) | 57.0 | **25.6** | 41.0 |

A dwarf and an elf are, to roughly one man in twelve, the same card. The gate's rule is that every pair must be separable by *something*: either the simulated colours stay at least 60 apart, or the two Petra Sancta hatchings differ. Every collapsed pair above differs in hatching, which is why the round added it.

The simulation is an LMS projection and can only ever **fail** a design, never pass one, so the evidence is a picture: `.probe-ui/hover-even-7-light/13-deuteranopia-player-row.png` (hatching off — the dwarf and elf cards are the same olive) against `.probe-ui/hover-even-7-light-hatch/13-deuteranopia-player-row.png` (hatching on — vertical, diagonal and horizontal rules, three distinguishable tribes at the same two colours). Those files are ignored task-run evidence and `npm run probe:ui hover 7 even light [hatch]` regenerates them, which strands this review rather than letting it be inherited.

`cvdMatrix` in `heraldry/tinctures.ts` exists so that the picture and the number cannot disagree: the probe feeds those nine coefficients to `feColorMatrix` in linearRGB, which is the arithmetic `simulate` does. The first version of the probe used a different, cruder approximation, and its two arms differed by more than the variable under test — dwarf and elf came out visibly different in the filtered screenshot while the number said 33.

### Bound

`test/explain.test.ts`'s header carries it. In short: it reads `PLAYER_CARDS` and `ENEMY_CARDS`, and the engine's `Trait` and `Tribe` unions through the glossary's typed tables. It says nothing about a card outside those two arrays, nothing about a trait in the union but on no card, and **nothing about pixels** — it asserts on HTML and SVG strings, never on what a browser draws from them. The compression-floor assertion is arithmetic on `pipIconSize`, not a measurement; the measurement is `npm run probe:ui narrow 7 even light`, which reported a **19px trait strip in a 44px card, one distinct card top at every viewport from 1440px down to 380px**.

## 2026-09-07 — combat is mutual, Ward is gone, decks reshuffle (`test/trade.test.ts` and six retargeted gates)

Taken on branch `worktree-agent-a57a336d565027bad`, cut from `b79abf9`, with this round's changes applied; the suite is **133 tests** here, 117 before it. Every mutation below was applied to the stated file, `node --test` run, and the tree restored before the next one. All sixteen go red.

Three owner rulings changed the rules and a fourth removed a trait, so this is the first round in the repo's history where `npm run verify`'s numbers are *expected* to move. What each gate is bound to is in its own header; the bounds that matter most are collected at the end.

| mutation | site | failed, of 133 |
|---|---|---|
| `attack` drops `e.health -= dealtBack` | `resolver.ts:apply` | 12 |
| retaliation ignores the attacker's `armourOf` | `resolver.ts:apply` | 2 |
| the `e.isHero ? 0 :` guard deleted, so a hero takes retaliation | `resolver.ts:apply` | 6 |
| retaliation guarded by `if (target.health > 0)` | `resolver.ts:apply` | 2 |
| `attack` spawns an `afterAct` for the defender | `resolver.ts:apply` | 9 |
| the `retaliated` event suppressed, damage still applied | `resolver.ts:apply` | 7 |
| `legalTargets` stops narrowing to Guards | `resolver.ts:legalTargets` | 18 |
| the Wake block deleted | `resolver.ts:triggersFor` | 14 |
| a second `afterActed` trait added to the Relay block | `resolver.ts:triggersFor` | 7 |
| `drawTo` stops at the end of the deck instead of reshuffling | `fight.ts:drawTo` | 5 |
| `reshuffle` puts the hand back in the pile too | `fight.ts:reshuffle` | 4 |
| `reshuffle` does not shuffle | `fight.ts:reshuffle` | 2 |
| `queue.shift()` → `queue.pop()` | `resolver.ts:drain` | 19 |
| the checkpoint runs only when the queue empties | `resolver.ts:drain` | 5 |
| buff attribution keeps only the most recent death | `view.ts:buildBeats` | 1 |
| the Relay projection dropped | `odds.ts:projectOwnPhase` | 1 |

### The rule itself: an attack is a trade

`docs/design/game.md`: "When A attacks B, they both do damage to each other." Four separate claims, four mutations, because a single test covering all of them would pass with any one broken.

```
✖ an attack is a trade: the defender deals its own Power back
  AssertionError [ERR_ASSERTION]: and took the defender’s 4 back
    9 !== 5

✖ the attacker’s Armour blunts retaliation exactly as it blunts any hit
  AssertionError [ERR_ASSERTION]: 5 Power against Armour 2 comes back as 3
    4 !== 6

✖ a hero retaliates when struck and takes nothing back when it attacks
  AssertionError [ERR_ASSERTION]: and took none of the brute’s 7 back
    23 !== 30
```

The third is the one asymmetry in the rule and the reason for it is a measurement rather than a preference: a hero swings every turn and cannot be told not to, so retaliation on its own swing is unavoidable chip damage against the bar that carries a whole run. Both halves are in one test on purpose — a hero that stopped retaliating when *struck* would be the safest thing on the board to attack — and the mutation above only reaches the second half, so the first is held by the `29 !== 30` assertion two lines above it.

### Simultaneity, which is a claim about the shape of `apply` and not a comment

The mutation is the one an implementation that had not read `ARCHITECTURE.md` would write: let the defender's death cancel its own blow.

```
✖ both blows land before either is checked, so neither death cancels the other
  AssertionError [ERR_ASSERTION]: one effect, one checkpoint, both deaths together
  + actual - expected
      [
        'attacked',
        'retaliated',
        'died',
  -     'died'
      ]
```

Both entities are lethal to the other; both must die, at one checkpoint, in `checkStateBased`'s own board order. That is the property `ARCHITECTURE.md` batches deaths for — "A kills B, B's death trigger kills A, but A already acted" must not depend on evaluation order — and mutual damage is the first shipped effect where a player can watch it happen.

### Retaliation is not an action, and it is not invisible either

Two different mistakes with the same shape. Making the defender's answer spawn an `afterAct`:

```
✖ retaliation is not an action: the defender fires no after-acting trait
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
      [
        'attacked',
        'retaliated',
  +     'afterActed'
      ]
```

and suppressing the `retaliated` event while still applying the damage:

```
✖ an attack is a trade: the defender deals its own Power back
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      [
        'attacked',
  -     'retaliated'
      ]
```

The second matters more than it looks. `ARCHITECTURE.md` makes the event stream the render contract: the view derives its own state from events and never diffs two boards. Damage that lands without an event is damage the screen cannot show, and the whole-suite run of that mutation is 7 tests, not 1 — the view-drift gate catches it independently:

```
✖ the view derived from the event stream matches the engine, every phase
  AssertionError [ERR_ASSERTION]: seed 1/even round 1: the view derived from the player
    phase's events disagrees with the engine's state
    + [ 'uid 5 health: view 2, engine 4', 'uid 4 health: view 1, engine 3' ]
```

### Wake, and the reason a fixture could not have proved this

The defect being retired, from `docs/devlog/summary.md` (2026-09-06): *"ablating Wake changed the outcome of not one fight in 20,000, because a player unit can only die while the enemy is attacking and the enemy attacks after the player's whole line has resolved."*

That defect was invisible to every fixture, because Wake **fired correctly**. `startTurn` cleared the +2 before the woken unit could spend it. A test asserting that Wake fires passed against it for the whole life of the trait, and one is still in `test/rules.test.ts`.

So there are two new tests and neither is that test. The first asserts the woken unit **swings** at its raised Power:

```
✖ Wake reaches a swing: the +2 is spent inside the same phase it was granted
  AssertionError [ERR_ASSERTION]: the woken unit swung at 2 printed + 2 from Wake
  + actual - expected
      [
  +     2
  -     4
      ]
```

The second is an ablation over 200 real fights at `even`, comparing the shipped deck against the same deck with Wake stripped, and requiring some fight to come out differently. It compares outcomes and round counts, never `hashFight`: the hash serialises an entity's trait list, so it differs across any ablation whether or not the trait did anything — a lesson recorded in this file's 2026-09-06 entries and applied here.

**Wake is alive.** Beyond the gate, `npm run measure:ablate` over 4,000 seeds at a matched 40% baseline puts it at 4.28 pp of the placement gap on its own and 2.46 pp against the intact deck. The old figure was zero outcomes changed in 20,000 fights.

### The reshuffle, and the state it deliberately does not add

There is no `discard` field. `reshuffle` is only ever called with the cursor at the end of the deck, so every card has been drawn and the discard is exactly `deck` minus `hand` as multisets. That is what the second mutation attacks:

```
✖ a deck that runs out reshuffles its discard and keeps drawing
  AssertionError [ERR_ASSERTION]: the last undrawn card plus three from the reshuffle
    2 !== 5

✖ the reshuffled pile is the deck minus the hand, one instance per held card
  AssertionError [ERR_ASSERTION]: the reshuffled pile is the six cards minus the two that
    were in hand at the time
    6 !== 4

✖ the reshuffle runs on the deck stream, never on the combat stream
  AssertionError [ERR_ASSERTION]: the reshuffle took draws from the deck stream
```

The third is stream separation, which is what keeps the A/B measurement paired, and it is checked by reading both generators' draw counts rather than by arguing from the call site. A fourth test holds the termination case that can actually spin — a deck smaller than the hand, where the reshuffle produces nothing.

### Six gates that used Ward to build a fixture, and needed a different one

`docs/learning/gate-proofs.md` warned that several gates use Ward *incidentally*. Each was retargeted rather than deleted, and each still goes red:

- **"it is a queue, not a stack"** used a `grantWard` queued ahead of an `attack`, because a ward applied first left the attacker no target. It now queues a `gainPower` ahead of the attack: applied first the attacker swings at 5 and kills, applied second it swings at its printed 1 and the target lives.
- **"an attack with no legal target fizzles"** (in `test/rules.test.ts`) and **"a single-target spell with no legal target fizzles"** (in `test/spells.test.ts`) both emptied the pool by warding the only Guard. The remaining route is a side with nothing alive on it, which is the real state between a lethal hit and the checkpoint that ends the fight: a dead hero stays on the board and `legalTargets` still skips it.
- **"Ward removes the unit to my right from the target pool"** became **"Guard is the only rule that narrows the pool"**, which holds both halves — Guard narrows, and with the Guard gone every living entity is back in the pool, hero included.

```
✖ Guard is the only rule that narrows the pool: nothing else removes an entity
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
      [
  +     2,
        3,
        4,
  +     5
      ]
```

- **"an AoE consults no target-selection rule: Guard and Ward do not narrow it"** lost its Ward half and keeps the Guard half, which is the half the claim was about.
- **`test/render-view.test.ts`'s projection gate** lost its Ward half for a different reason: the Ward half existed because the odds on screen were *wrong* without it. That failure mode is gone with the trait. Its Relay half survives and still goes red.

### The gate that could not be retargeted, and is recorded as lost

**"inside one unit, traits fire in the source order of the `if` blocks in `triggersFor`"** was gated by a unit carrying both Relay and Ward, which are the only two shipped traits that ever keyed on the same event. With Ward gone the two remaining shipped triggers key on *different* events — `afterActed` and `died` — so no card and no seam rule can make two shipped blocks answer one event. **The property is currently unobservable and the gate is gone.**

What replaced it pins the reason instead: a unit carrying both Relay and Wake gets exactly one effect out of each event, never two out of one. Adding a second `afterActed` trait makes it red, which is the moment somebody has to write the order gate back:

```
✖ the two shipped triggers key on different events, so no unit fires both at once
  AssertionError [ERR_ASSERTION]: afterActed reaches Relay and nothing else
  + actual - expected
      [
        'afterAct',
        'gainPower',
  +     'gainPower'
      ]
```

`ARCHITECTURE.md` now says the rule is unreachable rather than implying a gate holds it. This is the honest version and it is weaker than what it replaced; it is written down here so an audit does not have to rediscover it.

### The render gate that mutual damage broke before it gated it

Buff attribution reconstructs which trait granted a `powerGained` from the position of the event in the stream, because the event carries no `sourceUid`. It kept **one** death. Mutual damage makes one attack put two entities at zero at one checkpoint, so a single effect emits two `died` events and then the Wake triggers answering them — and the first death's Wake matched nothing.

```
✖ the view derived from the event stream matches the engine, every phase
  AssertionError [ERR_ASSERTION]: seed 7/even round 1: a +2 buff on uid 5 could not be
    attributed to the card that granted it, so the animation would have nothing to draw
    an arrow from
```

Found by the existing gate on the first run after the rule changed, which is the gate doing its job. Fixed by keeping every death in the phase and taking the newest match.

### The gate that went red for real, and what it caught

`npm run verify:run` failed on the first full-gate run after the three rules landed, with the content untouched:

```
- The instrument can see a difference: FAIL; the strongest arm won 0/200 and runs ended
  after 3 distinct act counts. Enforced: --verify exits non-zero.

FAIL: the run measurement is not trustworthy over 200 seeds.
  - no run in 200 seeds was won, so this seed window cannot detect a change that makes the
    run easier and every "win rate per act" below act 1 is a floor reading.
```

**Nothing was too hard.** Every shipped encounter still won 87-100% of the time in isolation at full Health; what had changed was the Health economy. Both new rules push the same way — your bodies die to the retaliation their own attacks draw, so the line protecting the hero thins faster, and the enemy's deck no longer runs dry, so it keeps fielding bodies for the whole fight. The measured cost of a won fight roughly doubled. `RUN_HERO.health` moved 80 → 200, by the same rule it was set by the first time, and the gate went green at 106/1000. That is the degeneracy gate earning its place: it is deliberately not a win-rate band, and a band would have been the wrong instrument here.

### What this round does not prove

- **The four preset encounters are no longer centred and were deliberately not re-tuned.** `even` was chosen so both arms straddle 50%; it now runs 66.5% against 58.1%, `easy` is 96.9/95.1 and `trivial` is 99.7/99.6. The headline gap is therefore measured above centre and compressed by the ceiling — 8.38 pp at `even` against 9.28 pp at a baseline matched back to 40% by `npm run measure:ablate`. Re-centring is a content change and it would have made the rules change unmeasurable against an unmoved content set.
- **The measured deck lost two cards and gained none.** The Elf Warden was the only card carrying Ward, so `PLAYER_DECK` is 18 rather than 20 and the run's starting deck is 14 rather than 16. Nothing was minted to hold the slots, because inventing a card to fill a deck is a balance decision. Every before-and-after comparison in this entry therefore differs by two cards as well as by three rules, and no attempt is made here to separate them.
- **`npm run measure:ablate` is new and has no red proof of its own.** It is an instrument rather than a gate — it exits 0 whatever it finds — and its calibration arm is Bot B alone, never Bot A, so it cannot tune the difficulty until the thing being measured has a chosen value. Its bisection converges to a *pair* of adjacent Health values and reports both, so a local inversion in the sampled win rate shows as a bracket rather than being hidden.
- **The reshuffle gates are bound to `handSize` 5 and to `PLAYER_DECK` at 18 cards.** The determinism half runs 60 seeds at `hard` and refuses to report success unless some fight in the window actually reshuffled; it says nothing about a deck of 200 cards or a hand of 1.
- **Nothing here was reviewed.** Sixteen mutations is evidence about the gates, not about the design.

## 2026-09-07 — spells and equipment, and the AoE that makes simultaneous-death order visible (`test/spells.test.ts`, `test/equipment.test.ts`, `test/casting.test.ts`)

Taken at `06c87c7` with this round's changes applied; the suite is **86 tests** here, 55 before it.

`docs/design/game.md` has three card types and only units existed. This round adds the other two and the four effect verbs they need — `damageOne`, `damageAll`, `buffAll`, `equip` — plus the end-of-fight equipment reset. Twenty-two mutations were applied one at a time, `node --test` run over the whole suite, and the tree restored after each. Every one goes red, and the table records which tests see it.

| mutation | site | failed, of 86 | which |
|---|---|---|---|
| `checkStateBased` index loop reversed | `resolver.ts:checkStateBased` | 2 | the AoE board-order test and the existing fixture one |
| `damageAll` marks the dead inside its own loop | `resolver.ts:apply` | 3 | one-effect-one-checkpoint, AoE board order, enemy casting |
| `damageAll` no longer skips heroes | `resolver.ts:apply` | 6 | five AoE tests and enemy casting |
| `damageAll` filtered through `legalTargets` | `resolver.ts:apply` | 1 | AoE consults no target-selection rule |
| `damageAll` drops the armour term | `resolver.ts:apply` | 1 | AoE armour, per target |
| `damageOne` picks from every living defender | `resolver.ts:apply` | 2 | bolt targeting, bolt fizzle |
| `damageOne` drops the armour term | `resolver.ts:apply` | 1 | bolt damage |
| `buffAll` skips heroes | `resolver.ts:apply` | 4 | the buff tests and both spell-order tests |
| `equip` refuses to overwrite a filled slot | `resolver.ts:apply` | 1 | slot replacement |
| `equip` ignores the item's own slot | `resolver.ts:apply` | 2 | slot independence, end-of-fight reset |
| `equip` drops the no-slots guard | `resolver.ts:apply` | 1 | equipping a unit |
| `attack` reads `target.armour` again instead of `armourOf` | `resolver.ts:apply` | 1 | worn Armour |
| `power()` drops `equipPower` | `state.ts:power` | 6 | every equipment test that reads a number |
| `cloneEntity` shares the slots object | `state.ts:cloneEntity` | 1 | the clone test |
| `spellQueue` builds its effects in reverse | `cast.ts:spellQueue` | 2 | spell order, verb binding |
| `spellQueue` drops the `buffAll` case | `cast.ts:spellQueue` | 5 | every buff test and verb binding |
| `runRound` no longer checks the energy budget | `fight.ts:runRound` | 2 | conservation, and the third arm of the message test |
| casts applied before placements | `fight.ts:runRound` | 1 | placements-before-casts |
| `settleResult` no longer calls `endFight` | `fight.ts:settleResult` | 1 | a fight that ends armed |
| `replayFight` drops the `casts` argument | `fight.ts:replayFight` | 1 | replay over the mixed deck |
| `splitPlays` inverts its branch | `fight.ts:splitPlays` | 17 | its own test plus every fight-level test in the suite |
| the equipment segment appended unconditionally | `hash.ts:entityToCanonical` | 1 | the canonical-form test |

### The one the round exists for: AoE makes simultaneous-death order player-visible

Before this, nothing in the game put two units at zero Health in a single effect. The order two simultaneous deaths are announced in was gated — in the entry below — but only through a fixture with a unit parked at zero Health, which is the *state* AoE produces and is not AoE. One Firestorm now reaches it, and what a player watches is two units waking in the order they stand.

The fixture is two corpse-and-waker pairs on one enemy line, built right to left so uid order is the exact reverse of board order, killed by one `damageAll 4`. Mutation: `checkStateBased`'s index loop walked backwards.

```
✖ two Wake units answering one AoE gain Power in board order
  AssertionError [ERR_ASSERTION]: one AoE, two deaths, announced left to right
    actual: [ 4, 6 ], expected: [ 6, 4 ]
✖ two deaths on one line at one checkpoint are announced left to right
ℹ tests 86   ℹ pass 84   ℹ fail 2
```

The test asserts the `died` order and then the `powerGained` order, because the second is the part a player sees: the same two deaths and the same final Power, in a different order down the event stream the animation layer replays.

### An AoE is one effect, and that is what puts both deaths at one checkpoint

`ARCHITECTURE.md`: "Health is checked at defined checkpoints, not the instant damage lands." AoE is the first shipped effect where that is observable. The mutation is the one an implementation that had not read the contract would write — mark the dead inside `damageAll`'s own loop:

```ts
        t.health -= dealt;
        events.push({ kind: 'damaged', ... });
        if (t.health <= 0) { t.alive = false; events.push({ kind: 'died', ... }); }   // added
```

```
✖ an AoE is one effect: every target is damaged before any death is announced
  AssertionError [ERR_ASSERTION]: all four hits land, then the checkpoint announces both deaths, then the wakes answer
    actual:   [ 'damaged', 'died', 'damaged', 'damaged', 'died', 'damaged' ]
    expected: [ 'damaged', 'damaged', 'damaged', 'damaged', 'died', 'died', 'powerGained', 'powerGained' ]
✖ two Wake units answering one AoE gain Power in board order
✖ the enemy spends on spells too, not only on bodies
ℹ tests 86   ℹ pass 83   ℹ fail 3
```

Two things in that diff rather than one: the deaths interleave with the damage, **and** both Wake triggers vanish entirely, because a death announced by hand never reaches `triggersFor`. Splitting one AoE into one effect per target is the same defect wearing different clothes and the same test catches it.

### The verbs, one mutation each

`damageAll` consults no target-selection rule — `legalTargets` is where Guard and Ward live, and it answers "which single entity does this strike". Filtering the AoE through it:

```
✖ an AoE consults no target-selection rule: Guard and Ward do not narrow it
  AssertionError [ERR_ASSERTION]: and so is the unit the Guard would otherwise have covered
    actual: 9, expected: 7
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

Armour still applies, per target, so the design's "concentrate against armour, spread against a swarm" inversion survives contact with spells. Dropping the armour term from `damageAll`:

```
✖ an AoE subtracts each target’s own Armour, so it is blunted unit by unit
  AssertionError [ERR_ASSERTION]: flat per target, to a minimum of zero
    actual: [ 3, 3, 3 ], expected: [ 3, 1, 0 ]
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

`damageOne` picks the way an attack does. Pointing it at every living defender instead of at `legalTargets` breaks both the Guard half and the fizzle half:

```
✖ single-target spell damage picks the way an attack does: Guard narrows the pool
  AssertionError [ERR_ASSERTION]: the only Guard is the only legal target
    actual: [ 4, 3, 2 ], expected: [ 3 ]
✖ a single-target spell with no legal target fizzles rather than throwing
ℹ tests 86   ℹ pass 84   ℹ fail 2
```

`buffAll` reaches the hero, which `damageAll` deliberately does not. Skipping heroes there:

```
✖ a board-wide buff reaches every living unit on the caster’s line and the hero
  AssertionError [ERR_ASSERTION]: left to right along the caster’s own line, hero last because the hero stands last
    actual: [ 3, 4 ], expected: [ 3, 4, 1 ]
ℹ tests 86   ℹ pass 82   ℹ fail 4
```

`spellQueue` is the one place a card's data becomes an effect, so both ways it can be wrong are gated: order, and a dropped verb. Reversing the array, and separately deleting the `buffAll` case:

```
✖ a spell’s effects resolve in the order they are written
    actual: [ 'buffAll', 'damageAll' ], expected: [ 'damageAll', 'buffAll' ]
✖ every verb a spell can name is bound to an effect, and the shipped spells only name those
    actual: [ 'damageOne', 'damageAll', 'gainPower' ]
    expected: [ 'damageOne', 'damageAll', 'buffAll', 'gainPower' ]
```

The second is the `AGENTS.md` invariant — card behaviour is data plus a named effect — as an assertion: one effect out per spec in, over the cards actually shipped. A card naming a verb the binder silently drops is the failure it catches.

### Equipment: the worked example's own third card, and the reset

`docs/design/game.md`'s worked example gives the Knight an Iron Sword (weapon, hero +3 Power) against a Stone Troll with Armour 2, and says 5 Power − 2 armour = 3 damage. Until this round that line could only be run by giving the Knight base Power 5, which is what `test/worked-example.test.ts` says in its own header. It now runs with the shipped card at its printed numbers. Mutation: `equipPower(e)` dropped from `power()`.

```
✖ the worked example’s Iron Sword: the Knight swings at 2 base + 3 sword, for 3 through Armour 2
  AssertionError [ERR_ASSERTION]: 2 base + 3 sword
    actual: 2, expected: 5
ℹ tests 86   ℹ pass 80   ℹ fail 6
```

Equipment is a summand in `power()` and `armourOf()` rather than a write to `basePower`, so taking a piece off is exact by construction and `basePower` keeps meaning "printed". A unit has no slots at all rather than three empty ones, and dropping that guard is a crash rather than a wrong number:

```
✖ a unit has no slots at all, so equipping one is skipped rather than thrown at
  TypeError: Cannot read properties of null (reading 'weapon')
      at apply (src/engine/resolver.ts:297:35)
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

"Equipment resets at the end of every fight" is reached through `runRound`, the one round code path, rather than by calling `endFight` directly — so the test pins that the reset is wired in at all. Mutation: the `endFight` call deleted from `settleResult`.

```
✖ a fight that ends with the hero armed leaves it unarmed
  AssertionError [ERR_ASSERTION]: the fight is over, so the sword is off
    actual: { weapon: { id: 'test:sword', ... }, armour: null, trinket: null }
    expected: { weapon: null, armour: null, trinket: null }
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

### The additive claim, and the gate that holds it

Everything above is an addition, and the claim that it is one rests on a single property: **an entity wearing nothing serialises exactly as it did before equipment existed**. `entityToCanonical` appends its equipment segment only when something is worn, and an empty set of slots is the same string as no slots at all. Mutation: append it unconditionally.

```
✖ an entity wearing nothing serialises exactly as it did before equipment existed
  AssertionError [ERR_ASSERTION]: nothing is worn, so nothing about equipment is in the canonical form
    actual: true, expected: false
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

**Behaviour held still, and this is the evidence for it.** `npm run verify` before and after the whole round is **identical line for line apart from its wall-clock line** — same 400-seed arms, same 2,454 compared rounds, same 2,167/4,238 differing placements, same 40 distinct final hashes, same 15.25 pp gap (CI 10.06..20.44), same four-encounter sweep, same negative control, same greedy-vs-exhaustive row. The shipped spells and equipment are deliberately absent from `PLAYER_DECK`, so no fight the measurement runs draws one, and the canonical form of a fight that draws none is byte-identical to what it was.

### Conservation, and the record format

`ARCHITECTURE.md` lists conservation — energy spent never exceeds energy available — among the invariants that should hold over every game, and it had no check. `selectPlays` caps the spend so a bot never breaks it; a hand-built round is where it can be broken, and a UI is a hand-built round. Mutation: the `checkEnergy` call deleted.

```
✖ units, spells and equipment all draw from the same three energy
  AssertionError [ERR_ASSERTION]: Missing expected exception.
    expected: /spends 4 energy on 1 unit\(s\) and 2 cast\(s\), but a side has 3 per turn\./
ℹ tests 86   ℹ pass 84   ℹ fail 2
```

The second failure there is worth naming rather than hiding: the third arm of "casting says which input was wrong" asserts that an id the pool has never heard of surfaces the **pool's** message, and it does so because `checkEnergy` has to price the card before anything else touches it. Remove the check and that id reaches the "not in hand" message instead. The two tests are coupled through the order of the two errors, and that coupling is real behaviour rather than a test artefact.

`RoundRecord` gained an optional `casts` field, and it is left off rather than set to `[]` when a round casts nothing — so a record from a unit-only fight is exactly the record it was before spells existed. The reader's rule is `rec.casts ?? []`. Dropping the argument from `replayFight`'s `runRound` call replays the placements and casts nothing, which desynchronises the hand within one round:

```
✖ a fight that casts replays byte-identically from its recorded action list
  Error: fight: cannot play "u_shieldbearer" - it is not in hand [s_bolt, q_iron_sword, s_volley, u_captain, u_hornblower]
ℹ tests 86   ℹ pass 85   ℹ fail 1
```

That test runs 25 fights over `PLAYER_DECK_MIXED` and asserts more than 20 rounds actually cast something before it reports success, so a green run cannot mean "the deck never drew a spell".

### What this round does not prove

The AoE ordering tests use two corpse-and-waker pairs on **one** line at **one** checkpoint. A three-way answer, or one spanning both sides from a single AoE, is not covered — the cross-side case is still only gated by the fixture test in the entry below.

The replay and determinism evidence is bound to `PLAYER_DECK_MIXED` over 25 seeds. That deck is not the measured one, on purpose, so none of it is evidence about balance: what a spell costs, and whether any of them belongs in a deck, is untested and is the content-and-balance node's question.

`npm run verify` holding still is evidence that the additions are inert on the path the measurement runs, not that they are correct on the path it does not. The measurement never draws a spell, so it can say nothing about one.

Three decisions inside these gates are guesses that the owner may want to reverse, and each is a data or one-line change rather than a redesign: that Armour applies to spell damage, that an AoE hits units and never heroes, and that an AoE ignores Guard and Ward. They are recorded in `docs/work/4_spells-equipment/plan.md`.
## 2026-09-07 — the run's gates: thirteen mutations, `test/run.test.ts` and `npm run verify:run`

Taken on branch `worktree-agent-a75f26c8bed784808`, cut from `06c87c7`, with unit 5's changes applied. The suite is **78 tests** here, 55 before it; `test/run.test.ts` contributes 23. Every mutation below was applied to the stated file, the stated command run, and the tree restored.

Two gates are new, and they are bounded differently on purpose:

- **`test/run.test.ts`** splits by what it is bound to. Structure tests run against the shipped `RUN_CONTENT` — claims about the generator and the loop that a rebalance must not move, and none of them asserts a win rate or a Health total. Behaviour tests run against a fixture: four rows, three cards, one enemy. A behaviour test built on shipped content would go red the day the owner retunes an encounter, which is how a gate gets deleted rather than fixed.
- **`npm run verify:run`** gates structure and stream separation over 200 seeds and deliberately gates **no win rate**. A band around a run win rate is a claim about the router, and it would go red on a content change that improved the game. What it does gate is that the outcome distribution is not a fixed point — every run won, or none — which is the run's counterpart to "a constant hash would pass determinism and mean nothing".

| mutation | site | red in | failed, of 78 |
|---|---|---|---|
| the extra right-hand edge skips its monotonicity check | `map.ts:generateAct` | `node --test` | 1 |
| a row's types drawn with replacement (`pool.splice` removed) | `map.ts:drawDistinctTypes` | `node --test` | 1 |
| every row one node wide | `map.ts:rowWidth` | `node --test`, `verify:run` | 2 |
| `pathSpread`'s min branch takes `Math.max` | `map.ts:pathSpread` | `node --test` | 2 |
| the act map regenerated lazily from the run generator | `run.ts:currentMap` | `node --test` | 8 |
| the fight seed mixes in the run generator's draw count | `nodes.ts:fightSeedFor` | `node --test`, `verify:run` | 1 |
| hero Health not written back out of a fight | `run.ts:visit` | `node --test` | 1 |
| the run pool ignores a card's permanent bonuses | `deck.ts:resolveDeckCard` | `node --test` | 1 |
| replay reads the reward choice and returns 0 | `run.ts:replayRun` | `node --test`, `verify:run` | 1 |
| replay stops one node before the end | `run.ts:replayRun` | `node --test`, `verify:run` | 1 |
| replay accepts a travel choice the map does not offer | `run.ts:replayRun` | `node --test` | 1 |
| the run agent carries one generator across calls | `runbots.ts:rngFor` | `node --test` | 1 |
| instance numbers not advanced (`run.nextInstance++` removed) | `nodes.ts:addCard` | `node --test` | 1 |
| a won boss grants a hero sigil | `run.ts:visit` | `node --test` | 1 |
| the act-3 boss made unwinnable (999 Health, 14-card deck) | `content.ts` | `verify:run` | — |

### The map's three structural rules, each pinned separately

Planarity, coverage and "no two nodes in one row share a type" are three claims in one gate, so each is made to fail on its own. Dropping the monotonicity check on the right-hand extra edge:

```
✖ every generated act map is reachable both ways, planar, and ends in one boss
  AssertionError [ERR_ASSERTION]: seed 1 act 1: row 2: the edges from node 3 and node 4 cross
    (1 > 0); the map is not planar and left/right stops meaning anything
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

Drawing a row's types with replacement:

```
✖ every generated act map is reachable both ways, planar, and ends in one boss
  AssertionError [ERR_ASSERTION]: seed 1 act 1: row 2 holds two "fight" nodes; a row's nodes
    must differ, or the row is not a choice; row 6 holds two "rest" nodes; ...
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

### "A map where every path is equivalent is not a map", and the instrument under it

The branching gate is built on `pathSpread`, so `pathSpread` needs a gate of its own — a min/max DP that quietly returned the entry node's own counts would make every map look decorative, and one that returned the whole map's counts would make every map look branchy. It is checked against brute-force path enumeration on eight generated maps.

Narrowing every row to one node makes the map a single path:

```
✖ a map where every path is equivalent is not a map: every act decides node types
  AssertionError [ERR_ASSERTION]: seed 1 act 1: every path carries the same node types, so the
    branching is decorative
ℹ tests 78   ℹ pass 76   ℹ fail 2
```

and the same mutation against `npm run verify:run`:

```
- The map is a map: FAIL; 0.00 of 7 node types are decided by the route on an average act map,
  and 60 map(s) had none.
FAIL: the run measurement is not trustworthy over 200 seeds.
  - 60 act map(s) where every path carries the same node types - a map where every path is
    equivalent is not a map
```

Turning `pathSpread`'s min branch into a max takes both the instrument's own gate and the gate built on it:

```
✖ pathSpread agrees with brute-force path enumeration on a small map
  AssertionError [ERR_ASSERTION]: seed 1: pathSpread disagrees with enumeration for "fight"
✖ a map where every path is equivalent is not a map: every act decides node types
ℹ tests 78   ℹ pass 76   ℹ fail 2
```

### The cheap version of "the map is a function of the seed" catches nothing

The first version of that test perturbed `run.rng` after `startRun` and compared `hashMaps`. **It cannot fail against the defect it names.** The maps are already in `run.maps` by then, so burning draws on the generator can never move them, whatever the loop does with the map afterwards — including regenerating it lazily on every call, which is the realistic version of the bug.

What catches that is comparing what two differently-routed runs actually *walked* against the map the seed produces at setup. With `currentMap` regenerating from `run.rng`:

```
✖ the map is generated once at setup, and no route changes what a node is
✖ same seed and same agent produce an identical final run hash, over many trials
✖ seed plus choice list replays a whole run, with no agent in the loop
✖ run hashes vary with the seed - a constant hash would pass determinism and mean nothing
✖ a run agent holds no state between runs: a warmed instance matches a fresh one
✖ a node's fight is a function of the node, not of the route taken to reach it
✖ deck instance ids are unique and are never reused within a run
✖ sigils stay out of scope: no run this unit can generate grants one
ℹ tests 23   ℹ pass 15   ℹ fail 8       (test/run.test.ts alone)
```

The recorded assertion under the mutation is `run: node 18 in act 1 leads nowhere and is not a boss node` — a regenerated map's node 18 is a leaf in a map the run was not walking.

### Stream separation: the run generator cannot reach a fight

Mixing the run generator's draw count into the fight seed is the smallest realistic form of the leak.

```
✖ a node's fight is a function of the node, not of the route taken to reach it
  AssertionError [ERR_ASSERTION]: seed 1 act 1 node 0: the run stream moved the fight seed
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

and against `npm run verify:run`, where the second half of the check — two routes through one seed agreeing on every shared node — also drops:

```
- Stream separation: FAIL; burning 37 draws on the run generator moved 47 fight seed(s) or
  map(s). Two differently-routed runs agreed on 49/88 shared fight seeds.
FAIL: the run measurement is not trustworthy over 200 seeds.
  - stream separation broke: seed 1 act 1 node 0: the fight seed moved when the run stream did,
    so a routing choice can perturb a fight's internals
```

The two halves are both there because they fail differently: burning draws catches a fight seeded off a *derivation* of the generator's position, which the route comparison would miss on two routes that happen to consume the same number of draws; the route comparison catches a fight seeded off `run.rng` directly even if the derivation is stable.

### Health carries, and the version of that test that could not see it

The first version asserted that a won fight never *raised* the hero's Health. Dropping the write-back entirely leaves Health at its maximum for the whole run, which never rises, so **that assertion passes against the defect it is named for.** The test now runs a fixture with no Guard in the deck against a hero that swings for five, so the player wins and must have been hit, and it asserts that some fight in the window actually cost Health:

```
✖ what is left of the hero after a fight is what the next fight starts with
  AssertionError [ERR_ASSERTION]: no fight in the window cost the hero any Health, so
    "Health carries" was never observed
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

### The forge reaching the fight

`docs/design/game.md`: "Forge nodes permanently upgrade one card: +1 Power, +1 Health, or −1 cost." The claim that matters is not that the bonus is stored but that it arrives at `makeUnit`. Making `resolveDeckCard` drop the bonuses:

```
✖ the forge permanently upgrades one deck card, and the next fight is fought with it
  AssertionError [ERR_ASSERTION]: +1 Power did not reach the fight
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

The same test asserts the *other* copy of the same card id is untouched — the forge upgrades a card, not a card id — and a separate test pins the cost floor at zero.

### Replay is a check, not a second opinion

Three mutations, because replay can fail loudly, quietly, or by not checking. Reading the recorded reward and returning 0 instead diverges the deck, and the recorded fight action list then names a card that is not in hand:

```
✖ seed plus choice list replays a whole run, with no agent in the loop
  Error: fight: cannot play "u_ironguard#17" - it is not in hand
    [u_shieldbearer#17, u_berserker#10, u_warden#12, u_ironguard#14, u_pikeman#8]
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

Stopping one node early is the quiet version — no crash, just a different final state — and it is what exercises the hash comparison rather than the engine's own guard:

```
✖ seed plus choice list replays a whole run, with no agent in the loop
  AssertionError [ERR_ASSERTION]: seed 1 did not replay
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

```
- seed 2: replay from the choice list diverged from the live run
FAIL: the run measurement is not trustworthy over 200 seeds.
  - a run did not replay from its own choice list
```

And accepting any travel choice rather than the recorded one — the version where replay stops checking that the map regenerated identically:

```
✖ replay refuses a travel choice that the regenerated map does not offer
  AssertionError [ERR_ASSERTION]: Missing expected exception.
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

### The stateless-agent rule, carried over from `bots.ts`

`src/sim/bots.ts` states it for placement policies: a policy that carries state makes its own decisions depend on how many fights the instance has already seen, and hoisting one out of a loop for speed silently changes every result with every gate green. The same applies to run agents, and it is gated the same way — a warmed instance against a fresh one. Replacing the derived generator with one carried across calls:

```
✖ a run agent holds no state between runs: a warmed instance matches a fresh one
  AssertionError [ERR_ASSERTION]: seed 1: the agent carried state
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

Note which test does *not* fail: "same seed and same agent produce an identical final run hash" stays green, because it builds a fresh agent per run. Both tests are needed, and neither covers the other.

### The seams that must stay inert

Sigils are out of scope for this unit and `hashRun` covers the list, so the day they land the run hash notices instead of agreeing with itself. Granting one at a won boss:

```
✖ sigils stay out of scope: no run this unit can generate grants one
  AssertionError [ERR_ASSERTION]: seed 1 granted a sigil
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

Deck instance ids are unique for the whole run, which is what lets the forge address one copy of a card. Not advancing the counter:

```
✖ deck instance ids are unique and are never reused within a run
  AssertionError [ERR_ASSERTION]: two deck cards share an instance id
ℹ tests 78   ℹ pass 77   ℹ fail 1
```

### The degeneracy gate: can the instrument still see a difference?

A run that is never won and a run that is never lost both produce a clean, stable, perfectly deterministic report that cannot detect any change to the content. Making the act-3 boss unwinnable:

```
- The instrument can see a difference: FAIL; the strongest arm won 0/200 and runs ended after
  3 distinct act counts. Enforced: --verify exits non-zero.
FAIL: the run measurement is not trustworthy over 200 seeds.
  - no run in 200 seeds was won, so this seed window cannot detect a change that makes the run
    easier and every "win rate per act" below act 1 is a floor reading. Either the content is
    unwinnable by this bot or the seed window is too small.
```

Note what stayed green under that mutation: determinism, replay, map structure, branching, stream separation and the sigil seam. That is the split working — the structural gates do not care whether the game is winnable, and the degeneracy gate does not care about balance beyond "not a fixed point".

### Bounds these two gates carry

- `test/run.test.ts` runs seed windows, not the seed space: 60 seeds x 3 acts for map structure, 25 seeds for run determinism and replay, 20 for stream separation, 8 generated maps for the `pathSpread` cross-check, 12 fixture seeds for Health carry. A property that fails one seed in ten thousand is not covered.
- `npm run verify:run` is bound to the shipped `RUN_CONTENT` and to two bots. It says nothing about another content set, and every win rate it prints is evidence about the router and the placement bot rather than about a person. It catches a run that has become a fixed point; it does not catch balance drift that keeps the run winnable and losable, which is what the printed tables and `--encounters` are for.
- Neither gate covers the *fight* inside a run beyond what `replayFight` already checks. `npm run verify` remains the fight's own gate, and its numbers are byte-identical before and after this unit.
## 2026-09-07 — the screen's six gates (`test/ui-session.test.ts`, `test/render-view.test.ts`)

Taken on the `playable-fight` branch cut from `06c87c7`; the suite is **63 tests** here, 55 before it. Each mutation was applied to the stated file, the named test file run, and the tree restored before the next one.

| mutation | site | failure |
|---|---|---|
| `insertUnit(..., unitCount(...))` → `insertUnit(..., 0)` in the enemy's turn | `src/ui/session.ts:enemyPlays` | `seed 1/even: the UI driver and runRound diverged after round 2` |
| `target.bonusPower += beat.amount` → `+= 0` | `src/render/view.ts:applyBeat` | `seed 1/even round 5: the view derived from the player phase's events disagrees with the engine's state` — `['uid 14 bonusPower: view 0, engine 2']` |
| the Relay branch of the attribution disabled | `src/render/view.ts:attributeBuff` | `seed 1/even round 5: a +2 buff on uid 14 could not be attributed to the card that granted it` |
| `right.warded = true` deleted from the projection | `src/render/odds.ts:projectOwnPhase` | `seed 1 round 2: the Wards shown before commit are not the Wards that landed` |
| `Math.floor(per)` → `Math.ceil(per) + 2` | `src/render/board.ts:fitWidth` | `14 cards at 90px need 1338px of 1300px: the row would wrap or scroll while cards could still have shrunk` |
| the bordure clause suppressed for one Guard | `src/render/blazons.ts:blazonFor` | `u_ironguard: the bordure is the Guard channel, so it must be present exactly when Guard is` |

### The driver gate is the load-bearing one, and it is a duplication gate rather than a behaviour gate

`src/ui/session.ts` exists because `resolvePhase` returns the event stream and `runRound` drops it, and that stream is the entire input to the animation. To keep the events it re-runs the round from exported engine pieces, which means it carries its own copy of two things `engine/fight.ts` keeps private: `settle`, and the enemy's draw-select-append turn. Two drivers that drift apart are two different games, and the one with a screen is the one nobody measured.

So the gate compares `hashFight` after **every round**, not only at the end, over 120 seeds at `even` and 40 at `hard`, driving both from the same recorded placements. `hashFight` covers the board, both hands, both deck cursors and both generator states, so a driver that reached the same board through a different number of rolls fails too. Moving the enemy's insertion index by one slot is caught on the second round of the first seed.

Its bound: it says nothing about a placement no bot makes, because the action lists come from `appendRightPlacer` and `randomPlacer`. The index arithmetic the *screen* generates — splicing a pending card anywhere in a line and turning that line back into ordered insertions — is covered separately by the `placementsFrom` test, over five orderings including ones that push earlier placements rightward.

### The projection gate found a real defect before it gated it

`projectOwnPhase` was written because the odds on screen were **wrong**, not merely incomplete. Ward is granted during your own resolution, so a pre-commit board that has not applied it says "each attack is 100% onto your 1 Guard" when the truth is that `legalTargets` will narrow to the Guards, remove the warded ones, find nothing, and fizzle every enemy attack. `ARCHITECTURE.md` calls being shown the opposite of what happens the definition of unfair, and this was reachable on turn one with two cheap cards.

The first version of the gate went red immediately on a case the projection does not model, which is worth recording because it looked like the projection was wrong: `resolvePhase` stops the moment a hero dies, so units to the right of a killing blow never act and never grant their Ward. The gate now skips rounds that end the fight and says why in its own comment — there is no next turn for the forecast to be about.

### What none of these six gates cover

Pixels. Every one of them is arithmetic or state comparison, and a board can satisfy all six while being unreadable or unclickable. That half is `tools/ui-probe/play.ts`, which plays the app through its real controls and photographs it, and the review is bound to a sha256 manifest in `docs/work/3_playable-fight/plan.md`. Four of the five defects that round found — a skip control that skipped one phase of three, a header reading a different clock from the board, a row clipping its own overflow, and a fit that measured a layout still gliding to its new width — are invisible to all six.

## 2026-09-06 — six ordering gates that were pinned to nothing, and a latent crash closed (`test/resolver-order.test.ts`)

Taken at `49f017b` with this round's changes applied; the suite is **55 tests** here, 47 before it.

An independent review of the twelve gates below found the seam sound and several gates not gating what they claimed. Each mutation was applied to the stated file, `node --test` run over the whole suite, and the tree restored.

| mutation | site | tests failed, of 55 | which |
|---|---|---|---|
| `extra(...)` hoisted into a correct pass of its own after both loops | `resolver.ts:triggersFor` | 1 | the new interleave test, only |
| that hoist, plus the shipped side and entity loops reversed | `resolver.ts:triggersFor` | 1 | the new interleave test, only |
| the shipped side and entity loops reversed | `resolver.ts:triggersFor` | 3 | both board-order tests and the interleave test |
| the shipped entity loop ordered by `uid` | `resolver.ts:triggersFor` | 2 | the index-not-uid test and the interleave test |
| `checkStateBased` side loop reversed | `resolver.ts:checkStateBased` | 1 | simultaneous deaths, across sides |
| `checkStateBased` index loop reversed | `resolver.ts:checkStateBased` | 1 | simultaneous deaths, one line |
| the `deaths` trigger loop moved above the `spawned` loop | `resolver.ts:drain` | 2 | both new reaction-order tests |
| the `produced` and `deaths` trigger loops swapped | `resolver.ts:drain` | 1 | reactions in event-emission order |
| `requireEntity` restored in `apply`'s five cases | `resolver.ts:apply` | 1 | the skip-a-departed-entity test |
| `drain`'s seam default `null` → a no-op `TriggerRule` | `resolver.ts:drain` | 1 | the seam-is-off test |
| a production call site hands the seam a rule | `fight.ts:248` | 1 | the seam-is-off test |
| `iterations >= maxIterations` → `>` | `resolver.ts:drain` | 1 | the cap-boundary test |

### The board-order gates were pinned to the shipped loop by nothing but where the seam call sits

The three board-order tests that existed were built from the seam alone, and `extra(...)` happens to be called inside the shipped `for (side) / for (entity)` nest. Nothing asserted that coupling, and the seam's own doc comment sanctioned a separate pass — "after the shipped traits have had their say". Hoisting `extra` into a pass of its own, correctly ordered by board index, and then reversing the shipped loop, left every test green with the shipped board-order loop inverted.

The new test puts a shipped trigger and a seam trigger on **one event**: a `watchDeaths` unit at index 0 and a Wake unit at index 2, both answering one death. Correct is `[watcher, waker]`; the hoist reorders it whether or not the shipped loop is also reversed. The fixture is built right to left, so uid order is the exact reverse of board order and the same test also catches a uid-ordered walk.

Hoist alone — nothing else in the suite sees it:

```
✖ a shipped trigger and a seam trigger answering one event interleave by board index
  AssertionError [ERR_ASSERTION]: the seam rule standing at index 0 answers before the shipped Wake at index 2
    actual: [ 3, 5 ], expected: [ 5, 3 ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

Hoist plus the shipped loops reversed produces the identical failure, and the identical 1-of-55. That is the review's finding stated as a number: with the seam decoupled, reversing the shipped board-order loop costs one test, and before this round it cost none.

### Simultaneous-death order is decided in `checkStateBased`, which the board-order gate does not reach

When two entities are at zero at one checkpoint, the order their `died` events reach triggers is fixed by `checkStateBased`'s own two loops, not by `triggersFor`. Both are reachable with **no seam**: Wake, plus the corpse-at-zero-Health state already used elsewhere in the file.

One corpse-and-waker pair per side catches the side loop:

```
✖ two deaths at one checkpoint are announced player line first, then enemy line
  AssertionError [ERR_ASSERTION]: the player line is checked before the enemy line
    actual: [ 5, 3 ], expected: [ 3, 5 ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

Two pairs on one line catch the index loop, and neither test sees the other's mutation:

```
✖ two deaths on one line at one checkpoint are announced left to right
  AssertionError [ERR_ASSERTION]: the leftmost death is announced first
    actual: [ 5, 3 ], expected: [ 3, 5 ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

Each test asserts the `died` order and then the `powerGained` order, because the second is the part a player sees: the same two deaths, the same final Power, in a different order down the event stream the animation layer replays. `docs/design/game.md` names AoE as the only designated counter to a wide board, and AoE is the first designed effect that puts two units at zero at once.

### "Continuations before reactions" gated one of the two reaction sources

`drain` pushes three loops: `spawned`, then triggers for `produced` events, then triggers for `deaths`. The recorded mutation swapped the first two. The third was untouched by any test, and both of its orderings are reachable from shipped traits alone.

An acting unit with Wake whose left neighbour is a corpse makes one `act` both spawn a continuation and produce a death. Moving the `deaths` loop above `spawned`:

```
✖ a death's triggers queue behind the acting unit's own continuations
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    actual:   [ 'act', 'gainPower', 'attack', 'afterAct' ]
    expected: [ 'act', 'attack', 'afterAct', 'gainPower' ]
ℹ tests 55   ℹ pass 53   ℹ fail 2
```

The unit swings at its printed 3 with the loops in order and at 5 with them moved, so this is a damage number and not only a trace.

Swapping `produced` with `deaths` needs both sources non-empty at one checkpoint: a Relay unit's `afterAct` while a corpse sits at zero to its left. Both are reactions, so "continuations before reactions" cannot separate them; what does is that `produced` events are pushed to the event stream before `deaths` are, and the triggers follow the stream.

```
✖ reactions queue in the order their events were emitted: an effect's own, then the checkpoint's deaths
  AssertionError [ERR_ASSERTION]: Relay answers the afterActed it was emitted with, before Wake answers the death
    actual: [ 4, 6 ], expected: [ 6, 4 ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

### The latent crash, and the two answers the engine gave to one situation

All five `apply` cases called `requireEntity` before their `!e.alive` guard, and `checkStateBased` removes dead non-heroes from the board. So an effect queued against a living unit that dies before the effect comes up reached `requireEntity` and threw. Aimed at a **hero** the same sequence was silent, because line 181 keeps dead heroes on the board and the `!e.alive` guard caught them. One situation, two answers, decided by a filter that exists to anchor the right end of the line.

The fix is to skip: `findEntity`, then `if (e === null || !e.alive) return { events: [], spawned: [] }`. `ARCHITECTURE.md:74` says deaths are batched precisely so this does not depend on evaluation order, and the throw could not have been a useful diagnostic either — `findEntity` returns null identically for "died and was removed" and "never existed".

Reached through `resolvePhase`, the real entry point, with a test-only trigger keyed to `acted` that queues an action against a named entity — `Echo`'s shape in `docs/design/game.md`, "repeat the base action of the unit that resolved immediately before me". Mutation: `requireEntity` restored in all five cases.

```
✖ an effect naming an entity that has left the board is skipped, and a hero answers the same way
  Error: state: no entity with uid 5 is on the board
      at requireEntity (src/engine/state.ts:159:11)
      at apply (src/engine/resolver.ts:117:17)
      at drain (src/engine/resolver.ts:350:43)
      at resolvePhase (src/engine/resolver.ts:392:20)
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

The split itself, under that same mutation, by running one half of the test at a time. Hero half only:

```
ℹ tests 55   ℹ pass 55   ℹ fail 0
```

Unit half only: the throw above. Same sequence, same trigger, same queued effect — the only difference is whether the victim is filtered off the board.

**Behaviour held still.** The review measured this path unreachable at this revision: 72,000 fights, 79,946,615 effect applications, zero effects naming an absent or dead entity. `npm run verify` before and after the fix is identical line for line apart from its wall-clock line — same 400-seed arms, same 2,454 compared rounds, same 2,167/4,238 differing placements, same 40 distinct final hashes, same 15.25 pp gap. The fix only changes what happens on a path that throws today, so any reachable difference would have shown up as a crash rather than as a different number.

### The seam's `null` default, and why this one gate reads source

Changing `drain`'s `extraTriggers` default from `null` to a no-op `TriggerRule` left the whole suite green, and no fixture can separate them: `triggersFor` asks a no-op rule and it returns nothing. So the test reads the declaration and the call sites instead of the behaviour. What it defends is not the token but what the token buys — the seam is off unless a caller asks, and no caller in `src/` asks.

```
✖ the test seam is off in production: its default is null, and nothing in src/ passes one
  AssertionError [ERR_ASSERTION]: both entry points default the seam to null, so an omitted argument is no rule at all
    actual: [ [ 'drain', '() => []' ], ... ]
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

And the other half, adding a fifth argument to one of the four `resolvePhase` calls in `src/engine/fight.ts` — a no-op rule and the same iteration cap, so nothing about the fight changes:

```
✖ the test seam is off in production: its default is null, and nothing in src/ passes one
  AssertionError [ERR_ASSERTION]: production passes the seam nothing
    actual: [ 'src/engine/fight.ts:248  resolvePhase is handed a trigger rule' ]
    expected: []
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

The call scan asserts it reached at least four call sites before it reports zero offenders, so "did not run" cannot come back as "passed". Bound: it proves nothing about a rule handed in at runtime from outside `src/`.

### The iteration cap's boundary

`iterations >= maxIterations` → `>` shifts the cap by exactly one effect and nothing else in the engine notices. The gate holds both sides of the boundary: `act` spawns `attack` and `afterAct`, so the cascade is exactly three effects; at `maxIterations = 3` it finishes, and at `2` it throws having applied exactly two.

```
✖ the iteration cap is the exact number of effects that may be applied
  AssertionError [ERR_ASSERTION]: Missing expected exception: a drain needing maxIterations + 1 effects throws
ℹ tests 55   ℹ pass 54   ℹ fail 1
```

The half that fired here is the `maxIterations = 2` half; the `= 3` half holds the other direction, so a cap that starts throwing one effect early is caught too.

### What this round does not prove

The interleave test uses one shipped trigger and one seam rule on one line. A three-way interleave, or one that spans both sides, is not covered. The simultaneous-death tests reach the checkpoint through a unit parked at zero Health, which is the state AoE will produce but is not AoE. The seam test reads `src/`, so a rule reaching `drain` from anywhere else is invisible to it. And `npm run verify` holding still is evidence about the 400 seeds it runs, not a proof that no fight anywhere queues an effect against a departed entity — it is evidence that this fix changed nothing that was already happening.

## 2026-09-06 — `npm run verify`, the optimal-vs-random gap

Claim: at the primary encounter, over the seed window the run names, a bot that searches insertion positions beats a bot that places at random by at least 5.00 percentage points, by a margin whose 95% paired interval excludes zero. Bound stated in `src/sim/measure.ts` — at `gapVerdict` for the threshold and inline at the `--verify` block for what a green run does and does not prove.

Before this, the gate could not go red on the claim it exists to defend. `--verify` set `process.exitCode = 1` for card-identity and determinism failures only, so a gap that collapsed to zero still exited 0 while `ARCHITECTURE.md` described it as "a number that can go red in CI".

### The threshold, and why it is 5.00 pp

Two conditions, both required, and they bind at opposite ends of the seed count.

1. The paired 95% interval must exclude zero. This keeps the gate sound at any `--seeds` value — at 20 seeds the floor alone could be cleared by luck.
2. The gap must reach `MIN_GAP_PP = 5.00`. This keeps the gate meaningful at large seed counts, where condition 1 degenerates: at 20,000 seeds an interval excluding zero needs a gap of only 0.74 pp, which is the size of a collapse rather than the size of a decision.

The number comes from the measurement's own two null arms rather than from the headline. The cascade-stripped negative control runs a 0.92 pp gap at `even`; the noise floor — two identical random policies separated only by their stream name — runs -0.26 pp over 20,000 seeds (95% CI -0.98..0.47). A genuine collapse therefore lands at or below about 1 pp. Against that, the paired standard error at the gate's 400 seeds is about 2.7 pp, so a single seed window can sit 5 pp either side of the population value for no reason at all. 5.00 pp is one such half-width above zero: below it a 400-seed run cannot separate the gap from zero anyway. With the population gap at 18.80 pp (95% CI 18.06..19.53 over 20,000 seeds), the floor sits 5.1 standard errors below it, so a false red needs a 5-sigma excursion.

Deliberately not a third condition: "the gap must beat the measured noise floor". A 95% interval on a null comparison excludes zero one run in twenty by construction, so gating on the control's interval would flake 1 in 20 on any change to the seed set, and a flaky gate is a gate that gets disabled. The control is printed for a human instead.

### Red 1 — both arms pointed at the same placement policy

Mutation, in `src/sim/measure.ts`:

```ts
export const BOTS: Record<string, BotFactory> = {
  lookahead: (seed) => randomPlacer(seed, 'placement-a'),   // was lookaheadPlacer(DEFAULT_LOOKAHEAD)
  ...
```

`npm run verify`, exit 1:

```
- The claim itself: FAIL. The A - B gap is 0.00 pp (CI 0.00..0.00); it must reach 5.00 pp and its interval must exclude zero. Enforced: --verify exits non-zero.

FAIL: placement is no longer measurably a decision at encounter "even" over 400 seeds (1..400).
  - the optimal-vs-random gap is 0.00 pp with a 95% interval of 0.00..0.00 pp, whose lower bound is not above zero. Over 400 seeds this run cannot distinguish optimal placement from random placement, so it is not evidence that placement is a decision. ...
  - the optimal-vs-random gap is 0.00 pp, below the floor of 5.00 pp this gate defends. ...
  Arms: A optimal 41.50% (166/400), B random 41.50% (166/400); measured noise floor B - B2 1.50%.
```

### Red 2 — Bot A replaced by a real policy that is no better than random

`lookahead: () => appendLeftPlacer()`. Append-left is a genuine fixed rule, not a copy of the control arm, and it is worth nothing. `npm run verify`, exit 1:

```
FAIL: placement is no longer measurably a decision at encounter "even" over 400 seeds (1..400).
  - the optimal-vs-random gap is -5.25 pp with a 95% interval of -10.39..-0.11 pp, whose lower bound is not above zero. ...
  - the optimal-vs-random gap is -5.25 pp, below the floor of 5.00 pp this gate defends. ...
  Arms: A optimal 36.25% (145/400), B random 41.50% (166/400); measured noise floor B - B2 1.50%.
```

### Red 3 — the floor firing where the interval does not, on unmutated code

The two conditions are not the same condition wearing different clothes, and this is the run that shows it. No source change: the gate run at an operating point where the gap is statistically real and substantively collapsed.

```
node src/sim/measure.ts --verify --seeds 20000 --sweep-seeds 1 --search-check 0 --encounter trivial
```

Exit 1:

```
- The claim itself: FAIL. The A - B gap is 1.55 pp (CI 1.28..1.83); it must reach 5.00 pp and its interval must exclude zero.

FAIL: placement is no longer measurably a decision at encounter "trivial" over 20000 seeds (1..20000).
  - the optimal-vs-random gap is 1.55 pp, below the floor of 5.00 pp this gate defends. ...
  Arms: A optimal 97.17% (19433/20000), B random 95.61% (19122/20000); measured noise floor B - B2 0.04%.
```

Only the floor condition fired: the interval 1.28..1.83 excludes zero, so condition 1 passed on a gap that is a fortieth of the headline. A gate written with condition 1 alone would have called this green.

All three reverted; `npm run gates` returns to exit 0, reporting `The claim itself: PASS. The A - B gap is 15.25 pp (CI 10.06..20.44)`.

### What this gate does not prove

It is bound to one encounter — `even` by default, the one tuned so both arms straddle 50%. The same gap is 1.55 pp at `trivial` and about 19 pp at `hard`, so a green run says nothing about the other three; `npm run measure` reports all four. It is bound to bots: Bot B places uniformly at random and no human does, and against "always append next to the hero" the gap is roughly 9 pp, which is the honest figure for a person not thinking about placement. And it catches collapse, not drift — a gap that quietly halved would still pass.

## 2026-09-06 — `npm run gate:banned-apis`, extended to the clock constructor

Claim, added to the existing one: `new Date()` with no arguments, and `Date()` called without `new`, appear nowhere under `src/` or `test/`. Both read the wall clock, and a fight seeded off `new Date()` is exactly as unreproducible as one seeded off `Date.now()` — which the gate already banned. Bound stated in `tools/gates/banned-apis.ts`.

`ARCHITECTURE.md` names three APIs and the gate was built to that list, so the same hidden input in a different syntax was uncovered.

### Scoping, without a file-name exemption

`tools/heraldry-probe/shoot.ts:113` stamps its manifest with `new Date().toISOString()`, which is the manifest's whole point. The new rule is scoped to `src/` and `test/` rather than exempting that file, because `tools/` is not code the engine's determinism depends on **by construction rather than by assertion**: `npm run gate:boundaries` fails when anything under `src/engine/` imports from `tools/`, so nothing there can enter a fight. A second probe may stamp its own manifest tomorrow without editing the gate. The three original names keep the wider `src/`, `test/`, `tools/` scope they had.

This is checked by the clean tree rather than argued: `shoot.ts` still contains its `new Date()` and the gate is green.

### Red — every syntax the rule claims to catch, in one mutation

Appended to `src/sim/bots.ts`:

```ts
export const stampA = (): string => new Date().toISOString();
export const stampB = (): string => Date();
export const coin = (): boolean => Math.random() < 0.5;
export const fixedIsFine = (): Date => new Date(0);
```

and to `src/sim/measure.ts`:

```ts
export const bare = (): Date => new Date;
export const viaGlobal = (): Date => new globalThis.Date();
export const stamped = (): number => Date.now();
export const ticked = (): number => performance.now();
// A comment naming new Date() and Math.random must not count.
export const inAString = 'new Date() and Date.now() in a string must not count';
```

`npm run gate:banned-apis`, exit 1:

```
Banned API gate FAILED: 7 hidden input(s) into the engine.

  3 use(s) of Math.random, Date.now or performance.now outside src/engine/rng.ts:
    src/sim/bots.ts:241:36  Math.random
    src/sim/measure.ts:624:38  Date.now
    src/sim/measure.ts:625:37  performance.now

  4 wall-clock read(s) via the Date constructor under src/ or test/:
    src/sim/bots.ts:239:37  new Date()
    src/sim/bots.ts:240:37  Date()
    src/sim/measure.ts:622:33  new Date
    src/sim/measure.ts:623:38  new globalThis.Date()
```

Seven, not nine. `new Date(0)` is absent from the list on purpose — a `Date` built from an argument is a pure function of that argument and is not banned anywhere — and so are the `new Date()` and `Date.now()` sitting in a comment and a string literal, which is the property that makes this gate parse rather than grep. This run also re-proves the three original names under the rewritten detector; the earlier proof was against the previous implementation.

Reverted; green again at exit 0, reporting 21 files scanned for the member rule and 17 for the clock rule.

### Red — the self-test, so "did not run" cannot come back as "passed"

The self-test now counts violations **per rule**, because a total-only count passes with one rule dead and the other over-firing. Mutation, in the detector itself:

```ts
if (objectName(node.expression) === 'Date' && argc === 99) record(node, 'clock');   // was argc === 0
```

Exit 2, before any file is read:

```
GATE BROKEN: the banned-API detector found 1 "clock" violation(s) in its own self-test, expected 4. It cannot be trusted to report an absence. Found: member@1:Math.random | member@2:Date.now | member@3:performance.now | member@4:globalThis.Math.random | member@5:Math['random'] | member@6:{ now } = Date | clock@13:Date()
```

The gate also exits 2 if either rule ends up with no files in scope, for the same reason.

## 2026-09-06 — `src/sim/bots.test.ts`, placement policies hold no state

Claim: every placement policy is a pure function of the fight it is handed, so a warmed instance places identically to a fresh one, one instance hoisted across a sweep gives the same fights as one instance per fight, and a policy asked the same question twice gives the same answer. Bound stated in the file header.

The defect was live at `26e55a8`: `lookaheadPlacer` carried a `salt` counter across calls and `randomPlacer` built its generator outside the returned closure, so a policy's decisions depended on how many fights its instance had already seen. `src/sim/measure.ts` builds a fresh policy per fight, which made this reproduce — but only by convention, and hoisting the construction out of that loop for speed would have changed every placement and every final hash in the measurement with every gate still green.

The tests live beside `bots.ts` rather than in `test/` because `test/` was being edited by another worker in the same wave; `node --test` discovers `**/*.test.ts` and the file is inside `tsconfig.json`'s `include`, so both `npm test` and `npm run typecheck` cover it.

**Correction, 2026-09-06.** That seam is gone and the file moved to `test/bots.test.ts`. The proof above was run at the old path and is left as it was recorded; re-running it today reads `node --test test/bots.test.ts`. Coverage at the new path was re-checked rather than assumed: `node --test` still reports 47 tests and `node --test test/bots.test.ts` runs 3 of them, and `npm run typecheck` was made to go red on a deliberate type error inserted in the moved file (`test/bots.test.ts(125,7): error TS2322`) before it was reverted.

### Red — the base revision's stateful policies

Mutation: `src/sim/bots.ts` restored to its `26e55a8` content, i.e. the `salt` counter and the hoisted generator put back.

`node --test src/sim/bots.test.ts`, exit 1, all three tests red:

```
✖ a warmed policy instance places exactly as a fresh one does
  AssertionError: lookahead: a warmed instance placed differently from a fresh one on seed 1
✖ one policy instance hoisted across a sweep gives the same fights as one per fight
  AssertionError: lookahead: hoisting the policy changed the placements on seed 2
✖ a policy asked the same question twice gives the same answer
  AssertionError: lookahead: two calls on the same fight and hand returned different indices
```

The first failure's diff shows the concrete divergence — the same card going to index 1 in the warmed instance and index 0 in the fresh one on round 1 of seed 1, and diverging further every round after.

Reverted; `npm test` green at 37/37 — taken at `4b45a7e`, where the suite is 37 tests. This branch's merge with the resolver-ordering one made the suite 47 at `49f017b`.

### What these tests do not prove

They cover the four policies listed in `POLICIES`. A stateful policy added later is caught only if it is added to that list. They also say nothing about the engine's own determinism — `test/determinism.test.ts` owns that, and these would pass just as happily on an engine that was deterministic and wrong.
## 2026-09-06 — the resolver's ordering contract (`test/resolver-order.test.ts`)

Claim: the ordering properties `ARCHITECTURE.md` promises — trigger order is board order, board order means board *index*, it is a queue and not a stack, deaths are batched after every effect, the acting order is snapshotted, and direct continuations are queued ahead of reactions — each fail when they are broken. Bound stated in the test file's header.

These six were the reason for the work. An independent review at `26e55a8` found the engine correct and the suite weak: of 28 mutations that reintroduce a defect the code or docs claim to prevent, **10 left 34/34 green**, and six of those ten were resolution order. They were not untested by oversight — they were **unobservable**. With the shipped pool every trigger is keyed to one uid (`event.uid === e.uid`, or `event.rightUid === e.uid`), so no event can match two units and the board-order loop decides nothing; and no shipped effect both spawns a continuation and produces an event anything triggers on, so the order of those two queue pushes decides nothing either. No fixture built from Relay, Guard, Wake and Ward can tell the correct resolver from any of these broken ones.

Three of the six therefore needed a trigger rule that fires for more than one unit, and the game has none. **Narrowed after review:** that is a claim about the exact recorded mutations *in `triggersFor`*, and it was first written as though it were a claim about resolution order. It is not. Sibling orderings at `checkStateBased` and at `drain`'s third push loop are reachable from Wake alone, were ungated, and are gated in the entry above with no seam at all. `drain` and `resolvePhase` gained an optional `extraTriggers` parameter for exactly that: it defaults to `null`, every production caller passes nothing, and `triggersFor`'s doc comment carries the argument for why it exists. **This is the one engine-source change in this round that is not behaviour**, and it is here because a gate nobody can make go red is not a gate.

Taken at `bcd7dc9`, where the suite is **44 tests**. Every transcript quoted below is from that revision, so its `ℹ tests 44` lines are correct there and nowhere else: `49f017b` merged this branch with the one carrying `src/sim/bots.test.ts` and the suite became 47, and the round after this one took it to 55. All seven mutations were re-run at `49f017b` with that later round applied; the same tests fail, and the re-run column below carries the denominators as they stand there.

Each mutation was applied to the stated file, `npm test` run against the whole suite, and the tree restored. Where a mutation fails *only* tests added in this round, that is the review's finding reproduced: the 34 that existed before it do not see the defect.

Line numbers are as they stood at `26e55a8`, which is how the review named them.

| mutation | site | failed, of 44 at `bcd7dc9` | re-run, of 55 | which |
|---|---|---|---|---|
| sides and lines iterated in reverse | `resolver.ts:181-182` | 2 | 3 | both trigger-order tests, plus the later interleave test |
| line ordered by `uid` instead of index | `resolver.ts:182` | 1 | 2 | the index-not-uid test, plus the later interleave test |
| Ward's block moved above Relay's | `resolver.ts:186-199` | 1 | 1 | the within-unit tie-break test |
| `queue.shift()` → `queue.pop()` | `resolver.ts:254` | 7 | 14 | six of this round's tests and the rewritten act guard, plus seven added later |
| `checkStateBased` deferred to the end of the drain | `resolver.ts:258` | 2 | 3 | the batching test and the act guard, plus the later departed-entity test |
| acting order read live by index | `resolver.ts:285-289` | 1 | 1 | the snapshot test |
| the two `queue.push` loops swapped | `resolver.ts:264-265` | 1 | 2 | the continuations-before-reactions test, plus the later departed-entity test |

The failures themselves.

**Sides and lines reversed** (`['enemy', 'player']`, and `[...state.board[side]].reverse()`). Three units answer one death; correct order is the player line left to right, then the enemy line.

```
✖ trigger order is board order: the player line left to right, then the enemy line
  AssertionError [ERR_ASSERTION]: three units answered one death; they answered in board order
    actual: [ 5, 4, 3 ], expected: [ 3, 4, 5 ]
✖ trigger order is board index, not uid: a later-made unit standing left goes first
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

**Ordered by uid** (`[...state.board[side]].sort((a, b) => a.uid - b.uid)`). The fixture makes the later-created unit stand to the left, so uid order and board order disagree; the test asserts that premise before it asserts the result, or it would degenerate into agreeing with itself.

```
✖ trigger order is board index, not uid: a later-made unit standing left goes first
  AssertionError [ERR_ASSERTION]: where a unit stands decides, not when it was made
    actual: [ 3, 4 ], expected: [ 4, 3 ]
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

**Ward's block above Relay's.** The tie-break inside one unit is the source order of the `if` blocks in `triggersFor` and it was documented nowhere; it is now in that function's comment, and this is the test that holds it.

```
✖ inside one unit, traits fire in the source order of the blocks: Relay before Ward
  AssertionError [ERR_ASSERTION]:
    actual:   [ 'afterAct', 'grantWard', 'gainPower' ]
    expected: [ 'afterAct', 'gainPower', 'grantWard' ]
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

**`queue.pop()`.** Seven tests. The state-level one: a queue of `[grantWard on the only Guard, attack]` leaves the attacker with no legal target and it fizzles; a stack strikes first and wards afterwards.

```
✖ it is a queue, not a stack: the first effect queued is the first applied
  AssertionError [ERR_ASSERTION]: actual: [ 'attack', 'grantWard' ], expected: [ 'grantWard', 'attack' ]
ℹ tests 44   ℹ pass 37   ℹ fail 7
```

**Deaths deferred** (`const deaths = queue.length === 0 ? checkStateBased(state) : []`). Written deliberately so the triggers still fire — the naive version that drops them is caught by the existing Wake test, and this one is not. Two attacks are queued; the first kills the defending side's only Guard.

```
✖ deaths are batched after every effect, not once at the end of the drain
  AssertionError [ERR_ASSERTION]: the death landed between the two attacks, not after both of them
    actual:   [ 'attacked', 'attacked', 'died' ]
    expected: [ 'attacked', 'died', 'attacked' ]
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

The test's next assertion is the state, not the events: with the checkpoint in place the Guard has left the board and the second attack reaches the enemy hero for 4; with deaths deferred the hero is untouched and the corpse absorbs a second hit.

**Acting order read live.** A unit is killed mid-phase by a riposte, the array is rebuilt, and a live index walk steps over the unit that shifted into the slot it just left.

```
✖ the acting order is snapshotted: a unit removed mid-phase does not shift the line
  AssertionError [ERR_ASSERTION]: the line acts in the order it stood in when the phase began
    actual: [ 3, 5, 1 ], expected: [ 3, 4, 5, 1 ]
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

Bound worth stating, because it is the difference between a gate and a coincidence: this fails for the **index** formulation of the mutation. The `for (const e of state.board[side])` formulation is *equivalent* to the snapshot today and no test can separate them, because `checkStateBased` rebinds `state.board[side]` to a new array rather than splicing the old one, so a running `for...of` keeps iterating the array the phase began with.

**The two `queue.push` loops swapped.** The acting unit's own reaction to having acted grants it +5 Power. Queued behind its attack, the attack lands at its printed 1; queued ahead of it, at 6.

```
✖ direct continuations are queued ahead of reactions to the same effect
  AssertionError [ERR_ASSERTION]: acting spawns the attack; the reaction to having acted queues behind it
    6 !== 1
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

## 2026-09-06 — two tests that were passing for the wrong reason (`test/rules.test.ts`)

Claim: Guard's random target selection really goes through `pick`, and the `!e.alive` guard in `apply`'s `act` case really stops a dead entity acting.

Taken at `bcd7dc9`, where the suite is 44 tests; the `ℹ tests 44` lines below are that revision's.

**"Guard forces attacks onto Guards, randomly among them"** created a generator, discarded it (`void rng`), and then indexed the target list with `t[Math.floor((i * 7919) % t.length)]`. 7919 is odd and the list has two entries, so `seen.size === 2` was the test's own arithmetic alternating; `pick` and `resolvePhase` were never called. It now resolves 200 real attacks on one combat stream and reads the targets out of the events.

Mutation, `src/engine/rng.ts` — `pick` consumes its draw and returns the first element:

```ts
  nextInt(r, xs.length);
  return xs[0]!;
```

```
✖ Guard forces attacks onto Guards, randomly among them
  AssertionError [ERR_ASSERTION]: both Guards were struck and nothing else ever was
    actual: [ 3 ], expected: [ 3, 4 ]
✖ the worked example under-specifies its own targeting
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

`the worked example under-specifies its own targeting` is a pre-existing test and it does catch this one — the review's finding was about the Guard test specifically, and it holds: before the rewrite that test passed with `pick` stubbed out.

**"no unit acts after dying"** removed the unit from the board before calling `resolvePhase`, so the snapshot never contained it and the phase loop skipped it. The guard at `resolver.ts:84` could be deleted outright with the suite green. Reaching it needs an entity that is on the board and alive when its action is queued and dead when that action comes up: a hero at zero Health, which the checkpoint kills mid-drain and which stays on the board because heroes do.

Mutation, `src/engine/resolver.ts` — the `if (!e.alive) return { events: [], spawned: [] };` line deleted from `case 'act'`:

```
✖ no unit acts after dying, even with its action already queued
  AssertionError [ERR_ASSERTION]: an entity that died before its queued action came up does not act
    true !== false
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

## 2026-09-06 — a cloned fight shares nothing mutable (`test/fight.test.ts`)

Claim: `cloneFight` returns a fight that can be written to without reaching the live one. Bound: the test writes to the deck, the hand, an entity and the generator; it does not enumerate future fields, so a new mutable field added to `Fight` and not copied would pass it.

Taken at `bcd7dc9`, where the suite is 44 tests; the `ℹ tests 44` lines below are that revision's.

`cloneFight` passed both decks by reference, so `clone.player.deck === live.player.deck`. Harmless only because nothing writes to a deck after setup — the first mill, shuffle-in or tutor effect makes every lookahead rollout a write into the fight it is searching from.

Mutation, `src/engine/fight.ts` — the two `.slice()` calls removed:

```
✖ a cloned fight shares no mutable state with the live one
  AssertionError [ERR_ASSERTION]: the player deck is a copy
    actual:   [ 'test:grunt', 'test:wall', 'test:grunt' ]
    expected: [ 'test:grunt', 'test:wall', 'test:grunt' ]
    operator: 'notStrictEqual'
ℹ tests 44   ℹ pass 43   ℹ fail 1
```

Two arrays that print identically and fail `notStrictEqual` is the defect stated as plainly as it can be: same object, two names.

## 2026-09-06 — Wake's inertness, gated in both directions (`test/rules.test.ts`)

Claim: Wake fires, and the +2 it grants is always cleared before the woken unit can swing. This **documents a defect and does not endorse it** — the rule is the owner's decision. `startTurn` clears `bonusPower` at the start of a side's own phase and a side's units only die during the opponent's phase, so the buff is wiped before it can be spent, and `docs/work/1_turn-prototype/plan.md` measured the trait changing zero rows in 20,000 fights.

Taken at `bcd7dc9`, where the suite is 44 tests; the `ℹ tests 44` lines below are that revision's.

The test that existed asserted `waker.bonusPower === 2` and stopped, which is green on a dead trait. The new one carries the whole sequence to the swing, so both a regression and a fix are visible.

Mutation A, the regression — Wake's block deleted from `triggersFor`:

```
✖ Wake fires when the unit to my left dies
  AssertionError [ERR_ASSERTION]: the unit to the right of the dead one woke
    0 !== 2
✖ KNOWN DEFECT: Wake is inert - the +2 is always cleared before it can swing
  AssertionError [ERR_ASSERTION]: Wake fired: the unit to the right of the dead one woke
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

Mutation B, one plausible fix — `startTurn` no longer clears `bonusPower`, so the buff survives to the swing:

```
✖ buffs expire at the start of the owner’s next turn
  AssertionError [ERR_ASSERTION]: 2 !== 0
✖ KNOWN DEFECT: Wake is inert - the +2 is always cleared before it can swing
  AssertionError [ERR_ASSERTION]: and the buff is gone before the unit can spend it
ℹ tests 44   ℹ pass 42   ℹ fail 2
```

A fix now has to come past a red test that names the decision, instead of being absorbed by a green suite.

## 2026-09-06 — `npm run gate:boundaries` covers `src/content/`, and proves every prefix

Claim: nothing under `src/engine/` imports from `src/content/`, `src/render/`, `src/ui/` or `tools/`. Extends the entry below, which had the same claim without `src/content/`. Bound stated in `tools/gates/boundaries.ts`.

`ARCHITECTURE.md` draws content → engine. The code had `src/engine/fight.ts` importing `src/content/cards.ts` while `src/content/cards.ts` imported `src/engine/state.ts`, so the one-way arrow was a cycle, and the gate that exists to enforce that arrow did not name the direction that was actually broken. A fight is now handed a `CardPool` — the card lookup, the energy per round and the hand size — and the engine imports nothing.

Mutation, appended to `src/engine/fight.ts`:

```ts
import { cardById } from '../content/cards.ts';
export const mutationLookup = cardById;
```

Red:

```
Import boundary gate FAILED: 1 violation(s) of the rule that src/engine/ imports nothing from src/content/, src/render/, src/ui/, tools/ and touches no DOM global.

  src/engine/fight.ts:316:26  imports "../content/cards.ts", which is src/content/cards.ts under src/content/
```

Exit status 1 under the mutation, 0 after the revert.

The probe the gate runs against itself on every invocation was also widened: it now carries one import per forbidden prefix and the gate exits 2 unless the detector fires for **each** of them, not just once in total. A single-import probe would have kept reporting "detector fired" while a newly added prefix matched nothing.

## 2026-09-06 — `npm run gate:boundaries`

Claim: nothing under `src/engine/` imports from `src/render/`, `src/ui/` or `tools/`, and nothing there references a global that only `lib.dom` declares. Bound stated in `tools/gates/boundaries.ts`.

Mutation 1, appended to `src/engine/state.ts`:

```ts
import '../render/heraldry/card.ts';
export const gateProof: string = document.title;
```

Red:

```
Import boundary gate FAILED: 2 violation(s) of the rule that src/engine/ imports nothing from src/render/, src/ui/, tools/ and touches no DOM global.

  src/engine/state.ts:190:8   imports "../render/heraldry/card.ts", which is src/render/heraldry/card.ts under src/render/
  src/engine/state.ts:191:34  references the DOM global `document`
```

Mutation 2, the other two forbidden prefixes, one of them through a dynamic import and one of them naming a directory that does not exist yet:

```ts
import '../../tools/heraldry-probe/pages.ts';
const lazy = () => import('../ui/input.ts');
export const proof = lazy;
```

Red:

```
  src/engine/state.ts:189:8   imports "../../tools/heraldry-probe/pages.ts", which is tools/heraldry-probe/pages.ts under tools/
  src/engine/state.ts:190:27  imports "../ui/input.ts", which is src/ui/input.ts under src/ui/
```

Both mutations reverted; the gate returned to green on the unmodified tree. Exit status was 1 in both red runs and 0 after the revert.

The gate also runs its own probe on every invocation — a virtual `src/engine/__gate_probe__.ts` that breaks both halves — and exits 2 if the detector does not fire on it, or if `lib.dom` was not loaded. Without that, the DOM half would pass vacuously the day the lib configuration changes, and a green run would mean nothing.

## 2026-09-06 — `npm run gate:banned-apis`

Claim: `Math.random`, `Date.now` and `performance.now` appear nowhere outside `src/engine/rng.ts`. Bound stated in `tools/gates/banned-apis.ts`.

Mutation, appended to `src/engine/resolver.ts` and `src/sim/bots.ts`:

```ts
export const coin = () => Math.random() < 0.5;
export const stamp = () => Date.now();
export const tick = () => performance.now();
```

Red:

```
Banned API gate FAILED: 3 use(s) of Math.random, Date.now or performance.now outside src/engine/rng.ts.

  src/engine/resolver.ts:314:27  Math.random
  src/engine/resolver.ts:315:28  Date.now
  src/sim/bots.ts:182:27         performance.now
```

Reverted; green again at exit 0.

The reason this gate parses rather than greps is recorded here because it is the kind of thing that gets simplified back later. On the clean tree, `grep -rn "Math\.random\|Date\.now\|performance\.now" src test tools --include=*.ts` returns **16 hits and zero real calls** — comments in `src/engine/rng.ts` and `src/sim/measure.ts` name all three in order to say they are never called, and the gate's own source names them again. A check built from the same symbol as the thing it checks proves only that the text agrees with itself. The AST sees no comments and no string literals, which is exactly the property wanted here.

The detector is also asked to find a known set of six violations in a self-test snippet before it is trusted to report an absence, and exits 2 if it finds a different number. The snippet includes one banned name in a comment and one in a string, both of which must not count.

### Known overlap

`test/determinism.test.ts` already carries a line-regex version of the banned-API check, scanning `src/engine`, `src/content` and `src/sim` non-recursively. It is weaker on three axes — it does not see `test/`, `tools/` or `src/render/`, it does not descend into subdirectories, and it decides "this line is a comment" by looking at the first two characters — but it passes, and it was left alone rather than churned while the prototype was under independent review.
