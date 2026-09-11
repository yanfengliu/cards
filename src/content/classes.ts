// Data only, no logic: the three classes a run can be started as.
//
// `docs/design/game.md`: "The player picks a class - Knight, Mage, Ranger -
// which sets the starting deck and the card pool", and "Class sets the pool;
// races appear across all of it. A Knight drafts dwarves, elves and humans
// alike." So a class here is three things and nothing else: a hero, a starting
// deck, and a reward pool. The cards themselves live in `cards.ts`, which owns
// ids; this file only chooses among them and weights them.
//
// The hero is where the classes differ mechanically. The design gives each a
// "small class-flavoured attack" - "the Knight swings for 2, the Ranger for 1
// twice, the Mage for 1 with a rider" - and those are data on the `HeroSpec`:
// Power, plus a trait the resolver reads. `volley` is the second swing and
// `scorch` is the rider (every enemy unit takes `SCORCH_DAMAGE`, spell damage,
// after the swing). Nothing in `src/engine/` knows a class exists.
//
// Every number here is a starting guess with a reason attached, not a balanced
// value, and the owner's ruling of 2026-09-09 stands over all of them: content
// is not tuned to make an option viable or to make the classes win equally.
// `npm run measure:run` reports each class on its own and that report is the
// only claim made about any of them.

import type { RewardEntry, RunClass } from '../run/types.ts';
import { ENEMY_CARDS, PLAYER_CARDS } from './cards.ts';

export type ClassId = 'knight' | 'ranger' | 'mage';

export const CLASS_IDS: readonly ClassId[] = ['knight', 'ranger', 'mage'];

/** The class a run is when none is named: the one that existed before classes did. */
export const DEFAULT_CLASS: ClassId = 'knight';

export type ClassDef = RunClass & {
  readonly id: ClassId;
};

function repeat(id: string, n: number): string[] {
  return new Array<string>(n).fill(id);
}

/**
 * The Knight's Health is the calibrated one, and the other two are set off it
 * rather than measured.
 *
 * 200 is the number `src/run/content.ts` arrived at: the run was unwinnable at
 * 80 - 0 of 1000 - once combat became mutual and decks reshuffled, and 200 is
 * where a won act-3 fight costs the placement bot 35-55 and the act-3 boss
 * about 80, which is the "three or four fights between rests" the number was
 * always set by. The Ranger and the Mage are given less because a hero in
 * cloth is not a hero in mail, and because their attacks carry more of the
 * fight than the Knight's plain swing does; the gaps are guesses. Whether
 * either bar survives a run is what the per-class report says, not this file.
 */
const KNIGHT_HEALTH = 200;
const RANGER_HEALTH = 180;
const MAGE_HEALTH = 160;

/**
 * Knight. Swings for 2 and nothing else happens: the design's default hero, and
 * the one every earlier number in this repo was measured with.
 *
 * The deck and the pool are the ones the run shipped with before classes
 * existed, so a Knight run is the run `docs/work/8_playable-run/plan.md` played
 * and `docs/work/6_trade-and-thin/plan.md` measured, plus the armoured bodies
 * this round added. The curve note from `src/run/content.ts` still holds and is
 * the reason the deck is not all 1-cost: every enemy from the Shieldwall up
 * carries Armour 1, and an all-1-cost deck tops out at 2 Power a body and won
 * 0 of 200 runs.
 */
export const KNIGHT: ClassDef = {
  id: 'knight',
  name: 'Knight',
  hero: { name: 'Knight', health: KNIGHT_HEALTH, power: 2, armour: 0 },
  startingDeck: [
    ...repeat('u_squire', 3),
    ...repeat('u_shieldbearer', 3),
    ...repeat('u_pikeman', 4),
    ...repeat('u_berserker', 2),
    ...repeat('u_ironguard', 1),
    ...repeat('u_avenger', 1),
  ],
  rewards: [
    { cardId: 'u_squire', weight: 10 },
    { cardId: 'u_shieldbearer', weight: 10 },
    { cardId: 'u_pikeman', weight: 10 },
    { cardId: 'u_manatarms', weight: 8 },
    { cardId: 'u_ironguard', weight: 8 },
    { cardId: 'u_avenger', weight: 8 },
    { cardId: 'u_berserker', weight: 8 },
    { cardId: 'u_hornblower', weight: 6 },
    { cardId: 'u_thane', weight: 5 },
    { cardId: 'u_paladin', weight: 4 },
    { cardId: 'u_captain', weight: 4 },
    { cardId: 'u_sentinel', weight: 4 },
    { cardId: 'u_champion', weight: 4 },
    { cardId: 'u_bulwark', weight: 3 },
    { cardId: 'u_wayfinder', weight: 3 },
    // The tribal six. Every class pool holds all six, per "races appear across
    // all of it": a Knight who keeps drawing elves can commit to elves. The
    // Knight's own races come at 6/3 and the races it is short of at 2/1, which
    // is the same lean its existing weights already have - it is not a claim
    // that a Chorus is worth less than a Kindle.
    //
    // A payoff card is offered less often than the bodies it pays off, and that
    // is the only reason these sit below the staples: a Kindler drawn into a
    // deck with no dwarves is a 1/4 for 2, and the run has to be able to build
    // towards it rather than trip over it.
    { cardId: 'u_kindler', weight: 6 },
    { cardId: 'u_runesmith', weight: 3 },
    { cardId: 'u_bannerman', weight: 6 },
    { cardId: 'u_marshal', weight: 3 },
    { cardId: 'u_songkeeper', weight: 2 },
    { cardId: 'u_elflord', weight: 1 },
  ],
};

/**
 * Ranger. Swings for 1, twice - `volley` - so every point of Power the line
 * hands the hero is spent twice, and a hero that no Relay reaches deals nothing
 * at all through Armour 1. The pool leans to what the hero wants: Relay bodies
 * to stand at the right end, and Volley bodies that swing the way it does.
 *
 * The starting deck carries five Relays and three Volleys. It is not tuned; it
 * is the deck that makes the class's own question - who stands rightmost - the
 * one a Ranger run keeps asking.
 */
export const RANGER: ClassDef = {
  id: 'ranger',
  name: 'Ranger',
  hero: { name: 'Ranger', health: RANGER_HEALTH, power: 1, armour: 0, traits: ['volley'] },
  startingDeck: [
    ...repeat('u_squire', 3),
    ...repeat('u_archer', 3),
    ...repeat('u_pikeman', 2),
    ...repeat('u_shieldbearer', 2),
    ...repeat('u_hornblower', 2),
    ...repeat('u_wayfinder', 1),
    ...repeat('u_berserker', 1),
  ],
  rewards: [
    { cardId: 'u_squire', weight: 10 },
    { cardId: 'u_archer', weight: 10 },
    { cardId: 'u_pikeman', weight: 8 },
    { cardId: 'u_hornblower', weight: 8 },
    { cardId: 'u_wayfinder', weight: 8 },
    { cardId: 'u_shieldbearer', weight: 6 },
    { cardId: 'u_herald', weight: 6 },
    { cardId: 'u_berserker', weight: 6 },
    { cardId: 'u_longbow', weight: 5 },
    { cardId: 'u_captain', weight: 4 },
    { cardId: 'u_sentinel', weight: 4 },
    { cardId: 'u_manatarms', weight: 4 },
    { cardId: 'u_avenger', weight: 3 },
    { cardId: 'u_champion', weight: 3 },
    // The tribal six, leaning the way the Ranger already leans: elves and
    // humans at 6/3, the dwarves it is short of at 2/1.
    { cardId: 'u_songkeeper', weight: 6 },
    { cardId: 'u_elflord', weight: 3 },
    { cardId: 'u_bannerman', weight: 6 },
    { cardId: 'u_marshal', weight: 3 },
    { cardId: 'u_kindler', weight: 2 },
    { cardId: 'u_runesmith', weight: 1 },
  ],
};

/**
 * Mage. Swings for 1, then `scorch`: every enemy unit takes `SCORCH_DAMAGE`,
 * less its Armour, as spell damage - nothing hits back and the enemy hero is
 * never touched. A Goblin dies to it in two turns whatever else happens; a
 * Shieldwall never notices.
 *
 * So the Mage's line is there to keep the Mage alive while the burn works,
 * and the pool leans to bodies that cost nothing to be attacked into: 0-Power
 * Guards and Relays, which retaliate for 0 and so lose nothing by being hit,
 * and Wake bodies that profit when a cheap neighbour dies on its own swing.
 */
export const MAGE: ClassDef = {
  id: 'mage',
  name: 'Mage',
  hero: { name: 'Mage', health: MAGE_HEALTH, power: 1, armour: 0, traits: ['scorch'] },
  startingDeck: [
    ...repeat('u_squire', 3),
    ...repeat('u_shieldbearer', 3),
    ...repeat('u_treewarden', 2),
    ...repeat('u_pikeman', 2),
    ...repeat('u_avenger', 2),
    ...repeat('u_herald', 1),
    ...repeat('u_berserker', 1),
  ],
  rewards: [
    { cardId: 'u_squire', weight: 10 },
    { cardId: 'u_shieldbearer', weight: 10 },
    { cardId: 'u_treewarden', weight: 8 },
    { cardId: 'u_pikeman', weight: 8 },
    { cardId: 'u_herald', weight: 8 },
    { cardId: 'u_avenger', weight: 8 },
    { cardId: 'u_veteran', weight: 6 },
    { cardId: 'u_berserker', weight: 6 },
    { cardId: 'u_ironguard', weight: 4 },
    { cardId: 'u_sentinel', weight: 4 },
    { cardId: 'u_wayfinder', weight: 4 },
    { cardId: 'u_bulwark', weight: 3 },
    { cardId: 'u_champion', weight: 3 },
    // The tribal six. The Mage drafts all three races already - "all three
    // races, dwarves most" - so its tribal weights are the flattest of the
    // three, at 4/2 across the board with the dwarves one step up. A Mage's
    // line is there to be attacked into while the burn works, and a Kindler
    // between two dwarves is a cheap body that also swings.
    { cardId: 'u_kindler', weight: 5 },
    { cardId: 'u_runesmith', weight: 2 },
    { cardId: 'u_songkeeper', weight: 4 },
    { cardId: 'u_elflord', weight: 2 },
    { cardId: 'u_bannerman', weight: 4 },
    { cardId: 'u_marshal', weight: 2 },
  ],
};

/** The three, in the order the class-pick screen shows them. */
export const CLASSES: readonly ClassDef[] = [KNIGHT, RANGER, MAGE];

export function classById(id: string): ClassDef {
  const cls = CLASSES.find((c) => c.id === id);
  if (cls === undefined) {
    throw new Error(
      `classes: no class "${id}". A run is started as one of ${CLASS_IDS.join(', ')}.`,
    );
  }
  return cls;
}

/** Every card id a class names, checked once at module load, as `content.ts` does. */
const KNOWN = new Set<string>([
  ...PLAYER_CARDS.map((c) => c.id),
  ...ENEMY_CARDS.map((c) => c.id),
]);

for (const cls of CLASSES) {
  for (const id of cls.startingDeck) {
    if (!KNOWN.has(id)) {
      throw new Error(`classes: the ${cls.name}'s starting deck names unknown card "${id}"`);
    }
  }
  const seen = new Set<string>();
  for (const entry of cls.rewards satisfies readonly RewardEntry[]) {
    if (!KNOWN.has(entry.cardId)) {
      throw new Error(`classes: the ${cls.name}'s pool names unknown card "${entry.cardId}"`);
    }
    if (seen.has(entry.cardId)) {
      throw new Error(`classes: the ${cls.name}'s pool lists "${entry.cardId}" twice`);
    }
    seen.add(entry.cardId);
  }
}
