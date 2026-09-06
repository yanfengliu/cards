/**
 * Rasterises the probe pages to real PNGs, one per shot, at native pixel size.
 *
 * Two device scale factors, on purpose. A 70px card rendered at dsf 1 is 70
 * device pixels; on the machines this game will actually run on it is 140. If a
 * card fails at dsf 1 and passes at dsf 2 the finding is "the raster was too
 * coarse", not "the design fails", and those must not be confused.
 *
 * Uses the system Chrome via `channel`, because playwright-core's own Chromium
 * build is not in this machine's browser cache and downloading one is not worth
 * a probe.
 */

import { chromium, type Browser } from 'playwright-core';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { allShots, buildPage, contrastReport, fixtureReport } from './pages.ts';

const OUT = path.resolve(import.meta.dirname, '../../.probe');

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
  throw new Error(
    `No usable Chromium. Tried:\n  ${errors.join('\n  ')}\n` +
      'Install Chrome, or run `npx playwright install chromium` and drop the executablePath list.',
  );
}

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const fixture = fixtureReport();
  for (const line of fixture) console.log(`[fixture] ${line}`);
  console.log('');
  for (const p of ['A', 'B']) {
    console.log(`[contrast ${p}]`);
    for (const line of contrastReport(p)) console.log(`  ${line}`);
  }
  console.log('');

  const shots = allShots();
  const page = buildPage(shots);
  const pagePath = path.join(OUT, 'probe.html');
  await writeFile(pagePath, page, 'utf8');
  console.log(`[page] ${shots.length} shots -> ${pagePath}`);

  const browser = await launch();
  try {
    for (const dsf of [1, 2]) {
      const dir = path.join(OUT, `dsf${dsf}`);
      await mkdir(dir, { recursive: true });
      const ctx = await browser.newContext({
        deviceScaleFactor: dsf,
        viewport: { width: 1600, height: 900 },
      });
      const p = await ctx.newPage();
      await p.goto(`file://${pagePath.replace(/\\/g, '/')}`);
      await p.evaluate(() => document.fonts.ready);

      for (const shot of shots) {
        const el = p.locator(`[data-shot="${shot.name}"]`);
        await el.screenshot({ path: path.join(dir, `${shot.name}.png`) });
      }
      await ctx.close();
      console.log(`[shot] dsf${dsf}: ${shots.length} PNGs -> ${dir}`);
    }
  } finally {
    await browser.close();
  }

  // Bind the review to the bytes: a manifest of sha256 per file, so a
  // regenerated set does not silently inherit a review of the old one.
  const manifest: Record<string, { bytes: number; sha256: string }> = {};
  for (const dsf of [1, 2]) {
    const dir = path.join(OUT, `dsf${dsf}`);
    for (const f of (await readdir(dir)).sort()) {
      const buf = await readFile(path.join(dir, f));
      manifest[`dsf${dsf}/${f}`] = {
        bytes: buf.byteLength,
        sha256: createHash('sha256').update(buf).digest('hex'),
      };
    }
  }
  await writeFile(
    path.join(OUT, 'manifest.json'),
    JSON.stringify({ generated: new Date().toISOString(), files: manifest }, null, 2),
    'utf8',
  );
  console.log(`[manifest] ${Object.keys(manifest).length} files digested`);
}

await main();
