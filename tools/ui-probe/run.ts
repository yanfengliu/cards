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
 * Shots go to `.probe-ui/run-<seed>-<theme>/` with a sha256 manifest, one per
 * kind of screen the first time it appears - map per act, the map with a node
 * hovered, the fight as it opens and as it ends, reward, forge, shop, event,
 * rest, the act break, and the end - so a review binds to the bytes inspected.
 * Sigils add four: the hero sigil offer after an elite, a shelf holding a
 * card sigil, the attach screen, and the fight with a sigilled card in the
 * line, hovered so its panel is open.
 *
 *   node tools/ui-probe/run.ts <seed> <light|dark>      play one seed
 *   node tools/ui-probe/run.ts find-win [max]           headless: seeds the bot wins
 *   node tools/ui-probe/run.ts find-sigil [max]         headless: seeds where act 1
 *                                                       attaches a card sigil
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

async function playRun(page: Page, seed: number, theme: string): Promise<void> {
  const dir = path.join(OUT, `run-${seed}-${theme}`);
  const taken = new Set<string>();
  const agent = makeRunAgent({ route: 'greedy', placement: 'right', seed });
  const mirror = createRunController(RUN_CONTENT, seed);
  const headless = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'greedy', placement: 'right', seed }));

  await page.goto(`${BASE}?seed=${seed}&theme=${theme}&fresh=1`);
  await page.evaluate(() => document.fonts.ready);
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
    `[run] seed ${seed} ${theme}: ${mirror.state.result} after ${mirror.state.nodesVisited} nodes, ` +
      `${mirror.state.fightsFought} fights; page hash ${shown}, headless ${expected}, mirror ${mirrored}`,
  );
  if (shown !== expected || mirrored !== expected) {
    throw new Error(`seed ${seed}: the run played through the browser did not hash to the headless run`);
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === 'find-win') {
    const max = Number.parseInt(args[1] ?? '300', 10);
    const wins: number[] = [];
    for (let seed = 1; seed <= max; seed++) {
      const { run } = runRun(RUN_CONTENT, seed, makeRunAgent({ route: 'greedy', placement: 'right', seed }));
      if (run.result === 'won') wins.push(seed);
    }
    console.log(`[find-win] greedy route, append-right placement, seeds 1..${max}: won ${wins.length} - ${wins.join(', ') || 'none'}`);
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
  await mkdir(OUT, { recursive: true });
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.error(`[page error] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.error(`[page crash] ${e.message}`));
    await playRun(page, seed, theme);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`[manifest] ${await manifest()} shots digested into ${path.relative(ROOT, OUT)}`);
}

await main();
