/**
 * Blazons for the cards the prototype ships, and the tribe -> field tincture
 * table they are written against.
 *
 * `ARCHITECTURE.md` says a card's art is "a blazon string in its data file".
 * That is where this table belongs, and it is not where it lives: `src/content/`
 * is owned by another lane right now, so the mapping sits here, keyed by card
 * id, until it can be folded into `cards.ts` as a `blazon` field. Nothing about
 * the renderer changes when it moves - `renderCard` already takes the blazon as
 * a string on the view model.
 *
 * Two things this file must survive, because the card pool is growing under it:
 *
 *   - A card id it has never seen. The pool is being extended additively by
 *     another lane, so an unknown id gets a *derived* blazon rather than an
 *     exception. Derivation is a stable hash of the id over the charge library,
 *     which is deterministic and produces a device that is at least
 *     recognisably that card's.
 *   - The `_nc` suffix. `content/cards.ts` builds a whole second card set for
 *     the negative control by suffixing every id; those are the same cards and
 *     get the same device.
 *
 * The rule of tincture is respected everywhere below: every field is a colour
 * and every charge and bordure is a metal, which is the pairing that survives
 * seventy pixels.
 */

import { CHARGE_IDS, type ChargeId } from './heraldry/charges.ts';
import type { Tincture } from './heraldry/tinctures.ts';

/**
 * Field tincture per tribe. `human`/`dwarf`/`elf` keep the probe's palette A so
 * the reviewed goldens still describe what the board draws. `orc`, `beast` and
 * `hero` are new here because `engine/state.ts` has tribes the heraldry probe
 * fixture never had.
 *
 * The collision check that matters is per *adjacent pair on one line*, and the
 * two lines never mix: the player fields human/dwarf/elf, the enemy fields
 * orc/beast. So the pair to keep apart on the enemy line is tenne against
 * sable, which is a 4.6:1 luminance contrast, and on the player line azure,
 * gules and vert, which is the reviewed palette A.
 */
export const TRIBE_FIELD: Readonly<Record<string, Tincture>> = {
  human: 'azure',
  dwarf: 'gules',
  elf: 'vert',
  orc: 'tenne',
  beast: 'sable',
  hero: 'purpure',
};

const FALLBACK_FIELD: Tincture = 'purpure';

/** Charge and its tincture, per card id. The field comes from the tribe. */
const DEVICE: Readonly<Record<string, { charge: ChargeId; on: Tincture; bordure: Tincture }>> = {
  u_squire: { charge: 'sword', on: 'argent', bordure: 'or' },
  u_shieldbearer: { charge: 'hammer', on: 'or', bordure: 'or' },
  u_pikeman: { charge: 'sword', on: 'or', bordure: 'argent' },
  u_hornblower: { charge: 'crescent', on: 'or', bordure: 'or' },
  u_ironguard: { charge: 'tower', on: 'or', bordure: 'argent' },
  u_avenger: { charge: 'mullet', on: 'or', bordure: 'or' },
  u_berserker: { charge: 'hammer', on: 'argent', bordure: 'or' },
  u_captain: { charge: 'eagle', on: 'or', bordure: 'or' },
  u_sentinel: { charge: 'tower', on: 'argent', bordure: 'or' },
  u_champion: { charge: 'leaf', on: 'or', bordure: 'or' },

  // The ten that arrived with classes. Within one tribe no two cards share a
  // charge and its metal, because the charge is how two cards of one race are
  // told apart; across tribes the field already separates them.
  u_archer: { charge: 'crescent', on: 'argent', bordure: 'or' },
  u_wayfinder: { charge: 'mullet', on: 'or', bordure: 'or' },
  u_treewarden: { charge: 'leaf', on: 'or', bordure: 'or' },
  u_longbow: { charge: 'sword', on: 'argent', bordure: 'or' },
  u_herald: { charge: 'crescent', on: 'argent', bordure: 'or' },
  u_manatarms: { charge: 'hammer', on: 'or', bordure: 'or' },
  u_paladin: { charge: 'eagle', on: 'argent', bordure: 'or' },
  u_veteran: { charge: 'wyvern', on: 'or', bordure: 'or' },
  u_thane: { charge: 'eagle', on: 'or', bordure: 'argent' },
  u_bulwark: { charge: 'tower', on: 'argent', bordure: 'or' },

  e_goblin: { charge: 'wyvern', on: 'argent', bordure: 'or' },
  e_shieldwall: { charge: 'tower', on: 'or', bordure: 'or' },
  e_ogre: { charge: 'hammer', on: 'or', bordure: 'argent' },
  e_troll: { charge: 'wyvern', on: 'or', bordure: 'argent' },
};

/** FNV-1a over the id, so an unseen card still gets a stable device. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/**
 * Strips the two suffixes a card id can wear and still be the same card.
 *
 * `u_squire_nc` is the negative control's copy of the Squire. `u_squire#7` is
 * the run's seventh deck instance of it: `src/run/deck.ts` mints one per copy
 * so the forge can upgrade one Squire out of three, and `#` is its
 * `INSTANCE_SEPARATOR`, never part of a card id. Both are the Squire's device.
 * Before the instance suffix was stripped every player card in a run was drawn
 * as a hashed stranger - `test/ui-run.test.ts` holds it.
 */
function baseId(id: string): string {
  const hash = id.indexOf('#');
  const bare = hash >= 0 ? id.slice(0, hash) : id;
  return bare.endsWith('_nc') ? bare.slice(0, -3) : bare;
}

/**
 * The blazon for one card. `guard` decides whether a bordure clause is written,
 * because the bordure is the Guard channel and a non-Guard must never carry
 * one - `tools/heraldry-probe/pages.ts` checks exactly that on its fixture.
 */
export function blazonFor(cardId: string, tribe: string, guard: boolean): string {
  const field = TRIBE_FIELD[tribe] ?? FALLBACK_FIELD;
  const id = baseId(cardId);
  const device = DEVICE[id] ?? {
    charge: CHARGE_IDS[hashId(id) % CHARGE_IDS.length]!,
    on: (hashId(id) & 1) === 0 ? ('or' as const) : ('argent' as const),
    bordure: 'or' as const,
  };
  const clauses = [String(field), `a ${device.charge} ${device.on}`];
  if (guard) clauses.push(`a bordure ${device.bordure}`);
  return clauses.join(', ');
}
