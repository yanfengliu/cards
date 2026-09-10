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
// What it cannot see, and what covers that instead: the two hero effects that
// are numbers read off the ledger at fight time, `heroPower` and `heroArmour`,
// have no second record here to drift from. `checkSigilsInFights` in
// `src/sim/runmeasure.ts` compares them, and every card sigil, against the
// fight the run actually hands the engine.

import { sigilById } from './nodes.ts';
import type { RunState, SigilDef } from './types.ts';

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
