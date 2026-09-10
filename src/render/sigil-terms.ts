/**
 * What a sigil means, in words a player has not read a design document to
 * understand. The sigil half of `glossary.ts`, in a file of its own.
 *
 * Three tables and two functions, and the rule each one is held to:
 *
 *   **`CARD_SIGIL_TERMS` is keyed by the engine's `Trait` union**, exactly as
 *   `TRAIT_TERMS` is, so a trait added to the engine cannot ship without a
 *   sigil name and a deleted one takes its sigil's explanation with it. The
 *   names here are what the shipped sigils in `src/content/sigils.ts` are
 *   called, and `test/sigils.test.ts` holds the two lists to each other
 *   rather than letting the shelf and the tooltip drift apart.
 *
 *   **Hero-sigil wording carries the resolver's numbers.** "Relay hands +3
 *   instead of +2" is `RELAY_POWER + amount` against `RELAY_POWER`, never a
 *   retyped 2, so re-tuning the constant re-words the sentence.
 *
 *   **A trait's rule is stated at the amount in force, not the printed one.**
 *   `traitTerm` rebuilds Relay's and Wake's sentences at the side's own
 *   `SideRules`, so a Squire fighting under a Sigil of the Chain is explained
 *   as handing +3 and says why. A tooltip that kept saying +2 while the fight
 *   did +3 would be the exact lie `glossary.ts` was built to prevent, one
 *   layer up.
 */

import type { SideRules, Trait } from '../engine/state.ts';
import { RELAY_POWER, WAKE_POWER } from '../engine/resolver.ts';
import type { HeroSigilEffect } from '../run/types.ts';
import { STAT_TERMS, TRAIT_TERMS, type Term } from './glossary.ts';

/** The one word, for chips and headings that need it alone. */
export const SIGIL_TERM: Term = {
  name: 'Sigil',
  icon: 'sigil',
  line:
    'A permanent mark that lasts the whole run. On a card it grants a trait; on your hero it ' +
    'bends one rule for your side. Equipment comes off after every fight - a sigil never does.',
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
};

/** The amounts in force, defaults filled in, so callers compare against one shape. */
export function effectiveRules(rules: SideRules | null | undefined): { relayPower: number; wakePower: number } {
  return {
    relayPower: rules?.relayPower ?? RELAY_POWER,
    wakePower: rules?.wakePower ?? WAKE_POWER,
  };
}

/**
 * What one hero-sigil effect does, as a sentence, at the numbers the engine
 * will actually use. `amount` is the delta the sigil adds; the sentence says
 * both the result and what it was, because "+3" alone does not tell a player
 * that anything changed.
 */
export function heroEffectWords(effect: HeroSigilEffect): string {
  const p = STAT_TERMS.power.name;
  switch (effect.kind) {
    case 'relayPower':
      return (
        `${TRAIT_TERMS.relay.name} on your side hands +${RELAY_POWER + effect.amount} ${p} instead of ` +
        `+${RELAY_POWER}, for the rest of the run.`
      );
    case 'wakePower':
      return (
        `${TRAIT_TERMS.wake.name} on your side grants +${WAKE_POWER + effect.amount} ${p} instead of ` +
        `+${WAKE_POWER}, for the rest of the run.`
      );
    case 'maxHealth':
      return `+${effect.amount} maximum ${STAT_TERMS.health.name} for the run, and you heal ${effect.amount} now.`;
    case 'handSize':
      return `Draw to ${effect.amount} more card${effect.amount === 1 ? '' : 's'} at the start of every turn, for the rest of the run.`;
  }
}

/**
 * A trait's term at the amounts in force on one side.
 *
 * Relay's and Wake's sentences in `TRAIT_TERMS` interpolate `RELAY_POWER` and
 * `WAKE_POWER`. When a hero sigil has moved either for this side, the
 * printed number in that sentence is replaced by the amount in force and a
 * clause says where the difference came from. Guard has no number and comes
 * back untouched, as does either trait at the default.
 *
 * The replacement is gated rather than trusted: `test/sigils.test.ts` asserts
 * that the rebuilt line names the amount in force and no longer names the
 * default, so a rewording of the glossary that broke the match would go red
 * instead of quietly shipping a tooltip one point out.
 */
export function traitTerm(trait: Trait, rules: SideRules | null | undefined): Term {
  const base = TRAIT_TERMS[trait];
  const eff = effectiveRules(rules);
  const p = STAT_TERMS.power.name;
  let printed: number;
  let actual: number;
  if (trait === 'relay') {
    printed = RELAY_POWER;
    actual = eff.relayPower;
  } else if (trait === 'wake') {
    printed = WAKE_POWER;
    actual = eff.wakePower;
  } else {
    return base;
  }
  if (actual === printed) return base;
  return {
    ...base,
    line:
      base.line.replace(`+${printed} ${p}`, `+${actual} ${p}`) +
      ` A hero sigil moved it from +${printed} on your side.`,
  };
}

/**
 * The rules a hero's sigils have bent, one sentence each, for the hero's own
 * panel. Empty at the defaults, so a hero with no sigil says nothing about
 * them rather than reciting the engine's constants.
 */
export function ruleOverrideLines(rules: SideRules | null | undefined): string[] {
  const eff = effectiveRules(rules);
  const p = STAT_TERMS.power.name;
  const out: string[] = [];
  if (eff.relayPower !== RELAY_POWER) {
    out.push(`${TRAIT_TERMS.relay.name} on this side hands +${eff.relayPower} ${p}, not +${RELAY_POWER}.`);
  }
  if (eff.wakePower !== WAKE_POWER) {
    out.push(`${TRAIT_TERMS.wake.name} on this side grants +${eff.wakePower} ${p}, not +${WAKE_POWER}.`);
  }
  return out;
}
