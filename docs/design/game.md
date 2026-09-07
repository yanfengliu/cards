# Cards — design of record

Status: **unprototyped**. Every number here is a starting guess with a reason attached, not a balanced value. The worked example is the specification; the prose around it is commentary. Decisions marked **[owner]** were made by the owner directly and are not open for an agent to reverse without asking.

## The pitch

You build a line of adventurers that fights **without taking orders**. Your whole turn is deciding what to add and where to put it, because the line resolves left to right, each unit can change what the next one does, and your hero swings last — so whatever your line hands forward lands on the hero's attack.

## Where each influence lands

Three references, three different jobs. Assigned explicitly, because the risk in a three-way homage is building the average of its influences instead of the union.

| Influence | What it contributes | What is deliberately left behind |
|---|---|---|
| **Hearthstone** | A persistent board of units **that trade** with an opposing board, a hero with equipment, and races as mechanical tribes. | Escalating mana, hero powers, a collection, a fixed board width, and ordering units to attack. |
| **Slay the Spire** | Run structure: a branching map, a small curated deck, telegraphed enemy intent, and deck thinning as a skill. | Its combat, which has no friendly board at all. Its relics, which merged into sigils. |
| **Grail** | You build a machine and then watch it run. Cards are modified over a run by attachable sigils to produce cascading effects. | Full automation, deck-order cascades, and PvP. |

**Grail's contribution is the one to get right**, because it is the least obvious. Grail's appeal is not that it uses cards; it is authorship-at-a-distance — you tune a construction, commit, and find out whether it worked. This design keeps that feeling but moves the cascade from *deck order* to *board position*, so the player authors it fresh every turn rather than once per run.

## Combat

### The board

**Unlimited width [owner].** There is no slot cap. Units are added to the line and stay until they die.

This is safer than it sounds, because **energy caps the board long before geometry would**. Two gates bind: energy (3 a turn against an average unit cost near 1.5 is about two units a turn) and hand size (you cannot play what you did not draw). A six-turn fight offers 18 energy; spending a realistic 70% of it on bodies yields **six to nine units**, less losses. A dedicated swarm build — all 1-cost units, every point spent on them — tops out near **fifteen**.

Deck size used to be the third gate, and it is not one any more: a deck reshuffles inside a fight, so running out of cards is not a thing that happens. What deck size decides is the *mix* you draw, not how many bodies you can field. **Losses are now the real cap**, because combat is mutual and a body that attacks is a body that may not come back.

So the board self-limits at roughly twice Hearthstone's width, and **deck design is the board-size dial**: make units cheap and plentiful and boards grow, make them costly and boards stay tight. No slot rule is needed to tune it. Uncapped width is also what makes a swarm archetype possible at all, which a fixed board would quietly forbid.

**The one real exception is token generation.** A spell that summons three goblins, or a unit that summons one every turn, decouples board size from cards drawn — that is the only route to a genuinely unbounded line. Budget discipline belongs on token generators, not on the board rule.

The board clears completely between fights. Nothing on it persists.

### Energy

**Three per turn [owner]**, refreshed every turn, never carried over. Units, spells and equipment all draw from the same three points.

### The deck, inside a fight

**A deck reshuffles inside a fight [owner].** When it is empty and a card must be drawn, the discard is shuffled and becomes the new deck. A fight does not end because a side ran out of cards.

This is the rule that makes **deck thinning a skill**, which the influences table assigns to Slay the Spire. Without it, deck size is a resource budget rather than a consistency dial and the whole idea inverts: a small deck stops playing halfway through the fight, so *adding* filler is strictly good and cutting a weak card is strictly bad. Measured on the old rules, a ten-card deck won 0 of 200 runs. With the reshuffle, a thin deck cycles to its good cards faster and a fat one dilutes them, which is the decision the influence was chosen for.

Note what it does to the *enemy* as well, because it is the larger half in practice: an enemy deck is no longer a cap on how many bodies the enemy can field. Its size now decides the mix it fields rather than how long it can field anything.

### A turn

1. Draw to five cards.
2. Spend energy: place units into the line, cast spells, equip the hero. You choose where in the line each new unit goes.
3. Commit.
4. **Your line resolves left to right, one unit at a time. Your hero acts last.** Then the enemy side resolves the same way.

**The hero stands immediately to the right of the last unit.** This is a rule, not flavour: it means an adjacency trait on your rightmost unit reaches the hero, so "who is rightmost" is a live decision every single turn.

### How a unit resolves

Two things, in order: its **action** (by default, strike a random enemy), then any **after-acting** trait.

**Units never take orders [owner].** You do not click a unit and pick a target. You decided everything when you chose the slot.

### Targeting

**Random [owner].** Each attack picks uniformly among legal enemy targets.

**Guard** constrains it. While any Guard unit is alive on a side, every attack against that side must hit a Guard — still randomly, if there are several. Guards are the only way to steer incoming damage, which makes them the whole defensive game.

**The hero is a legal target [owner]**, not a protected back rank. It sits in the pool alongside every unit, and Guards are what keep it safe. Losing your last Guard exposes the hero immediately.

### Damage

**Combat is mutual [owner].** When A attacks B, they both do damage to each other. The attacker deals its Power to the defender and the defender simultaneously deals **its** Power back to the attacker, with Armour applying to each hit the way it applies to any other.

This is what makes the board *trade*, which is the contribution the influences table assigns to Hearthstone and which the rules did not previously deliver: attacking cost nothing, so a line was a damage total rather than a set of bodies with a price on using them. Four consequences, each a decision:

- **Power is a defensive stat now.** A body's Power is what it charges anything that swings at it, so a 2/6 wall and a 6/2 glass cannon are different objects rather than the same object priced two ways.
- **A 0-Power unit retaliates for 0, which makes it a genuine wall** — free to attack into, forever. That is a real card to design toward, not an accident.
- **Guards pay for their job twice.** A Guard soaks the enemy's attacks *and* takes retaliation on its own, so a Guard's survival is now the thing to protect rather than assumed.
- **A unit that dies to retaliation never finishes acting**, so its after-acting trait does not fire. A fragile Relay body may die on its own swing and hand nothing forward, and that is what "which body goes where" is now mostly about.

Three rules the mutual version needs, each decided here rather than left to the engine:

1. **Simultaneous means simultaneous.** Both blows are computed from Power read before either lands, and both deaths are announced at the same checkpoint. The first death does not cancel the second blow. Anything else would make the outcome depend on which side the engine happened to evaluate first, which `ARCHITECTURE.md` forbids.
2. **Retaliation is not an action.** A defender that hits back has not acted: it emits no `acted` and no after-acting trait fires. Being hit is not a turn.
3. **A hero retaliates when struck and takes nothing back when it attacks.** The first half follows from "the hero is a legal target, not a protected back rank" — a hero that did not hit back would be the *safest* thing on the board to attack, which inverts the rule that Guards are what keep it safe. The second half is the one asymmetry in the whole rule, and it is there because **units never take orders**: the hero swings every turn whether you want it to or not, so retaliation on its own swing would be unavoidable chip damage with no decision attached, against the bar that has to carry a whole run. Measured, it was not a small effect — with the hero taking retaliation the run is not merely harder, the life bar cannot survive the arithmetic.

**Only an attack trades.** Spell damage does not: a spell is cast from behind the line, and this is what keeps AoE the answer to a wide board rather than a way to feed one.

**Damage does not carry.** A 7-Power unit striking a 2-Health unit kills it and wastes 5. Excess damage is a trait (*Cleave*), not a default, because trample math turns every turn into arithmetic instead of a decision.

**Armour reduces each incoming attack** by a flat amount, to a minimum of zero — the attacker's blow and the defender's answer alike. Armour is what makes concentrating damage better than spreading it — see the worked example. It is the counterweight to overkill waste, and the two together are why packaging your damage is a real decision under random targeting.

**Buffs granted during resolution last until end of turn** unless stated otherwise. Permanent growth is rare and expensive.

### The hero

**Health, plus a small class-flavoured attack [owner].** The Knight swings for 2, the Ranger for 1 twice, the Mage for 1 with a rider. The hero always contributes something, and equipment amplifies an attack that already exists rather than switching one on.

Hero health **persists across the whole run** — it is the run's life bar, healed at rest nodes. A fight is won by reducing the enemy hero to zero.

## The cascade

Traits that reference resolution order are the core vocabulary.

- **Relay** — after acting, the unit to my right gains +2 Power this turn.
- **Echo** — repeat the **base** action of the unit that resolved immediately before me, never a copied one.
- **Wake** — when the unit to my left dies this turn, gain +2 Power.
- **Guard** — while I live, attacks against my side must target a Guard.
- **Kindle** — +1 Power for each adjacent friendly dwarf.

**Ward is deleted [owner].** It read "the unit to my right cannot be struck this turn", and a Ward standing to the left of your only Guard made your entire side untargetable: the targeting rule narrows to the Guards and then removes the warded ones, leaving nothing, so every enemy attack fizzled. Two one-cost cards bought that on turn one and it held for the rest of the fight. It was also the strongest trait in the game by a wide margin — an ablation had it carrying about two and a half times what Relay carried of the placement decision — and a trait that is both the best card and an unbreakable lock is not a card to tune, it is a card to remove.

**Wake only works because combat is mutual, and before that it did nothing at all.** Your units used to die only during the enemy's phase, and this-turn buffs clear at the start of your own phase, so the +2 was always wiped before the woken unit could swing — measured, ablating Wake changed the outcome of not one fight in twenty thousand. With combat mutual a unit dies to retaliation *during its own side's phase*, and the unit that dies is by construction to the left of one that has not acted yet. That is exactly the neighbour Wake reads. Nothing about the trait changed; the rule around it did.

### Why adjacency, and not counting

**Every cascade trait references neighbours, never totals.** This is the single most important constraint the unlimited board imposes, and it is easy to violate by accident.

A trait that counts — "+1 Power for each friendly unit that acted before me" — gives the Nth unit +N. On a five-slot board that caps at +4; here the cap is whatever the deck economy currently allows, so it drifts every time unit costs, deck size or fight length are tuned. That is the problem: not that it explodes, but that its ceiling is **not a number anyone controls directly**. An adjacency trait is bounded at two neighbours no matter how wide the line gets, so it stays correct through every later balance pass.

Note that **Relay grants a flat +2 and therefore does not compound**: in a line of five Relays, each unit gives its right neighbour +2 and every unit receives exactly +2. A version worded "gains Power equal to mine" *would* double down the line, which on an unlimited board is unbounded. Do not write that card.

The practical rule: **a new trait may read its neighbours, its own tribe among its neighbours, and the unit that resolved immediately before it — and nothing else.** A trait that wants a board-wide total is a trait that wants a fixed board width, and this game does not have one.

**Echo carries a second constraint, for a different reason.** Worded as "repeat the action of the unit before me", two adjacent Echoes walk backwards forever — and an Echo Sigil would let a player build that deliberately. Restricting Echo to the previous unit's *base* action makes it terminate by construction rather than by an engine guard, and it is one line a player can read. The general rule: **a trait that reads another trait's output needs an explicit termination argument before it is written.** `ARCHITECTURE.md` carries the engineering side of this.

## Worked example

The gate for this document is that every rule survives being walked through by hand. This walk-through justifies the hero-acts-last rule, the adjacency cascade, Guard, and armour all at once.

**Your hero** — Knight, 30 Health, base attack 2, **Iron Sword** worn (+3 Power), so it swings at **5**. Board empty. 3 energy.

**Your hand**

| Card | Type | Cost | Power | Health | Trait |
|---|---|---|---|---|---|
| Human Squire | Unit | 1 | 1 | 2 | Relay |
| Dwarf Avenger | Unit | 2 | 2 | 3 | Wake |

**Enemy board** — one **Stone Troll**: 3 Power, 7 Health, **Armour 2**, **Guard**.

The Troll's Guard is not decoration. Without it the enemy hero is in the target pool alongside the Troll — that is this document's own targeting rule — and the numbers below would not reproduce. An example that cannot be walked through by hand is not a specification, so the constraint is stated rather than assumed.

You can afford both cards. The only decision left is **which unit goes on the right**.

### Arrangement A — Squire first, Avenger second

1. **Squire** acts: 1 Power − 2 armour = **0 damage**. The Troll hits back for 3; the Squire has 2 Health and **dies**. It never reaches its after-acting trait, so **Relay does not fire**.
2. The checkpoint announces the death. The **Avenger stands to the Squire's right and has Wake: +2 Power**, now 4.
3. **Avenger** acts: 4 − 2 = **2 damage**. Troll to 5. The Troll hits back for 3; the Avenger has 3 Health and dies.
4. **Hero** acts: 2 base + 3 sword = 5 − 2 = **3 damage**. Troll to 2. A hero takes nothing back.

Troll takes **5**, dropping to 2. Your line is empty.

### Arrangement B — Avenger first, Squire second

1. **Avenger** acts: 2 − 2 = **0 damage**. The Troll hits back for 3 and the Avenger dies. Its right-hand neighbour is the Squire, which has no Wake, so **nothing answers the death**.
2. **Squire** acts: 1 − 2 = **0 damage**. The Troll hits back for 3 and the Squire dies; again Relay never fires.
3. **Hero** acts: 5 − 2 = **3 damage**. Troll to 4.

Troll takes **3**, dropping to 4. Your line is empty.

### Then the enemy turn, and it is not identical

Your line is empty in both, so the Troll's attack reaches the Knight: 3 Power − 0 armour = **3 damage**, Knight to 27. **The Knight is a defender, and a defender always hits back** — 5 Power − 2 armour = **3 damage** into the Troll.

- In **A** the Troll was on 2. It dies on its own turn, to a blow it started.
- In **B** the Troll was on 4. It survives on 1.

Then the Warchief swings for 2 and the Knight ends the round on 25 either way. One arrangement cleared the board; the other left a Troll standing.

### What the example proves

**Both arrangements put the same three attacks into the same target**, and one of them deals almost twice as much. Four rules are doing the work, and each is a decision:

- **Against armour, concentrate.** Armour is subtracted per attack, so a 1-Power body against Armour 2 contributes nothing at all however you arrange it, while the same 2 points handed to something already above the armour line are worth exactly 2. That is why Wake landing on the Avenger is worth more than Relay would have been.
- **Against a swarm, spread.** Overkill is wasted, so 1/3/5 across three 3-Health goblins kills two cleanly while 1/1/7 kills one and wastes four. The inversion between these two is the core tactical decision, and random targeting is what makes it interesting: you cannot choose *who* gets hit, so you play the only variable you control — how your damage is divided among attackers.
- **Attacking has a price.** Both bodies die on their own turn, to blows they started. A line is not a damage total; it is a set of bodies with a cost attached to using them.
- **A death is a resource if something is standing next to it.** Wake was inert for the whole life of this design because your units only ever died on the enemy's turn. Mutual damage is what put a death inside your own phase, and putting the Avenger to the right of the body that was going to die is the whole difference between the two arrangements.

## Card types

**Units, spells and equipment [owner].**

**Units** are bodies with Power, Health, a race and usually a trait. They persist until they die.

**Spells** are cast by the hero for immediate effect. Critically, **spells are where board-wide effects live** — see below.

**Equipment** attaches to the hero in **three fixed slots: weapon, armour, trinket [owner]**. A new piece replaces whatever is in that slot. **Equipment resets at the end of every fight [owner]**.

That last rule gives the design a clean split, and it is worth stating as an intent so it does not get eroded:

> **Equipment is the per-fight tactical layer. Sigils are the run-long progression layer.** They never compete.

## Races and classes

**Races are mechanical tribes [owner]** — dwarf, elf, human, dragon. Cards care about them: *Kindle* counts adjacent dwarves, an elf lord might Relay to every elf beside it.

**The player picks a class [owner]** — Knight, Mage, Ranger — which sets the starting deck and the card pool.

**Class sets the pool; races appear across all of it [owner].** A Knight drafts dwarves, elves and humans alike. Tribal identity is a direction you *commit to* mid-run based on what the run offers, not something handed to you at the start. This is what makes the same class play differently across runs.

## The run

Slay the Spire's structure, compressed. Target run length **30 minutes** — shorter than Spire's 60–90, because automatic resolution makes a fight fast, and Grail's 15–45 is the right neighbourhood.

Three acts, each a branching map, each ending in a boss. Nodes: fight, elite, event, shop, **forge**, rest.

### Sigils

**Sigils are the run's progression system [owner]** and the direct descendant of Grail's stickers. A sigil attaches to a card and grants it a trait — a *Relay Sigil* makes any unit a relay. This is what lets a player **author** a cascade rather than wait to draft one, and a run's identity is usually the moment it picks up its second sigil of a kind.

**A sigil placed on the hero applies to the whole run [owner].** This is where relics went: rather than a second progression system doing the same job, boss and event rewards are hero sigils. One system, two targets, and "card or hero?" is itself a decision.

### Forge and unlocks

**Forge** nodes permanently upgrade one card: +1 Power, +1 Health, or −1 cost.

**Meta-progression is unlocks only [owner].** Finishing runs adds cards and sigils to the pool. No persistent power, no hub to rebuild — every run is winnable from the first one.

## Non-goals

Multiplayer, a live-service economy, real-money purchases, and a collection metagame. One player, one run.

There is no raster art pipeline, but that is a consequence and not a goal: card art is heraldic, written as a blazon in the card's own data and rendered to SVG by code, so there are no image assets. `ARCHITECTURE.md` carries the art system.

**PvP is a deliberate non-goal despite Grail having it.** The temptation is real — resolution is deterministic and headless, so fighting a snapshot of another player's board would be nearly free to build. It stays out of scope until the single-player game has proven its core turn is fun, because PvP would put balance pressure on every card before that question is answered.

## Open questions, in priority order

1. **The cheap bodies do not survive their own swing, and the pool has not been rebalanced for that.** A 1-Power, 2-Health Squire dies to any 2-Power defender the moment it attacks, so every cheap body is now a one-shot and the trait printed on it may never fire. That is a *content* consequence of a rules change — no card in the pool was costed for a world where attacking has a price — and it is the first thing a balance pass has to answer. The pool is currently ten player cards; nothing was retuned in the round that made combat mutual, deliberately, so the rules change could be measured on its own.
2. **What is the token-generation budget?** This is the only place the board can genuinely run away, since summoned bodies bypass the energy and hand gates that cap it. Needs a rule before the first summon card is written — a per-turn cap, a cost that scales, or summons that expire.
3. **Is Wake worth more than it costs to think about?** It is live for the first time and measurably carries part of the placement decision, but it only pays when a body dies to the left of it, which is a roll. A trait whose value is a coin flip is a trait a player cannot plan around, and the fix if it is one is to widen what answers the death rather than to change the number.
4. **AoE is no longer the only counter to a wide board, and that changes what it is for.** The open risk used to be that AoE was a narrow band: common wipes make going wide unplayable, rare ones make it dominant. Mutual damage is a second, *structural* counter — more bodies attacking is more damage taken, every turn, with no card required — so the pressure on the AoE band is lower. **The mitigation still worth trying costs nothing: telegraph enemy AoE a full turn ahead**, which converts a coin flip into a read. What is now open is whether AoE is still needed at its current numbers or whether it is redundant.
5. **Does resolution stay quick at realistic width?** Ten units resolving one at a time is roughly three seconds if each step is visible, which is acceptable but not generous. Likely answer is batching the visual while keeping the logic strictly sequential. A normal polish problem rather than a threat to the design.
6. **Does 3 energy across units, spells and equipment leave enough for any of them?** Three card types competing for three points is tight. Equipment may need to be cheap, or free on the turn you draw it, or the number may need to be four.
7. **Does the sigil system explode the balance surface past what can be tuned?** Cards times sigils is a large space. Seeded batch simulation through the headless engine is the answer, which is why that engine is an invariant in `AGENTS.md` rather than a convenience.
8. **Is "class sets the pool, races spread across it" enough tribal density to build around?** If dwarves are one card in six, a dwarf build may never come together. The draft may need to bias toward whatever tribe you have already committed to.
