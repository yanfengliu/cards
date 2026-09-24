// The one consistency check every sigil grant has to pass.
//
// A grant is recorded twice on purpose: in the run's ledger (`RunState.sigils`,
// the history of what was picked up and where it went) and where it applies
// (the trait on the `DeckCard`, or the Health bar a hero sigil moved). Two
// records of one fact can drift, and this file is the answer to that rather
// than an argument that they will not: `sigilProblems` walks both directions -
// every ledger entry has its effect in place, every effect in place has its
// ledger entry - and returns every disagreement as a sentence. `npm run
// verify:run` fails on a non-empty list, and `test/sigils.test.ts` runs it
// over every fixture run.
//
// What it cannot see, and what covers that instead: `sigilProblems` compares
// two run-layer records of the same grant, so a grant both records agree on
// and the *fight* never receives passes it. The other half reads what the
// engine is handed and asks whether each granted sigil is in there, each
// ungranted one is not, and every other field of each card and of the hero is
// the content's. It comes in two readings:
//
//   - `foughtSigilProblems` reads **every fight a run plays**, elites and
//     bosses included, as the engine holds it when the fight begins: the pool
//     it resolves cards through, the hero it built and the deck it shuffled.
//     `watchFights` hands it each one through the agent's placement policy,
//     which the engine calls with the live fight.
//   - `fightSigilProblems` reads **one setup** built from the finished run, so
//     a grant taken after the last fight, which no fight ever receives, is
//     still asked of the one function that builds a setup.
//
// The second alone was the whole check until the final acceptance review of
// `907c8e9`: it stands the run at act 0's first node, always an ordinary
// fight, so card sigils stripped from every elite and boss fight changed 129
// of 360 runs and passed all seven gates. Both are called by `npm run
// verify:run`, which plays the Knight, by `test/classes.test.ts`, which plays
// all three classes, and by `test/sigils.test.ts`, which makes each one fire
// on fixture fights with one thing moved.

import type { Fight, FightSetup } from '../engine/fight.ts';
import { mixSeeds } from '../engine/rng.ts';
import { type CardPool, type Entity, type HeroSpec, type UnitCard, heroOf } from '../engine/state.ts';
import { TAG_ENCOUNTER, sigilById } from './nodes.ts';
import { type RunAgent, cloneRunState, fightSetupFor } from './run.ts';
import type { MapNode, NodeType, RunEncounter, RunState, SigilDef } from './types.ts';

export function sigilProblems(run: RunState): string[] {
  const problems: string[] = [];
  const content = run.content;
  const heldHero = new Set<string>();
  const ledgerCard = new Set<string>();
  // The bar the content plus the ledger say the hero should have.
  let bar = content.hero.health;

  for (const g of run.sigils) {
    let def: SigilDef;
    try {
      def = sigilById(content, g.sigilId);
    } catch {
      problems.push(`the ledger names "${g.sigilId}", which the content does not define`);
      continue;
    }
    if (g.target === 'hero') {
      if (def.kind !== 'hero') {
        problems.push(`the ledger puts card sigil "${def.id}" on the hero`);
        continue;
      }
      if (heldHero.has(def.id)) problems.push(`the hero holds "${def.id}" twice`);
      heldHero.add(def.id);
      if (def.effect.kind === 'maxHealth') bar += def.effect.amount;
      continue;
    }
    const target = g.target;
    if (def.kind !== 'card') {
      problems.push(`the ledger puts hero sigil "${def.id}" on deck card ${target.instanceId}`);
      continue;
    }
    const dc = run.deck.find((d) => d.instanceId === target.instanceId);
    if (dc === undefined) {
      problems.push(`the ledger attaches "${def.id}" to ${target.instanceId}, which is not in the deck`);
      continue;
    }
    const key = `${dc.instanceId}:${def.id}`;
    if (ledgerCard.has(key)) problems.push(`"${def.id}" is attached to ${dc.instanceId} twice in the ledger`);
    ledgerCard.add(key);
    const on = dc.sigils.find((s) => s.id === def.id);
    if (on === undefined) {
      problems.push(`the ledger attaches "${def.id}" to ${dc.instanceId} and the deck card does not carry it`);
    } else if (on.trait !== def.trait) {
      problems.push(
        `"${def.id}" grants ${def.trait} and the deck card ${dc.instanceId} carries it as ${on.trait}`,
      );
    }
  }

  for (const dc of run.deck) {
    const seenTraits = new Set<string>();
    for (const s of dc.sigils) {
      if (!ledgerCard.has(`${dc.instanceId}:${s.id}`)) {
        problems.push(`${dc.instanceId} carries "${s.id}" and the ledger never granted it`);
      }
      if (seenTraits.has(s.trait)) {
        problems.push(`${dc.instanceId} carries ${s.trait} from two sigils`);
      }
      seenTraits.add(s.trait);
      if (content.pool.card(dc.cardId).traits.includes(s.trait)) {
        problems.push(
          `${dc.instanceId} carries "${s.id}" for ${s.trait}, which ${dc.cardId} already prints`,
        );
      }
    }
  }

  // The one hero effect that is state rather than a number read at fight time.
  if (run.hero.maxHealth !== bar) {
    problems.push(
      `the hero's maximum Health is ${run.hero.maxHealth}, and the content's ${content.hero.health} ` +
        `plus every maximum-Health sigil in the ledger make it ${bar}`,
    );
  }
  if (run.hero.health > run.hero.maxHealth) {
    problems.push(`the hero stands at ${run.hero.health}, above its maximum of ${run.hero.maxHealth}`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// The other half: what the fight is actually handed
// ---------------------------------------------------------------------------

/**
 * The fight setup a run would hand `setupFight` right now, through the one
 * function that builds it, plus the copy of the run it was built from and the
 * node that copy stands at.
 *
 * A finished run stands nowhere a fight can be fought - a won run's `act` is
 * past the last one, a lost run's node is where it died - so this stands a
 * copy of it at act 0's first node, which is always an ordinary fight. That
 * rests on an assumption: that nothing the check below reads depends on which
 * node it is. Today the pool is `runPool(content.pool, deck)` and the hero
 * spec is `heroSpecFor(run)`, both functions of the deck and the ledger alone,
 * but nothing here can see an elite or a boss. **The assumption is not what
 * holds real fights to the ledger** - `foughtSigilProblems` reads every one a
 * run plays. The copy and the node come back so the enemy hero's Power and
 * Armour can be held to what the content prints for that node, which
 * `printedEncounter` reads off the act's table rather than through
 * `encounterFor`.
 */
function seamSetup(run: RunState): { setup: FightSetup; at: RunState; node: MapNode } {
  const at = cloneRunState(run);
  at.act = 0;
  const map = at.maps[0];
  const first = map?.rows[0]?.[0];
  const node: MapNode | undefined = first === undefined ? undefined : map?.nodes[first];
  if (node === undefined) {
    throw new Error(
      'run sigils: this run has no act 0 map with a first row, so there is no node to build a ' +
        'fight setup at. Every act map is generated at `startRun`, so a run missing one is a bug ' +
        'in the run generator rather than bad input.',
    );
  }
  at.nodeId = node.id;
  return { setup: fightSetupFor(at, node), at, node };
}

/**
 * Every granted sigil is in the setup the run would hand the engine from
 * where it finished, and nothing that was never granted is - read as: each
 * card the fight resolves and the hero it is handed are the content, plus
 * what the ledger granted, plus what the forge did, **field by field**, and
 * nothing else. It is one setup, built by `seamSetup`. The pool object itself
 * is not walked: its `handSize` and `energyPerTurn` are held below, and
 * `runPool` hands over no `castable`, which is harmless while no spell or
 * piece of equipment can enter a run deck: `runPool` would throw building the
 * pool first, because the content's `card` refuses a spell or equipment id.
 *
 * `sigilProblems` holds two *run-layer* records of a grant to each other. This
 * holds the run layer to the engine's own inputs, which is what a player
 * actually plays: the `CardPool` the fight resolves cards through, and the
 * `HeroSpec` the player's hero is built from.
 *
 *   - Each deck instance resolves to exactly its printed traits followed by
 *     the traits the *ledger* says a sigil granted it, in ledger order. Both
 *     directions at once: a granted trait missing from the fight is a problem,
 *     and so is a trait in the fight that neither the card prints nor the
 *     ledger granted.
 *   - Every **other** field of that card is the printed card's, except the
 *     three the forge moves - cost, Power and Health, by the deck card's own
 *     record, cost floored at 0 - and the id, which is the instance's. The
 *     field list is read off the two card objects, never written here, so a
 *     race, a name, an Armour, or a field `UnitCard` gains tomorrow is held to
 *     the printed card the day it exists. The race is the reason this is a
 *     walk: `resolveDeckCard` carries it through `...card`, so the type system
 *     promised *a* race and nothing promised the right one - setting every
 *     sigilled card's race to human passed every gate while changing what
 *     Kindle, Banner and Chorus did in the runs it touched.
 *   - The player's Power and Armour are the content's plus every `heroPower`
 *     and `heroArmour` in the ledger, exactly - so a run holding none fights
 *     at the content's numbers and one holding two gets both - and its Health
 *     is the run's bar.
 *   - Every **other** field of the player's hero is the content hero's, walked
 *     the same way: its name, and its `traits`, which *are* the class - the
 *     Ranger's `volley`, the Mage's `scorch`. `heroSpecFor` carries them
 *     through `...hero`, and rebuilding that line field by field without them
 *     passed every gate while the Ranger swung once and the Mage never burned.
 *     No sigil moves a hero's traits, so the expected list is the content's
 *     exactly, with "none" and `[]` read as the same thing because `makeHero`
 *     reads them the same way.
 *   - The enemy hero's Power and Armour are the ones the content prints for
 *     the encounter at that node, read off the act's table by
 *     `printedEncounter`. That is all of the enemy side this compares: not
 *     the enemy hero's Health, traits or name, and not the enemy's cards,
 *     opening units or deck.
 *
 * **Everything expected here is read off `run.sigils`, `content.sigils`, the
 * printed card, the deck card's forge record, `content.hero` and the act's
 * encounter table, and nothing off `grantedTraits`, `heldHeroSigils`,
 * `resolveDeckCard`, `heroSpecFor` or `encounterFor`.** That is deliberate
 * and it is the whole difference between a check and a tautology: the
 * subject side of every comparison below - `runPool`, `resolveDeckCard`,
 * `heroSpecFor`, `encounterFor` - is built out of those helpers, so a check
 * that also used them would prove only that the code agrees with itself. The
 * first draft of this function did exactly that. Until the re-review of
 * `2b040d9` both readings still asked `encounterFor` for the enemy hero they
 * compared, so a boss that gained the player's Power sigils inside
 * `encounterFor` passed all seven gates. The forge's arithmetic is restated
 * here from the design's "+1 Power, +1 Health, or -1 cost" for the same
 * reason, and so is which encounter a node fields.
 *
 * The bound: this reads **one** setup, built at a node it picks, not the
 * fights the run played - `foughtSigilProblems` below is those - and it reads
 * the setup, not a resolved fight. It proves the fight is *handed* the sigil,
 * not that a card carrying one was ever drawn - which is a matter of the
 * shuffle, and is what `test/sigils.test.ts`'s comparison of a sigilled Relay
 * against a printed one covers instead. And it holds the fight to
 * `run.content.hero`, not to the class: that the content's hero *is* the
 * class's is `test/classes.test.ts`'s claim, and that every fight a class
 * plays is handed its class's hero is a second test there that reads the hero
 * the engine built inside real fights.
 */
export function fightSigilProblems(run: RunState): string[] {
  const { setup, at, node } = seamSetup(run);
  const ledger = readLedger(run);
  const { power, armour } = ledger;
  const problems = cardProblems(run, setup.pool, ledger);

  const hero = run.content.hero;
  // The hero's other fields, walked the same way: its name and its traits,
  // which are the class. The three numbers have their own checks below.
  for (const key of fieldsOf(hero, setup.playerHero)) {
    if (key === 'power' || key === 'armour' || key === 'health') continue;
    const got = fieldOf(setup.playerHero, key);
    const expected = fieldOf(hero, key);
    const same =
      key === 'traits' ? sameValue(got ?? [], expected ?? []) : sameValue(got, expected);
    if (!same) {
      problems.push(
        `the fight's hero has ${key} ${shown(got)}, and the hero this run's content hands every ` +
          `fight - the ${run.classId}'s - has ${shown(expected)}. No sigil moves a hero's ${key}, ` +
          `so the fight must be handed the content's`,
      );
    }
  }
  if (setup.playerHero.power !== hero.power + power) {
    problems.push(
      `the fight's hero swings for ${setup.playerHero.power}, and the content's ${hero.power} plus ` +
        `every Power sigil in the ledger make it ${hero.power + power}`,
    );
  }
  if (setup.playerHero.armour !== hero.armour + armour) {
    problems.push(
      `the fight's hero wears ${setup.playerHero.armour} Armour, and the content's ${hero.armour} ` +
        `plus every Armour sigil in the ledger make it ${hero.armour + armour}`,
    );
  }
  if (setup.playerHero.health !== run.hero.health) {
    problems.push(
      `the fight's hero opens on ${setup.playerHero.health} Health and the run stands at ` +
        `${run.hero.health}`,
    );
  }
  problems.push(...perFightNumberProblems(run, setup.pool));
  problems.push(
    ...enemyHeroProblems(
      at,
      node,
      'the setup hands the fight an enemy hero',
      setup.enemyHero.power,
      setup.enemyHero.armour,
    ),
  );

  return problems;
}

/** The ledger, re-read from scratch, as both readings of a fight expect it. */
type LedgerReading = {
  /**
   * Instance id -> the traits its card sigils grant, in the order they were
   * granted, minus anything the card already prints (attaching such a sigil
   * is refused, and a ledger holding one is `sigilProblems`'s complaint
   * rather than this one's).
   */
  readonly granted: ReadonlyMap<string, readonly string[]>;
  /** What every `heroPower` and every `heroArmour` in the ledger adds, summed. */
  readonly power: number;
  readonly armour: number;
};

function readLedger(run: RunState): LedgerReading {
  const base = run.content.pool;
  const granted = new Map<string, string[]>();
  let power = 0;
  let armour = 0;
  for (const g of run.sigils) {
    const def = run.content.sigils.find((s) => s.id === g.sigilId);
    if (def === undefined) continue; // `sigilProblems` names an unknown id.
    if (g.target === 'hero') {
      if (def.kind !== 'hero') continue;
      if (def.effect.kind === 'heroPower') power += def.effect.amount;
      else if (def.effect.kind === 'heroArmour') armour += def.effect.amount;
      continue;
    }
    if (def.kind !== 'card') continue;
    const id = g.target.instanceId;
    const dc = run.deck.find((d) => d.instanceId === id);
    if (dc === undefined) continue; // Also `sigilProblems`'s complaint.
    if (base.card(dc.cardId).traits.includes(def.trait)) continue;
    const list = granted.get(id) ?? [];
    if (!list.includes(def.trait)) list.push(def.trait);
    granted.set(id, list);
  }
  return { granted, power, armour };
}

/**
 * Each deck card as `pool` resolves it, held to its printed card, the ledger's
 * grants and its forge record: the traits exactly, every other field walked
 * off both objects. A card the pool cannot resolve at all is a problem rather
 * than a throw, so one missing instance does not hide the rest.
 */
function cardProblems(run: RunState, pool: CardPool, ledger: LedgerReading): string[] {
  const problems: string[] = [];
  const base = run.content.pool;
  for (const dc of run.deck) {
    const card = base.card(dc.cardId);
    const printed = card.traits;
    const granted = ledger.granted.get(dc.instanceId) ?? [];
    const want = [...printed, ...granted];
    let resolved: UnitCard;
    try {
      resolved = pool.card(dc.instanceId);
    } catch (e) {
      problems.push(
        `the fight cannot resolve ${dc.instanceId}, a card in the run's deck: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    const fought = resolved.traits;
    if (fought.join(',') !== want.join(',')) {
      problems.push(
        `the fight resolves ${dc.instanceId} with traits [${fought.join(', ')}] and the ledger ` +
          `says it should be [${want.join(', ')}] - ${dc.cardId} prints [${printed.join(', ')}] ` +
          `and the ledger grants it [${granted.join(', ')}]`,
      );
    }
    // Every other field, walked off both objects. What the forge moves is
    // restated from the design; everything else must be the printed card's.
    const forged: Readonly<Record<string, unknown>> = {
      id: dc.instanceId,
      cost: Math.max(0, card.cost + dc.costDelta),
      power: card.power + dc.powerBonus,
      health: card.health + dc.healthBonus,
    };
    for (const key of fieldsOf(card, resolved)) {
      if (key === 'traits') continue; // Compared above, against the ledger.
      const got = fieldOf(resolved, key);
      if (key in forged) {
        const expected = forged[key];
        if (!sameValue(got, expected)) {
          problems.push(
            `the fight resolves ${dc.instanceId} with ${key} ${shown(got)}, and ${dc.cardId} prints ` +
              `${shown(fieldOf(card, key))}, which this deck card's forge record makes ${shown(expected)}`,
          );
        }
        continue;
      }
      const expected = fieldOf(card, key);
      if (!sameValue(got, expected)) {
        problems.push(
          `the fight resolves ${dc.instanceId} with ${key} ${shown(got)}, and ${dc.cardId} prints ` +
            `${shown(expected)} - neither a sigil nor the forge moves a card's ${key}, so the fight ` +
            `must be handed the printed one`,
        );
      }
    }
  }
  return problems;
}

/**
 * The pool's two per-fight numbers are read for *both* sides by `fight.ts` -
 * `enemyPlays` draws the enemy to the same `handSize` - so a hero sigil that
 * moved either would hand the enemy the same card. Nothing may move them.
 */
function perFightNumberProblems(run: RunState, pool: CardPool): string[] {
  const base = run.content.pool;
  if (pool.handSize === base.handSize && pool.energyPerTurn === base.energyPerTurn) return [];
  return [
    `the fight is handed a hand of ${pool.handSize} and ${pool.energyPerTurn} Energy where the ` +
      `content's pool is ${base.handSize} and ${base.energyPerTurn} - both are read for both ` +
      `sides, so moving one arms the enemy too`,
  ];
}

/**
 * The encounter the content prints for a fight node, read off the act's own
 * table: the act's boss at a boss, and at an elite or an ordinary fight the
 * entry of the act's list that `mixSeeds(seed, act, node id, TAG_ENCOUNTER)`
 * picks. `undefined` where the act is missing or that list is empty.
 *
 * **Never through `encounterFor`.** `fightSetupFor` builds the fight's enemy
 * out of it, so a comparison that asked it would move with any change made
 * inside it. Until the re-review of `2b040d9` both readings did ask it, and a
 * boss that gained the player's Power sigils inside `encounterFor` passed all
 * seven gates. The node-keyed pick is restated here instead, the way the
 * forge's arithmetic is restated above.
 *
 * The bound: every shipped act prints one Power and one Armour for all of its
 * elites, and one for all of its ordinary fights, so on the shipped content a
 * restated pick that named the wrong entry would change nothing compared.
 * `test/sigils.test.ts` holds the pick on a fixture act whose two elites and
 * two ordinary fights print different Power.
 */
function printedEncounter(run: RunState, node: MapNode): RunEncounter | undefined {
  const act = run.content.acts[run.act];
  if (act === undefined) return undefined;
  if (node.type === 'boss') return act.boss;
  const list = node.type === 'elite' ? act.elites : act.fights;
  if (list.length === 0) return undefined;
  return list[mixSeeds(run.seed, run.act, node.id, TAG_ENCOUNTER) % list.length];
}

/**
 * The enemy hero's Power and Armour, as the fight has them, against what the
 * content prints for the encounter at `node`, read by `printedEncounter`.
 * With the hand size and Energy both sides share, which
 * `perFightNumberProblems` holds, this is all of the enemy side either
 * reading compares. The enemy hero's Health, traits and name are not
 * compared, and neither are the enemy's cards, opening units or deck.
 */
function enemyHeroProblems(
  run: RunState,
  node: MapNode,
  subject: string,
  power: number,
  armour: number,
): string[] {
  const enc = printedEncounter(run, node);
  if (enc === undefined) {
    return [
      `${subject} at ${power} Power / ${armour} Armour, and act ${run.act + 1}'s content prints ` +
        `no ${node.type} encounter to hold it to`,
    ];
  }
  if (power === enc.enemyHero.power && armour === enc.enemyHero.armour) return [];
  return [
    `${subject} at ${power} Power / ${armour} Armour, and ${enc.id}, the encounter act ` +
      `${run.act + 1}'s content prints for this ${node.type}, has ${enc.enemyHero.power} / ` +
      `${enc.enemyHero.armour}`,
  ];
}

// ---------------------------------------------------------------------------
// Every fight a run plays, read as the engine holds it
// ---------------------------------------------------------------------------

/**
 * How each field of a `HeroSpec` is read back off the hero the engine built
 * from it (`makeHero` in `src/engine/state.ts`). A `Record` over `keyof
 * HeroSpec`, so a field the spec gains does not compile until somebody says
 * how the check reads it.
 */
const ON_THE_BUILT_HERO: Readonly<Record<keyof HeroSpec, (e: Entity) => unknown>> = {
  name: (e) => e.cardId,
  health: (e) => e.health,
  power: (e) => e.basePower,
  armour: (e) => e.armour,
  traits: (e) => e.traits,
};

/**
 * One fight a run is playing, held to the run's content plus its ledger as
 * the engine actually holds it: the `CardPool` it resolves every card
 * through, the hero entity it built from the spec it was handed, the enemy
 * hero, and the deck it shuffled.
 *
 * `fightSigilProblems` above reads one setup, built from the finished run at
 * a node it picks, and cannot see an elite or a boss. This is the reading
 * the claim "every fight is handed its ledger" is about: `watchFights` calls
 * it once for every fight a run plays - ordinary, elite and boss - through
 * the agent's placement policy, the hook `test/classes.test.ts` already read
 * the hero entity through.
 *
 * Two preconditions, both of which `watchFights` meets:
 *
 *   - `run` is the run *at the node the fight is fought at*: the live
 *     `RunState` the agent's `travel` was last handed. Nothing on it moves
 *     during a fight - `visit` carries the Health out and grants anything won
 *     only after `driver.fight` returns - so its deck, ledger and bar are
 *     exactly what the fight was built from.
 *   - `fight` is read at its first placement, before round 1 resolves: nothing
 *     has struck, no card has left the hand, and `startTurn` has cleared only
 *     the per-turn buff. Read any later and it is refused, not guessed at.
 *
 * The expected side is read the way `fightSigilProblems` reads it - off the
 * ledger, the printed cards, the forge records, `run.content.hero` and the
 * act's encounter table - and never off `resolveDeckCard`, `heroSpecFor`,
 * `fightSetupFor` or `encounterFor`.
 *
 * Not held: the hero's `maxHealth`. The engine takes the Health a fight is
 * handed as its maximum too, so a fight's own maximum is the Health the hero
 * walked in with rather than the run's. That is display-only and recorded as
 * open in `docs/learning/defect-register.md`. Holding it here would either
 * pin that defect as correct or fail on every run that took damage.
 */
export function foughtSigilProblems(run: RunState, fight: Fight): string[] {
  if (fight.round !== 1) {
    return [
      `the fight was read in round ${fight.round}, and what it was handed can only be read at its ` +
        `first placement, before round 1 resolves`,
    ];
  }
  const node = run.maps[run.act]?.nodes[run.nodeId];
  if (node === undefined) {
    return [
      `the run stands at node ${run.nodeId} of act ${run.act + 1}, which its map does not hold, so ` +
        `there is no encounter to hold the fight to`,
    ];
  }
  const ledger = readLedger(run);
  const problems = cardProblems(run, fight.pool, ledger);

  // The deck the engine shuffled, as a multiset. At the first placement no
  // card has left play, so the undrawn part of the deck plus the hand is all
  // of it - also when a deck smaller than the hand was reshuffled to draw.
  const shuffled = [...fight.player.deck.slice(fight.player.cursor), ...fight.player.hand].sort();
  const held = run.deck.map((d) => d.instanceId).sort();
  if (shuffled.join(',') !== held.join(',')) {
    problems.push(
      `the fight shuffled [${shuffled.join(', ')}] and the run's deck is [${held.join(', ')}] - a ` +
        `card the ledger granted a sigil to is only handed to the fight if it is in the deck`,
    );
  }

  const hero = run.content.hero;
  const built = heroOf(fight.state, 'player');
  const want: Readonly<Record<keyof HeroSpec, { readonly value: unknown; readonly why: string }>> = {
    name: {
      value: `hero:${hero.name}`,
      why: `the hero this run's content hands every fight, the ${run.classId}'s, and no sigil moves it`,
    },
    traits: {
      value: hero.traits ?? [],
      why: `the ${run.classId}'s traits, which are the class, and no sigil moves them`,
    },
    power: {
      value: hero.power + ledger.power,
      why: `the content's ${hero.power} plus every Power sigil in the ledger`,
    },
    armour: {
      value: hero.armour + ledger.armour,
      why: `the content's ${hero.armour} plus every Armour sigil in the ledger`,
    },
    health: { value: run.hero.health, why: 'the Health the run stood at when the fight began' },
  };
  for (const key of Object.keys(ON_THE_BUILT_HERO) as (keyof HeroSpec)[]) {
    const got = ON_THE_BUILT_HERO[key](built);
    if (!sameValue(got, want[key].value)) {
      problems.push(
        `the engine built the player's hero with ${key} ${shown(got)}, and it should be ` +
          `${shown(want[key].value)}: ${want[key].why}`,
      );
    }
  }

  problems.push(...perFightNumberProblems(run, fight.pool));

  const foe = heroOf(fight.state, 'enemy');
  problems.push(
    ...enemyHeroProblems(run, node, 'the engine built the enemy hero', foe.basePower, foe.armour),
  );
  return problems;
}

/** The node kinds a fight is fought at. */
export type FightNodeType = Extract<NodeType, 'fight' | 'elite' | 'boss'>;

/** How many fights of one kind a watch held, and how many of them had something to hold. */
export type FightTally = {
  fights: number;
  /** Fights where a card in the deck carried a card sigil the ledger granted. */
  withCardSigil: number;
  /** Fights where the ledger held a hero sigil that moves the hero's Power or Armour. */
  withHeroSigil: number;
};

/** What `watchFights` hands back: the agent to play with, and what it saw. */
export type FightWatch = {
  /** The agent handed in, with its `travel` and `placement` watched. Decides nothing differently. */
  readonly agent: RunAgent;
  /** Fights held so far, by the kind of node each was fought at. */
  readonly held: Readonly<Record<FightNodeType, Readonly<FightTally>>>;
  /** Every disagreement `foughtSigilProblems` found, each naming the fight it was found in. */
  readonly problems: readonly string[];
};

/**
 * `agent`, watched: the first time the engine hands its placement policy a
 * fight, that fight is held to the run as it stands at the node, by
 * `foughtSigilProblems`. Every decision is still `agent`'s own, so a watched
 * run is the unwatched run, draw for draw and hash for hash.
 *
 * The live run is taken from `travel`, which `step` asks before every node, so
 * a fight's run is the node's. A fight seen before any travel choice, or at a
 * node that is not a fight, elite or boss, is a problem rather than a guess.
 * `held` is what makes "every fight" checkable by the caller: its fights must
 * add up to the run's own `fightsFought`, and a window with no elite or no
 * boss fought while a sigil was held did not test the claim for them.
 */
export function watchFights(agent: RunAgent): FightWatch {
  const tally = (): FightTally => ({ fights: 0, withCardSigil: 0, withHeroSigil: 0 });
  const held: Record<FightNodeType, FightTally> = { fight: tally(), elite: tally(), boss: tally() };
  const problems: string[] = [];
  const seen = new Set<Fight>();
  let at: RunState | null = null;
  const watched: RunAgent = {
    ...agent,
    travel: (run, options) => {
      at = run;
      return agent.travel(run, options);
    },
    placement: (fight, plays) => {
      if (!seen.has(fight)) {
        seen.add(fight);
        const run: RunState | null = at;
        const node = run === null ? undefined : run.maps[run.act]?.nodes[run.nodeId];
        if (run === null || node === undefined) {
          problems.push(`fight ${seen.size}: the engine began a fight before the run chose where to go`);
        } else if (node.type !== 'fight' && node.type !== 'elite' && node.type !== 'boss') {
          problems.push(`fight ${seen.size}: the engine began a fight at a ${node.type} node`);
        } else {
          const ledger = readLedger(run);
          const t = held[node.type];
          t.fights++;
          if (ledger.granted.size > 0) t.withCardSigil++;
          if (ledger.power !== 0 || ledger.armour !== 0) t.withHeroSigil++;
          const where = `act ${run.act + 1} row ${node.row + 1}, ${node.type === 'fight' ? 'a fight' : `the ${node.type}`}`;
          for (const p of foughtSigilProblems(run, fight)) problems.push(`${where}: ${p}`);
        }
      }
      return agent.placement(fight, plays);
    },
  };
  return { agent: watched, held, problems };
}

/**
 * Every own key of either object, first's order then any the second adds. A
 * field only one side has is a disagreement, so both sides are walked.
 */
function fieldsOf(a: object, b: object): string[] {
  const out = Object.keys(a);
  for (const k of Object.keys(b)) if (!out.includes(k)) out.push(k);
  return out;
}

function fieldOf(o: object, key: string): unknown {
  return (o as Readonly<Record<string, unknown>>)[key];
}

/** Structural equality over the values a card or a hero spec holds. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length && ka.every((k) => sameValue(fieldOf(a, k), fieldOf(b, k)))
    );
  }
  return false;
}

/** A value as a problem sentence shows it: quoted, and "nothing" for a field that is not there. */
function shown(v: unknown): string {
  return v === undefined ? 'nothing' : JSON.stringify(v);
}
