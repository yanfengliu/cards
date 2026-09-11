/**
 * Plays a whole run through the real app's real controls, and photographs it.
 *
 * Same rule as `play.ts`, from fleet canon: a harness that sets state
 * directly is blind to every defect in the input path it skipped. So every
 * decision here is a click - a lit node on the map, a card on a shelf, a hand
 * card and a gap in the line, the commit button - and the only things read out
 * of the page are what the page shows.
 *
 * What decides is a bot, and that is the point of the second thing this probe
 * does. The decisions are `src/sim/runbots.ts`'s greedy router and
 * append-right placement, mirrored in a headless `createRunController` that is
 * fed the same choices, so the probe always knows what the screen should be
 * offering and asserts it. At the end, the run hash the page prints is
 * compared with `hashRun` of `runRun` on the same seed and agent: **a run
 * played through the browser's controls must hash identically to the same run
 * played headlessly**, which is the determinism invariant crossing the DOM.
 *
 * Shots go to `.probe-ui/run-<seed>-<class>-<theme>/` with a sha256 manifest,
 * one per kind of screen the first time it appears - map per act, the map with
 * a node hovered, the fight as it opens and as it ends, reward, forge, shop,
 * event, rest, the act break, and the end - so a review binds to the bytes
 * inspected. Sigils add five: the hero sigil offer after an elite, a shelf
 * holding a card sigil, the attach screen, the fight with a sigilled card in
 * the line hovered so its panel is open, and the hero hovered once the run
 * holds a hero sigil, which is the only screen that names them in full.
 *
 * **The class is a parameter, and `all` is the default.** It was the Knight,
 * hardcoded, for the whole unit that added the other two - so the Ranger and
 * the Mage, whose Volley and Scorch are the only two things the unit put in the
 * resolver, were never once played through the DOM. Every class plays the same
 * run structure, so one class proves the wiring; it proves nothing about the
 * two classes whose own verbs draw their own beats.
 *
 * The last argument is the unlock arm. `all`, the default, pins the pool
 * through `?unlocks=all` and writes no profile - the run the hash comparison
 * needs. `fresh` clears the stored profile, plays the run the app's own
 * `loadProfile` decides, and at the end reads `cards.profile` back out of the
 * browser and holds it to what the run earned. That round trip is the one part
 * of the unlock layer no headless test can reach.
 *
 *   node tools/ui-probe/run.ts <seed> <light|dark> [knight|ranger|mage|all] [all|fresh]
 *   node tools/ui-probe/run.ts find-win [max] [class]   headless: seeds the bot wins
 *   node tools/ui-probe/run.ts find-sigil [max] [class] headless: seeds where act 1
 *                                                       attaches a card sigil
 */

import { type Page } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './chrome.ts';
import { runFight, selectPlays } from '../../src/engine/fight.ts';
import { CARD_POOL } from '../../src/content/cards.ts';
import { classById } from '../../src/content/classes.ts';
import { SIGILS } from '../../src/content/sigils.ts';
import { ACHIEVEMENTS, FRESH_UNLOCKS } from '../../src/content/unlocks.ts';
import { PROFILE_KEY, parseProfile, unlockSetFor } from '../../src/ui/profile.ts';
import { RUN_CONTENT } from '../../src/run/content.ts';
import { hashRun } from '../../src/run/hash.ts';
import { runRun, travelOptions } from '../../src/run/run.ts';
import type { RunState } from '../../src/run/types.ts';
import { earnedBy, unlockedRewards } from '../../src/run/unlocks.ts';
import { makeRunAgent } from '../../src/sim/runbots.ts';
import { createRunController } from '../../src/ui/run.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, '.probe-ui');
const BASE = process.env['CARDS_URL'] ?? 'http://127.0.0.1:5175/src/ui/index.html';

async function shoot(page: Page, dir: string, name: string, taken: Set<string>, always = false): Promise<void> {
  if (!always && taken.has(name)) return;
  taken.add(name);
  await mkdir(dir, { recursive: true });
  // A screen fades in over 240ms (`screen-in` in app.css); a shot taken during
  // it is a picture of the fade, which is what the first act-map shot was.
  await page.waitForTimeout(320);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

/** The page's own account of where the run stands. */
async function look(page: Page): Promise<{ subtitle: string; screen: string; reachable: number[]; over: boolean }> {
  return page.evaluate(() => {
    const subtitle = document.getElementById('subtitle')?.textContent ?? '';
    const fight = document.getElementById('fight') as HTMLElement | null;
    const node = document.getElementById('run-node') as HTMLElement | null;
    const body = document.getElementById('run-body') as HTMLElement | null;
    const reachable = Array.from(document.querySelectorAll('#run-map [data-node].is-reachable')).map((el) =>
      Number.parseInt((el as HTMLElement).dataset['node'] ?? '', 10),
    );
    const title = node?.querySelector('.run__title')?.textContent?.trim() ?? '';
    const screen =
      fight !== null && !fight.hidden
        ? 'fight'
        : node !== null && !node.hidden
          ? title
          : body !== null && !body.hidden
            ? 'map'
            : 'unknown';
    return {
      subtitle,
      screen,
      reachable,
      over: title.startsWith('The run is'),
    };
  });
}

/**
 * The end screen's unlock block, against what the finished run actually earned.
 *
 * Computed here from `earnedBy` on the state the mirror reached, so the check
 * is "the screen says what this run earned" rather than "the screen says
 * something". Deterministic in a probe because `?unlocks=all` never writes a
 * profile, so every run this probe plays is a run by a player who has nothing.
 */
async function checkUnlocks(
  page: Page,
  state: RunState,
  seed: number,
  classId: string,
  arm: UnlockArm,
): Promise<void> {
  const earned = earnedBy(state, ACHIEVEMENTS);
  if (earned.length === 0) {
    throw new Error(`seed ${seed} as the ${classId}: a finished run earned nothing at all`);
  }
  const block = await page.evaluate(() => document.getElementById('run-unlocked')?.textContent ?? null);
  if (block === null) {
    throw new Error(
      `seed ${seed} as the ${classId}: the run ended having earned ` +
        `${earned.map((a) => a.id).join(', ')} and the end screen says nothing about it`,
    );
  }
  for (const a of earned) {
    if (!block.includes(a.name)) {
      throw new Error(`seed ${seed} as the ${classId}: "${a.name}" was earned and is not on screen`);
    }
    for (const id of a.unlocks) {
      const name = SIGILS.find((s) => s.id === id)?.name ?? CARD_POOL.card(id).name;
      if (!block.includes(name)) {
        throw new Error(`seed ${seed} as the ${classId}: "${name}" was unlocked and is not on screen`);
      }
    }
  }
  console.log(`[run] seed ${seed} ${classId}: earned ${earned.map((a) => a.name).join(', ')}`);

  // The storage round trip, on the arm that has one. Read out of the browser
  // rather than out of the app's own state: what has to survive the page is
  // the bytes in `localStorage`, and a profile the app is holding in a closure
  // is not a profile that survived anything.
  const stored = await page.evaluate((key) => globalThis.localStorage.getItem(key), PROFILE_KEY);
  if (arm === 'all') {
    if (stored !== null) {
      throw new Error(`?unlocks=all wrote a profile (${stored}); a pinned pool must never save`);
    }
    return;
  }
  if (stored === null) {
    throw new Error(
      `seed ${seed} as the ${classId}: the run ended and nothing was written to ${PROFILE_KEY}`,
    );
  }
  const profile = parseProfile(JSON.parse(stored));
  const wantedEarned = earned.map((a) => a.id).sort();
  const wantedOwned = [...new Set(earned.flatMap((a) => a.unlocks))].sort();
  if (profile.earned.join(',') !== wantedEarned.join(',')) {
    throw new Error(
      `the stored profile holds [${profile.earned.join(', ')}] and the run earned ` +
        `[${wantedEarned.join(', ')}]`,
    );
  }
  if (profile.owned.join(',') !== wantedOwned.join(',')) {
    throw new Error(
      `the stored profile owns [${profile.owned.join(', ')}] and the run unlocked ` +
        `[${wantedOwned.join(', ')}]`,
    );
  }
  if (profile.runsFinished !== 1 || profile.runsWon !== (state.result === 'won' ? 1 : 0)) {
    throw new Error(
      `the stored profile counts ${profile.runsFinished} finished and ${profile.runsWon} won ` +
        `after one ${state.result} run`,
    );
  }

  console.log(
    `[run] seed ${seed} ${classId}: profile survived the page - ${profile.earned.length} deed(s), ` +
      `${profile.owned.length} unlock(s)`,
  );
}

/**
 * The next run drafts from the wider pool.
 *
 * Separate from `checkUnlocks` because it navigates: "Same seed again" leaves
 * the end screen, and the run hash the page prints is read off that screen.
 * Called last, after the hash comparison, for exactly that reason.
 */
async function checkNextRunWidens(page: Page, seed: number, classId: string, dir: string): Promise<void> {
  const stored = await page.evaluate((key) => globalThis.localStorage.getItem(key), PROFILE_KEY);
  if (stored === null) throw new Error('the profile vanished between the two checks');
  const profile = parseProfile(JSON.parse(stored));
  const before = unlockedRewards(FRESH_UNLOCKS, classById(classId).rewards).length;
  const after = unlockedRewards(unlockSetFor(profile), classById(classId).rewards).length;
  await page.locator('[data-run="same-seed"]').click();
  await page.waitForSelector('#collection');
  const pick = await page.evaluate(() => ({
    pool: document.querySelector(`[data-class-card] .run__h + *`)?.textContent ?? '',
    text: document.getElementById('run-node')?.textContent ?? '',
    collection: document.querySelector('#collection .unlocks__title')?.textContent ?? '',
  }));
  if (after <= before) {
    throw new Error(
      `the run unlocked ${profile.owned.length} thing(s) and the ${classId}'s pool did not widen ` +
        `(${before} then ${after}); this probe is checking nothing`,
    );
  }
  if (!pick.text.includes(`Drafts from ${after} cards`)) {
    throw new Error(
      `after the unlock the ${classId} should draft from ${after} cards and the pick screen says ` +
        `otherwise: ${pick.text.slice(0, 400)}`,
    );
  }
  if (!pick.collection.includes(`${profile.owned.length} of `)) {
    throw new Error(`the collection does not count the unlocks: "${pick.collection}"`);
  }
  console.log(
    `[run] seed ${seed} ${classId}: the ${classId} now drafts from ${after} cards, was ${before}`,
  );
  await page.screenshot({ path: path.join(dir, 'after-unlock-pick.png'), fullPage: true });
}

/**
 * Which pool the browser plays with, and whether the profile is live.
 *
 *   `all`    `?unlocks=all` - no unlock layer, and no profile is written. The
 *            default, because it is the pool the headless comparison below
 *            plays and the one every other number in this repo is taken at.
 *   `fresh`  the profile, with the stored profile **cleared first**, so the
 *            browser starts at a fresh player and the set is `FRESH_UNLOCKS`
 *            deterministically. This is the arm that exercises the storage:
 *            the run ends, the app writes the profile, and the probe reads it
 *            back and holds it to what the run earned.
 */
type UnlockArm = 'all' | 'fresh';

async function playRun(
  page: Page,
  seed: number,
  theme: string,
  classId: string,
  arm: UnlockArm = 'all',
): Promise<void> {
  const dir = path.join(OUT, `run-${seed}-${classId}-${theme}${arm === 'all' ? '' : `-${arm}`}`);
  const taken = new Set<string>();
  const agent = makeRunAgent({ route: 'greedy', placement: 'right', seed });
  const unlocked = arm === 'fresh' ? FRESH_UNLOCKS : null;
  const mirror = createRunController(RUN_CONTENT, seed, { classId, unlocked });
  const headless = runRun(
    RUN_CONTENT,
    seed,
    makeRunAgent({ route: 'greedy', placement: 'right', seed }),
    classId,
    unlocked,
  );

  // `unlocks=all` pins the pool to the whole content, which is what the
  // headless mirror above and `runRun` both play. Without it the browser would
  // draft from whatever this browser profile happens to hold, and the run hash
  // the page prints would be a run nothing else played.
  //
  // The `fresh` arm is the exception and gets its determinism the other way:
  // the stored profile is wiped first, so "whatever this browser holds" is
  // exactly a fresh player, and the app's own `loadProfile` is then in the
  // loop rather than pinned out of it.
  if (arm === 'fresh') {
    await page.goto(`${BASE}?seed=${seed}&theme=${theme}&fresh=1&unlocks=all`);
    await page.evaluate((key) => globalThis.localStorage.removeItem(key), PROFILE_KEY);
  }
  await page.goto(
    `${BASE}?seed=${seed}&theme=${theme}&fresh=1${arm === 'all' ? '&unlocks=all' : ''}`,
  );
  await page.evaluate(() => document.fonts.ready);
  // A run now starts at the class pick, and this probe walked straight past it
  // into a 30-second timeout for a whole unit: classes shipped, `#run-map` was
  // no longer the first thing on screen, and the repo's own instrument for
  // playing a run stopped working with nothing saying so.
  //
  // The class is clicked rather than named in the address, for the reason at
  // the top of this file. Whichever one is clicked, the headless mirror and the
  // headless run are started as the same one - the hash comparison at the end
  // means nothing unless all three are the same run.
  await page.waitForSelector('[data-class-card]');
  await shoot(page, dir, 'class-pick', taken);
  await page.locator(`[data-run="pick-class"][data-class="${classId}"]`).click();
  await page.waitForSelector('#run-map svg');

  let steps = 0;
  let actShot = -1;
  while (steps++ < 400) {
    const state = await look(page);
    const phase = mirror.phase;

    if (state.over) {
      await shoot(page, dir, `end-${mirror.state.result}`, taken);
      break;
    }

    switch (phase.kind) {
      case 'travel': {
        if (state.screen !== 'map') {
          // A rest or an act break between the node and the map.
          await shoot(page, dir, state.screen.toLowerCase().replace(/[^a-z0-9]+/g, '-'), taken);
          await page.locator('[data-run="continue"]').click();
          continue;
        }
        const act = mirror.state.act;
        if (act !== actShot) {
          actShot = act;
          await shoot(page, dir, `act${act + 1}-map`, taken);
        }
        const options = travelOptions(mirror.state);
        const ids = options.map((o) => o.id).sort((a, b) => a - b);
        const shown = state.reachable.slice().sort((a, b) => a - b);
        if (ids.join(',') !== shown.join(',')) {
          throw new Error(`seed ${seed}: the map lights [${shown.join(',')}] and the run offers [${ids.join(',')}]`);
        }
        const pick = options[agent.travel(mirror.state, options)]!;
        const node = page.locator(`#run-map [data-node="${pick.id}"]`);
        await node.hover();
        await page.waitForTimeout(120);
        await shoot(page, dir, 'map-hover', taken);
        await node.click();
        mirror.travel(pick.id);
        if (mirror.phase.kind === 'fight') {
          await page.waitForSelector('#commit:not(:disabled)');
          await shoot(page, dir, 'fight-enter', taken);
        }
        break;
      }
      case 'fight': {
        // The fight the engine would fight, mirrored so the clicks are the
        // bot's. Card choice is `selectPlays` and placement is append-right,
        // which is the last slot every time.
        const setup = phase.setup;
        const expect = runFight(setup, agent.placement);
        for (const record of expect.log) {
          await page.waitForSelector('#commit:not(:disabled)');
          const hand: string[] = await page.evaluate(() =>
            Array.from(document.querySelectorAll('.handcard')).map((el) => (el as HTMLElement).dataset['cardId'] ?? ''),
          );
          if (hand.join(',') !== record.handBefore.join(',')) {
            throw new Error(
              `seed ${seed} round ${record.round}: the hand on screen is [${hand.join(',')}], the engine drew [${record.handBefore.join(',')}]`,
            );
          }
          const chosen = selectPlays(record.handBefore, setup.pool.energyPerTurn, setup.pool);
          for (const index of chosen) {
            await page.locator(`.handcard[data-index="${index}"]`).click();
            const slots = page.locator('#player-row .slot');
            await slots.nth((await slots.count()) - 1).click();
          }
          // A sigilled card in the line, the first time one is placed: shoot
          // it, then hover it so the panel that explains the sigil is open.
          if (!taken.has('fight-sigil') && (await page.locator('#player-row .pip--sigil').count()) > 0) {
            await shoot(page, dir, 'fight-sigil', taken);
            const card = page.locator('#player-row .pip--sigil').first().locator('xpath=ancestor::*[@data-uid][1]');
            await card.hover();
            await page.waitForSelector('#inspect:not([hidden])');
            await shoot(page, dir, 'fight-sigil-hover', taken);
            await page.mouse.move(2, 2);
          }
          // The hero's own panel, the first time the run holds a hero sigil.
          // It is the only place a hero sigil's *effect* is written out while a
          // fight is up: the HUD chip beside the Health bar carries the name
          // and the sentence on hover, and this panel is where it is on screen.
          //
          // The condition asks the mirror and not the page on purpose. A first
          // attempt asked the page for `#hud .hud__stat--sigil` and took no
          // shot at all: `hud` is a class on `<header>`, not an id, so the
          // selector matched nothing and the missing shot read as "the run
          // never held one". The run state is the authority on what is held.
          if (!taken.has('fight-hero-hover') && mirror.state.sigils.some((g) => g.target === 'hero')) {
            const hero = page.locator('#player-row [data-uid]').last();
            await hero.hover();
            await page.waitForSelector('#inspect:not([hidden])');
            await shoot(page, dir, 'fight-hero-hover', taken);
            await page.mouse.move(2, 2);
          }
          await page.locator('#commit').click();
          await page.locator('#skip').click().catch(() => undefined);
          await page.waitForFunction(
            () =>
              (document.getElementById('commit') as HTMLButtonElement | null)?.disabled === false ||
              document.querySelector('.banner') !== null,
            undefined,
            { timeout: 20000 },
          );
        }
        await page.waitForSelector('.banner');
        await shoot(page, dir, expect.fight.result === 'playerWin' ? 'fight-won' : 'fight-lost', taken);
        // The last thing the player reads. A screenshot only shows the log's
        // scrolled viewport, and the lines this run was changed for - the tail
        // of an act that ended the fight - are the ones that scroll off it. So
        // they are printed as well as photographed. This is a read-out, not an
        // assertion: "for 0" is CORRECT mid-fight, where a blow Armour ate is
        // exactly what the player has to see, and only after the fight is
        // decided is it dropped.
        const tail: string[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll('#log p'))
            .slice(-8)
            .map((el) => (el.textContent ?? '').trim()),
        );
        console.log(`   [log tail] ${classId} fight ${mirror.state.fightsFought + 1}: ${tail.join(' | ')}`);
        await page.locator('[data-run="finish-fight"]').click();
        mirror.finishFight({ fight: expect.fight, rounds: expect.log });
        break;
      }
      case 'sigil': {
        await page.waitForSelector('[data-run="sigil"]');
        await shoot(page, dir, 'sigil-offer', taken);
        const shownIds: string[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-run="sigil"][data-sigil-id]')).map(
            (el) => (el as HTMLElement).dataset['sigilId'] ?? '',
          ),
        );
        const wantIds = phase.offer.map((s) => s.id);
        if (shownIds.join(',') !== wantIds.join(',')) {
          throw new Error(`seed ${seed}: the screen offers hero sigils [${shownIds.join(',')}] and the run offers [${wantIds.join(',')}]`);
        }
        const pick = agent.sigil(mirror.state, phase.offer);
        await page.locator(`[data-run="sigil"][data-pick="${pick}"]`).click();
        mirror.pickSigil(pick);
        break;
      }
      case 'reward': {
        await page.waitForSelector('[data-run="reward"]');
        const hasSigil = phase.offer.some((o) => o.kind === 'sigil');
        await shoot(page, dir, hasSigil ? 'reward-sigil' : 'reward', taken);
        const shownSigils = await page.locator('[data-run="reward"][data-sigil-id]').count();
        if (shownSigils !== phase.offer.filter((o) => o.kind === 'sigil').length) {
          throw new Error(`seed ${seed}: the shelf shows ${shownSigils} sigil(s) and the run offers ${hasSigil ? 1 : 0}`);
        }
        const pick = agent.reward(mirror.state, phase.offer);
        await page.locator(`[data-run="reward"][data-pick="${pick}"]`).click();
        mirror.pickReward(pick);
        break;
      }
      case 'attach': {
        await page.waitForSelector('[data-run="attach"]');
        await shoot(page, dir, 'attach', taken);
        const shown: number[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-run="attach"]:not([disabled])')).map((el) =>
            Number.parseInt((el as HTMLElement).dataset['index'] ?? '', 10),
          ),
        );
        if (shown.join(',') !== phase.offers.join(',')) {
          throw new Error(`seed ${seed}: the attach shelf enables [${shown.join(',')}] and the run offers [${phase.offers.join(',')}]`);
        }
        const at = agent.attach(mirror.state, phase.sigil, phase.offers);
        const deckIndex = phase.offers[at]!;
        await page.locator(`[data-run="attach"][data-index="${deckIndex}"]`).click();
        mirror.attach(deckIndex);
        break;
      }
      case 'forge': {
        await page.waitForSelector('[data-run="forge-card"]');
        const offer = phase.offers[agent.forge(mirror.state, phase.offers)]!;
        await page.locator(`[data-run="forge-card"][data-index="${offer.deckIndex}"]`).click();
        await page.waitForSelector('[data-run="forge-mode"]');
        await shoot(page, dir, 'forge', taken);
        await page.locator(`[data-run="forge-mode"][data-mode="${offer.mode}"]`).click();
        mirror.forge(offer.deckIndex, offer.mode);
        break;
      }
      case 'shop': {
        await page.waitForSelector('[data-run="buy"]');
        await shoot(page, dir, 'shop', taken);
        const buy = agent.shop(mirror.state, phase.stock);
        await page.locator(`[data-run="buy"][data-index="${buy}"]`).click();
        mirror.buy(buy);
        break;
      }
      case 'event': {
        await page.waitForSelector('[data-run="event"]');
        await shoot(page, dir, 'event', taken);
        const option = agent.event(mirror.state, phase.def);
        await page.locator(`[data-run="event"][data-option="${option}"]`).click();
        mirror.chooseEvent(option);
        break;
      }
      case 'over':
        break;
    }
    if (mirror.phase.kind === 'over') {
      // The log sits in a closed <details>, so "attached" is the state to wait for.
      await page.waitForSelector('#run-log', { state: 'attached' });
      await shoot(page, dir, `end-${mirror.state.result}`, taken);
      await checkUnlocks(page, mirror.state, seed, classId, arm);
      break;
    }
  }

  // The page's own hash against the headless run's: the invariant across the DOM.
  // Read as the last `dd` of the stats list, so the unlock block below it must
  // stay below it.
  const shown = await page.evaluate(() => {
    const dd = Array.from(document.querySelectorAll('.run__stats dd'));
    return dd[dd.length - 1]?.textContent ?? '';
  });
  const expected = hashRun(headless.run);
  const mirrored = mirror.hash();
  console.log(
    `[run] seed ${seed} ${classId} ${theme}: ${mirror.state.result} after ` +
      `${mirror.state.nodesVisited} nodes, ${mirror.state.fightsFought} fights; ` +
      `page hash ${shown}, headless ${expected}, mirror ${mirrored}`,
  );
  if (shown !== expected || mirrored !== expected) {
    throw new Error(
      `seed ${seed} as the ${classId}: the run played through the browser hashed ${shown}, ` +
        `the headless run ${expected} and the mirror ${mirrored}. All three must agree, or the ` +
        `DOM is playing a different fight from the engine.`,
    );
  }

  // Last, because it navigates away from the end screen the hash was read off.
  if (arm === 'fresh') await checkNextRunWidens(page, seed, classId, dir);
}

async function manifest(): Promise<number> {
  const files: Record<string, { bytes: number; sha256: string }> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.png')) {
        const buf = await readFile(full);
        files[`${prefix}${entry.name}`] = { bytes: buf.byteLength, sha256: createHash('sha256').update(buf).digest('hex') };
      }
    }
  };
  await walk(OUT, '');
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify({ files }, null, 2), 'utf8');
  return Object.keys(files).length;
}

/** The classes named on the command line, or all of them. */
function classesFrom(arg: string | undefined): string[] {
  const all = (RUN_CONTENT.classes ?? []).map((c) => c.id);
  if (arg === undefined || arg === 'all') return all;
  if (!all.includes(arg)) {
    throw new Error(
      `tools/ui-probe/run.ts: "${arg}" is not a class this content offers. ` +
        `Pass one of ${all.join(', ')}, or "all" for every one of them.`,
    );
  }
  return [arg];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === 'find-win') {
    const max = Number.parseInt(args[1] ?? '300', 10);
    for (const classId of classesFrom(args[2])) {
      const wins: number[] = [];
      for (let seed = 1; seed <= max; seed++) {
        const { run } = runRun(
          RUN_CONTENT,
          seed,
          makeRunAgent({ route: 'greedy', placement: 'right', seed }),
          classId,
        );
        if (run.result === 'won') wins.push(seed);
      }
      console.log(
        `[find-win] ${classId}, greedy route, append-right placement, seeds 1..${max}: ` +
          `won ${wins.length} - ${wins.join(', ') || 'none'}`,
      );
    }
    return;
  }
  if (args[0] === 'find-sigil') {
    // Seeds where the bot attaches a card sigil inside act 1 and takes a hero
    // sigil there too, so one run photographs every sigil screen early.
    const max = Number.parseInt(args[1] ?? '300', 10);
    const hits: string[] = [];
    for (let seed = 1; seed <= max; seed++) {
      const { run, log } = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'greedy', placement: 'right', seed }));
      const act1 = log.nodes.filter((n) => n.act === 0);
      const attach = act1.findIndex((n) => n.choices.some((c) => c.kind === 'attach'));
      const hero = act1.findIndex((n) => n.choices.some((c) => c.kind === 'sigil' && c.pick >= 0));
      if (attach >= 0 && hero >= 0) {
        hits.push(`${seed} (attach at node ${attach + 1}, hero sigil at node ${hero + 1}, ${run.result})`);
      }
    }
    console.log(`[find-sigil] seeds 1..${max} with a card sigil attached and a hero sigil taken in act 1: ${hits.length}\n  ${hits.join('\n  ') || 'none'}`);
    return;
  }
  const seed = Number.parseInt(args[0] ?? '7', 10);
  const theme = args[1] ?? 'light';
  const classes = classesFrom(args[2]);
  await mkdir(OUT, { recursive: true });
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.error(`[page error] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.error(`[page crash] ${e.message}`));
    const arm: UnlockArm = args[3] === 'fresh' ? 'fresh' : 'all';
    if (args[3] !== undefined && args[3] !== 'all' && args[3] !== 'fresh') {
      throw new Error(
        `tools/ui-probe/run.ts: "${args[3]}" is not an unlock arm. Pass "all" (the default: no ` +
          `unlock layer, and no profile is written) or "fresh" (a cleared profile, the app's own ` +
          `unlock set, and the stored profile read back at the end).`,
      );
    }
    for (const classId of classes) await playRun(page, seed, theme, classId, arm);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`[manifest] ${await manifest()} shots digested into ${path.relative(ROOT, OUT)}`);
}

await main();
