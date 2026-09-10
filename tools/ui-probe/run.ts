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
 * inspected.
 *
 * **The class is a parameter, and `all` is the default.** It was the Knight,
 * hardcoded, for the whole unit that added the other two - so the Ranger and
 * the Mage, whose Volley and Scorch are the only two things the unit put in the
 * resolver, were never once played through the DOM. Every class plays the same
 * run structure, so one class proves the wiring; it proves nothing about the
 * two classes whose own verbs draw their own beats.
 *
 *   node tools/ui-probe/run.ts <seed> <light|dark> [knight|ranger|mage|all]
 *   node tools/ui-probe/run.ts find-win [max] [class]   headless: seeds the bot wins
 */

import { type Page } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './chrome.ts';
import { runFight, selectPlays } from '../../src/engine/fight.ts';
import { RUN_CONTENT } from '../../src/run/content.ts';
import { hashRun } from '../../src/run/hash.ts';
import { runRun, travelOptions } from '../../src/run/run.ts';
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

async function playRun(page: Page, seed: number, theme: string, classId: string): Promise<void> {
  const dir = path.join(OUT, `run-${seed}-${classId}-${theme}`);
  const taken = new Set<string>();
  const agent = makeRunAgent({ route: 'greedy', placement: 'right', seed });
  const mirror = createRunController(RUN_CONTENT, seed, { classId });
  const headless = runRun(
    RUN_CONTENT,
    seed,
    makeRunAgent({ route: 'greedy', placement: 'right', seed }),
    classId,
  );

  await page.goto(`${BASE}?seed=${seed}&theme=${theme}&fresh=1`);
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
      case 'reward': {
        await page.waitForSelector('[data-run="reward"]');
        await shoot(page, dir, 'reward', taken);
        const pick = agent.reward(mirror.state, phase.offer);
        await page.locator(`[data-run="reward"][data-pick="${pick}"]`).click();
        mirror.pickReward(pick);
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
      break;
    }
  }

  // The page's own hash against the headless run's: the invariant across the DOM.
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
    for (const classId of classes) await playRun(page, seed, theme, classId);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`[manifest] ${await manifest()} shots digested into ${path.relative(ROOT, OUT)}`);
}

await main();
