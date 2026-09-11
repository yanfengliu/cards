// What a run may draft from, and what a finished run adds to that for the next one.
//
// `docs/design/game.md`: "**Meta-progression is unlocks only.** Finishing runs
// adds cards and sigils to the pool. No persistent power, no hub to rebuild -
// every run is winnable from the first one." So the whole of this layer is a
// *filter over content*, and the filter only ever gets wider:
//
//   - `unlockedContent` narrows two fields of a `RunContent` and nothing else:
//     the reward pool (the content's own and every class's) and the sigil
//     list. The hero, the starting deck, the acts, the map shape, the events,
//     the gold, the prices and the round cap come out of it as the same
//     objects that went in. That is the "no persistent power" rule as
//     arithmetic rather than as an intention: an unlock cannot move a number
//     because there is no number here to move.
//   - Widening is monotone. For two sets where one owns everything the other
//     owns, the narrower content's reward rows are a subsequence of the wider
//     one's, with every weight untouched. Unlocking adds rows; it never edits
//     one and never removes one.
//
// **An `UnlockSet` is an input to a run, in the same sense the class is.** It
// is fixed when the run starts - finishing a run never widens the run you are
// in - and it is recorded in the log, so a replay narrows the content by the
// set the run was *played* with rather than by whatever the player has
// unlocked today. That matters more here than it looks: a reward pick in a log
// is an index into a shelf, so a shelf drawn from a different pool makes the
// same index name a different card, and the replay would be a different run
// wearing the seed. `docs/policies/local-rules.md` records the round that
// learned it.
//
// The set carries **both** halves - what was gated and what was owned - rather
// than the owned half alone. With only the owned half, narrowing an old log
// would need today's gated list, and adding a card to that list would silently
// retire every log written before it. With both halves the pair is a complete
// description of the filter, so a log stays replayable across a content change
// that adds or removes gated content.
//
// Which ids are gated, and what unlocks them, is content: `src/content/unlocks.ts`.
// Nothing here imports it, the same seam `RunContent` already uses.

import type { RunContent, RunState, UnlockSet } from './types.ts';

/**
 * An unlock set with both lists deduped and sorted, so two sets holding the
 * same ids canonicalise the same and the run hash cannot move on list order.
 */
export function makeUnlockSet(
  gated: readonly string[],
  owned: readonly string[],
): UnlockSet {
  const tidy = (xs: readonly string[]): readonly string[] =>
    Object.freeze([...new Set(xs)].sort());
  return Object.freeze({ gated: tidy(gated), owned: tidy(owned) });
}

/**
 * `set` in the one form the digest may see: sorted and deduped, `null`
 * untouched.
 *
 * `UnlockSet` is a bare structural type, so *any* object with two string lists
 * satisfies it - one a caller built by hand, one read out of JSON, one whose
 * lists came back from a `Set` in insertion order. `makeUnlockSet` produces the
 * canonical form, but nothing forced a caller through it, and the run digest
 * quotes both lists verbatim. Two runs that own exactly the same ids in a
 * different order would then hash apart, and `replayRun` - which reads the
 * log's set through `parseUnlockSet`, and so always canonicalises - would
 * disagree with the live run it is replaying. That is the keystone breaking on
 * an input nothing rejected.
 *
 * So `startRun` funnels every set through here, and the property is the one
 * `src/run/types.ts` already claims: the set a run holds is canonical, whatever
 * shape it arrived in.
 */
export function canonicalUnlockSet(set: UnlockSet | null): UnlockSet | null {
  return set === null ? null : makeUnlockSet(set.gated, set.owned);
}

/**
 * May a run with this set draft `id`?
 *
 * Anything the set does not gate is always draftable. That is what makes a
 * content addition safe by default: a card nobody listed as gated is in the
 * pool for every run, including one replaying a log written before it existed.
 */
export function isUnlocked(set: UnlockSet, id: string): boolean {
  return !set.gated.includes(id) || set.owned.includes(id);
}

/**
 * `rewards`, with what this set cannot draft filtered out. Order and weights
 * untouched: what comes back is a subsequence of what went in.
 *
 * The **one** place a reward table is narrowed. `unlockedContent` below calls
 * it and so does the class-pick screen, because that screen tells the player
 * how many cards each class drafts from and two filters that disagreed would
 * put a number on screen that no run uses.
 */
export function unlockedRewards<T extends { readonly cardId: string }>(
  set: UnlockSet | null,
  rewards: readonly T[],
): readonly T[] {
  return set === null ? rewards : rewards.filter((e) => isUnlocked(set, e.cardId));
}

/** Gated ids this set does not own, sorted. What the player has still to earn. */
export function stillLocked(set: UnlockSet): string[] {
  return set.gated.filter((id) => !set.owned.includes(id));
}

/**
 * `content` as a run holding `unlocked` drafts it.
 *
 * `null` is "no unlock layer at all" - every measurement, every test fixture
 * and every run recorded before unlocks existed - and it returns the content
 * itself, so those paths are byte-identical to what they were.
 *
 * Exactly three fields can differ, and each is a filtered copy of the list
 * that went in: `rewards`, `sigils`, and each entry of `classes`. Every other
 * field comes out as the same object, which is the check
 * `test/unlocks.test.ts` makes rather than a promise this comment makes.
 */
export function unlockedContent(content: RunContent, unlocked: UnlockSet | null): RunContent {
  if (unlocked === null) return content;
  const classes = content.classes?.map((c) => ({
    ...c,
    rewards: unlockedRewards(unlocked, c.rewards),
  }));
  return {
    ...content,
    rewards: unlockedRewards(unlocked, content.rewards),
    sigils: content.sigils.filter((s) => isUnlocked(unlocked, s.id)),
    ...(classes === undefined ? {} : { classes }),
  };
}

/**
 * Reasons `content` narrowed by `unlocked` would not be playable, as sentences.
 * Empty is the claim, and the claim is "**every run is winnable from the first
 * one**" reduced to the parts of it a check can see.
 *
 * The first two are about the shelf a fight and a shop draw. `drawDistinct`
 * takes `min(k, pool.length)` draws, so a pool shorter than the offer count
 * both shortens the shelf and takes fewer draws than the same run would take
 * unnarrowed - the run stream would sit somewhere else for the rest of the
 * run. The third is about the card-sigil shelf, which draws one from whatever
 * card sigils are left.
 *
 * What it deliberately does not check: whether the narrowed pool is *strong*
 * enough to win with. That is a balance claim, it needs the simulator rather
 * than a predicate, and `npm run measure:run -- --unlocks` is where it is
 * asked. This is the structural half.
 */
export function unlockProblems(content: RunContent, unlocked: UnlockSet | null): string[] {
  const problems: string[] = [];
  const narrowed = unlockedContent(content, unlocked);
  const need = Math.max(content.rewardOffers, content.shopStock);
  const pools: { readonly who: string; readonly rewards: readonly { cardId: string }[] }[] = [
    { who: 'the content', rewards: narrowed.rewards },
    ...(narrowed.classes ?? []).map((c) => ({ who: `the ${c.name}`, rewards: c.rewards })),
  ];
  for (const { who, rewards } of pools) {
    if (rewards.length < need) {
      problems.push(
        `${who} can draft ${rewards.length} card(s) at this unlock set, and a fight shelf offers ` +
          `${content.rewardOffers} while a shop stocks ${content.shopStock}. A pool shorter than ` +
          `${need} shortens the shelf and moves the run stream. Gate fewer cards, or lower the ` +
          `offer counts.`,
      );
    }
  }
  if (content.cardSigilChance > 0 && narrowed.sigils.filter((s) => s.kind === 'card').length === 0) {
    problems.push(
      `no card sigil is unlocked at this set and cardSigilChance is ${content.cardSigilChance}, so ` +
        `a fight shelf rolls for a sigil it can never offer. Leave at least one card sigil ` +
        `ungated, or set cardSigilChance to 0.`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// What a finished run earned
// ---------------------------------------------------------------------------

/**
 * What a run has to have done for an achievement to fire. Data, read by
 * `achievementEarned` below, for the same reason `HeroSigilEffect` is data: an
 * achievement that needed its own `if` in a content file would be a rule
 * hiding in a data row.
 *
 * Every one of these is a pure function of the finished `RunState`, so what a
 * run earned is as deterministic as the run, and two players whose runs hash
 * the same earn the same things.
 */
export type UnlockCondition =
  /** The run ended, however it ended. */
  | { readonly kind: 'finished' }
  /** At least `amount` act bosses beaten. */
  | { readonly kind: 'actsCleared'; readonly amount: number }
  /** The run was won: every act cleared. */
  | { readonly kind: 'won' }
  /** At least `amount` card sigils attached in the one run. */
  | { readonly kind: 'cardSigils'; readonly amount: number };

/**
 * One thing a run can earn, and what earning it adds to the pool.
 *
 * `how` is the sentence the screen shows before it is earned, so an
 * achievement the player cannot see the shape of is not one this file can
 * define.
 */
export type AchievementDef = {
  readonly id: string;
  readonly name: string;
  readonly how: string;
  readonly condition: UnlockCondition;
  /** Card ids and sigil ids this adds to the pool. */
  readonly unlocks: readonly string[];
};

/** Act bosses this run beat. 3 of 3 is a won run. */
export function actsCleared(run: RunState): number {
  return Math.min(run.act, run.content.acts.length);
}

/** Card sigils attached in this run. Hero sigils are not counted; they are not cards. */
export function cardSigilsAttached(run: RunState): number {
  return run.sigils.filter((g) => g.target !== 'hero').length;
}

/**
 * Has this run earned `condition`? A pure function of the run, asked once when
 * the run ends.
 *
 * An ongoing run has earned nothing at all - not even `finished` - because a
 * run that is still being played has not finished and an unlock that landed
 * mid-run would widen a pool the run is already drafting from, which is the
 * one thing the recorded unlock set promises cannot happen.
 */
export function achievementEarned(run: RunState, condition: UnlockCondition): boolean {
  if (run.result === 'ongoing') return false;
  switch (condition.kind) {
    case 'finished':
      return true;
    case 'actsCleared':
      return actsCleared(run) >= condition.amount;
    case 'won':
      return run.result === 'won';
    case 'cardSigils':
      return cardSigilsAttached(run) >= condition.amount;
  }
}

/** Every achievement in `defs` this finished run earned, in the order listed. */
export function earnedBy(run: RunState, defs: readonly AchievementDef[]): AchievementDef[] {
  return defs.filter((d) => achievementEarned(run, d.condition));
}

// ---------------------------------------------------------------------------
// Reading one back
// ---------------------------------------------------------------------------

/**
 * An unlock set out of a saved log or a stored profile, or an error naming
 * what is wrong with it.
 *
 * Loud rather than lenient, and the reason is the whole point of recording the
 * set: a log whose set cannot be read is a log whose shelves cannot be redrawn,
 * and a replay that quietly fell back to "nothing gated" would reach a
 * different run and report success. `null` in, `null` out - a log that names no
 * set was played with no unlock layer.
 */
export function parseUnlockSet(raw: unknown, where: string): UnlockSet | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') {
    throw new Error(
      `unlocks: ${where} holds ${typeof raw} where an unlock set belongs. An unlock set is ` +
        `{gated: string[], owned: string[]}; leave the field out for a run played with no ` +
        `unlock layer.`,
    );
  }
  const obj = raw as { gated?: unknown; owned?: unknown };
  const list = (value: unknown, field: string): readonly string[] => {
    if (!Array.isArray(value)) {
      throw new Error(
        `unlocks: ${where} has no \`${field}\` list. An unlock set is {gated: string[], ` +
          `owned: string[]}, and both lists are needed - the pair is what lets an old log be ` +
          `narrowed without today's content.`,
      );
    }
    for (const id of value) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          `unlocks: ${where} lists ${JSON.stringify(id)} in \`${field}\`, and an unlock set holds ` +
            `card ids and sigil ids as non-empty strings.`,
        );
      }
    }
    return value as readonly string[];
  };
  return makeUnlockSet(list(obj.gated, 'gated'), list(obj.owned, 'owned'));
}
