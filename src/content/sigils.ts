// Data only, no logic: the sigils the shipped run can grant.
//
// `docs/design/game.md`: "A sigil attaches to a card and grants it a trait - a
// Relay Sigil makes any unit a relay." and "A sigil placed on the hero applies
// to the whole run. This is where relics went." Two kinds, two targets, and the
// same discipline as `cards.ts`: a sigil is a row of data naming an effect the
// engine already has. A card sigil names a `Trait`; a hero sigil names one of
// four run-level modifiers. No sigil is an `if` anywhere in `src/engine/`.
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
 * Four hero sigils, each a modifier the run can apply without a new engine
 * verb:
 *
 *   - `relayPower` and `wakePower` move the amount a cascade trait grants on
 *     the player's side, through `SideRules` on the hero. The enemy's Relays,
 *     if it ever fields one, stay at the engine's default.
 *   - `maxHealth` raises the run's life bar and heals by the same amount the
 *     moment it is taken, because a bigger bar with the same hole in it is not
 *     a reward the player can feel at the boss they just beat.
 *   - `handSize` draws one more card a turn, through the pool the fight is
 *     handed. A thin deck cycles to its good cards faster with it, which is
 *     the "deck thinning as a skill" lever pointed at from the other end.
 *
 * Two of the design's own examples are deliberately not here, and
 * `docs/work/9_sigils/plan.md` says why: "Relay reaches two slots right" adds an
 * ordering decision to the resolver, and "leader damage heals you" needs a
 * heal verb the engine does not have.
 */
export const HERO_SIGILS: readonly HeroSigilDef[] = [
  {
    kind: 'hero',
    id: 'si_chain',
    name: 'Sigil of the Chain',
    effect: { kind: 'relayPower', amount: 1 },
    weight: 3,
  },
  {
    kind: 'hero',
    id: 'si_vigil',
    name: 'Sigil of Vigil',
    effect: { kind: 'wakePower', amount: 1 },
    weight: 3,
  },
  {
    kind: 'hero',
    id: 'si_oak',
    name: 'Sigil of the Oak',
    effect: { kind: 'maxHealth', amount: 30 },
    weight: 3,
  },
  {
    kind: 'hero',
    id: 'si_wide_hand',
    name: 'Sigil of the Wide Hand',
    effect: { kind: 'handSize', amount: 1 },
    weight: 2,
  },
];

export const SIGILS: readonly SigilDef[] = [...CARD_SIGILS, ...HERO_SIGILS];

/**
 * How the shipped run offers them. Handed to `RunContent` in one spread, so the
 * run file gains one line rather than three numbers it does not own.
 *
 *   - A won elite or boss offers `heroSigilOffers` hero sigils the run does not
 *     already hold; the player takes one or none. Two, so it is a choice and
 *     not a prize.
 *   - A won ordinary fight rolls `cardSigilChance` on the run stream and, when
 *     it hits, puts one card sigil on the shelf beside the three cards. One in
 *     two is a starting guess: at that rate a run that clears act 1 has seen
 *     about two, which is enough to author a cascade and not enough to make
 *     every deck the same deck.
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
