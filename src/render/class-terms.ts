/**
 * What a class means, in words a player has not read a design document to
 * understand - the classes' half of `glossary.ts`.
 *
 * Two tables. `CLASS_TRAIT_TERMS` explains the two traits that arrived with
 * classes and is spread into `glossary.ts`'s `TRAIT_TERMS`, which stays keyed
 * by the engine's `Trait` union: that is the compile-time gate that made the
 * glossary stop compiling the moment `volley` and `scorch` were added to the
 * union, and it still holds through the spread. `CLASS_TERMS` explains each
 * class - what its hero does and what its pool leans to - for the hero plate,
 * the hover panel and the class-pick screen.
 *
 * The same three rules `glossary.ts` states hold here:
 *
 *   The numbers come from the resolver. `SCORCH_DAMAGE` and `VOLLEY_SWINGS`
 *   are imported - the swing count through `timesWord`, so `VOLLEY_SWINGS = 3`
 *   re-words every "twice" here to "three times" - and a class's swing is
 *   written from the hero's printed Power at the moment the sentence is made,
 *   so a re-tuned constant re-words the tooltip. Gated by "Volley's count in
 *   words is the count the resolver swings" in `test/explain.test.ts`, which
 *   reads the swings off a real drain rather than off the constant.
 *
 *   A class is looked up by the hero's name, because that is what a hero
 *   entity carries - `cardId` is `hero:<name>` - and a run's hero is named for
 *   its class by construction in `src/content/classes.ts`. An enemy hero, or a
 *   fixture hero called anything else, has no class term and the panel says
 *   nothing about a class for it rather than guessing.
 *
 *   No runtime import of `src/content/` - only the `ClassId` type, so that a
 *   class added to the union without a term here fails to compile, the way an
 *   undocumented trait does. This file words what a hero *is*; the class data
 *   is handed to it by whoever holds it, so the render layer stays free of
 *   content the way `view.ts` and `board.ts` are.
 */

import type { ClassId } from '../content/classes.ts';
import { SCORCH_DAMAGE, VOLLEY_SWINGS } from '../engine/resolver.ts';
import type { Trait } from '../engine/state.ts';
import type { Term } from './glossary.ts';
import type { IconName } from './icons.ts';

/**
 * "twice", not "2 times" - a count of repetitions as a player would say it.
 *
 * This exists so that every sentence about Volley below is built from
 * `VOLLEY_SWINGS` rather than from the word the design happens to use today.
 * `VOLLEY_SWINGS = 3` re-words all four of them at once; a number typed here
 * would not follow it, which is the whole failure `glossary.ts`'s "the numbers
 * come from the resolver" rule exists to stop.
 *
 * Above four it falls back to digits, which is the honest answer: English has
 * no ordinary word for it and a card that swung five times would want a
 * different sentence anyway.
 */
export function timesWord(n: number): string {
  const words: Readonly<Record<number, string>> = { 1: 'once', 2: 'twice', 3: 'three times', 4: 'four times' };
  return words[n] ?? `${n} times`;
}

/** The two traits classes brought, explained. Spread into `TRAIT_TERMS`. */
export const CLASS_TRAIT_TERMS: Readonly<Record<Extract<Trait, 'volley' | 'scorch'>, Term>> = {
  volley: {
    name: 'Volley',
    icon: 'volley',
    line:
      `Attacks ${timesWord(VOLLEY_SWINGS)}. Each swing picks its own target and, on a unit, ` +
      'draws its own retaliation — so a fragile body may not live to swing again. A hero ' +
      'takes none.',
  },
  scorch: {
    name: 'Scorch',
    icon: 'scorch',
    line:
      `After its swing, every enemy unit takes ${SCORCH_DAMAGE}, less its Armour. Spell damage: ` +
      'nothing hits back, Guards do not redirect it, and it never reaches the enemy hero.',
  },
};

/** One explained class: its crest, what its hero does, what its pool leans to. */
export interface ClassTerm {
  readonly id: ClassId;
  readonly name: string;
  readonly icon: IconName;
  /** One sentence on the hero's attack, written from its printed Power. */
  readonly swing: (power: number) => string;
  /** One sentence on what the class's pool is made of. */
  readonly pool: string;
}

export const CLASS_TERMS: Readonly<Record<ClassId, ClassTerm>> = {
  knight: {
    id: 'knight',
    name: 'Knight',
    icon: 'knight',
    swing: (power) =>
      `Swings for ${power} at the end of the line and takes nothing back for it. ` +
      'The plain hero: whatever the line hands forward lands on one blow.',
    pool: 'Dwarves and humans in mail: Guards, Armour and heavy hitters. Elves are rare.',
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    icon: 'ranger',
    swing: (power) =>
      `Swings for ${power}, ${timesWord(VOLLEY_SWINGS)}, each swing picking its own target. ` +
      `Every point a Relay or a weapon hands the hero is spent ${timesWord(VOLLEY_SWINGS)}; ` +
      `against Armour, ${power} ${timesWord(VOLLEY_SWINGS)} can be nothing.`,
    pool:
      'Elves and humans: Relays to stand at the right end, and Volley bodies that swing ' +
      `${timesWord(VOLLEY_SWINGS)} as the hero does. Dwarves are rare.`,
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    icon: 'mage',
    swing: (power) =>
      `Swings for ${power}, then scorches every enemy unit for ${SCORCH_DAMAGE}, less its ` +
      'Armour — spell damage, so nothing hits back. Swarms wither; armoured lines shrug it off.',
    pool:
      'Walls and sacrifices: Guards and Relays with no Power to lose, and Wake bodies that ' +
      'profit when a cheap neighbour dies. All three races, dwarves most.',
  },
};

/** The class a hero is, by its name, or null for a hero that is not one. */
export function classTermFor(heroName: string): ClassTerm | null {
  const id = heroName.toLowerCase();
  return (CLASS_TERMS as Readonly<Record<string, ClassTerm | undefined>>)[id] ?? null;
}
