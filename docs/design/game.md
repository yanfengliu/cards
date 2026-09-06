# Cards — design of record

Status: **unprototyped**. Every number here is a starting guess with a reason attached, not a balanced value. The worked example is the specification; the prose around it is commentary. Decisions marked **[owner]** were made by the owner directly and are not open for an agent to reverse without asking.

## The pitch

You build a line of adventurers that fights **without taking orders**. Your whole turn is deciding what to add and where to put it, because the line resolves left to right, each unit can change what the next one does, and your hero swings last — so whatever your line hands forward lands on the hero's attack.

## Where each influence lands

Three references, three different jobs. Assigned explicitly, because the risk in a three-way homage is building the average of its influences instead of the union.

| Influence | What it contributes | What is deliberately left behind |
|---|---|---|
| **Hearthstone** | A persistent board of units, a hero with equipment, and races as mechanical tribes. | Escalating mana, hero powers, a collection, a fixed board width, and ordering units to attack. |
| **Slay the Spire** | Run structure: a branching map, a small curated deck, telegraphed enemy intent, and deck thinning as a skill. | Its combat, which has no friendly board at all. Its relics, which merged into sigils. |
| **Grail** | You build a machine and then watch it run. Cards are modified over a run by attachable sigils to produce cascading effects. | Full automation, deck-order cascades, and PvP. |

**Grail's contribution is the one to get right**, because it is the least obvious. Grail's appeal is not that it uses cards; it is authorship-at-a-distance — you tune a construction, commit, and find out whether it worked. This design keeps that feeling but moves the cascade from *deck order* to *board position*, so the player authors it fresh every turn rather than once per run.

## Combat

### The board

**Unlimited width [owner].** There is no slot cap. Units are added to the line and stay until they die.

This is safer than it sounds, because **the deck caps the board long before geometry would**. Three gates bind first: energy (3 a turn against an average unit cost near 1.5 is about two units a turn), hand size (you cannot play what you did not draw), and deck composition (perhaps thirteen units in a twenty-card mid-run deck, cycled roughly once a fight). A six-turn fight offers 18 energy; spending a realistic 70% of it on bodies yields **six to nine units**, less losses. A dedicated swarm build — all 1-cost units, every point spent on them, full cycle — tops out near **fifteen**.

So the board self-limits at roughly twice Hearthstone's width, and **deck design is the board-size dial**: make units cheap and plentiful and boards grow, make them costly and boards stay tight. No slot rule is needed to tune it. Uncapped width is also what makes a swarm archetype possible at all, which a fixed board would quietly forbid.

**The one real exception is token generation.** A spell that summons three goblins, or a unit that summons one every turn, decouples board size from cards drawn — that is the only route to a genuinely unbounded line. Budget discipline belongs on token generators, not on the board rule.

The board clears completely between fights. Nothing on it persists.

### Energy

**Three per turn [owner]**, refreshed every turn, never carried over. Units, spells and equipment all draw from the same three points.

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

**Damage does not carry.** A 7-Power unit striking a 2-Health unit kills it and wastes 5. Excess damage is a trait (*Cleave*), not a default, because trample math turns every turn into arithmetic instead of a decision.

**Armour reduces each incoming attack** by a flat amount, to a minimum of zero. Armour is what makes concentrating damage better than spreading it — see the worked example. It is the counterweight to overkill waste, and the two together are why packaging your damage is a real decision under random targeting.

**Buffs granted during resolution last until end of turn** unless stated otherwise. Permanent growth is rare and expensive.

### The hero

**Health, plus a small class-flavoured attack [owner].** The Knight swings for 2, the Ranger for 1 twice, the Mage for 1 with a rider. The hero always contributes something, and equipment amplifies an attack that already exists rather than switching one on.

Hero health **persists across the whole run** — it is the run's life bar, healed at rest nodes. A fight is won by reducing the enemy hero to zero.

## The cascade

Traits that reference resolution order are the core vocabulary.

- **Relay** — after acting, the unit to my right gains +2 Power this turn.
- **Echo** — repeat the **base** action of the unit that resolved immediately before me, never a copied one.
- **Wake** — when the unit to my left dies this turn, gain +2 Power.
- **Ward** — the unit to my right cannot be struck this turn.
- **Guard** — while I live, attacks against my side must target a Guard.
- **Kindle** — +1 Power for each adjacent friendly dwarf.

### Why adjacency, and not counting

**Every cascade trait references neighbours, never totals.** This is the single most important constraint the unlimited board imposes, and it is easy to violate by accident.

A trait that counts — "+1 Power for each friendly unit that acted before me" — gives the Nth unit +N. On a five-slot board that caps at +4; here the cap is whatever the deck economy currently allows, so it drifts every time unit costs, deck size or fight length are tuned. That is the problem: not that it explodes, but that its ceiling is **not a number anyone controls directly**. An adjacency trait is bounded at two neighbours no matter how wide the line gets, so it stays correct through every later balance pass.

Note that **Relay grants a flat +2 and therefore does not compound**: in a line of five Relays, each unit gives its right neighbour +2 and every unit receives exactly +2. A version worded "gains Power equal to mine" *would* double down the line, which on an unlimited board is unbounded. Do not write that card.

The practical rule: **a new trait may read its neighbours, its own tribe among its neighbours, and the unit that resolved immediately before it — and nothing else.** A trait that wants a board-wide total is a trait that wants a fixed board width, and this game does not have one.

**Echo carries a second constraint, for a different reason.** Worded as "repeat the action of the unit before me", two adjacent Echoes walk backwards forever — and an Echo Sigil would let a player build that deliberately. Restricting Echo to the previous unit's *base* action makes it terminate by construction rather than by an engine guard, and it is one line a player can read. The general rule: **a trait that reads another trait's output needs an explicit termination argument before it is written.** `ARCHITECTURE.md` carries the engineering side of this.

## Worked example

The gate for this document is that every rule survives being walked through by hand. This walk-through justifies the hero-acts-last rule, the adjacency cascade, Guard, and armour all at once.

**Your hero** — Knight, 30 Health, base attack 2, nothing equipped. Board empty. 3 energy.

**Your hand**

| Card | Type | Cost | Power | Health | Trait |
|---|---|---|---|---|---|
| Human Squire | Unit | 1 | 1 | 2 | Relay |
| Dwarf Shieldbearer | Unit | 1 | 1 | 3 | Guard |
| Iron Sword | Equipment (weapon) | 1 | — | — | Hero +3 Power |

**Enemy board** — one **Stone Troll**: 4 Power, 10 Health, **Armour 2**.

You can afford all three cards, and the Sword's slot is fixed. The only decision left is **which unit goes on the right** — that is, who receives the Squire's Relay.

### Arrangement A — Squire first, Shieldbearer second

Relay lands on the Shieldbearer.

1. **Squire** acts: 1 Power − 2 armour = **0 damage**. Relay fires on the Shieldbearer: +2 Power.
2. **Shieldbearer** acts: 1 + 2 = 3 Power − 2 armour = **1 damage**.
3. **Hero** acts: 2 base + 3 sword = 5 Power − 2 armour = **3 damage**.

Troll takes **4**, dropping to 6.

### Arrangement B — Shieldbearer first, Squire second

The Squire is now rightmost, so Relay reaches **the hero**.

1. **Shieldbearer** acts: 1 − 2 = **0 damage**.
2. **Squire** acts: 1 − 2 = **0 damage**. Relay fires on the hero: +2 Power.
3. **Hero** acts: 2 base + 3 sword + 2 relay = 7 Power − 2 armour = **5 damage**.

Troll takes **5**, dropping to 5.

### Then the enemy turn, identical in both

The Troll attacks. Your Shieldbearer is a Guard, so the attack **must** hit it — the hero is not reachable while a Guard lives. 4 Power against 3 Health: the Shieldbearer dies. Your hero takes nothing.

### What the example proves

**Both arrangements deal the same raw total** — Relay's flat +2 goes somewhere either way. What changes is how that damage is *packaged*, and packaging is what matters:

- **Against armour, concentrate.** Armour is subtracted per attack, so three small hits lose 6 to it and one big hit loses 2. B wins here.
- **Against a swarm, spread.** Overkill is wasted, so 1/3/5 across three 3-Health goblins kills two cleanly while 1/1/7 kills one and wastes four. A wins there.

That inversion — armour rewards concentration, overkill rewards spreading — is the core tactical decision, and random targeting is what makes it interesting. You cannot choose *who* gets hit, so you play the only variable you control: **how your damage is divided among attackers**.

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

Multiplayer, a live-service economy, real-money purchases, a collection metagame, and card art pipelines. One player, one run.

**PvP is a deliberate non-goal despite Grail having it.** The temptation is real — resolution is deterministic and headless, so fighting a snapshot of another player's board would be nearly free to build. It stays out of scope until the single-player game has proven its core turn is fun, because PvP would put balance pressure on every card before that question is answered.

## Open questions, in priority order

1. **AoE spells are the only designated counter to a wide board, and that is a narrow band.** The owner chose this deliberately over structural alternatives. The risk it carries: if enemy wipes are common, going wide is unplayable; if rare, going wide is dominant, and either way the fight can hinge on a draw. **The mitigation to try first costs nothing and adds no system: telegraph enemy AoE a full turn ahead.** Enemy intent is already visible, so an incoming wipe becomes a read — "do I commit bodies this turn?" — which converts a coin flip into a decision. Prototype this before adding any second counter.
2. **What is the token-generation budget?** This is the only place the board can genuinely run away, since summoned bodies bypass the energy, hand and deck gates that otherwise cap it. Needs a rule before the first summon card is written — a per-turn cap, a cost that scales, or summons that expire.
3. **Does resolution stay quick at realistic width?** Ten units resolving one at a time is roughly three seconds if each step is visible, which is acceptable but not generous. Likely answer is batching the visual while keeping the logic strictly sequential. A normal polish problem rather than a threat to the design.
4. **Does 3 energy across units, spells and equipment leave enough for any of them?** Three card types competing for three points is tight. Equipment may need to be cheap, or free on the turn you draw it, or the number may need to be four.
5. **Does the sigil system explode the balance surface past what can be tuned?** Cards times sigils is a large space. Seeded batch simulation through the headless engine is the answer, which is why that engine is an invariant in `AGENTS.md` rather than a convenience.
6. **Is "class sets the pool, races spread across it" enough tribal density to build around?** If dwarves are one card in six, a dwarf build may never come together. The draft may need to bias toward whatever tribe you have already committed to.
