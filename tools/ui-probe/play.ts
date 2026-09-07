/**
 * Plays the real app through its real controls, and photographs what happens.
 *
 * Fleet canon, and the reason this file is not `page.evaluate(render)`:
 *
 *   > A harness that sets state directly - assigning the camera pose, calling
 *   > the render function, writing the store - is not exercising the controls,
 *   > and is structurally blind to every defect living in the input path it
 *   > skipped, while reporting confidently on the path it kept.
 *
 * So every action below is a click on a real element: a card in the hand, a gap
 * in the line, the commit button, the speed control. The only thing read out of
 * the page is what the page is showing.
 *
 * Two modes:
 *   sweep  play rounds to the end, skipping animation, and photograph the board
 *          at every distinct line width reached. This is the 1/5/10/15 sweep.
 *   film   play one round at 1x and photograph the resolution every 220ms, so
 *          the acting highlight and the travelling buff can be reviewed as
 *          frames rather than as a claim.
 *
 * Shots are written to `.probe-ui/` (git-ignored) with a sha256 manifest, so a
 * review binds to the bytes inspected and a regenerated set does not inherit it.
 */

import { chromium, type Browser, type Page } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, '.probe-ui');
const BASE = process.env['CARDS_URL'] ?? 'http://127.0.0.1:5175/src/ui/index.html';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

async function launch(): Promise<Browser> {
  const errors: string[] = [];
  for (const exe of CHROME_CANDIDATES) {
    try {
      await stat(exe);
    } catch {
      errors.push(`${exe}: not present`);
      continue;
    }
    try {
      return await chromium.launch({ executablePath: exe });
    } catch (e) {
      errors.push(`${exe}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  try {
    return await chromium.launch({ channel: 'chrome' });
  } catch (e) {
    errors.push(`channel chrome: ${(e as Error).message.split('\n')[0]}`);
  }
  throw new Error(`No usable Chromium. Tried:\n  ${errors.join('\n  ')}`);
}

type Snapshot = {
  round: number;
  mode: string;
  playerUnits: number;
  enemyUnits: number;
  hand: number;
  slots: number;
  result: string;
  heroes: string;
};

/** Everything the harness knows, read off the rendered page and nothing else. */
async function look(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const q = (s: string): number => document.querySelectorAll(s).length;
    const subtitle = document.getElementById('subtitle')?.textContent ?? '';
    const banner = document.querySelector('.banner')?.textContent ?? '';
    const roundMatch = /round (\d+)/.exec(subtitle);
    return {
      round: roundMatch === null ? 0 : Number.parseInt(roundMatch[1] ?? '0', 10),
      mode: (document.getElementById('skip') as HTMLButtonElement | null)?.disabled === false
        ? 'resolving'
        : banner.length > 0
          ? 'over'
          : 'planning',
      // The rendered line width, which is what the compression rule is about:
      // a pending card takes exactly as much room as a committed one.
      playerUnits: q('#player-row .card'),
      enemyUnits: q('#enemy-row .card'),
      hand: q('.handcard'),
      slots: q('#player-row .slot'),
      result: banner,
      heroes: subtitle,
    };
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('commit') as HTMLButtonElement | null)?.disabled === false ||
      document.querySelector('.banner') !== null,
    undefined,
    { timeout: 20000 },
  );
}

async function shoot(page: Page, dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

async function shootRow(page: Page, dir: string, name: string, selector: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const el = page.locator(selector);
  if ((await el.count()) === 0) return;
  await el.screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * Place every affordable card in hand, through the hand and the slots.
 * `spread` decides which gap: 'right' grows the line at the hero end, 'left'
 * at the far end, 'mix' alternates, which is what a player actually does.
 */
async function playHand(
  page: Page,
  spread: 'right' | 'left' | 'mix',
  round: number,
  limit = 6,
): Promise<number> {
  let placed = 0;
  for (let guard = 0; guard < limit; guard++) {
    const card = page.locator('.handcard:not(:disabled)').first();
    if ((await card.count()) === 0) break;
    await card.click();
    const slots = page.locator('#player-row .slot');
    const count = await slots.count();
    if (count === 0) break;
    const index =
      spread === 'right' ? count - 1 : spread === 'left' ? 0 : (round + placed) % count;
    await slots.nth(index).click();
    placed++;
  }
  return placed;
}

async function sweep(
  page: Page,
  seed: number,
  encounter: string,
  theme: string,
  open: 'one' | 'all',
): Promise<Snapshot[]> {
  const dir = path.join(OUT, `sweep-${encounter}-${seed}-${theme}-${open}`);
  await page.goto(`${BASE}?seed=${seed}&encounter=${encounter}&theme=${theme}`);
  await page.evaluate(() => document.fonts.ready);
  await settle(page);

  const seen = new Set<number>();
  const log: Snapshot[] = [];
  for (let round = 1; round <= 14; round++) {
    const before = await look(page);
    if (before.mode === 'over') break;
    // `open: 'one'` places a single card on round one, so the 1-unit board -
    // the width the player actually starts every fight at - is in the sweep
    // rather than skipped over by a greedy opening. It also changes the whole
    // fight: a different action list consumes the targeting stream differently,
    // so the two openings are two different games, not two views of one.
    await playHand(page, 'mix', round, open === 'one' && round === 1 ? 1 : 6);
    const state = await look(page);
    log.push(state);

    // One shot per distinct player-line width, at native resolution.
    const width = state.playerUnits;
    if (!seen.has(width)) {
      seen.add(width);
      await shoot(page, dir, `page-${String(width).padStart(2, '0')}units`);
      await shootRow(page, dir, `playerrow-${String(width).padStart(2, '0')}units`, '#player-row');
      await shootRow(page, dir, `enemyrow-${String(state.enemyUnits).padStart(2, '0')}units`, '#enemy-row');
    }

    await page.locator('#commit').click();
    await page.locator('#skip').click().catch(() => undefined);
    await settle(page);
    const after = await look(page);
    if (after.mode === 'over') {
      await shoot(page, dir, 'page-final');
      log.push(after);
      break;
    }
  }
  return log;
}

/**
 * Play to the widest line the fight will give, then squeeze the window.
 *
 * The width sweep the review needs is not only "how many units" - it is
 * "how many units in how much room", because the compression rule only bites
 * when the two are in tension. A fourteen-unit line at 1440px is comfortable; a
 * fourteen-unit line at 700px is the case that either compresses or wraps.
 */
async function narrow(page: Page, seed: number, encounter: string, theme: string): Promise<void> {
  const dir = path.join(OUT, `narrow-${encounter}-${seed}-${theme}`);
  await page.goto(`${BASE}?seed=${seed}&encounter=${encounter}&theme=${theme}`);
  await page.evaluate(() => document.fonts.ready);
  await settle(page);

  let best = 0;
  for (let round = 1; round <= 14; round++) {
    const before = await look(page);
    if (before.mode === 'over') break;
    await playHand(page, 'mix', round);
    const state = await look(page);
    best = Math.max(best, state.playerUnits);
    if (state.playerUnits >= 13) break;
    await page.locator('#commit').click();
    await page.locator('#skip').click().catch(() => undefined);
    await settle(page);
  }

  for (const width of [1440, 1180, 980, 820, 700, 560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(120);
    const state = await look(page);
    const wrapped = await page.evaluate(() => {
      const row = document.getElementById('player-row');
      if (row === null) return { rows: 0, scroll: 0, cardW: 0 };
      const tops = new Set<number>();
      for (const c of Array.from(row.querySelectorAll('.card, .hero'))) {
        tops.add(Math.round(c.getBoundingClientRect().top));
      }
      const first = row.querySelector('.card') as HTMLElement | null;
      return {
        rows: tops.size,
        scroll: row.scrollWidth - row.clientWidth,
        cardW: first === null ? 0 : Math.round(first.getBoundingClientRect().width),
      };
    });
    console.log(
      `viewport ${width}: ${state.playerUnits} units, card ${wrapped.cardW}px, ` +
        `distinct card tops ${wrapped.rows} (1 means no wrap), overflow ${wrapped.scroll}px`,
    );
    await shootRow(page, dir, `row-${state.playerUnits}units-vw${width}`, '#player-row');
    await shoot(page, dir, `page-${state.playerUnits}units-vw${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log(`[narrow] widest line reached: ${best}`);
}

async function film(page: Page, seed: number, encounter: string, theme: string): Promise<void> {
  const dir = path.join(OUT, `film-${encounter}-${seed}-${theme}`);
  await page.goto(`${BASE}?seed=${seed}&encounter=${encounter}&theme=${theme}`);
  await page.evaluate(() => document.fonts.ready);
  await settle(page);

  // Build a line worth watching: two rounds of placements, resolved instantly,
  // then film the third.
  for (let round = 1; round <= 2; round++) {
    await playHand(page, 'mix', round);
    await page.locator('#commit').click();
    await page.locator('#skip').click().catch(() => undefined);
    await settle(page);
  }
  await playHand(page, 'mix', 3);
  await shoot(page, dir, 'frame-00-planning');
  await page.locator('#commit').click();
  for (let frame = 1; frame <= 16; frame++) {
    await shoot(page, dir, `frame-${String(frame).padStart(2, '0')}`);
    await page.waitForTimeout(220);
  }
  await settle(page).catch(() => undefined);
  await shoot(page, dir, 'frame-99-after');
}

async function manifest(): Promise<number> {
  const files: Record<string, { bytes: number; sha256: string }> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.png')) {
        const buf = await readFile(full);
        files[`${prefix}${entry.name}`] = {
          bytes: buf.byteLength,
          sha256: createHash('sha256').update(buf).digest('hex'),
        };
      }
    }
  };
  await walk(OUT, '');
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify({ files }, null, 2), 'utf8');
  return Object.keys(files).length;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0] ?? 'sweep';
  const seed = Number.parseInt(args[1] ?? '7', 10);
  const encounter = args[2] ?? 'even';
  const theme = args[3] ?? 'dark';
  const open = args[4] === 'one' ? 'one' : 'all';

  if (mode === 'sweep' && args[1] === undefined) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const browser = await launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.error(`[page error] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.error(`[page crash] ${e.message}`));

    if (mode === 'film') {
      await film(page, seed, encounter, theme);
      console.log(`[film] ${encounter} seed ${seed} ${theme}`);
    } else if (mode === 'narrow') {
      await narrow(page, seed, encounter, theme);
    } else {
      const log = await sweep(page, seed, encounter, theme, open);
      for (const s of log) {
        console.log(
          `round ${s.round} ${s.mode} player=${s.playerUnits} enemy=${s.enemyUnits} ` +
            `hand=${s.hand} | ${s.heroes}${s.result.length > 0 ? ` | ${s.result}` : ''}`,
        );
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
  }

  console.log(`[manifest] ${await manifest()} shots digested into ${path.relative(ROOT, OUT)}`);
}

await main();
