// Data only, no logic: what a fresh profile cannot draft yet, and what opens it.
//
// `docs/design/game.md`: "**Meta-progression is unlocks only.** Finishing runs
// adds cards and sigils to the pool. No persistent power, no hub to rebuild -
// every run is winnable from the first one." Two halves, and this file is both
// of them as rows: the ids a new player has not got yet, and the run-scoped
// things that hand them over. The filter itself is `src/run/unlocks.ts`, which
// imports nothing from here - the same seam `RunContent` already uses.
//
// **What is gated, and the rule that chose it.** A gated id is a card that
//
//   - appears in **no class's starting deck**, so nothing a run is handed on
//     turn one is ever missing, and
//   - is weighted **5 or lower** by every class that lists it, so what a fresh
//     profile cannot draft is the tail of each pool rather than its middle.
//
// At the pools in `src/content/classes.ts` that is seven cards. It costs the
// Knight 24 of its 87 pool weight, the Ranger 16 of 85 and the Mage 10 of 78,
// and leaves every class 9 or 10 cards to draft from against a shelf of three.
// The Man-at-Arms (Knight 8) and the Veteran (Mage 6) are the two cards the
// rule keeps out of the gate, and both are common in the class that leans on
// them.
//
// **The list is written out, not derived from those weights**, and that is
// deliberate. A derived list would relock a card the day someone retunes a
// weight, taking back something a player had already earned, and ids are
// stable forever (`AGENTS.md`) exactly so that a record of what someone owns
// keeps meaning what it meant. The rule above is the reason each id is here,
// not a check this file runs.
//
// **Nothing here is a balance change and nothing here is power.** No cost,
// stat or weight moves; a gated card keeps every number it has and every class
// keeps every weight it wrote. What an unlock does is put one more row back in
// a draw table. `test/unlocks.test.ts` holds that to be the only thing it can
// do, by comparing every other field of the narrowed content with the field it
// came from.
//
// One sigil is gated and no hero sigil is. A hero sigil offer draws
// `heroSigilOffers` (2) distinct sigils from the three that exist, so gating
// one would leave the first offer with two of two and no decision in it; that
// is a worse first run, not a smaller one. The Guard Sigil is the card sigil
// the shipped content already weights lowest, for the reason
// `src/content/sigils.ts` gives.

import type { AchievementDef } from '../run/unlocks.ts';
import { makeUnlockSet } from '../run/unlocks.ts';
import type { UnlockSet } from '../run/types.ts';
import { CLASSES } from './classes.ts';
import { SIGILS } from './sigils.ts';

/**
 * The ids a fresh profile cannot draft. Card ids from `src/content/cards.ts`
 * and sigil ids from `src/content/sigils.ts`, in one list, because the pool a
 * fight's shelf draws from holds both.
 */
export const GATED_IDS: readonly string[] = [
  'u_captain',
  'u_sentinel',
  'u_longbow',
  'u_paladin',
  'u_champion',
  'u_thane',
  'u_bulwark',
  'si_guard',
];

/**
 * What a finished run can earn, and what each one adds.
 *
 * Five, and small on purpose. Four read the run's depth, which is the
 * design's own "finishing runs adds cards and sigils to the pool"; the fifth
 * reads something the player did rather than how far they got, so the shape
 * this file can hold is not only a ladder. Every condition is a pure function
 * of the finished `RunState` (`achievementEarned` in `src/run/unlocks.ts`), so
 * two runs that hash the same earn the same things.
 *
 * The first fires on **any** ended run, won or lost. That is the design's "no
 * persistent power, every run is winnable from the first one" read from the
 * other side: a player who loses is still collecting, so nothing here is a
 * wall in front of someone who has not won yet.
 *
 * `unlocks` never overlap, so what a run earned is what it added; the checks
 * at the foot of this file hold that and hold every id to the gated list.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'a_first_run',
    name: 'First Blood',
    how: 'Finish a run, however it ends.',
    condition: { kind: 'finished' },
    unlocks: ['u_captain'],
  },
  {
    id: 'a_act_one',
    name: 'Past the Gate',
    how: "Beat an act's boss.",
    condition: { kind: 'actsCleared', amount: 1 },
    unlocks: ['u_sentinel', 'si_guard'],
  },
  {
    id: 'a_act_two',
    name: 'Two Acts Deep',
    how: 'Beat the bosses of two acts in one run.',
    condition: { kind: 'actsCleared', amount: 2 },
    unlocks: ['u_paladin', 'u_longbow'],
  },
  {
    id: 'a_won_run',
    name: 'The Black Gate',
    how: 'Win a run.',
    condition: { kind: 'won' },
    unlocks: ['u_champion', 'u_thane'],
  },
  {
    id: 'a_cascade',
    name: 'Author of Cascades',
    how: 'Attach three card sigils in one run.',
    condition: { kind: 'cardSigils', amount: 3 },
    unlocks: ['u_bulwark'],
  },
];

/** A player who has finished nothing: everything gated, nothing owned. */
export const FRESH_UNLOCKS: UnlockSet = makeUnlockSet(GATED_IDS, []);

/**
 * Everything gated and everything owned - the pool exactly as it is with no
 * unlock layer, but reached through the narrowing rather than around it.
 *
 * Not the same object as "no unlock layer", and the difference is the point:
 * `null` means the run was never filtered, this means it was filtered and
 * nothing was held back. `test/unlocks.test.ts` requires the two to produce
 * the same content and the same run, which is what says the filter is a filter
 * and not a second content.
 */
export const ALL_UNLOCKS: UnlockSet = makeUnlockSet(GATED_IDS, GATED_IDS);

/** The ids `earned` achievements add, as an unlock set over the gated list. */
export function unlocksFor(earnedIds: readonly string[]): UnlockSet {
  const owned: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (earnedIds.includes(a.id)) owned.push(...a.unlocks);
  }
  return makeUnlockSet(GATED_IDS, owned);
}

/** An achievement by id, or undefined. The screens name them; nothing else does. */
export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Which achievement hands `id` over, for the line a locked card shows. */
export function unlockedBy(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.unlocks.includes(id));
}

// ---------------------------------------------------------------------------
// Checked once at module load, as `classes.ts` and `content.ts` check theirs.
// A typo here is otherwise a card that can never be drafted by anyone.
// ---------------------------------------------------------------------------

const DRAFTABLE = new Set<string>([
  ...CLASSES.flatMap((c) => c.rewards.map((r) => r.cardId)),
  ...SIGILS.map((s) => s.id),
]);

const IN_A_STARTING_DECK = new Set<string>(CLASSES.flatMap((c) => c.startingDeck));

{
  const seen = new Set<string>();
  for (const id of GATED_IDS) {
    if (seen.has(id)) throw new Error(`unlocks: "${id}" is gated twice; the gated list is a set`);
    seen.add(id);
    if (!DRAFTABLE.has(id)) {
      throw new Error(
        `unlocks: "${id}" is gated and nothing can draft it - no class pool lists it and it is ` +
          `not a sigil. Gate an id that appears in a class's rewards or in src/content/sigils.ts.`,
      );
    }
    if (IN_A_STARTING_DECK.has(id)) {
      throw new Error(
        `unlocks: "${id}" is gated and a class starts with it. A run is always handed its class's ` +
          `whole starting deck, so gating one of those cards would show the player a card they ` +
          `hold and cannot draft. Gate a card no starting deck names.`,
      );
    }
  }

  const handedOut = new Set<string>();
  const achievementIds = new Set<string>();
  for (const a of ACHIEVEMENTS) {
    if (achievementIds.has(a.id)) {
      throw new Error(`unlocks: duplicate achievement id "${a.id}"; ids are unique and stable forever`);
    }
    achievementIds.add(a.id);
    if (a.unlocks.length === 0) {
      throw new Error(
        `unlocks: achievement "${a.id}" unlocks nothing, so earning it would say nothing. Give it ` +
          `at least one gated id, or take it out.`,
      );
    }
    for (const id of a.unlocks) {
      if (!seen.has(id)) {
        throw new Error(
          `unlocks: achievement "${a.id}" hands over "${id}", which is not in GATED_IDS - so it is ` +
            `already draftable and earning the achievement would change nothing.`,
        );
      }
      if (handedOut.has(id)) {
        throw new Error(
          `unlocks: "${id}" is handed over by two achievements. One id, one achievement, so what a ` +
            `run earned is what it added.`,
        );
      }
      handedOut.add(id);
    }
  }
  for (const id of GATED_IDS) {
    if (!handedOut.has(id)) {
      throw new Error(
        `unlocks: "${id}" is gated and no achievement unlocks it, so no player could ever draft ` +
          `it. Add it to an achievement's unlocks, or take it out of GATED_IDS.`,
      );
    }
  }
}
