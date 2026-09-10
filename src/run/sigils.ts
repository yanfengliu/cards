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
// and the *fight* never receives passes it. `fightSigilProblems`, below, is
// the other half - it reads the pool and the hero spec the run hands the
// engine and asks whether each granted sigil is in there and each ungranted
// one is not. Both are called by `npm run verify:run` and by
// `test/sigils.test.ts`.

import type { FightSetup } from '../engine/fight.ts';
import type { HeroSpec } from '../engine/state.ts';
import { encounterFor, sigilById } from './nodes.ts';
import { cloneRunState, fightSetupFor } from './run.ts';
import type { MapNode, RunState, SigilDef } from './types.ts';

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
 * The fight setup a run would hand `setupFight` right now, plus the encounter
 * it was built from, through the one function that builds it.
 *
 * A finished run stands nowhere a fight can be fought - a won run's `act` is
 * past the last one, a lost run's node is where it died - so this stands a
 * copy of it at act 0's first node. That is honest rather than convenient:
 * nothing the check below reads depends on which node it is. The pool is
 * `runPool(content.pool, deck)` and the hero spec is `heroSpecFor(run)`, and
 * both are functions of the deck and the ledger alone. The encounter comes
 * back only so the enemy hero can be compared with what it prints.
 */
function seamSetup(run: RunState): { setup: FightSetup; enemy: HeroSpec } {
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
  return { setup: fightSetupFor(at, node), enemy: encounterFor(at, node).enemyHero };
}

/**
 * Every granted sigil is in the fight the run hands the engine, and nothing
 * that was never granted is.
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
 *   - The player's Power and Armour are the content's plus every `heroPower`
 *     and `heroArmour` in the ledger, exactly - so a run holding none fights
 *     at the content's numbers and one holding two gets both.
 *   - The enemy hero is the encounter's, untouched. A hero sigil that reached
 *     the other side would be a rule change wearing a reward's clothes.
 *
 * **Everything expected here is read off `run.sigils` and `content.sigils`,
 * and nothing off `grantedTraits`, `heldHeroSigils` or `heroSpecFor`.** That
 * is deliberate and it is the whole difference between a check and a
 * tautology: the subject side of every comparison below - `runPool`,
 * `resolveDeckCard`, `heroSpecFor` - is built out of those helpers, so a
 * check that also used them would prove only that the code agrees with
 * itself. The first draft of this function did exactly that.
 *
 * The bound: this reads the setup, not a resolved fight. It proves the fight
 * is *handed* the sigil, not that a card carrying one was ever drawn - which
 * is a matter of the shuffle, and is what `test/sigils.test.ts`'s comparison
 * of a sigilled Relay against a printed one covers instead.
 */
export function fightSigilProblems(run: RunState): string[] {
  const problems: string[] = [];
  const base = run.content.pool;
  const { setup, enemy } = seamSetup(run);

  // The ledger, re-read from scratch: instance id -> the traits its card
  // sigils grant, in the order they were granted, minus anything the card
  // already prints (attaching such a sigil is refused, and a ledger holding
  // one is `sigilProblems`'s complaint rather than this one's).
  const fromLedger = new Map<string, string[]>();
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
    const list = fromLedger.get(id) ?? [];
    if (!list.includes(def.trait)) list.push(def.trait);
    fromLedger.set(id, list);
  }

  for (const dc of run.deck) {
    const printed = base.card(dc.cardId).traits;
    const granted = fromLedger.get(dc.instanceId) ?? [];
    const want = [...printed, ...granted];
    const fought = setup.pool.card(dc.instanceId).traits;
    if (fought.join(',') !== want.join(',')) {
      problems.push(
        `the fight resolves ${dc.instanceId} with traits [${fought.join(', ')}] and the ledger ` +
          `says it should be [${want.join(', ')}] - ${dc.cardId} prints [${printed.join(', ')}] ` +
          `and the ledger grants it [${granted.join(', ')}]`,
      );
    }
  }

  const hero = run.content.hero;
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
  // The pool's two per-fight numbers are read for *both* sides by `fight.ts` -
  // `enemyPlays` draws the enemy to the same `handSize` - so a hero sigil that
  // moved either would hand the enemy the same card. Nothing may move them.
  if (setup.pool.handSize !== base.handSize || setup.pool.energyPerTurn !== base.energyPerTurn) {
    problems.push(
      `the fight is handed a hand of ${setup.pool.handSize} and ${setup.pool.energyPerTurn} ` +
        `Energy where the content's pool is ${base.handSize} and ${base.energyPerTurn} - both are ` +
        `read for both sides, so moving one arms the enemy too`,
    );
  }
  if (setup.enemyHero.power !== enemy.power || setup.enemyHero.armour !== enemy.armour) {
    problems.push(
      `the enemy hero fights at ${setup.enemyHero.power} Power / ${setup.enemyHero.armour} Armour ` +
        `and its encounter prints ${enemy.power} / ${enemy.armour} - a hero sigil reached the ` +
        `other side`,
    );
  }

  return problems;
}
