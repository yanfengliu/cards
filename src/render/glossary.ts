/**
 * What every element of a card means, in words a player has not read a design
 * document to understand.
 *
 * Every noun in this game is invented. "Wake", "Relay", "gules", "a mullet" -
 * none of them mean anything until something on screen says what they mean, and
 * until this file existed the only place any of them was written down was
 * `docs/design/game.md`, which a player will never open.
 *
 * Three rules hold this file honest, and each is enforced by something rather
 * than intended:
 *
 *   **The trait table is keyed by the engine's own `Trait` union.** A trait
 *   deleted from `engine/state.ts` makes this file stop compiling, and a trait
 *   added to it makes this file stop compiling until it is documented. A
 *   glossary that can silently describe a rule the game no longer has is worse
 *   than no glossary, because the player has no way to tell.
 *
 *   **The numbers come from the resolver, not from prose.** `RELAY_POWER` and
 *   `WAKE_POWER` are imported, so "+2 Power" is the engine's 2 and re-tuning the
 *   constant re-words the tooltip. Retyping the number here is how a tooltip
 *   starts lying without anyone editing it.
 *
 *   **A sentence about a set of traits names them from the set.** `RACE_RULE`
 *   answers "what does being a dwarf do" by reading `TRIBAL_TRAITS` out of the
 *   engine, so the copy cannot outlive the rules it describes. It replaced
 *   `RACE_HAS_NO_RULE`, which was the honest answer for as long as nothing in
 *   a fight read a race - unit 11 is when that stopped being true.
 */

import { type Trait, type Tribe, MOST_ADJACENT, TRIBAL_TRAITS } from '../engine/state.ts';
import {
  BANNER_POWER,
  CHORUS_POWER,
  KINDLE_POWER,
  RELAY_POWER,
  WAKE_POWER,
} from '../engine/resolver.ts';
import { CLASS_TRAIT_TERMS } from './class-terms.ts';
import type { IconName } from './icons.ts';
import { type HatchPattern, type Tincture, TINCTURES, hatchOf } from './heraldry/tinctures.ts';
import { type ChargeId, getCharge } from './heraldry/charges.ts';

/** One explained thing: what it is called, how it is drawn, what it does. */
export interface Term {
  /** The word as it appears on screen. */
  readonly name: string;
  readonly icon: IconName;
  /** One plain sentence. No jargon that is not itself in this file. */
  readonly line: string;
}

// --------------------------------------------------------------- the numbers

export const STAT_TERMS = {
  power: {
    name: 'Power',
    icon: 'power',
    line:
      'What it swings for — and what it deals straight back when something attacks it, because ' +
      'combat is mutual. A unit can die on the swing it started, and a defender with no Power ' +
      'still hits back, for nothing, which is what makes a big harmless body free to attack ' +
      'into. A hero is the exception: it hits back when it is attacked but takes nothing on ' +
      'its own swing. Armour comes off every hit and damage past Health is wasted.',
  },
  health: {
    name: 'Health',
    icon: 'health',
    line: 'Damage it can take before it dies. It never heals between rounds.',
  },
  cost: {
    name: 'Energy',
    icon: 'cost',
    line: 'What it costs to play. Energy refills every turn and does not carry over.',
  },
  armour: {
    name: 'Armour',
    icon: 'armour',
    line:
      'Comes off each incoming attack separately, never below zero — so many small hits ' +
      'lose more to Armour than one big one.',
  },
  target: {
    name: 'Target',
    icon: 'target',
    line:
      'Attacks pick at random among legal targets, so this is the chance one incoming ' +
      'attack lands here. You choose how your damage is divided, never who is hit.',
  },
} as const satisfies Readonly<Record<string, Term>>;

/** The one line under the number strip. Each chip carries its own full rule. */
export const NUMBERS_SUMMARY =
  'Armour comes off every hit and damage past Health is wasted, so how you package damage is the decision. Hover a chip for its rule.';

// ---------------------------------------------------------------- the traits

/**
 * Keyed by the engine's `Trait` union on purpose. See the file header: this is
 * the compile-time half of "a removed trait disappears from the tooltips".
 *
 * The rules are read out of `engine/resolver.ts`'s `triggersFor` and
 * `legalTargets`, not out of the design document, because the resolver is what
 * the fight actually does.
 */
export const TRAIT_TERMS: Readonly<Record<Trait, Term>> = {
  guard: {
    name: 'Guard',
    icon: 'guard',
    line:
      'While any Guard on this side is alive, every attack against this side must hit a ' +
      'Guard. Your hero cannot be reached until the last one falls.',
  },
  relay: {
    name: 'Relay',
    icon: 'relay',
    line:
      `After this acts, the unit immediately to its right gains +${RELAY_POWER} Power until ` +
      'the end of the turn. It reaches your hero when this is the rightmost unit.',
  },
  wake: {
    name: 'Wake',
    icon: 'wake',
    line:
      `When the unit immediately to its left dies this turn, this gains +${WAKE_POWER} Power ` +
      'until the end of the turn.',
  },
  kindle: {
    name: 'Kindle',
    icon: 'kindle',
    line:
      `Before it swings, this gains +${KINDLE_POWER} Power for each unit of its own race standing ` +
      'immediately beside it, until the end of the turn. Two neighbours is the most any card ' +
      'has, so the most this can ever be is ' +
      `+${KINDLE_POWER * MOST_ADJACENT}. Your hero has no race and never counts.`,
  },
  chorus: {
    name: 'Chorus',
    icon: 'chorus',
    line:
      `After this acts, each unit of its own race standing immediately beside it — left and ` +
      `right — gains +${CHORUS_POWER} Power until the end of the turn. The one on its left has ` +
      'already swung, so that half is Power to hit back with rather than Power to attack with.',
  },
  banner: {
    name: 'Banner',
    icon: 'banner',
    line:
      `Before it swings, this gains +${BANNER_POWER} Power for each unit of a DIFFERENT race ` +
      'standing immediately beside it, until the end of the turn. It is Kindle upside down: this ' +
      'one wants to stand between races rather than among its own. Your hero has no race and ' +
      'never counts.',
  },
  ...CLASS_TRAIT_TERMS,
};

// ------------------------------------------------------------ the price of a swing

/**
 * Combat is mutual, and the panel has to say so on every card.
 *
 * This is the one rule on the board that costs the player something for doing
 * the thing the board most obviously invites - putting a body down and letting
 * it swing - and until it is written here the only place a player meets it is a
 * corpse in the log. It is not a trait, so it cannot ride in `TRAIT_TERMS`; it
 * is true of every card, so it does not belong to any one of them.
 *
 * **It goes in the line under the number strip rather than in a row of its own,
 * and that is a measurement rather than a preference.** `docs/devlog/detailed/`
 * for this panel: "Adding a paragraph to `render/inspect.ts` can push it past
 * 270px, at which point it silently starts covering a row again." A rule row
 * costs 54px and the panel has 0 to spare - it is 266px against a 270px band,
 * already placing on a 4px sliver of its own line. The same sentence in the
 * summary paragraph costs nothing, because that paragraph is two lines at
 * anything under about 235 characters and was 130. Measured with
 * `npm run probe:ui hover 7 even light`, which prints the panel's height and
 * what it covers; read those numbers after any change to this copy.
 *
 * So these are one sentence each, and the rest of the rule - a body dying on the
 * swing it started, a 0-Power wall being free to attack into - rides on the
 * Power chip, which is where every other number's full rule already lives and
 * where the summary tells the player to look.
 *
 * Two sentences rather than one because the rule has exactly one exception, and
 * `engine/resolver.ts`'s `attack` case is where both halves come from: the
 * defender's blow is skipped when the attacker `isHero`, and emitted at zero
 * otherwise. A hero panel that repeated the unit's sentence would be telling the
 * player their hero pays a price it does not pay.
 */
export const RETALIATION_UNIT =
  'Attacking costs this: whatever it strikes hits back at once with its own Power.';

export const RETALIATION_HERO =
  'Combat is mutual, but a hero takes nothing back when it swings — only when it is attacked.';

/** The rule every trait obeys, said once rather than once per trait. */
export const ADJACENCY_RULE =
  'Every trait reads its neighbours and nothing else, so where a card stands is the decision.';

/** Where a card stands, which is the only thing the player actually chooses. */
export const POSITION_UNIT = `Lines resolve left to right. ${ADJACENCY_RULE}`;
export const POSITION_HERO =
  `A hero stands at the right end of its line and swings last. ${ADJACENCY_RULE}`;

// ----------------------------------------------------------------- the races

/**
 * What being a dwarf does, in one sentence the code writes for itself.
 *
 * This used to be `RACE_HAS_NO_RULE` - "nothing in the card pool reads it" -
 * and it was true for ten units. `docs/design/game.md` reserved races as
 * mechanical tribes the whole time, and unit 11 built them, so the sentence
 * had to be replaced rather than edited.
 *
 * **The trait names in it are not typed here.** They are read out of
 * `TRIBAL_TRAITS`, which the engine's own type system fills in - a tribal
 * trait added to that union and not to its record does not compile, and one
 * deleted takes its name out of this sentence in the same edit. That is the
 * property that made deleting Ward a compile error instead of a lying tooltip,
 * pointed at a sentence rather than at a table.
 *
 * The claim "and nothing else does" is held by `test/tribes.test.ts`, which
 * fights the same board twice with one neighbour's race changed and asserts
 * that exactly the traits named here notice.
 *
 * **It is short because the panel is 4px from covering the board.** The first
 * draft of this sentence was 255 characters, wrapped to a third line and took
 * the panel from 266px to 280px against a 270px band - measured with
 * `npm run probe:ui hover 7 even light`, where the area of the player's row it
 * covered went from 2,341px² to 11,623px². The gate above `RETALIATION_UNIT`
 * says the same thing about the summary paragraph; this note is under the same
 * limit now, in the same test, for the same reason.
 */
const TRIBAL_NAMES: readonly string[] = TRIBAL_TRAITS.map((t) => TRAIT_TERMS[t].name);

export const RACE_RULE =
  `Race is a rule, not just a colour: ${listWords(TRIBAL_NAMES)} read the races next to a card. ` +
  'Each sees its two neighbours and no further, so where a card stands is the whole of it.';

/** "a, b and c" — the list a player would read aloud, from however many there are. */
function listWords(words: readonly string[]): string {
  if (words.length === 0) return 'nothing';
  if (words.length === 1) return words[0]!;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`;
}

/**
 * A tribe by name, for callers holding a `string` rather than a `Tribe`.
 *
 * `EntityView.tribe` is a string because the view model is built from card data
 * the renderer does not own. An unknown tribe gets a truthful placeholder rather
 * than a crash or a silent blank: the panel's job is to say what a card is, and
 * "a race this build has no entry for" is at least a true answer.
 */
export function tribeTerm(tribe: string): Term {
  return (
    (TRIBE_TERMS as Readonly<Record<string, Term | undefined>>)[tribe] ?? {
      name: tribe.length > 0 ? tribe : 'Unknown',
      icon: 'blank',
      line: 'A race with no entry in this build’s glossary.',
    }
  );
}

export const TRIBE_TERMS: Readonly<Record<Tribe, Term>> = {
  human: { name: 'Human', icon: 'human', line: 'Your line’s generalists — the Squire, Captain and Champion.' },
  dwarf: { name: 'Dwarf', icon: 'dwarf', line: 'Your line’s heavy bodies — Shieldbearers, Ironguards, Pikemen.' },
  elf: { name: 'Elf', icon: 'elf', line: 'Your line’s archers and wardens — the Archer, the Wayfinder, the Sentinel.' },
  orc: { name: 'Orc', icon: 'orc', line: 'The enemy’s rank and file — Goblins, Shieldwalls and Ogres.' },
  beast: { name: 'Beast', icon: 'beast', line: 'The enemy’s armoured monsters, such as the Stone Troll.' },
  hero: { name: 'Hero', icon: 'hero', line: 'Not a race. A hero is one per side and its Health is the fight.' },
};

// -------------------------------------------------------------- the heraldry

/**
 * Colour is never the only carrier of tribe.
 *
 * Roughly one man in twelve cannot separate red from green, and this board puts
 * a gules dwarf next to a vert elf and asks the player to tell them apart. Print
 * heraldry solved this in the seventeenth century with the Petra Sancta
 * convention: each tincture gets a hatching, so arms survive being engraved in
 * black and white. `hatch` is that convention, and `render/heraldry/card.ts`
 * draws it when the board is asked to.
 *
 * `pattern` is what the hatching looks like, said in words, because the player
 * who most needs it is the one who cannot see the difference between the two
 * colours it is disambiguating.
 */
export interface TinctureTerm {
  /** The heraldic name, which is what the blazon under the card says. */
  readonly name: string;
  /** The colour in a word a non-herald recognises. */
  readonly plain: string;
}

/**
 * How each hatching looks, said in words - because the player who most needs
 * the hatching is the one who cannot see the two colours it is separating, and
 * a pattern nobody names is another symbol whose meaning lives elsewhere.
 */
export const HATCH_WORDS: Readonly<Record<HatchPattern, string>> = {
  none: 'left plain',
  vertical: 'vertical lines',
  horizontal: 'horizontal lines',
  'diagonal-down': 'diagonal lines running down to the right',
  'diagonal-up': 'diagonal lines running up to the right',
  cross: 'crossed vertical and horizontal lines',
  'diagonal-up-horizontal': 'crossed diagonal and horizontal lines',
  dots: 'a field of dots',
};

export const TINCTURE_TERMS: Readonly<Record<Tincture, TinctureTerm>> = {
  or: { name: 'Or', plain: 'gold' },
  argent: { name: 'Argent', plain: 'silver' },
  gules: { name: 'Gules', plain: 'red' },
  azure: { name: 'Azure', plain: 'blue' },
  vert: { name: 'Vert', plain: 'green' },
  sable: { name: 'Sable', plain: 'black' },
  purpure: { name: 'Purpure', plain: 'purple' },
  tenne: { name: 'Tenné', plain: 'orange' },
};

/** The Petra Sancta hatching for a tincture, in words. */
export function hatchWords(t: Tincture): string {
  return HATCH_WORDS[hatchOf(t)];
}

export function tinctureHex(t: Tincture): string {
  return TINCTURES[t].hex;
}

/** The charge's own blazon name — "a sword", "a wyvern's head". */
export function chargeName(id: ChargeId): string {
  return getCharge(id).name;
}

export const HERALDRY_TERMS = {
  field: {
    name: 'Field',
    icon: 'field',
    line: 'The background colour of the card. It is set by the unit’s race and by nothing else.',
  },
  charge: {
    name: 'Charge',
    icon: 'charge',
    line: 'The device in the middle of the card. It belongs to this card alone — it is how you tell two cards of one race apart.',
  },
  silhouette: {
    name: 'Shape',
    icon: 'guard',
    line:
      'A Guard is drawn as a shield with a heavy border; everything else is a plain rectangle. ' +
      'Shape is used because it reads faster than colour when the board is compressed.',
  },
  position: {
    name: 'Position',
    icon: 'position',
    line:
      'Your line resolves left to right and your hero swings last. ' + ADJACENCY_RULE,
  },
} as const satisfies Readonly<Record<string, Term>>;
