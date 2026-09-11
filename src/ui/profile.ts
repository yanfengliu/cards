/**
 * What survives a run: the player's profile.
 *
 * It lives beside the saved run, in the same `localStorage` and under the same
 * `cards.` prefix - `cards.run.<seed>` is one run in progress, `cards.profile`
 * is the player. One mechanism, not two: `src/ui/runapp.ts` already reads and
 * writes the run slot with the same guards, because storage can be missing or
 * refused (a private window, a blocked origin) and every access has to say so
 * with a value rather than an exception.
 *
 * **What is stored is what was earned, and separately what was unlocked.** The
 * owned ids are not recomputed from the earned achievements on load; they are
 * kept. A later content change that moves a card from one achievement to
 * another, or drops it, would otherwise take back something a player already
 * had, and an unlock that can be taken back is not an unlock. The two are
 * *unioned* on load instead, so the record only ever widens: an achievement
 * that grows a new card hands it to everyone who already earned it, and one
 * that loses a card leaves it with everyone who already has it.
 *
 * **Nothing here is power.** The profile decides one thing - which rows of a
 * draw table exist - through `unlockSetFor` and `src/run/unlocks.ts`. It holds
 * no bonus, no currency and no upgrade, and there is nowhere for one to go: the
 * fields are two id lists and two counters the screens read out.
 *
 * The DOM is not touched here. `runapp.ts` does the wiring and
 * `src/ui/unlocks.ts` does the words, so everything in this file is reachable
 * from `node --test`.
 */

import { ACHIEVEMENTS, GATED_IDS, unlocksFor } from '../content/unlocks.ts';
import type { RunState, UnlockSet } from '../run/types.ts';
import { type AchievementDef, earnedBy, makeUnlockSet } from '../run/unlocks.ts';

/** Where the profile is kept. Beside `cards.run.<seed>`, under the same prefix. */
export const PROFILE_KEY = 'cards.profile';

/**
 * The shape this code writes. A stored profile in an unknown version is
 * refused by `parseProfile` rather than half-read, and `loadProfile` turns
 * that into a fresh profile plus a sentence for the player - losing a
 * collection quietly is worse than being told.
 */
export const PROFILE_VERSION = 1;

export type Profile = {
  readonly version: number;
  /** Achievement ids earned, sorted. */
  readonly earned: readonly string[];
  /** Content ids unlocked, sorted. Kept, not recomputed. See the file note. */
  readonly owned: readonly string[];
  readonly runsFinished: number;
  readonly runsWon: number;
};

export function emptyProfile(): Profile {
  return { version: PROFILE_VERSION, earned: [], owned: [], runsFinished: 0, runsWon: 0 };
}

/**
 * What a run with this profile may draft.
 *
 * The stored ids and the ids today's achievements say those earned things hand
 * over, unioned - the widening rule from the file note, in one line.
 */
export function unlockSetFor(profile: Profile): UnlockSet {
  return makeUnlockSet(GATED_IDS, [...profile.owned, ...unlocksFor(profile.earned).owned]);
}

/**
 * A stored profile, or an error naming what is wrong with it.
 *
 * Strict about the version and about the two lists, because the alternative is
 * reading a profile written by some other code as if it were this one's, and
 * the thing that goes wrong then is a player's collection.
 */
export function parseProfile(raw: unknown): Profile {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(
      `profile: ${PROFILE_KEY} holds ${raw === null ? 'null' : typeof raw} where a profile ` +
        `belongs. A profile is an object with version, earned, owned, runsFinished and runsWon.`,
    );
  }
  const p = raw as Record<string, unknown>;
  if (p['version'] !== PROFILE_VERSION) {
    throw new Error(
      `profile: ${PROFILE_KEY} was written in version ${String(p['version'])} and this code reads ` +
        `version ${PROFILE_VERSION}. Its unlocks cannot be read as this version's without ` +
        `guessing what they meant.`,
    );
  }
  const ids = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value)) {
      throw new Error(`profile: ${PROFILE_KEY} has no \`${field}\` list, and it is a list of ids.`);
    }
    for (const id of value) {
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error(
          `profile: ${PROFILE_KEY} lists ${JSON.stringify(id)} in \`${field}\`, and ids are ` +
            `non-empty strings.`,
        );
      }
    }
    return [...new Set(value as string[])].sort();
  };
  const count = (value: unknown, field: string): number => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(
        `profile: ${PROFILE_KEY} has \`${field}\` as ${JSON.stringify(value)}, and it counts runs ` +
          `- a whole number, never below zero.`,
      );
    }
    return value;
  };
  return {
    version: PROFILE_VERSION,
    earned: ids(p['earned'], 'earned'),
    owned: ids(p['owned'], 'owned'),
    runsFinished: count(p['runsFinished'], 'runsFinished'),
    runsWon: count(p['runsWon'], 'runsWon'),
  };
}

/** What one finished run did to the profile, and what the end screen reports. */
export type RunUnlocks = {
  readonly profile: Profile;
  /** Achievements this run earned that the profile did not already hold. */
  readonly newlyEarned: readonly AchievementDef[];
  /** Content ids this run added, sorted. Empty when the run earned nothing new. */
  readonly gained: readonly string[];
};

/**
 * The profile after `run`, and what changed.
 *
 * Only a finished run counts: `earnedBy` answers nothing for an ongoing one,
 * and the counters move only when the run has actually ended, so calling this
 * mid-run - which the app does not - would still be a no-op rather than a
 * half-applied run.
 *
 * The result is a new profile; nothing is mutated. `owned` is a union, so this
 * function cannot take anything away - which is the property
 * `test/unlocks.test.ts` holds it to, over every combination of run and stored
 * profile it walks.
 */
export function applyRunToProfile(
  profile: Profile,
  run: RunState,
  defs: readonly AchievementDef[] = ACHIEVEMENTS,
): RunUnlocks {
  if (run.result === 'ongoing') {
    return { profile, newlyEarned: [], gained: [] };
  }
  const earned = earnedBy(run, defs);
  const newlyEarned = earned.filter((a) => !profile.earned.includes(a.id));
  const held = new Set(profile.owned);
  const gained = [...new Set(newlyEarned.flatMap((a) => a.unlocks))]
    .filter((id) => !held.has(id))
    .sort();
  return {
    profile: {
      version: PROFILE_VERSION,
      earned: [...new Set([...profile.earned, ...earned.map((a) => a.id)])].sort(),
      owned: [...new Set([...profile.owned, ...gained])].sort(),
      runsFinished: profile.runsFinished + 1,
      runsWon: profile.runsWon + (run.result === 'won' ? 1 : 0),
    },
    newlyEarned,
    gained,
  };
}

// ---------------------------------------------------------------------------
// Storage. The only part of this file a test cannot reach, and it is three
// lines per direction for that reason.
// ---------------------------------------------------------------------------

/** A loaded profile, whether it may be written back, and why not. */
export type LoadedProfile = {
  readonly profile: Profile;
  /**
   * False when something *was* stored and could not be read. The caller must
   * not write over it then: a profile this code cannot parse may still be one
   * a newer build can, and overwriting it would turn "your collection is
   * temporarily unreadable" into "your collection is gone".
   */
  readonly writable: boolean;
  /**
   * Null when the profile loaded, or when there was nothing stored at all. A
   * sentence when something was stored and could not be read - the screen says
   * it, because a collection that vanishes without a word is the worst version
   * of this.
   */
  readonly problem: string | null;
};

export function loadProfile(): LoadedProfile {
  let raw: string | null | undefined;
  try {
    raw = globalThis.localStorage?.getItem(PROFILE_KEY);
  } catch {
    // Storage refused the read: a private window, a blocked origin. There is
    // nothing stored to protect, so a write may still be attempted and will
    // fail the same way.
    return { profile: emptyProfile(), writable: true, problem: null };
  }
  if (raw === null || raw === undefined) {
    return { profile: emptyProfile(), writable: true, problem: null };
  }
  try {
    return { profile: parseProfile(JSON.parse(raw)), writable: true, problem: null };
  } catch (e) {
    return {
      profile: emptyProfile(),
      writable: false,
      problem:
        `${e instanceof Error ? e.message : String(e)} It has been left exactly as it is and ` +
        `nothing will be written over it, so this session plays with everything locked.`,
    };
  }
}

/** Write the profile back. Returns false when storage refused it. */
export function saveProfile(profile: Profile): boolean {
  try {
    globalThis.localStorage?.setItem(PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}
