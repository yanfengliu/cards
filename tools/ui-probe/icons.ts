/**
 * The icon sheet, at the sizes the icons are actually drawn at.
 *
 * Canon: "an aggregate view answers 'is there one of each' and never 'is each
 * one right'". So this is not a proof sheet. Each icon is emitted three times -
 * 11px, which is the trait strip under a compressed card; 15px, which is a rule
 * line in the hover panel; and 64px, which is the only way a human can tell
 * whether the 11px one is a hammer or a smudge - and each row is labelled with
 * the meaning and the shape the icon claims to be, so a review can say "the
 * anvil does not read as an anvil" rather than "they look fine".
 *
 * Written as a standalone HTML file rather than served, because the icons are
 * strings and depend on nothing else in the app.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ICON_NAMES, iconShape, iconSvg } from '../../src/render/icons.ts';
import { launch } from './chrome.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, '.probe-ui');

const rows = ICON_NAMES.map(
  (name) =>
    `<tr><th>${name}</th>` +
    `<td class="s">${iconSvg(name, { size: 11, decorative: true })}</td>` +
    `<td class="s">${iconSvg(name, { size: 15, decorative: true })}</td>` +
    `<td class="s">${iconSvg(name, { size: 64, decorative: true })}</td>` +
    `<td class="w">${iconShape(name)}</td></tr>`,
).join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>icons</title><style>
  body { margin: 0; padding: 16px; font: 13px 'Segoe UI', system-ui, sans-serif;
         background: #f1ede4; color: #17181d; }
  body.dark { background: #15171c; color: #eef0f4; }
  table { border-collapse: collapse; }
  th, td { padding: 6px 12px; border-bottom: 1px solid rgba(128,128,128,0.35); }
  th { text-align: left; font-family: ui-monospace, Consolas, monospace; font-weight: 700; }
  td.s { vertical-align: middle; color: #8a6707; }
  body.dark td.s { color: #d9a520; }
  td.w { color: #55585f; }
  body.dark td.w { color: #a9aeb9; }
  svg { display: block; }
</style></head><body>
<table><thead><tr><th>meaning</th><th>11px</th><th>15px</th><th>64px</th><th>claims to be</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;

await mkdir(OUT, { recursive: true });
const file = path.join(OUT, 'icons.html');
await writeFile(file, html, 'utf8');

/*
 * One shot per icon, not one sheet of nineteen.
 *
 * Canon: an aggregate view answers "is there one of each" and never "is each
 * one right", and it answers the first just as confidently when the second
 * answer is no. A sheet of nineteen crisp gold marks looks like a set whether
 * or not the anvil reads as a table - which is exactly what the first pass of
 * these did.
 */
const dir = path.join(OUT, 'icons');
await mkdir(dir, { recursive: true });
const browser = await launch();
try {
  for (const theme of ['light', 'dark'] as const) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(file).href);
    if (theme === 'dark') await page.evaluate(() => document.body.classList.add('dark'));
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const name = ICON_NAMES[i] ?? String(i);
      await rows.nth(i).screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
    }
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(
  `[icons] ${ICON_NAMES.length} icons written to ${path.relative(ROOT, file)} ` +
    `and shot individually into ${path.relative(ROOT, dir)}`,
);
