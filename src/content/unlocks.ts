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
//   - is weighted **`GATE_WEIGHT_CEILING` or lower** by every class that
//     lists it, so what a fresh profile cannot draft is the tail of each pool
//     rather than its middle.
//
// **The list is written out, not derived from those weights**, and that is
// deliberate. A derived list would relock a card the day someone retunes a
// weight, taking back something a player had already earned, and ids are
// stable forever (`AGENTS.md`) exactly so that a record of what someone owns
// keeps meaning what it meant.
//
// **But the list and the rule are held to each other.** `test/unlocks.test.ts`
// - *GATED_IDS is the rule its header states* - reads the pools in
// `src/content/classes.ts`, works out which cards the rule selects, and goes
// red naming the card the day a new card or a moved weight makes the rule and
// this list disagree. Its message offers the two ways out, and both are
// decisions rather than edits: change the list, or write the card into
// `RULE_EXCEPTIONS` below with the reason it departs. A written-out list with
// nothing holding it to its rule is how this one went stale: units 11 and 12
// were built side by side from `dcf2cdf`, unit 11 added six tribal cards to
// every pool, and when the two merged the rule selected three of them - the
// Runesmith, the Marshal and the Elf Lord, each weighted at or under the
// ceiling by every class that lists it - while the list still held the seven
// cards it was written with. Nothing noticed until a review counted. They are
// gated now, and First Blood hands them over.
//
// What the rule costs each class - how many cards, and how much pool weight, a
// fresh profile cannot draft - is printed by `npm run measure:run -- --unlocks
// none`, one class at a time with `--class <id>`, and is not written here. It
// used to be, and two of the numbers were wrong on the day they were written:
// `cf2092f` gave the Knight's pool as 87 and the Mage's as 78, and at that
// commit they weighed 95 and 82.
//
// **The tribal pairs.** Each tribal trait is printed by two cards, a 2-cost
// carrier and a 3-cost one, and the rule gates only the second: the Kindler,
// the Bannerman and the Songkeeper are each weighted above the ceiling by at
// least one class, so they stay draftable, and every tribal trait stays
// draftable at a fresh profile. Both halves of that are held rather than
// trusted. A carrier that fell under the ceiling everywhere would be a card
// the rule selects and the list does not gate, which the test above names.
// And a trait left with no draftable carrier - both of its cards gated,
// whatever the weights say - turns *every class can draft every tribal trait
// and every player race at every unlock set a player can reach* in
// `test/classes.test.ts` red; it asks at every set the deeds can produce.
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
 * The rule's one number: a card any class weights above this is never gated.
 * Data rather than a figure in a sentence, so the header and the gate that
 * holds this list to the rule read the same number.
 */
export const GATE_WEIGHT_CEILING = 5;

/** A card `GATED_IDS` treats differently from the rule on purpose, and why. */
export type RuleException = {
  readonly id: string;
  readonly why: string;
};

/**
 * Where `GATED_IDS` departs from the rule, one row per card, each with its
 * reason. **Empty: at today's pools the list is exactly what the rule
 * selects.**
 *
 * This is where the "no take-backs" half of the header lives. When a new card
 * or a moved weight makes the rule select a card the list does not gate,
 * `test/unlocks.test.ts` goes red, and both ways out are decisions: gate it,
 * which takes it away from every profile that drafts it today, or write it
 * here with the reason it stays draftable. The same the other way round: a
 * gated card the rule no longer selects is ungated, or written here with the
 * reason it stays gated. Which way a row departs is whatever `GATED_IDS` does
 * with the card. A row naming a card the rule and the list already agree
 * about is stale, and that is red too.
 */
export const RULE_EXCEPTIONS: readonly RuleException[] = [];

/**
 * The ids a fresh profile cannot draft. Card ids from `src/content/cards.ts`
 * and sigil ids from `src/content/sigils.ts`, in one list, because the pool a
 * fight's shelf draws from holds both. The collection screen lists them in
 * this order.
 */
export const GATED_IDS: readonly string[] = [
  'u_captain',
  'u_runesmith',
  'u_marshal',
  'u_elflord',
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
 *
 * The three 3-cost tribal cards are the first deed's. Each is the second card
 * printing a tribal trait whose first stays ungated, so a fresh profile can
 * still take every tribe as a direction and is missing only the bigger card
 * that prints it - and only until its first run ends, won or lost. Putting
 * them here, rather than spreading them over the deeds that read depth, also
 * leaves every other deed handing over exactly what it did before they were
 * gated.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'a_first_run',
    name: 'First Blood',
    how: 'Finish a run, however it ends.',
    condition: { kind: 'finished' },
    unlocks: ['u_captain', 'u_runesmith', 'u_marshal', 'u_elflord'],
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

  // The shape of an exception. Whether each one is still an exception - the
  // rule and the list really do disagree about it - needs the rule worked out
  // from the pools, which is `test/unlocks.test.ts`'s job rather than a load's.
  const excepted = new Set<string>();
  for (const e of RULE_EXCEPTIONS) {
    if (excepted.has(e.id)) {
      throw new Error(`unlocks: "${e.id}" is in RULE_EXCEPTIONS twice; one card, one reason`);
    }
    excepted.add(e.id);
    if (!DRAFTABLE.has(e.id)) {
      throw new Error(
        `unlocks: RULE_EXCEPTIONS names "${e.id}", which no class pool lists, so the rule has ` +
          `nothing to say about it. Take the row out.`,
      );
    }
    if (e.why.trim().length === 0) {
      throw new Error(
        `unlocks: RULE_EXCEPTIONS keeps "${e.id}" apart from the rule and gives no reason. An ` +
          `exception is a decision, and the reason is the decision.`,
      );
    }
  }
}
