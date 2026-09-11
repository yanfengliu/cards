/**
 * The run, as screens.
 *
 * One controller (`run.ts`) holds the run; this file draws whatever it is
 * waiting on and hands its answer back. The screens are:
 *
 *   pick       the class: hero, starting deck and pool for each of the three,
 *              before anything else - `classpick.ts` draws it, this file
 *              starts the run when a class is chosen
 *   map        the act's whole map, every node with its icon, the nodes you can
 *              reach lit, and - on hover - everything a node still leads to,
 *              because a map whose routes cannot be read is not a map
 *   fight      the fight screen from `app.ts`, handed the node's `FightSetup`
 *   reward     the fight was won: gold is in, pick one of three cards or none
 *   forge      pick a deck card, then +1 Power, +1 Health or -1 Energy
 *   shop       three cards with prices, and the gold you have next to them
 *   event      a named encounter with its options, each one saying what it does
 *   rest       what the rest did, before the map comes back
 *   act        the boss fell and the next act's name, before its map
 *   end        how the run finished, its numbers, and the replay log
 *
 * Every choice shows its consequences before commit, in the sense
 * `ARCHITECTURE.md` gives that phrase: a fight node says who is in it and what
 * it pays, a rest says how much it heals, an event option says what it does,
 * and a reachable node on the map says which node types the routes beyond it
 * can still hold - exactly, from `pathSpread`, not by guessing.
 *
 * Nothing here advances the run except through the controller, and the
 * controller advances it only by `replayRun`. This file reads run state and
 * `nodes.ts`'s pure lookups to describe things; it never draws from the run
 * stream.
 */

import { CARD_POOL } from '../content/cards.ts';
import { type ClassDef, CLASSES, classById } from '../content/classes.ts';
import type { CardPool, Trait, UnitCard } from '../engine/state.ts';
import { RUN_CONTENT } from '../run/content.ts';
import { grantedTraits, resolveDeckCard, runPool } from '../run/deck.ts';
import { pathSpread } from '../run/map.ts';
import { encounterFor, goldFor, heldHeroSigils, restAmount } from '../run/nodes.ts';
import { currentMap, migrateRunLog, travelOptions } from '../run/run.ts';
import { renderClassPick } from './classpick.ts';
import { ALL_UNLOCKS, FRESH_UNLOCKS } from '../content/unlocks.ts';
import { unlockedRewards } from '../run/unlocks.ts';
import type { UnlockSet } from '../run/types.ts';
import {
  type Profile,
  type RunUnlocks,
  applyRunToProfile,
  loadProfile,
  saveProfile,
  unlockSetFor,
} from './profile.ts';
import { collectionHtml, runUnlocksHtml } from './unlocks.ts';
import type { DeckCard, EventEffect, ForgeMode, RunEventDef } from '../run/types.ts';
import { compressedCard } from '../render/board.ts';
import { STAT_TERMS, TRAIT_TERMS } from '../render/glossary.ts';
import { iconSvg } from '../render/icons.ts';
import { heroSigilTerm } from '../render/sigil-terms.ts';
import {
  NODE_ICON,
  NODE_LABEL,
  NODE_LINE,
  applyMapFocus,
  renderMapSvg,
  spreadFrom,
  spreadWords,
} from '../render/map.ts';
import { cardEntityView } from '../render/view.ts';
import type { RunLog } from '../run/types.ts';
import { type FightOutcome, createFightScreen, initialTheme, need } from './app.ts';
import { type NodeOutcome, type RunController, createRunController } from './run.ts';
import { attachHtml, heroSigilChips, heroSigilOfferHtml, sigilMarks, sigilOutcomeWords, sigilShelfButton } from './sigils.ts';
import { escapeHtml as esc } from '../render/escape.ts';

/**
 * Where a run in progress is kept between page loads: its log, which is the
 * whole run. `replayRun` rebuilds the state from it on the next load, through
 * the same path every other advance takes, so a saved run is not a second
 * representation of anything. One slot per seed. Storage can be missing or
 * refused - a private window, a blocked origin - and every access says so
 * with a null rather than an exception.
 */
export const SAVE_PREFIX = 'cards.run.';

/**
 * A stored run, whatever format it was written in, as the format this code
 * replays - or null when there is nothing readable there.
 *
 * The **migration** is the point, and it was missing: `loadSaved` used to hand
 * the parsed JSON straight to `createRunController`, and a log written by a
 * unit 8 build has no `format` field, so `replayRun` refused it, the caller
 * caught the refusal and `forget()`-ed the run. A player upgrading a build lost
 * a run in progress and got a line in the console. `migrateRunLog` is what
 * `RUN_LOG_FORMAT`'s whole upgrade path exists for; this is the one caller that
 * was not using it.
 *
 * Split out of `loadSaved` so `node --test` can reach it: it takes the stored
 * string rather than a `localStorage`, so the shape checks, the migration and
 * the refusal are all testable without a browser.
 */
export function parseSavedRun(raw: string | null | undefined, seed: number): RunLog | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as RunLog;
    if (typeof parsed !== 'object' || parsed === null || parsed.seed !== seed || !Array.isArray(parsed.nodes)) {
      return null;
    }
    return migrateRunLog(parsed);
  } catch (e) {
    // A stored run this code cannot read is not resumed, and the reason is said
    // rather than swallowed: `migrateRunLog` refuses by name, and its sentence
    // is the only account of why a run vanished.
    console.error(`cards: the saved run on seed ${seed} could not be read`, e);
    return null;
  }
}

/**
 * `persist` is false while `?unlocks=` is pinning the pool, and it is false for
 * **every** stored-state call, not only the write: a pinned session must not
 * read a stored run either, or it resumes a run played against the player's own
 * pool and then finishes it against the pinned one. See `storageAllowed`.
 */
export function loadSavedRun(seed: number, persist: boolean): RunLog | null {
  if (!persist) return null;
  try {
    return parseSavedRun(globalThis.localStorage?.getItem(`${SAVE_PREFIX}${seed}`), seed);
  } catch {
    return null;
  }
}

export function saveRun(log: RunLog, persist: boolean): void {
  if (!persist) return;
  try {
    globalThis.localStorage?.setItem(`${SAVE_PREFIX}${log.seed}`, JSON.stringify(log));
  } catch {
    // Nothing to do: the run is still on screen, it just will not survive a reload.
  }
}

export function forgetRun(seed: number, persist: boolean): void {
  if (!persist) return;
  try {
    globalThis.localStorage?.removeItem(`${SAVE_PREFIX}${seed}`);
  } catch {
    // As above.
  }
}

const FORGE_WORDS: Readonly<Record<ForgeMode, string>> = {
  power: `+1 ${STAT_TERMS.power.name}`,
  health: `+1 ${STAT_TERMS.health.name}`,
  cost: `−1 ${STAT_TERMS.cost.name}`,
};

/**
 * The classes this app offers, and the one gate on a class named from outside
 * it. Both are up here, exported, rather than inline in `startRunApp`, and that
 * is the point rather than tidiness.
 *
 * `startRunApp` needs a document, so nothing inside it can be reached by
 * `node --test`. An independent review found what that costs: the screen was
 * handed `CLASSES` at one call site and no test touched this file, so removing
 * the Mage from what the screen is offered left the whole suite green, and so
 * did deleting the guard that refuses an unknown `?class=`. A wiring nobody can
 * test is a wiring nobody is checking.
 *
 * So the two decisions live in two functions with no DOM in them, and
 * `test/classes.test.ts` calls exactly what the screen calls. Gated by "the
 * screen is handed every class the game has" and "a class named from outside
 * the app is refused unless it is one of the three".
 */
export const PICKABLE_CLASSES: readonly ClassDef[] = CLASSES;

/**
 * The class-pick screen as the app builds it, with the classes the app offers.
 *
 * `unlocked` narrows what each class's card says it drafts from, through the
 * same `unlockedRewards` a run is narrowed by - the screen must not promise a
 * pool the run will not have. Omitted, or null, is no unlock layer, which is
 * the screen exactly as it was before unlocks existed.
 */
export function classPickHtml(opts: {
  seed: number;
  pool: CardPool;
  mount: boolean;
  hatch: boolean;
  unlocked?: UnlockSet | null;
}): string {
  const set = opts.unlocked ?? null;
  return renderClassPick({
    seed: opts.seed,
    classes:
      set === null
        ? PICKABLE_CLASSES
        : PICKABLE_CLASSES.map((c) => ({ ...c, rewards: unlockedRewards(set, c.rewards) })),
    pool: opts.pool,
    mount: opts.mount,
    hatch: opts.hatch,
  });
}

/**
 * `?unlocks=` - a debug override that pins what a run may draft and **touches
 * no stored state at all**, so looking at a locked or an open collection cannot
 * spend the player's own progress and cannot disturb a run in progress. `all`
 * is no unlock layer at all, which is the pool every measurement plays and the
 * log every measurement writes; `none` is a fresh profile. Anything else,
 * including absent, is the stored profile.
 *
 * A pinned run therefore does not survive a reload, and that is the point
 * rather than a limitation - `storageAllowed` has the account of what the
 * earlier "never writes the profile" wording promised and did not deliver.
 *
 * Up here beside `pickableClassId` and for the same reason: `startRunApp`
 * needs a document, so a decision made inside it is a decision no test can
 * reach.
 */
export function unlockOverride(raw: string | null | undefined): 'all' | 'none' | null {
  return raw === 'all' || raw === 'none' ? raw : null;
}

/** What a run started now may draft: the override if there is one, else the profile's. */
export function unlockSetFrom(
  override: 'all' | 'none' | null,
  profile: Profile,
): UnlockSet | null {
  if (override === 'all') return null;
  if (override === 'none') return FRESH_UNLOCKS;
  return unlockSetFor(profile);
}

/**
 * A class id from outside the app - a `?class=` in the address bar, or the
 * `data-class` of whatever was clicked - narrowed to one this app offers, or
 * null.
 *
 * Null rather than a throw, and rather than a fallback to the Knight: an
 * address naming a class that does not exist should put the pick screen up and
 * let the player choose, not silently start a run as something else. Every
 * caller that does start a run passes the result to `createRunController`,
 * which refuses an unknown class by name.
 */
export function pickableClassId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return PICKABLE_CLASSES.some((c) => c.id === raw) ? raw : null;
}

/**
 * May a session started under `override` touch stored state at all - the saved
 * run under `cards.run.<seed>` and the profile under `cards.profile`?
 *
 * **No, whenever `?unlocks=` is pinning the pool**, and the two halves are one
 * decision rather than two, which is the fix for what an independent review
 * found. The old rule was "a pinned run does not write the profile", enforced
 * only at the moment the profile is written. It leaked across a reload:
 * `?unlocks=all` is *no unlock layer*, so the pinned run's saved log carries no
 * `unlocked` field and is indistinguishable from a log written before unlocks
 * existed. Reloading without the parameter resumed that log - the log is what
 * decides, correctly - so the run carried on fully unlocked, and with no
 * override in the address this time, `profileWritable` was true and the run
 * wrote its deeds into the player's collection. `?unlocks=none` leaked the same
 * way with the narrow pool instead of the wide one.
 *
 * So a pinned session neither reads nor writes: no saved run is loaded, none is
 * written, none is forgotten - the last one matters, or opening
 * `?seed=7&unlocks=all` would delete the real run in progress on seed 7 - and
 * the profile is read for display but never written back. The pinned run lives
 * as long as the tab and leaves nothing behind, which is what the comment on
 * `unlockSetFrom` has always claimed and is now true across a reload.
 */
export function storageAllowed(override: 'all' | 'none' | null): boolean {
  return override === null;
}

/** The three permanent bonuses on a deck card, as short marks. Empty when none. */
function bonusMarks(dc: DeckCard): string {
  const marks: string[] = [];
  if (dc.powerBonus > 0) marks.push(`+${dc.powerBonus} ${STAT_TERMS.power.name}`);
  if (dc.healthBonus > 0) marks.push(`+${dc.healthBonus} ${STAT_TERMS.health.name}`);
  if (dc.costDelta < 0) marks.push(`${dc.costDelta} ${STAT_TERMS.cost.name}`);
  return marks.join(', ');
}

export function startRunApp(): void {
  const app = need<HTMLElement>('app');
  app.dataset['mode'] = 'run';
  const dom = {
    run: need<HTMLElement>('run'),
    fight: need<HTMLElement>('fight'),
    subtitle: need<HTMLElement>('subtitle'),
    status: need<HTMLElement>('run-status'),
    body: need<HTMLElement>('run-body'),
    map: need<HTMLElement>('run-map'),
    notice: need<HTMLElement>('run-notice'),
    consequence: need<HTMLElement>('run-consequence'),
    deck: need<HTMLElement>('run-deck'),
    node: need<HTMLElement>('run-node'),
    after: need<HTMLElement>('fight-after'),
  };

  const params = new URLSearchParams(globalThis.location.search);
  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  const startSeed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : 7;
  /** A word for the notice bar about how this run came to be on screen. */
  let opened: 'fresh' | 'resumed' | 'refused' = 'fresh';
  /**
   * A run starts by choosing a class. `?class=ranger` names one and skips the
   * screen, the way `?seed=` and `?encounter=` make a run addressable; a saved
   * run carries its own class and never asks. Otherwise the class-pick screen
   * is up and the controller below is a placeholder that is never rendered.
   */
  const classParam = pickableClassId(params.get('class'));
  let picking = classParam === null;
  /**
   * The player, between runs: what they have unlocked and what they have done.
   * Loaded once. A stored profile this code cannot read is left exactly where
   * it is and reported rather than overwritten - see `profile.ts`.
   */
  const override = unlockOverride(params.get('unlocks'));
  /**
   * May this session touch `cards.run.<seed>` and `cards.profile`? No while
   * `?unlocks=` pins the pool - see `storageAllowed`, which has the whole
   * account. Every read, every write and every delete below goes through it.
   */
  const persist = storageAllowed(override);
  const openedProfile = loadProfile();
  let profile: Profile = openedProfile.profile;
  /** False when a stored profile could not be read, or when `?unlocks=` is pinning one. */
  const profileWritable = openedProfile.writable && persist;
  /** What a run started now may draft. Widens when a finished run earns something. */
  let unlocked: UnlockSet | null = unlockSetFrom(override, profile);
  /** What the run that just ended added. Null until it ends; the end screen reads it. */
  let earned: RunUnlocks | null = null;
  /** The collection, over whatever screen is up, until it is closed again. */
  let showingCollection = false;
  let ctl: RunController = createRunController(RUN_CONTENT, startSeed, {
    unlocked,
    ...(classParam === null ? {} : { classId: classParam }),
  });
  // `?fresh=1` ignores a saved run; otherwise a run in progress on this seed
  // is replayed from its log and picks up where it stood between nodes.
  //
  // **No `unlocked` is passed here, and that is deliberate**, which is why
  // `createRunController`'s refusal guard is not on the app's own path. The
  // log's set wins by design: a reward pick is an index into a shelf, so the
  // run has to be redrawn from the pool it was played with. Handing the guard
  // today's profile instead would refuse - and this catch would then delete -
  // every saved run whose player unlocked something on another seed in the
  // meantime, which is the ordinary case and not an error. The guard stays a
  // contract for a caller that insists on a set; `test/unlocks.test.ts` holds
  // both halves, the refusal and this resume.
  const saved = params.get('fresh') === '1' ? null : loadSavedRun(startSeed, persist);
  if (saved !== null && saved.nodes.length > 0) {
    try {
      ctl = createRunController(RUN_CONTENT, startSeed, { resume: saved });
      opened = 'resumed';
      picking = false;
    } catch (e) {
      console.error('cards: the saved run did not replay and was discarded', e);
      forgetRun(startSeed, persist);
      opened = 'refused';
    }
  }
  /** A reachable node the pointer or the focus ring is on. */
  let focus: number | null = null;
  /** The deck card picked at the forge, before its upgrade is picked. */
  let forgeIndex: number | null = null;
  /** A screen shown between a finished node and the map, until "continue". */
  let interstitial: 'rest' | 'act' | null = null;
  /** The finished fight waiting for "continue". */
  let pendingFight: FightOutcome | null = null;

  const screen = createFightScreen({
    onFightOver: (outcome) => {
      pendingFight = outcome;
      const won = outcome.fight.result === 'playerWin';
      dom.after.innerHTML =
        `<button type="button" class="btn--primary" data-run="finish-fight">` +
        `${won ? 'Take your reward' : 'See how the run ended'} →</button>`;
      dom.after.hidden = false;
    },
    resolveCard: (id) => {
      try {
        return runPool(CARD_POOL, ctl.state.deck).card(id);
      } catch {
        return null;
      }
    },
    // Both hooks answer off the run state as it stands, so the fight screen
    // never holds a copy of what the run has granted.
    sigilTraitsOf: (id) => {
      const dc = ctl.state.deck.find((d) => d.instanceId === id);
      return dc === undefined ? [] : grantedTraits(CARD_POOL, dc);
    },
    heroSigils: () => heldHeroSigils(ctl.state).map(heroSigilTerm),
  });

  // ------------------------------------------------------------- helpers

  function cardOf(id: string): UnitCard {
    return runPool(CARD_POOL, ctl.state.deck).card(id);
  }

  function actName(act: number): string {
    return RUN_CONTENT.acts[act]?.name ?? `Act ${act + 1}`;
  }

  /** The class the run on screen was started as, by name. */
  function className(): string {
    return classById(ctl.classId).name;
  }

  /** The node ids walked in the current act, in order, from the log alone. */
  function visitedThisAct(): number[] {
    return ctl.log.nodes.filter((n) => n.act === ctl.state.act).map((n) => n.nodeId);
  }

  function cardButton(
    card: UnitCard,
    attrs: string,
    foot = '',
    sigilTraits: readonly Trait[] = [],
  ): string {
    // A trait a sigil put there is said so on the button itself, because the
    // stats line is what a reader gets before the hover panel opens and a
    // Relay that came from a sigil is not printed on the card's own art.
    const traits = card.traits.map((t) =>
      sigilTraits.includes(t) ? `${TRAIT_TERMS[t].name} (from a sigil)` : TRAIT_TERMS[t].name,
    );
    const stats =
      `${card.power} ${STAT_TERMS.power.name} · ${card.health} ${STAT_TERMS.health.name}` +
      (card.armour > 0 ? ` · ${card.armour} ${STAT_TERMS.armour.name}` : '') +
      (traits.length > 0 ? ` · ${traits.join(', ')}` : '');
    return (
      `<button type="button" class="runcard" data-card-id="${esc(card.id)}" ${attrs}` +
      ` aria-label="${esc(`${card.name}. Costs ${card.cost} ${STAT_TERMS.cost.name}. ${stats}.`)}">` +
      `<span class="runcard__cost" aria-hidden="true">${card.cost}</span>` +
      `<span class="card__art">${compressedCard(cardEntityView(card, 'player', sigilTraits), 96, screen.mount(), screen.hatch())}</span>` +
      `<span class="runcard__name">${esc(card.name)}</span>` +
      `<span class="runcard__stats">${esc(stats)}</span>` +
      foot +
      '</button>'
    );
  }

  function effectWords(effect: EventEffect): string {
    const h = ctl.state.hero;
    const gold = ctl.state.gold;
    switch (effect.kind) {
      case 'heal':
        return `heal ${effect.amount} (${h.health} → ${Math.min(h.maxHealth, h.health + effect.amount)})`;
      case 'damage':
        return `take ${effect.amount} damage (${h.health} → ${Math.max(1, h.health - effect.amount)}; it cannot kill you)`;
      case 'gold':
        return `+${effect.amount} gold (${gold} → ${gold + effect.amount})`;
      case 'card':
        return 'a random card joins your deck';
    }
  }

  /** What the last node did, in one line, for the map's notice bar. */
  function outcomeWords(o: NodeOutcome): string {
    const health = o.before.health === o.after.health
      ? ''
      : ` Health ${o.before.health} → ${o.after.health}.`;
    const gold = o.before.gold === o.after.gold ? '' : ` Gold ${o.before.gold} → ${o.after.gold}.`;
    const gained = o.gained.length === 0
      ? ''
      : ` ${o.gained.map((d) => `<b>${esc(cardOf(d.instanceId).name)}</b>`).join(', ')} joined your deck.`;
    switch (o.node.type) {
      case 'rest':
        return `You rested.${health}`;
      case 'forge':
        return o.forged === null
          ? 'The forge had nothing to work on.'
          : `Forged <b>${esc(cardOf(o.forged.card.instanceId).name)}</b>: ${FORGE_WORDS[o.forged.mode]}.`;
      case 'shop':
        return o.bought === null
          ? 'You left the shop with your gold.'
          : `Bought <b>${esc(CARD_POOL.card(o.bought.item.cardId).name)}</b> for ${o.bought.item.price} gold.${gold}`;
      case 'event':
        return o.event === null
          ? 'The event passed.'
          : `${esc(o.event.def.name)} — ${esc(o.event.def.options[o.event.option]?.label ?? '')}.${health}${gold}${gained}`;
      case 'fight':
      case 'elite':
      case 'boss': {
        const f = o.fight;
        const name = f === null ? 'the enemy' : esc(f.encounter.name);
        const rounds = f === null ? '' : ` in ${f.outcome.fight.round} rounds`;
        const sigils = sigilOutcomeWords(o, RUN_CONTENT, (id) => cardOf(id).name);
        const took = o.gained.length === 0 ? (sigils.length === 0 ? ' You took no card.' : '') : gained;
        return `${name} beaten${rounds}.${health}${gold}${took}${sigils}`;
      }
    }
  }

  // ------------------------------------------------------------- screens

  function showRun(): void {
    dom.fight.hidden = true;
    dom.after.hidden = true;
    dom.run.hidden = false;
    screen.idle();
  }

  function renderHud(): void {
    const s = ctl.state;
    const p = ctl.phase;
    const act = Math.min(s.act, RUN_CONTENT.acts.length - 1);
    const rows = currentMapSafe()?.rows.length ?? 0;
    // A node in progress is not in the state yet - the state moves when the
    // choice is made - so the HUD reads the node from the phase, and after a
    // won fight it reads the Health and gold the reward screen is promising.
    const atNode = p.kind === 'travel' || p.kind === 'over' ? null : p.node;
    const where =
      s.result !== 'ongoing'
        ? 'the run is over'
        : atNode !== null
          ? `row ${atNode.row + 1} of ${rows} · ${NODE_LABEL[atNode.type].toLowerCase()}`
          : s.row < 0
            ? 'choose where to start'
            : `row ${s.row + 1} of ${rows}`;
    // During a fight the fight screen writes the subtitle - the round and both
    // heroes' Health - and it must not be overwritten from here.
    if (p.kind !== 'fight') {
      dom.subtitle.textContent =
        `${className()} · Act ${act + 1} of ${RUN_CONTENT.acts.length} — ${actName(act)} · ${where}`;
    }
    // A won fight's screens promise the numbers the replay will set, hero
    // sigil included, so the HUD reads them off the phase until the commit.
    const won = p.kind === 'reward' || p.kind === 'sigil' || p.kind === 'attach' ? p : null;
    const health = won === null ? s.hero.health : won.healthAfter;
    const maxHealth = won === null ? s.hero.maxHealth : won.maxHealthAfter;
    const gold = won === null ? s.gold : won.goldAfter;
    const frac = health / Math.max(1, maxHealth);
    dom.status.innerHTML =
      `<span class="hud__stat hud__stat--health" title="${esc(`Your hero's Health. It persists across the whole run and is only healed at a rest, by an event, or by a hero sigil.`)}">` +
      iconSvg('health', { size: 13, label: STAT_TERMS.health.name }) +
      `<b>${health}</b>/${maxHealth}` +
      `<i class="hud__bar" aria-hidden="true"><i style="width:${Math.round(frac * 100)}%"></i></i></span>` +
      `<span class="hud__stat" title="Gold. Fights pay it and only a shop takes it.">` +
      iconSvg('gold', { size: 13, label: 'gold' }) +
      `<b>${gold}</b></span>` +
      `<span class="hud__stat" title="Cards in your deck. Rewards, shops and events add to it; nothing removes from it.">` +
      iconSvg('deck', { size: 13, label: 'cards in deck' }) +
      `<b>${s.deck.length}</b></span>` +
      heroSigilChips(s) +
      `<span class="hud__stat hud__stat--seed" title="The run's seed. The same seed and the same choices replay the same run.">seed ${s.seed}</span>` +
      // Not during a fight: the collection needs the run panel, and showing
      // that panel idles the fight screen out from under the fight.
      (p.kind === 'fight'
        ? ''
        : `<button type="button" data-run="collection" title="What you have unlocked, and what opens the rest. Nothing here makes a run stronger.">${showingCollection ? 'Back' : 'Collection'}</button>`) +
      `<button type="button" data-run="restart" title="Abandon this run and start seed ${s.seed} again from the first node">Restart</button>`;
  }

  function currentMapSafe(): ReturnType<typeof currentMap> | null {
    return ctl.state.act < ctl.state.maps.length ? currentMap(ctl.state) : null;
  }

  function renderMap(): void {
    const map = currentMapSafe();
    if (map === null) return;
    const reachable = ctl.state.result === 'ongoing' ? travelOptions(ctl.state).map((o) => o.id) : [];
    if (focus !== null && !reachable.includes(focus)) focus = null;
    const captions = new Map<number, string>();
    for (const node of map.nodes) {
      if (node.type === 'fight' || node.type === 'elite' || node.type === 'boss') {
        captions.set(node.id, encounterFor(ctl.state, node).name);
      }
    }
    dom.map.innerHTML = renderMapSvg({
      map,
      visited: visitedThisAct(),
      current: ctl.state.nodeId,
      reachable,
      focus,
      captions,
    });
    renderConsequence(map, focus);
    renderNotice();
    renderDeck();
  }

  /**
   * What a reachable node leads to, before it is chosen.
   *
   * The node itself, from the run's own lookups: the encounter a fight holds
   * and what it pays, what a rest heals, what a shop charges. Then the routes
   * beyond it, from `spreadFrom` - the same DP `test/run.test.ts` gates - so
   * "1–2 fights, 0–1 elites, 1 rest" is a fact about this map and not a hope.
   */
  function renderConsequence(map: ReturnType<typeof currentMap>, id: number | null): void {
    const s = ctl.state;
    if (id === null) {
      // From the entry, the whole act; from a node, what is still ahead of it
      // - the node itself taken out of its own type's count.
      let spread = pathSpread(map);
      let scope = 'The routes through this act hold';
      if (s.nodeId >= 0) {
        const here = map.nodes[s.nodeId]!;
        spread = new Map(spreadFrom(map, s.nodeId));
        const own = spread.get(here.type);
        if (own !== undefined) spread.set(here.type, { min: own.min - 1, max: own.max - 1 });
        scope = 'From here the routes hold';
      }
      dom.consequence.innerHTML =
        `<h3 class="run__h">${esc(actName(map.act))}</h3>` +
        `<p>${s.row < 0 ? 'Pick a starting node.' : 'Pick the next node.'} Hover or tab to a lit node to see what it holds and where it leads; click it to go.</p>` +
        `<p class="run__muted">${scope} ${esc(spreadWords(spread))}, and every route ends at the boss.</p>`;
      return;
    }
    const node = map.nodes[id]!;
    const type = node.type;
    const details: string[] = [];
    if (type === 'fight' || type === 'elite' || type === 'boss') {
      const enc = encounterFor(s, node);
      const opening = enc.opening.length === 0
        ? 'an empty line'
        : enc.opening.map((cid) => esc(CARD_POOL.card(cid).name)).join(', ');
      details.push(
        `<b>${esc(enc.name)}</b> — hero with ${enc.enemyHero.health} ${STAT_TERMS.health.name} and ` +
          `${enc.enemyHero.power} ${STAT_TERMS.power.name}, ${enc.enemyDeck.length} cards, opening with ${opening}.`,
      );
      details.push(`Pays ${goldFor(s, node)} gold and one card of three${type === 'boss' ? ', and ends the act' : ''}.`);
      details.push(`Your hero brings ${s.hero.health} of ${s.hero.maxHealth} ${STAT_TERMS.health.name} in and carries out what is left.`);
    } else if (type === 'rest') {
      const heal = restAmount(s);
      details.push(`Heals ${heal}: ${s.hero.health} → ${Math.min(s.hero.maxHealth, s.hero.health + heal)} of ${s.hero.maxHealth}.`);
    } else if (type === 'shop') {
      const base = RUN_CONTENT.shopBasePrice;
      const per = RUN_CONTENT.shopPricePerCost;
      details.push(`You have ${s.gold} gold. A card costs ${base} + ${per} per ${STAT_TERMS.cost.name}: ${base + per} to ${base + per * 3}.`);
    } else if (type === 'forge') {
      details.push(`Any one of your ${s.deck.length} cards, permanently.`);
    } else {
      details.push(`One of ${RUN_CONTENT.events.length} encounters. Its options are shown when you arrive, each with what it does.`);
    }
    const beyond = type === 'boss'
      ? 'This is the last node of the act.'
      : `Beyond it the routes hold ${esc(spreadWords(spreadFrom(map, id)))}, then the boss.`;
    dom.consequence.innerHTML =
      `<h3 class="run__h">${iconSvg(NODE_ICON[type], { size: 15, decorative: true })} ${esc(NODE_LABEL[type])}</h3>` +
      `<p>${esc(NODE_LINE[type])}</p>` +
      `<ul class="run__facts">${details.map((d) => `<li>${d}</li>`).join('')}</ul>` +
      `<p class="run__muted">${beyond}</p>`;
  }

  function renderNotice(): void {
    const o = ctl.last;
    if (o === null) {
      const s = ctl.state;
      dom.notice.innerHTML =
        opened === 'resumed'
          ? `Run resumed on seed ${ctl.seed}, ${s.nodesVisited} node${s.nodesVisited === 1 ? '' : 's'} in, replayed from its choice list. ` +
            `A node in progress is not saved, so a reload returns you here, to the map.`
          : (opened === 'refused' ? 'The saved run on this seed did not replay and was discarded. ' : '') +
            `A new run on seed ${ctl.seed} as the ${className()}. Your hero has ${s.hero.health} ${STAT_TERMS.health.name} for the whole run, ${s.deck.length} cards, and no gold.`;
      dom.notice.className = 'run__notice';
      return;
    }
    dom.notice.innerHTML = (o.actCleared ? `<b>Act ${o.act + 1} cleared.</b> ` : '') + outcomeWords(o);
    dom.notice.className = 'run__notice is-live';
  }

  function renderDeck(): void {
    const deck = ctl.state.deck;
    dom.deck.innerHTML =
      `<h3 class="run__h">${iconSvg('deck', { size: 14, decorative: true })} Deck · ${deck.length} cards</h3>` +
      `<div class="run__deckgrid run__deckgrid--small">${deck
        .map((dc) => {
          const card = resolveDeckCard(CARD_POOL, dc);
          const marks = bonusMarks(dc);
          const sigils = sigilMarks(dc, RUN_CONTENT);
          return (
            `<span class="runcard runcard--mini" data-card-id="${esc(dc.instanceId)}" tabindex="0" ` +
            `aria-label="${esc(`${card.name}, ${card.power} ${STAT_TERMS.power.name}, ${card.health} ${STAT_TERMS.health.name}, ${card.cost} ${STAT_TERMS.cost.name}${marks.length > 0 ? `, forged ${marks}` : ''}${sigils.length > 0 ? `, ${sigils}` : ''}`)}">` +
            `<span class="card__art">${compressedCard(cardEntityView(card), 52, screen.mount(), screen.hatch())}</span>` +
            (sigils.length > 0 ? `<span class="runcard__sigil runcard__sigil--mini" aria-hidden="true">${iconSvg('sigil', { size: 11, decorative: true })}</span>` : '') +
            (marks.length > 0 ? `<span class="runcard__forged" aria-hidden="true">${esc(marks.replace(/ (Power|Health|Energy)/g, (_m, w: string) => w[0]!))}</span>` : '') +
            '</span>'
          );
        })
        .join('')}</div>`;
  }

  function renderNode(): void {
    const p = ctl.phase;
    const s = ctl.state;
    let html = '';
    if (interstitial === 'rest' && ctl.last !== null) {
      const o = ctl.last;
      html =
        `<h2 class="run__title">${iconSvg('rest', { size: 22, decorative: true })} Rest</h2>` +
        `<p class="run__lead">You rest by the fire. ${STAT_TERMS.health.name} ${o.before.health} → <b>${o.after.health}</b> of ${o.after.maxHealth}` +
        ` (+${o.after.health - o.before.health}).</p>` +
        `<p><button type="button" class="btn--primary" data-run="continue">Back to the map</button></p>`;
    } else if (interstitial === 'act' && ctl.last !== null) {
      const o = ctl.last;
      html =
        `<h2 class="run__title">${iconSvg('boss', { size: 22, decorative: true })} Act ${o.act + 1} cleared</h2>` +
        `<p class="run__lead">${esc(o.fight?.encounter.name ?? 'The boss')} falls. <b>${esc(actName(o.act + 1))}</b> lies ahead.</p>` +
        `<p class="run__muted">${outcomeWords(o)}</p>` +
        `<p><button type="button" class="btn--primary" data-run="continue">Onward</button></p>`;
    } else if (p.kind === 'reward') {
      const f = p.outcome.fight;
      html =
        `<h2 class="run__title">${iconSvg(NODE_ICON[p.node.type], { size: 22, decorative: true })} ${esc(p.encounter.name)} beaten</h2>` +
        `<p class="run__lead">Won in ${f.round} round${f.round === 1 ? '' : 's'}. Your hero stands at <b>${p.healthAfter}</b> of ${s.hero.maxHealth} ${STAT_TERMS.health.name}.` +
        ` <b>+${p.goldAfter - s.gold} gold</b> — you now have ${p.goldAfter}.</p>` +
        `<p>Take one ${p.offer.some((o) => o.kind === 'sigil') ? 'card into your deck, or the sigil for a card you already hold,' : 'card into your deck,'} or none:</p>` +
        `<div class="run__offer">${p.offer
          .map((o, i) => (o.kind === 'card' ? cardButton(CARD_POOL.card(o.cardId), `data-run="reward" data-pick="${i}"`) : sigilShelfButton(o.sigil, i)))
          .join('')}</div>` +
        `<p><button type="button" data-run="reward" data-pick="-1">Take nothing</button></p>`;
    } else if (p.kind === 'sigil') {
      html = heroSigilOfferHtml(p, s);
    } else if (p.kind === 'attach') {
      html = attachHtml(p, s, cardButton);
    } else if (p.kind === 'forge') {
      const chosen = forgeIndex === null ? null : s.deck[forgeIndex] ?? null;
      const cards = s.deck
        .map((dc, i) => {
          const card = resolveDeckCard(CARD_POOL, dc);
          const marks = bonusMarks(dc);
          const sigils = sigilMarks(dc, RUN_CONTENT);
          return cardButton(
            card,
            `data-run="forge-card" data-index="${i}"${i === forgeIndex ? ' aria-pressed="true"' : ' aria-pressed="false"'}`,
            (sigils.length > 0 ? `<span class="runcard__sigil">${esc(sigils)}</span>` : '') +
              (marks.length > 0 ? `<span class="runcard__forged">${esc(marks)}</span>` : ''),
            grantedTraits(CARD_POOL, dc),
          );
        })
        .join('');
      let modes = '<p class="run__muted">Pick a card above to see its three upgrades.</p>';
      if (chosen !== null) {
        const card = resolveDeckCard(CARD_POOL, chosen);
        const lines: Record<ForgeMode, string> = {
          power: `${card.power} → ${card.power + 1}`,
          health: `${card.health} → ${card.health + 1}`,
          cost: card.cost === 0 ? 'already 0 — this would be wasted' : `${card.cost} → ${card.cost - 1}`,
        };
        modes =
          `<p>Upgrade <b>${esc(card.name)}</b>, permanently:</p>` +
          `<div class="run__modes">${(['power', 'health', 'cost'] as const)
            .map(
              (mode) =>
                `<button type="button" class="run__mode" data-run="forge-mode" data-mode="${mode}">` +
                `<b>${FORGE_WORDS[mode]}</b><small>${esc(lines[mode])}</small></button>`,
            )
            .join('')}</div>`;
      }
      html =
        `<h2 class="run__title">${iconSvg('forge', { size: 22, decorative: true })} Forge</h2>` +
        `<p class="run__lead">${esc(NODE_LINE.forge)} The change survives every fight after this one.</p>` +
        `<div class="run__deckgrid">${cards}</div>` +
        modes;
    } else if (p.kind === 'shop') {
      html =
        `<h2 class="run__title">${iconSvg('shop', { size: 22, decorative: true })} Shop</h2>` +
        `<p class="run__lead">You have <b>${s.gold} gold</b>. A card costs ${RUN_CONTENT.shopBasePrice} + ${RUN_CONTENT.shopPricePerCost} per ${STAT_TERMS.cost.name}.</p>` +
        `<div class="run__offer">${p.stock
          .map((item, i) => {
            const affordable = item.price <= s.gold;
            return cardButton(
              CARD_POOL.card(item.cardId),
              `data-run="buy" data-index="${i}"${affordable ? '' : ' disabled'}`,
              `<span class="runcard__price${affordable ? '' : ' is-short'}">${item.price} gold${affordable ? '' : ` — ${item.price - s.gold} short`}</span>`,
            );
          })
          .join('')}</div>` +
        `<p><button type="button" data-run="buy" data-index="-1">Leave</button></p>`;
    } else if (p.kind === 'event') {
      html = eventHtml(p.def);
    }
    dom.node.innerHTML = html;
    dom.node.hidden = html.length === 0;
    dom.body.hidden = html.length > 0;
  }

  function eventHtml(def: RunEventDef): string {
    return (
      `<h2 class="run__title">${iconSvg('event', { size: 22, decorative: true })} ${esc(def.name)}</h2>` +
      `<p class="run__lead">${esc(NODE_LINE.event)}</p>` +
      `<div class="run__options">${def.options
        .map(
          (opt, i) =>
            `<button type="button" class="run__option" data-run="event" data-option="${i}">` +
            `<b>${esc(opt.label)}</b><small>${esc(opt.effects.map(effectWords).join('; '))}</small></button>`,
        )
        .join('')}</div>`
    );
  }

  function renderEnd(): void {
    const s = ctl.state;
    const e = s.ending;
    const won = s.result === 'won';
    const last = ctl.last;
    const foe = last?.fight?.encounter.name ?? 'the enemy';
    const how = won
      ? `You beat <b>${esc(foe)}</b>, the boss of ${esc(actName(RUN_CONTENT.acts.length - 1))}. The run is won.`
      : e === null
        ? 'The run ended.'
        : `Your hero ${e.cause === 'timeout' ? 'ran out of rounds against' : 'fell to'} <b>${esc(foe)}</b> in ` +
          `${esc(actName(e.act))}, row ${e.row + 1} of ${s.maps[e.act]?.rows.length ?? '?'}.`;
    const fightsWon = ctl.log.nodes.filter((n) => n.fightResult === 'playerWin').length;
    const rows: [string, string][] = [
      ['Nodes visited', String(s.nodesVisited)],
      ['Fights', `${s.fightsFought}, ${fightsWon} won, ${s.roundsFought} rounds in all`],
      ['Deck', `${s.deck.length} cards, ${s.cardsGained} gained, ${s.forgesApplied} forged`],
      ['Gold left', String(s.gold)],
      [STAT_TERMS.health.name, `${s.hero.health} of ${s.hero.maxHealth}`],
      ['Run hash', ctl.hash()],
    ];
    dom.node.innerHTML =
      `<h2 class="run__title ${won ? 'is-won' : 'is-lost'}">${iconSvg(won ? 'hero' : 'boss', { size: 22, decorative: true })} ${won ? 'The run is won' : 'The run is over'}</h2>` +
      `<p class="run__lead">${how}</p>` +
      `<dl class="run__stats">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` +
      (earned === null ? '' : runUnlocksHtml(earned, CARD_POOL)) +
      (earned === null || earned.newlyEarned.length === 0 || profileWritable
        ? ''
        : `<p class="run__warn${openedProfile.problem === null ? ' run__warn--pin' : ''}">Not saved: ${
            openedProfile.problem === null
              ? `unlocks are pinned by <code>?unlocks=${esc(override ?? '')}</code>`
              : 'the stored profile could not be read and is being left alone'
          }.</p>`) +
      `<p class="run__muted">The seed and the choice list are the whole run: this log replays it, byte for byte, through <code>replayRun</code>.</p>` +
      `<details class="run__log"><summary>Replay log</summary>` +
      `<textarea id="run-log" readonly rows="6" aria-label="Replay log as JSON">${esc(JSON.stringify(ctl.log))}</textarea>` +
      `<p><button type="button" data-run="copy-log">Copy the log</button> <span id="run-copied" class="run__muted"></span></p></details>` +
      `<form class="run__newrun" data-run-form="new-run"><label>Seed <input id="run-seed" type="number" min="1" step="1" value="${ctl.seed + 1}"></label>` +
      `<button type="submit" class="btn--primary">New run</button>` +
      `<button type="button" data-run="same-seed">Same seed again</button></form>`;
    dom.node.hidden = false;
    dom.body.hidden = true;
  }

  /**
   * The class pick, in the node panel where every other screen goes. The
   * placeholder controller is not read: the HUD says only the seed, and the
   * run's own readouts start with the run.
   */
  function renderPick(): void {
    showRun();
    dom.subtitle.textContent = `Choose a class · seed ${ctl.seed}`;
    dom.status.innerHTML =
      `<span class="hud__stat hud__stat--seed" title="The run's seed. The same seed and the same choices replay the same run.">seed ${ctl.seed}</span>`;
    dom.node.innerHTML =
      classPickHtml({
        seed: ctl.seed,
        pool: CARD_POOL,
        mount: screen.mount(),
        hatch: screen.hatch(),
        unlocked,
      }) +
      profileNotice() +
      collectionHtml(profile, unlocked ?? ALL_UNLOCKS, CARD_POOL);
    dom.node.hidden = false;
    dom.body.hidden = true;
  }

  /**
   * The one line a player sees when their stored profile could not be read, or
   * when `?unlocks=` is pinning the pool. Both change what a run can draft, and
   * a collection that quietly disagrees with the address bar is worse than a
   * sentence saying which is in force.
   */
  function profileNotice(): string {
    if (openedProfile.problem !== null) {
      return `<p class="run__warn">${esc(openedProfile.problem)}</p>`;
    }
    if (override === null) return '';
    return (
      `<p class="run__warn run__warn--pin">Unlocks are pinned by <code>?unlocks=${esc(override)}</code>: ` +
      `${override === 'all' ? 'everything is draftable' : 'nothing unlockable is draftable'}, and ` +
      `nothing this run earns is saved to your profile.</p>`
    );
  }

  /** The collection over whatever screen is up. The HUD's button closes it again. */
  function renderCollection(): void {
    showRun();
    dom.node.innerHTML =
      profileNotice() +
      collectionHtml(profile, unlocked ?? ALL_UNLOCKS, CARD_POOL) +
      `<p><button type="button" class="btn--primary" data-run="collection">Back</button></p>`;
    dom.node.hidden = false;
    dom.body.hidden = true;
  }

  function render(): void {
    if (picking) {
      renderPick();
      return;
    }
    renderHud();
    // The fight wins over the collection, and that is not a preference: the
    // run panel's `showRun` calls `screen.idle()`, which cancels playback and
    // drops the fight on screen. So the collection is not reachable during a
    // fight - `renderHud` does not draw its button then - and this branch is
    // the second guard on the same thing.
    if (ctl.phase.kind === 'fight') {
      showingCollection = false;
      dom.run.hidden = true;
      dom.fight.hidden = false;
      return;
    }
    if (showingCollection) {
      renderCollection();
      return;
    }
    showRun();
    if (ctl.phase.kind === 'over') {
      renderEnd();
      return;
    }
    renderNode();
    if (!dom.body.hidden) renderMap();
  }

  // ------------------------------------------------------------- actions

  function go(nodeId: number): void {
    ctl.travel(nodeId);
    focus = null;
    forgeIndex = null;
    const p = ctl.phase;
    if (p.kind === 'fight') {
      const s = ctl.state;
      const pay = goldFor(s, p.node);
      screen.start(p.setup, {
        title: `${esc(actName(s.act))} · ${esc(p.encounter.name)} (${NODE_LABEL[p.node.type].toLowerCase()}, row ${p.node.row + 1}).`,
        intro: [
          `Your ${esc(className())} brings ${s.hero.health} of ${s.hero.maxHealth} Health into this fight. ` +
            `Winning pays ${pay} gold and one card of three; losing ends the run.`,
          'Your line resolves left to right. Your hero swings last.',
        ],
        overHint: 'The fight is over. The run goes on from the button under the banner.',
      });
    } else if (p.kind === 'travel' && ctl.last?.node.type === 'rest') {
      interstitial = 'rest';
    }
    committed();
    render();
  }

  /**
   * After anything that may have appended to the log: keep the saved run
   * current, and - the first time the run is seen to have ended - work out what
   * it unlocked and keep it.
   *
   * The profile moves **once**, here, when the run ends. Not during it: the
   * unlock set is an input to the run and widening it mid-run would change the
   * pool the run's own log is recorded against.
   */
  function committed(): void {
    if (ctl.state.result === 'ongoing') {
      saveRun(ctl.log, persist);
      return;
    }
    forgetRun(ctl.seed, persist);
    if (earned !== null) return;
    earned = applyRunToProfile(profile, ctl.state);
    profile = earned.profile;
    if (profileWritable) saveProfile(profile);
    // The next run drafts from the wider pool; the one on screen is finished.
    unlocked = unlockSetFrom(override, profile);
  }

  function finishFight(): void {
    if (pendingFight === null) return;
    const outcome = pendingFight;
    pendingFight = null;
    ctl.finishFight(outcome);
    committed();
    render();
  }

  function afterChoice(): void {
    forgeIndex = null;
    if (ctl.phase.kind === 'travel' && ctl.last?.actCleared === true) interstitial = 'act';
    committed();
    render();
  }

  /** A new run starts by choosing a class, so this puts the pick up. */
  function newRun(seed: number): void {
    forgetRun(ctl.seed, persist);
    forgetRun(seed, persist);
    ctl = createRunController(RUN_CONTENT, seed, { unlocked });
    picking = true;
    opened = 'fresh';
    focus = null;
    forgeIndex = null;
    interstitial = null;
    pendingFight = null;
    earned = null;
    showingCollection = false;
    const url = new URL(globalThis.location.href);
    url.searchParams.set('seed', String(seed));
    url.searchParams.delete('fresh');
    url.searchParams.delete('class');
    globalThis.history.replaceState(null, '', url);
    render();
  }

  /** The pick was made: start the run as that class, on the seed already chosen. */
  function pickClass(raw: string): void {
    const classId = pickableClassId(raw);
    if (!picking || classId === null) return;
    ctl = createRunController(RUN_CONTENT, ctl.seed, { classId, unlocked });
    picking = false;
    opened = 'fresh';
    const url = new URL(globalThis.location.href);
    url.searchParams.set('class', classId);
    globalThis.history.replaceState(null, '', url);
    screen.showInspect(null);
    render();
  }

  // ------------------------------------------------------------- input

  /**
   * Every `[data-run]` control, wherever it is drawn.
   *
   * Attached to the HUD as well as to the run panel, and that is a fix rather
   * than tidiness: the HUD lives in `<header class="hud">`, which is not
   * inside `#run`, so a listener on `#run` alone never saw it. Restart has
   * been in the HUD since unit 8 and has never worked; the Collection button
   * this unit added would have been dead the same way.
   */
  const onRunClick = (ev: Event): void => {
    const target = ev.target as HTMLElement | null;
    if (target === null) return;
    const mapNode = target.closest('[data-node]') as HTMLElement | null;
    if (mapNode !== null && mapNode.classList.contains('is-reachable')) {
      go(Number.parseInt(mapNode.dataset['node'] ?? '', 10));
      return;
    }
    const act = target.closest('[data-run]') as HTMLElement | null;
    if (act === null) return;
    const int = (key: string): number => Number.parseInt(act.dataset[key] ?? '', 10);
    switch (act.dataset['run']) {
      case 'pick-class':
        pickClass(act.dataset['class'] ?? '');
        break;
      case 'reward':
        ctl.pickReward(int('pick'));
        afterChoice();
        break;
      case 'sigil':
        ctl.pickSigil(int('pick'));
        afterChoice();
        break;
      case 'attach':
        ctl.attach(int('index'));
        afterChoice();
        break;
      case 'forge-card':
        forgeIndex = int('index');
        renderNode();
        break;
      case 'forge-mode': {
        const mode = act.dataset['mode'];
        if (forgeIndex === null || (mode !== 'power' && mode !== 'health' && mode !== 'cost')) return;
        ctl.forge(forgeIndex, mode);
        afterChoice();
        break;
      }
      case 'buy':
        ctl.buy(int('index'));
        afterChoice();
        break;
      case 'event':
        ctl.chooseEvent(int('option'));
        afterChoice();
        break;
      case 'continue':
        interstitial = null;
        render();
        break;
      case 'same-seed':
      case 'restart':
        newRun(ctl.seed);
        break;
      case 'collection':
        showingCollection = !showingCollection;
        render();
        break;
      case 'copy-log': {
        const log = JSON.stringify(ctl.log);
        const said = document.getElementById('run-copied');
        void globalThis.navigator.clipboard
          ?.writeText(log)
          .then(() => {
            if (said !== null) said.textContent = 'copied';
          })
          .catch(() => {
            if (said !== null) said.textContent = 'could not copy — select the text above instead';
          });
        break;
      }
    }
  };
  dom.run.addEventListener('click', onRunClick);
  dom.status.addEventListener('click', onRunClick);

  dom.run.addEventListener('submit', (ev) => {
    const form = ev.target as HTMLElement | null;
    if (form?.dataset['runForm'] !== 'new-run') return;
    ev.preventDefault();
    const input = document.getElementById('run-seed') as HTMLInputElement | null;
    const seed = Number.parseInt(input?.value ?? '', 10);
    newRun(Number.isFinite(seed) && seed > 0 ? seed : ctl.seed + 1);
  });

  dom.after.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('[data-run="finish-fight"]') !== null) finishFight();
  });

  // The map: a lit node lights everything it still leads to while the pointer
  // or the focus ring is on it, and Enter or Space goes there. The highlight
  // moves in place - see `applyMapFocus` - because rebuilding the SVG under
  // the pointer is what made the first click on a hovered node do nothing.
  const setFocus = (id: number | null): void => {
    if (id === focus) return;
    focus = id;
    const map = currentMapSafe();
    if (map !== null && !dom.body.hidden) {
      applyMapFocus(dom.map, map, focus);
      renderConsequence(map, focus);
    }
  };
  const nodeUnder = (target: EventTarget | null): number | null => {
    const el = (target as HTMLElement | null)?.closest('[data-node].is-reachable') as HTMLElement | null;
    if (el === null || el === undefined) return null;
    const id = Number.parseInt(el.dataset['node'] ?? '', 10);
    return Number.isFinite(id) ? id : null;
  };
  dom.map.addEventListener('pointerover', (ev) => setFocus(nodeUnder(ev.target)));
  dom.map.addEventListener('pointerleave', () => setFocus(null));
  dom.map.addEventListener('focusin', (ev) => setFocus(nodeUnder(ev.target)));
  dom.map.addEventListener('focusout', (ev) => {
    if (nodeUnder(ev.relatedTarget) === null) setFocus(null);
  });
  dom.map.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const id = nodeUnder(ev.target);
    if (id === null) return;
    ev.preventDefault();
    go(id);
  });

  // Theme and hatching buttons repaint the fight's art through `app.ts`; the
  // run screens hold their own painted cards and repaint on the same press.
  document.body.addEventListener('click', (ev) => {
    const act = (ev.target as HTMLElement | null)?.closest('[data-act="theme"], [data-act="hatch"]');
    if (act !== null && act !== undefined && !dom.run.hidden) render();
  });

  screen.setTheme(initialTheme(params));
  screen.setHatch(params.get('hatch') === '1' || params.get('hatch') === 'on');
  screen.setSpeed(1);
  render();
}
