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
 * Four modes:
 *   sweep  play rounds to the end, skipping animation, and photograph the board
 *          at every distinct line width reached. This is the 1/5/10/15 sweep.
 *   narrow play to the widest line the fight gives, then squeeze the viewport.
 *   film   play one round at 1x and photograph the resolution every 220ms, so
 *          the acting highlight and the travelling buff can be reviewed as
 *          frames rather than as a claim.
 *   hover  hover every kind of card and photograph the explanation panel, with
 *          the area it covers of each row measured rather than eyeballed.
 *
 * Shots are written to `.probe-ui/` (git-ignored) with a sha256 manifest, so a
 * review binds to the bytes inspected and a regenerated set does not inherit it.
 */

import { type Page } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './chrome.ts';
import { cvdMatrix } from '../../src/render/heraldry/tinctures.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, '.probe-ui');
const BASE = process.env['CARDS_URL'] ?? 'http://127.0.0.1:5175/src/ui/index.html';

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
async function narrow(
  page: Page,
  seed: number,
  encounter: string,
  theme: string,
  hatch: boolean,
): Promise<void> {
  const dir = path.join(OUT, `narrow-${encounter}-${seed}-${theme}${hatch ? '-hatch' : ''}`);
  await page.goto(
    `${BASE}?seed=${seed}&encounter=${encounter}&theme=${theme}${hatch ? '&hatch=1' : ''}`,
  );
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

  for (const width of [1440, 1180, 980, 820, 700, 560, 440, 380]) {
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
      // The trait strip is the thing most likely to break compression: it is
      // the one part of a card whose contents are not scaled by the card's own
      // width, so an icon that is too big for the floor pushes the row into a
      // scrollbar. Measured as "widest strip against its own card".
      let worst = 0;
      let worstCard = 0;
      for (const card of Array.from(row.querySelectorAll('.card'))) {
        const pips = card.querySelector('.card__pips') as HTMLElement | null;
        if (pips === null || pips.children.length === 0) continue;
        let used = 0;
        for (const pip of Array.from(pips.children)) {
          used += (pip as HTMLElement).getBoundingClientRect().width + 3;
        }
        if (used - 3 > worst) {
          worst = used - 3;
          worstCard = card.getBoundingClientRect().width;
        }
      }
      return {
        rows: tops.size,
        scroll: row.scrollWidth - row.clientWidth,
        cardW: first === null ? 0 : Math.round(first.getBoundingClientRect().width),
        pipStrip: Math.round(worst),
        pipCard: Math.round(worstCard),
      };
    });
    console.log(
      `viewport ${width}: ${state.playerUnits} units, card ${wrapped.cardW}px, ` +
        `distinct card tops ${wrapped.rows} (1 means no wrap), overflow ${wrapped.scroll}px, ` +
        `widest trait strip ${wrapped.pipStrip}px in a ${wrapped.pipCard}px card`,
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

/**
 * What the inspect panel covers up.
 *
 * The panel is the answer to "what does this card mean", and the board is the
 * thing the player is reading when they ask. A panel that hides the other line
 * to explain this one has traded the question for the answer. So the overlap is
 * *measured* rather than eyeballed: the panel's rectangle against each row's
 * rectangle, in CSS pixels, read off the live page.
 */
type Overlap = {
  readonly shown: boolean;
  readonly panel: { x: number; y: number; w: number; h: number };
  readonly enemyRow: number;
  readonly playerRow: number;
  readonly offscreen: number;
  /** The bands the two rows leave free, so a bad placement can be explained. */
  readonly bands: string;
};

async function overlapOf(page: Page): Promise<Overlap> {
  return page.evaluate(() => {
    const panel = document.getElementById('inspect');
    const rect = (el: Element | null): DOMRect | null =>
      el === null ? null : el.getBoundingClientRect();
    const p = panel === null || panel.hidden ? null : rect(panel);
    const area = (a: DOMRect | null, b: DOMRect | null): number => {
      if (a === null || b === null) return 0;
      const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return Math.round(w * h);
    };
    const view = new DOMRect(0, 0, globalThis.innerWidth, globalThis.innerHeight);
    const er = rect(document.getElementById('enemy-row'));
    const pr = rect(document.getElementById('player-row'));
    const band = (a: number, b: number): string => `${Math.round(a)}..${Math.round(b)} (${Math.round(b - a)}px)`;
    return {
      shown: p !== null,
      bands:
        er === null || pr === null
          ? 'no rows'
          : `top ${band(0, er.top)}, middle ${band(er.bottom, pr.top)}, bottom ${band(pr.bottom, globalThis.innerHeight)}`,
      panel:
        p === null
          ? { x: 0, y: 0, w: 0, h: 0 }
          : { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) },
      enemyRow: area(p, rect(document.getElementById('enemy-row'))),
      playerRow: area(p, rect(document.getElementById('player-row'))),
      offscreen: p === null ? 0 : Math.round(p.width * p.height) - area(p, view),
    };
  });
}

/**
 * Hover every kind of thing a card can be, and photograph the explanation.
 *
 * The states that matter are not "a card" but the positions the panel has to
 * solve for: an enemy unit at the top of the window (where the panel used to
 * cover the row above it), a player unit at the bottom, a hand card, the hero,
 * and a card at the 44px compression floor where the icons have to give up.
 */
async function hover(
  page: Page,
  seed: number,
  encounter: string,
  theme: string,
  hatch: boolean,
): Promise<void> {
  const dir = path.join(OUT, `hover-${encounter}-${seed}-${theme}${hatch ? '-hatch' : ''}`);
  await page.goto(
    `${BASE}?seed=${seed}&encounter=${encounter}&theme=${theme}${hatch ? '&hatch=1' : ''}`,
  );
  await page.evaluate(() => document.fonts.ready);
  await settle(page);

  const shotOf = async (name: string, locator: string, nth = 0): Promise<void> => {
    const el = page.locator(locator).nth(nth);
    if ((await el.count()) === 0) {
      console.log(`[hover] ${name}: no element for ${locator}`);
      return;
    }
    await el.hover();
    await page.waitForTimeout(140);
    const o = await overlapOf(page);
    console.log(
      `[hover] ${name}: shown=${o.shown} panel=${o.panel.w}x${o.panel.h}@(${o.panel.x},${o.panel.y}) ` +
        `covers enemy-row ${o.enemyRow}px2, player-row ${o.playerRow}px2, offscreen ${o.offscreen}px2` +
        ` | bands ${o.bands}`,
    );
    await shoot(page, dir, name);
  };

  await shotOf('01-hand-card', '.handcard');
  await shotOf('02-hand-card-last', '.handcard', 4);
  await shotOf('03-enemy-unit', '#enemy-row .card');
  await shotOf('04-enemy-hero', '#enemy-row .hero');

  // A player line worth hovering, and a ghost still in it.
  await playHand(page, 'mix', 1);
  await shotOf('05-ghost', '#player-row [data-ghost]');
  await page.locator('#commit').click();
  await page.locator('#skip').click().catch(() => undefined);
  await settle(page);
  await shotOf('06-player-unit', '#player-row .card');
  await shotOf('07-player-hero', '#player-row .hero');

  // Then a wide line, so the same hover is checked at the compression floor.
  for (let round = 2; round <= 12; round++) {
    const before = await look(page);
    if (before.mode === 'over') break;
    await playHand(page, 'mix', round);
    if ((await look(page)).playerUnits >= 12) break;
    await page.locator('#commit').click();
    await page.locator('#skip').click().catch(() => undefined);
    await settle(page);
  }
  const wide = await look(page);
  console.log(`[hover] wide line: ${wide.playerUnits} player units`);
  await shotOf('08-wide-player-unit', '#player-row .card', 3);
  await shootRow(page, dir, '09-wide-player-row', '#player-row');

  /*
   * The same line as a red-green colour-blind player sees it.
   *
   * Tribe is carried by field tincture and nothing else, and gules (dwarf) and
   * vert (elf) stand next to each other on the player's own line. Their sRGB
   * distance is 139; simulated for deuteranopia it is 34, which is to say the
   * two are the same card to roughly one man in twelve. Run this probe with and
   * without `hatch` and compare the two rows: that difference is the whole
   * argument for the hatching switch, and it is a thing to look at rather than a
   * number to take on trust.
   */
  const k = cvdMatrix('deuteranopia');
  const values =
    `${k[0]} ${k[1]} ${k[2]} 0 0  ${k[3]} ${k[4]} ${k[5]} 0 0  ` +
    `${k[6]} ${k[7]} ${k[8]} 0 0  0 0 0 1 0`;
  await page.evaluate((matrix: string) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.innerHTML =
      '<filter id="cvd-deut" color-interpolation-filters="linearRGB">' +
      `<feColorMatrix type="matrix" values="${matrix}"/></filter>`;
    document.body.append(svg);
    document.body.style.filter = 'url(#cvd-deut)';
  }, values);
  await page.waitForTimeout(160);
  await shootRow(page, dir, '13-deuteranopia-player-row', '#player-row');
  await shootRow(page, dir, '14-deuteranopia-enemy-row', '#enemy-row');
  await page.evaluate(() => {
    document.body.style.filter = '';
  });

  await page.setViewportSize({ width: 700, height: 760 });
  await page.waitForTimeout(160);
  await shotOf('10-floor-narrow', '#player-row .card', 2);
  await shotOf('11-floor-enemy', '#enemy-row .card');
  await shootRow(page, dir, '12-floor-player-row', '#player-row');
  await page.setViewportSize({ width: 1440, height: 900 });
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
    } else if (mode === 'hover') {
      await hover(page, seed, encounter, theme, args[4] === 'hatch');
    } else if (mode === 'narrow') {
      await narrow(page, seed, encounter, theme, args[4] === 'hatch');
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
