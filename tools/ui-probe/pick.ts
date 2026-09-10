/**
 * The class pick, photographed and driven through its own controls.
 *
 * This screen is the first thing a run shows and nothing had ever looked at it.
 * `test/classes.test.ts` reads the HTML the app builds; HTML is not pixels, and
 * fleet canon asks that visual work be verified visually.
 *
 * Two rules from `run.ts` hold here as well:
 *
 *   Every decision is a real control. The class is chosen by clicking the
 *   button on the card, not by setting state or by loading `?class=`, because a
 *   harness that skips the input path is blind to every defect living in it.
 *
 *   A review binds to bytes. Shots go to `.probe-ui/pick-<seed>-<theme>/` with a
 *   sha256 manifest, and each class card is shot AT ITS OWN NATIVE SIZE as well
 *   as in the whole screen: a three-card contact sheet answers "is there one of
 *   each" and never "is each one right".
 *
 * What it asserts as it goes, so a shot nobody reads still fails loudly:
 *   - three cards, in the order the game lists its classes, each naming its
 *     class, its Health, its deck size and its pool size
 *   - a class the game does not have (`?class=bard`) leaves the pick screen up
 *     rather than starting a run as something else
 *   - clicking a class starts a run as that class: the HUD says so, the map
 *     appears, and the address bar carries the class
 *
 *   node tools/ui-probe/pick.ts <seed> <light|dark>
 *   node tools/ui-probe/pick.ts <seed> both
 */

import { type Page } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './chrome.ts';
import { CLASSES } from '../../src/content/classes.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, '.probe-ui');
const BASE = process.env['CARDS_URL'] ?? 'http://127.0.0.1:5175/src/ui/index.html';

async function settle(page: Page): Promise<void> {
  // The pointer is parked off the cards first: a hover ring left over from the
  // previous navigation lands in the bytes, and a review that binds to a digest
  // has to be able to reproduce them.
  await page.mouse.move(2, 2);
  // A screen fades in over 240ms (`screen-in` in app.css); a shot taken during
  // it is a picture of the fade.
  await page.waitForTimeout(320);
}

/**
 * Pick a class, walk to the first fight on the map, and photograph the intent
 * lines - the pre-commit odds.
 *
 * This is here rather than in `play.ts` because the odds are the one thing on
 * the fight screen a class changes: a Volley hero throws more attacks than it
 * has bodies, and a Scorch hero deals damage no target roll can miss. Both were
 * invisible until this unit, and a number that is only checked in a unit test
 * is a number nobody has read on screen.
 */
async function shootFightAs(page: Page, seed: number, theme: string, classId: string, dir: string): Promise<void> {
  await page.goto(`${BASE}?seed=${seed}&theme=${theme}&fresh=1`);
  await page.waitForSelector('[data-class-card]');
  await page.locator(`[data-run="pick-class"][data-class="${classId}"]`).click();
  await page.waitForSelector('#run-map svg');
  const node = page.locator('#run-map [data-node].is-reachable').first();
  await node.click();
  await page.waitForSelector('#commit:not(:disabled)');
  await settle(page);
  const said = await page.evaluate(() => ({
    yours: document.getElementById('player-intent')?.textContent ?? '',
    theirs: document.getElementById('enemy-intent')?.textContent ?? '',
  }));
  console.log(`[pick] seed ${seed} ${theme} ${classId} at its first fight:`);
  console.log(`   yours:  ${said.yours}`);
  console.log(`   theirs: ${said.theirs}`);
  if (said.yours.trim() === '') throw new Error(`${classId}: the fight screen shows no player intent at all`);
  await page.screenshot({ path: path.join(dir, `fight-${classId}-odds.png`), fullPage: true });

  if (classId === 'knight') return;

  // The two class heroes are then played to the end of the fight, by pressing
  // commit, for two things a still of round one cannot show:
  //
  //   The Mage's opening board is one armoured Goblin, so the honest line there
  //   is "stopped by Armour"; the other line needs a wider enemy line.
  //   The Ranger's second swing is what emitted "has no legal target - the
  //   attack fizzles" under the death that had just won the fight. The log at
  //   the banner is where that was read, so that is what is photographed.
  let burnShot = false;
  for (let round = 1; round <= 20; round++) {
    if (await page.locator('.banner').count() > 0) break;
    // Play whatever the energy affords, append-right, through the same two
    // clicks a person makes: the hand card, then the gap at the end of the
    // line. `.handcard:not([disabled])` is the page's own affordability rule -
    // `renderHand` disables what the energy cannot pay for - so nothing here
    // re-implements it.
    for (let card = 0; card < 6; card++) {
      const playable = page.locator('.handcard:not([disabled])');
      if (await playable.count() === 0) break;
      await playable.first().click();
      const slots = page.locator('#player-row .slot');
      const n = await slots.count();
      if (n === 0) break;
      await slots.nth(n - 1).click();
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
    if (await page.locator('.banner').count() > 0) break;
    await settle(page);
    const now = await page.evaluate(() => document.getElementById('player-intent')?.textContent ?? '');
    console.log(`   round ${round + 1}: ${now}`);
    if (!burnShot && now.includes('Scorch burns')) {
      burnShot = true;
      await page.screenshot({ path: path.join(dir, 'fight-mage-burn-counted.png'), fullPage: true });
    }
  }
  if (await page.locator('.banner').count() === 0) {
    console.warn(`[pick] seed ${seed} ${theme} ${classId}: the fight did not finish inside 20 commits`);
    return;
  }
  await settle(page);
  const tail = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('#log .logline, #log p, #log div'))
      .map((el) => el.textContent?.trim() ?? '')
      .filter((s) => s !== '');
    return { banner: document.querySelector('.banner')?.textContent?.trim() ?? '', tail: lines.slice(-6) };
  });
  console.log(`   banner: ${tail.banner}`);
  for (const line of tail.tail) console.log(`   log: ${line}`);
  await page.screenshot({ path: path.join(dir, `fight-${classId}-over.png`), fullPage: true });
}

/** What the pick screen says about itself, read out of the page. */
async function readPick(page: Page): Promise<{
  title: string;
  subtitle: string;
  cards: { id: string; name: string; hero: string; deck: string; pool: string; button: string }[];
}> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-class-card]')).map((el) => {
      const q = (sel: string): string => el.querySelector(sel)?.textContent?.trim() ?? '';
      return {
        id: el.getAttribute('data-class-card') ?? '',
        name: q('.classcard__name'),
        hero: q('.classcard__hero'),
        deck: Array.from(el.querySelectorAll('.run__h'))[0]?.textContent?.trim() ?? '',
        pool: Array.from(el.querySelectorAll('.run__h'))[1]?.textContent?.trim() ?? '',
        button: q('[data-run="pick-class"]'),
      };
    });
    return {
      title: document.querySelector('#run-node .run__title')?.textContent?.trim() ?? '',
      subtitle: document.getElementById('subtitle')?.textContent ?? '',
      cards,
    };
  });
}

async function shootPick(page: Page, seed: number, theme: string): Promise<void> {
  const dir = path.join(OUT, `pick-${seed}-${theme}`);
  await mkdir(dir, { recursive: true });

  await page.goto(`${BASE}?seed=${seed}&theme=${theme}&fresh=1`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-class-card]');
  await settle(page);

  const seen = await readPick(page);
  const ids = seen.cards.map((c) => c.id);
  const want = CLASSES.map((c) => c.id);
  if (ids.join(',') !== want.join(',')) {
    throw new Error(`the pick screen shows [${ids.join(',')}] and the game has [${want.join(',')}]`);
  }
  for (const cls of CLASSES) {
    const card = seen.cards.find((c) => c.id === cls.id)!;
    const must: [string, string][] = [
      ['name', cls.name],
      ['hero bar', `${cls.hero.health} Health`],
      ['deck size', `Starts with ${cls.startingDeck.length} cards`],
      ['pool size', `Drafts from ${cls.rewards.length} cards`],
      ['button', `Play the ${cls.name}`],
    ];
    const all = `${card.name}|${card.hero}|${card.deck}|${card.pool}|${card.button}`;
    for (const [what, text] of must) {
      if (!all.includes(text)) {
        throw new Error(`the ${cls.name}'s card does not carry its ${what} ("${text}"): ${all}`);
      }
    }
  }
  console.log(`[pick] seed ${seed} ${theme}: "${seen.title}" - ${seen.subtitle}`);
  for (const c of seen.cards) console.log(`   ${c.id}: ${c.hero} - ${c.button}`);

  // The whole screen, then every card on its own at its own size. The second
  // is the one that answers "is each one right".
  await page.screenshot({ path: path.join(dir, 'screen.png'), fullPage: true });
  for (const cls of CLASSES) {
    const card = page.locator(`[data-class-card="${cls.id}"]`);
    const box = await card.boundingBox();
    await card.screenshot({ path: path.join(dir, `card-${cls.id}.png`) });
    console.log(`   ${cls.id} card at ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)} native px`);
  }

  // A class the game does not have: the pick screen stays up. This is the DOM
  // half of `pickableClassId`, which `test/classes.test.ts` gates headlessly.
  await page.goto(`${BASE}?seed=${seed}&theme=${theme}&fresh=1&class=bard`);
  await page.waitForSelector('[data-class-card]');
  await settle(page);
  const refused = await readPick(page);
  if (refused.cards.length !== CLASSES.length) {
    throw new Error(`?class=bard did not leave the pick screen up: ${refused.title}`);
  }
  await page.screenshot({ path: path.join(dir, 'refused-unknown-class.png'), fullPage: true });

  // The real control: click a class and check the run that starts is that one.
  // The Ranger, because a Volley hero is what the fight screen has never been
  // photographed with.
  await page.goto(`${BASE}?seed=${seed}&theme=${theme}&fresh=1`);
  await page.waitForSelector('[data-class-card]');
  await page.locator('[data-run="pick-class"][data-class="ranger"]').click();
  await page.waitForSelector('#run-map svg');
  await settle(page);
  const after = await page.evaluate(() => ({
    subtitle: document.getElementById('subtitle')?.textContent ?? '',
    hud: document.getElementById('run-status')?.textContent ?? '',
    url: globalThis.location.search,
    cards: document.querySelectorAll('[data-class-card]').length,
  }));
  if (after.cards !== 0) throw new Error('the pick screen is still up after a class was clicked');
  if (!after.url.includes('class=ranger')) {
    throw new Error(`the address bar does not carry the class after the pick: ${after.url}`);
  }
  if (!/Ranger/i.test(after.subtitle + after.hud)) {
    throw new Error(`the run does not say it is a Ranger: "${after.subtitle}" / "${after.hud}"`);
  }
  console.log(`[pick] seed ${seed} ${theme}: clicked Ranger -> ${after.subtitle} (${after.url})`);
  await page.screenshot({ path: path.join(dir, 'after-pick-ranger-map.png'), fullPage: true });

  // And what each class's first fight says it is about to do.
  for (const cls of CLASSES) await shootFightAs(page, seed, theme, cls.id, dir);
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
  const seed = Number.parseInt(args[0] ?? '7', 10);
  const asked = args[1] ?? 'both';
  const themes = asked === 'both' ? ['light', 'dark'] : [asked];
  await mkdir(OUT, { recursive: true });
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.error(`[page error] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.error(`[page crash] ${e.message}`));
    for (const theme of themes) await shootPick(page, seed, theme);
    await ctx.close();
  } finally {
    await browser.close();
  }
  console.log(`[manifest] ${await manifest()} shots digested into ${path.relative(ROOT, OUT)}`);
}

await main();
