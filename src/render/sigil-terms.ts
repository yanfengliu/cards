/**
 * What a sigil means, in words a player has not read a design document to
 * understand. The sigil half of `glossary.ts`, in a file of its own.
 *
 * Two tables, and the rule each one is held to:
 *
 *   **`CARD_SIGIL_TERMS` is keyed by the engine's `Trait` union**, exactly as
 *   `TRAIT_TERMS` is, so a trait added to the engine cannot ship without a
 *   sigil name and a deleted one takes its sigil's explanation with it. The
 *   names here are what the shipped sigils in `src/content/sigils.ts` are
 *   called, and `test/sigils.test.ts` holds the two lists to each other
 *   rather than letting the shelf and the tooltip drift apart.
 *
 *   **`HERO_EFFECT_WORDS` is keyed by `HeroSigilEffect['kind']`**, so a hero
 *   effect the run can apply cannot ship without a sentence, and a sentence
 *   cannot outlive its effect. Each is built from the amount and the stat's
 *   own name in `STAT_TERMS`, never a retyped number, so the offer, the HUD
 *   chip and the hero's panel all say the same thing about the same sigil.
 */

import type { Trait } from '../engine/state.ts';
import type { HeroSigilEffect } from '../run/types.ts';
import { STAT_TERMS, type Term } from './glossary.ts';

/** The one word, for chips and headings that need it alone. */
export const SIGIL_TERM: Term = {
  name: 'Sigil',
  icon: 'sigil',
  line:
    'A permanent mark that lasts the whole run. On a card it grants a trait; on your hero it ' +
    'raises one of your hero’s own numbers. Equipment comes off after every fight - a sigil never does.',
};

/**
 * What a card sigil is called and what attaching one does. One per trait.
 *
 * The sentence is about the *sigil* - that it was attached, that it lasts -
 * and leaves the trait's own rule to `TRAIT_TERMS`, which the panel prints
 * beside it. Saying the rule twice in two wordings is how the two drift.
 */
export const CARD_SIGIL_TERMS: Readonly<Record<Trait, Term>> = {
  guard: {
    name: 'Guard Sigil',
    icon: 'sigil',
    line: 'Attached at a reward. This card is a Guard for the rest of the run, on top of what it was printed with.',
  },
  relay: {
    name: 'Relay Sigil',
    icon: 'sigil',
    line: 'Attached at a reward. This card is a Relay for the rest of the run, on top of what it was printed with.',
  },
  wake: {
    name: 'Wake Sigil',
    icon: 'sigil',
    line: 'Attached at a reward. This card has Wake for the rest of the run, on top of what it was printed with.',
  },
  // The two class traits have their words here and no sigil in
  // `src/content/sigils.ts`. That is the table doing its job rather than a
  // gap: it is keyed by the engine's `Trait` union so a new trait cannot ship
  // unexplained, and whether the shipped run *offers* a sigil for one is a
  // content decision made in that file. Adding either to `CARD_SIGILS` needs
  // no change here.
  volley: {
    name: 'Volley Sigil',
    icon: 'sigil',
    line: 'Attached at a reward. This card has Volley for the rest of the run, on top of what it was printed with.',
  },
  scorch: {
    name: 'Scorch Sigil',
    icon: 'sigil',
    line: 'Attached at a reward. This card has Scorch for the rest of the run, on top of what it was printed with.',
  },
  // The three tribal traits, worded here and offered by nothing: unit 11 added
  // the traits and deliberately shipped no sigil for any of them, because a
  // tribal sigil is a second way to author a tribe and whether the run wants
  // one is a content decision `src/content/sigils.ts` owns. Each sentence says
  // what attaching one would do, and the trait's own rule stays in
  // `TRAIT_TERMS` beside it - including that a card sigil cannot change what
  // race the card is, which is what these three read.
  kindle: {
    name: 'Kindle Sigil',
    icon: 'sigil',
    line: 'Attached at a reward. This card has Kindle for the rest of the run, on top of what it was printed with. It still counts its own race, which the sigil does not change.',
  },
  chorus: {
    name: 'Chorus Sigil',
    icon: 'sigil',
    line: 'Attached at a reward. This card has Chorus for the rest of the run, on top of what it was printed with. It still sings to its own race, which the sigil does not change.',
  },
  banner: {
    name: 'Banner Sigil',
    icon: 'sigil',
    line: 'Attached at a reward. This card has Banner for the rest of the run, on top of what it was printed with. It still counts the races beside it, which the sigil does not change.',
  },
};

/**
 * What one hero-sigil effect does, as a sentence, given its amount. Keyed by
 * the effect union so a kind the run can apply cannot ship unexplained.
 */
export const HERO_EFFECT_WORDS: Readonly<Record<HeroSigilEffect['kind'], (amount: number) => string>> = {
  maxHealth: (n) =>
    `+${n} maximum ${STAT_TERMS.health.name} for the rest of the run, and you heal ${n} now.`,
  heroPower: (n) =>
    `Your hero swings for +${n} ${STAT_TERMS.power.name} in every fight for the rest of the run, ` +
    'and hits back for it too.',
  heroArmour: (n) =>
    `Your hero has +${n} ${STAT_TERMS.armour.name} in every fight for the rest of the run: ` +
    `every hit on it deals ${n} less.`,
};

export function heroEffectWords(effect: HeroSigilEffect): string {
  return HERO_EFFECT_WORDS[effect.kind](effect.amount);
}

/** A held hero sigil as a term, for the hero's panel: its name, the seal, its effect. */
export function heroSigilTerm(sigil: { readonly name: string; readonly effect: HeroSigilEffect }): Term {
  return { name: sigil.name, icon: 'sigil', line: heroEffectWords(sigil.effect) };
}
