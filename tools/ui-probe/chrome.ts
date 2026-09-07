/**
 * Finding a browser to shoot with.
 *
 * Shared by `play.ts` and `icons.ts` so the two cannot drift into disagreeing
 * about which Chrome they photographed with - a screenshot review is bound to
 * the bytes, and two different renderers produce two different sets of bytes.
 */

import { chromium, type Browser } from 'playwright-core';
import { stat } from 'node:fs/promises';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

export async function launch(): Promise<Browser> {
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
