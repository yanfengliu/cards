// Data only, no logic: the sigils the shipped run can grant.
//
// `docs/design/game.md`: "A sigil attaches to a card and grants it a trait - a
// Relay Sigil makes any unit a relay." and "A sigil placed on the hero applies
// to the whole run. This is where relics went." Two kinds, two targets, and the
// same discipline as `cards.ts`: a sigil is a row of data naming an effect the
// run already applies. A card sigil names a `Trait`; a hero sigil names one of
// three numbers on the hero the run hands every fight. No sigil is an `if`
// anywhere in `src/engine/`, and nothing under `src/engine/` changed for them.
//
// **Every weight and amount here is a starting guess, and none of them is a
// balance claim.** The owner's ruling of 2026-09-09 is that content is not
// tuned to produce a board shape or to make an option viable: these are
// offered, and `npm run measure:run` reports what a bot does with them. That
// report is evidence about the bot, not about a person.
//
// Ids are stable forever, per `AGENTS.md`: a retuned sigil keeps its id, a
// redesigned one gets a new id. `si_` is the prefix, and no id may contain
// `#`, which `src/run/deck.ts` reserves for deck instance numbers.

import type { CardSigilDef, HeroSigilDef, SigilDef } from '../run/types.ts';

/**
 * One card sigil per trait the engine has. Guard's weight is lower because a
 * Guard changes who the enemy can hit - the whole defensive game - and a Guard
 * Sigil on a 4-Power Berserker is a very different card from a Shieldbearer.
 * Lower, not absent: "sigils let a player author a cascade rather than wait to
 * draft one", and authoring where the damage goes is part of that.
 */
export const CARD_SIGILS: readonly CardSigilDef[] = [
  { kind: 'card', id: 'si_relay', name: 'Relay Sigil', trait: 'relay', weight: 3 },
  { kind: 'card', id: 'si_wake', name: 'Wake Sigil', trait: 'wake', weight: 3 },
  { kind: 'card', id: 'si_guard', name: 'Guard Sigil', trait: 'guard', weight: 2 },
];

/**
 * Three hero sigils, one per number the run can move on its hero without the
 * engine learning anything. Each is applied in `src/run/`: `maxHealth` moves
 * the run's own life bar the moment it is taken and heals by the same amount,
 * because a bigger bar with the same hole in it is not a reward the player can
 * feel at the boss they just beat; `heroPower` and `heroArmour` are added to
 * the `HeroSpec` every later fight is handed (`heroSpecFor` in `nodes.ts`).
 * The run's hero has 200 Health (`src/run/content.ts`), so the Oak is fifteen
 * percent of the bar - a rest and a half.
 *
 * What is deliberately not here, and why, so nobody adds it as a data row and
 * finds it silently wrong. The design's own example, "Relay reaches two slots
 * right", and a Relay or Wake *amount* for one side both need the resolver to
 * read a rule off the hero, which is an engine change and a coordinator
 * decision (`ARCHITECTURE.md`). A wider hand or more energy would go through
 * `CardPool.handSize` or `energyPerTurn`, and `src/engine/fight.ts` reads both
 * for **both sides** - `enemyPlays` draws the enemy to the same `handSize` -
 * so a hero sigil that moved either would hand the enemy the same card. That
 * one was built once, tested only on the player's hand, and taken out;
 * `docs/work/9_sigils/plan.md` records it.
 */
export const HERO_SIGILS: readonly HeroSigilDef[] = [
  {
    kind: 'hero',
    id: 'si_oak',
    name: 'Sigil of the Oak',
    effect: { kind: 'maxHealth', amount: 30 },
    weight: 3,
  },
  {
    kind: 'hero',
    id: 'si_lance',
    name: 'Sigil of the Lance',
    effect: { kind: 'heroPower', amount: 1 },
    weight: 3,
  },
  {
    kind: 'hero',
    id: 'si_bulwark',
    name: 'Sigil of the Bulwark',
    effect: { kind: 'heroArmour', amount: 1 },
    weight: 3,
  },
];

export const SIGILS: readonly SigilDef[] = [...CARD_SIGILS, ...HERO_SIGILS];

/**
 * How the shipped run offers them. Handed to `RunContent` in one spread, so the
 * run file gains one line rather than three numbers it does not own.
 *
 *   - A won elite or boss offers `heroSigilOffers` hero sigils the run does not
 *     already hold; the player takes one or none. Two, so it is a choice and
 *     not a prize. With three in the pool, the third such node offers one and
 *     the fourth offers nothing - the run then records a decline by itself.
 *   - A won ordinary fight rolls `cardSigilChance` on that node's own stream
 *     and, when it hits, puts one card sigil on the shelf beside the three
 *     cards. One in two is a starting guess: at that rate a run that clears
 *     act 1 has seen about two, which is enough to author a cascade and not
 *     enough to make every deck the same deck.
 */
export const SIGIL_CONTENT = {
  sigils: SIGILS,
  heroSigilOffers: 2,
  cardSigilChance: 0.5,
} as const;

const seen = new Set<string>();
for (const s of SIGILS) {
  if (seen.has(s.id)) throw new Error(`content: duplicate sigil id ${s.id}; ids are unique and stable forever`);
  if (s.id.includes('#')) {
    throw new Error(`content: sigil id "${s.id}" contains "#", which deck instance ids reserve`);
  }
  seen.add(s.id);
}
