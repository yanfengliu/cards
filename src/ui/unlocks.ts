/**
 * The two screens the unlock layer needs: what a finished run added, and what
 * the player has.
 *
 * Both are HTML strings built the way `runapp.ts` and `sigils.ts` build theirs,
 * with no DOM in this file, so `node --test` can call every one of them. That
 * is the lesson `runapp.ts`'s own note records: a wiring nobody can test is a
 * wiring nobody is checking, and a panel whose only caller needs a document is
 * a panel that can quietly stop listing half the collection.
 *
 * **The collection screen names what is locked and how to get it.** A locked
 * card shows its name and the sentence that opens it, not a silhouette: the
 * design's unlocks "add cards and sigils to the pool", so knowing what is in
 * the pool to be added is the whole of what makes finishing another run
 * interesting. It also says, in as many words, that nothing here makes a run
 * stronger - because the first thing a player will assume about a collection
 * screen is that it does.
 */

import { ACHIEVEMENTS, GATED_IDS, unlockedBy } from '../content/unlocks.ts';
import { SIGILS } from '../content/sigils.ts';
import type { CardPool } from '../engine/state.ts';
import type { UnlockSet } from '../run/types.ts';
import { type AchievementDef, isUnlocked } from '../run/unlocks.ts';
import { TRAIT_TERMS } from '../render/glossary.ts';
import { iconSvg } from '../render/icons.ts';
import { SIGIL_TERM } from '../render/sigil-terms.ts';
import type { Profile, RunUnlocks } from './profile.ts';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

/** One unlockable thing, as the collection lists it. */
export type UnlockEntry = {
  readonly id: string;
  readonly name: string;
  /** What it is, in a few words: the stats line for a card, the trait for a sigil. */
  readonly what: string;
  readonly kind: 'card' | 'sigil';
  readonly owned: boolean;
  /** The achievement that opens it, or null when nothing does. */
  readonly from: AchievementDef | null;
};

/**
 * Every gated id, in the order `GATED_IDS` lists them, with its name, what it
 * is and whether this set owns it.
 *
 * A card the pool no longer knows is listed by its id with no stats rather
 * than crashing the screen: a collection that throws because content moved is
 * worse than one that says less about one row.
 */
export function collectionEntries(set: UnlockSet, pool: CardPool): UnlockEntry[] {
  return GATED_IDS.map((id) => {
    const sigil = SIGILS.find((s) => s.id === id);
    if (sigil !== undefined) {
      return {
        id,
        name: sigil.name,
        what:
          sigil.kind === 'card'
            ? `attaches to a card: it gains ${TRAIT_TERMS[sigil.trait].name}`
            : `on the hero, for the whole run`,
        kind: 'sigil' as const,
        owned: isUnlocked(set, id),
        from: unlockedBy(id) ?? null,
      };
    }
    let name = id;
    let what = '';
    try {
      const card = pool.card(id);
      name = card.name;
      what =
        `${card.cost} cost · ${card.power}/${card.health}` +
        (card.armour > 0 ? ` · ${card.armour} armour` : '') +
        (card.traits.length > 0 ? ` · ${card.traits.map((t) => TRAIT_TERMS[t].name).join(', ')}` : '');
    } catch {
      what = 'no longer in the card pool';
    }
    return { id, name, what, kind: 'card' as const, owned: isUnlocked(set, id), from: unlockedBy(id) ?? null };
  });
}

/**
 * The collection: every unlockable card and sigil, owned or not, and the
 * achievement that opens each locked one.
 *
 * `earnedIds` is what the profile has already earned, so an achievement whose
 * card is owned still reads as done rather than as pending.
 */
export function collectionHtml(profile: Profile, set: UnlockSet, pool: CardPool): string {
  const entries = collectionEntries(set, pool);
  const owned = entries.filter((e) => e.owned).length;
  const done = new Set(profile.earned);
  const row = (e: UnlockEntry): string =>
    `<li class="unlock ${e.owned ? 'is-owned' : 'is-locked'}">` +
    `<span class="unlock__mark" aria-hidden="true">${iconSvg(e.kind === 'sigil' ? 'sigil' : 'deck', { size: 14, decorative: true })}</span>` +
    `<span class="unlock__name">${esc(e.name)}</span>` +
    `<span class="unlock__what">${esc(e.what)}</span>` +
    `<span class="unlock__how">${
      e.owned
        ? 'Unlocked'
        : e.from === null
          ? 'Nothing unlocks this yet'
          : `Locked — ${esc(e.from.how)}`
    }</span></li>`;
  const achievements = ACHIEVEMENTS.map(
    (a) =>
      `<li class="unlock ${done.has(a.id) ? 'is-owned' : 'is-locked'}">` +
      `<span class="unlock__mark" aria-hidden="true">${iconSvg(done.has(a.id) ? 'hero' : 'boss', { size: 14, decorative: true })}</span>` +
      `<span class="unlock__name">${esc(a.name)}</span>` +
      `<span class="unlock__what">${esc(a.how)}</span>` +
      `<span class="unlock__how">${done.has(a.id) ? 'Done' : 'Not yet'}</span></li>`,
  ).join('');
  return (
    `<section class="unlocks" id="collection">` +
    `<h3 class="unlocks__title">Collection — ${owned} of ${entries.length} unlocked</h3>` +
    `<p class="run__muted">Finishing runs adds cards and sigils to what a run can draft. ` +
    `Nothing here makes your hero stronger: an unlock widens the pool, it never raises a number, ` +
    `and every run is winnable from the first one. ` +
    `${profile.runsFinished} run${profile.runsFinished === 1 ? '' : 's'} finished, ` +
    `${profile.runsWon} won.</p>` +
    `<ul class="unlocks__list">${entries.map(row).join('')}</ul>` +
    `<h3 class="unlocks__title">Deeds</h3>` +
    `<ul class="unlocks__list">${achievements}</ul>` +
    `</section>`
  );
}

/**
 * What the run that just ended added, for the end screen.
 *
 * Empty string when it added nothing, so the caller can drop the block
 * entirely rather than print a heading over nothing. A run that earned an
 * achievement it already held adds nothing and says nothing, which is right:
 * "First Blood" is news once.
 */
export function runUnlocksHtml(gained: RunUnlocks, pool: CardPool): string {
  if (gained.newlyEarned.length === 0) return '';
  const name = (id: string): string => {
    const sigil = SIGILS.find((s) => s.id === id);
    if (sigil !== undefined) return `${sigil.name} (${SIGIL_TERM.name.toLowerCase()})`;
    try {
      return pool.card(id).name;
    } catch {
      return id;
    }
  };
  const deeds = gained.newlyEarned
    .map(
      (a) =>
        `<li><b>${esc(a.name)}</b> — ${esc(a.how)}<small>${
          a.unlocks.length === 0
            ? ''
            : ` Unlocks ${a.unlocks.map((id) => `<b>${esc(name(id))}</b>`).join(', ')}.`
        }</small></li>`,
    )
    .join('');
  const added =
    gained.gained.length === 0
      ? 'You already had everything it opens.'
      : `<b>${gained.gained.map((id) => esc(name(id))).join('</b>, <b>')}</b> ` +
        `${gained.gained.length === 1 ? 'is' : 'are'} now in the pool every future run drafts from.`;
  return (
    `<section class="unlocks unlocks--earned" id="run-unlocked">` +
    `<h3 class="unlocks__title">${iconSvg('sigil', { size: 16, decorative: true })} This run unlocked</h3>` +
    `<ul class="unlocks__deeds">${deeds}</ul>` +
    `<p class="run__muted">${added} It widens what you can draft; it does not make you stronger.</p>` +
    `</section>`
  );
}
