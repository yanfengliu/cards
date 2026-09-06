/**
 * Builds the HTML pages the probe screenshots.
 *
 * Every shot is one element carrying `data-shot="<name>"`; `shoot.ts` takes an
 * element screenshot of each, so a single-card shot is the card at its own
 * native pixel size plus a fixed margin of background. The margin is not
 * decoration -- how a card separates from the ground it sits on is one of the
 * things under test, and a shot cropped to the card's bounding box cannot show
 * it.
 */

import { renderCard, type CardView, type Tier } from '../../src/render/heraldry/card.ts';
import { parseBlazon, blazonWarnings } from '../../src/render/heraldry/blazon.ts';
import { TINCTURES, type Tincture, contrastRatio } from '../../src/render/heraldry/tinctures.ts';
import cardsFixture from '../../src/content/cards.fixture.json' with { type: 'json' };
import tribesFixture from '../../src/content/tribes.fixture.json' with { type: 'json' };

export const COMPRESSED_W = 70;
export const EXPANDED_W = 250;

export const BACKGROUNDS = {
  light: '#f1ede4',
  dark: '#15171c',
} as const;
export type BgName = keyof typeof BACKGROUNDS;

export const CARDS: readonly CardView[] = cardsFixture.cards as readonly CardView[];

export const PALETTES = tribesFixture.palettes as Record<
  string,
  Record<string, string>
>;

/** Rewrites a card's blazon from palette A onto another palette. */
export function repalette(card: CardView, palette: string): CardView {
  const a = PALETTES.A!;
  const target = PALETTES[palette];
  if (target === undefined) throw new Error(`Unknown palette ${JSON.stringify(palette)}.`);
  const from = a[card.tribe];
  const to = target[card.tribe];
  if (from === undefined || to === undefined) {
    throw new Error(
      `Tribe ${JSON.stringify(card.tribe)} is missing from palette ${JSON.stringify(palette)} or A.`,
    );
  }
  const clauses = card.blazon.split(',');
  clauses[0] = ` ${to}`.trimStart();
  return { ...card, blazon: clauses.join(',') };
}

interface Shot {
  readonly name: string;
  readonly html: string;
}

function shotEl(name: string, bg: BgName, pad: number, inner: string): Shot {
  return {
    name,
    html:
      `<div class="shot" data-shot="${name}" style="background:${BACKGROUNDS[bg]};padding:${pad}px">` +
      `<div class="row">${inner}</div></div>`,
  };
}

function card(
  c: CardView,
  tier: Tier,
  width: number,
  showCharge?: boolean,
  mount?: boolean,
): string {
  return renderCard(c, { tier, width, showCharge, label: true, mount });
}

/**
 * The same row with a pale mount around every card. Tests whether the sable
 * field's disappearance on a dark board is a palette problem or an outline
 * problem -- those have very different costs to fix.
 */
export function mountShots(): Shot[] {
  const line = [
    CARDS[1]!, CARDS[0]!, CARDS[2]!, CARDS[4]!, CARDS[6]!,
    CARDS[8]!, CARDS[3]!, CARDS[12]!, CARDS[9]!, CARDS[10]!,
    CARDS[7]!, CARDS[13]!, CARDS[14]!, CARDS[11]!, CARDS[15]!,
  ];
  const out: Shot[] = [];
  for (const bg of Object.keys(BACKGROUNDS) as BgName[]) {
    out.push(
      shotEl(
        `mountrow__15__${bg}`,
        bg,
        12,
        line.map((c) => card(c, 'compressed', COMPRESSED_W, true, true)).join(''),
      ),
    );
    for (const c of [CARDS[3]!, CARDS[15]!, CARDS[11]!]) {
      out.push(
        shotEl(
          `mount__${c.id}__${bg}`,
          bg,
          10,
          card(c, 'compressed', COMPRESSED_W, true, true),
        ),
      );
    }
  }
  return out;
}

/** Every single card, both tiers, both backgrounds. This is the per-item sweep. */
export function singleShots(): Shot[] {
  const out: Shot[] = [];
  for (const c of CARDS) {
    for (const bg of Object.keys(BACKGROUNDS) as BgName[]) {
      out.push(
        shotEl(`single__${c.id}__compressed__${bg}`, bg, 10, card(c, 'compressed', COMPRESSED_W, true)),
      );
      out.push(
        shotEl(
          `single__${c.id}__compressed-nocharge__${bg}`,
          bg,
          10,
          card(c, 'compressed', COMPRESSED_W, false),
        ),
      );
      out.push(
        shotEl(`single__${c.id}__expanded__${bg}`, bg, 14, card(c, 'expanded', EXPANDED_W)),
      );
    }
  }
  return out;
}

/** Every tribe pair, side by side at 70px. The collision check is per pair. */
export function pairShots(palette = 'A'): Shot[] {
  const tribes = ['dwarf', 'elf', 'human', 'dragon'] as const;
  const exemplar = new Map<string, CardView>();
  for (const t of tribes) {
    // Same charge and the same Guard state across the pair, so the only
    // variable in the shot is the field tincture.
    const base = CARDS.find((c) => c.tribe === t && !c.guard)!;
    exemplar.set(t, { ...base, power: 2, health: 3, blazon: base.blazon });
  }
  const out: Shot[] = [];
  for (let i = 0; i < tribes.length; i += 1) {
    for (let j = i + 1; j < tribes.length; j += 1) {
      const a = exemplar.get(tribes[i]!)!;
      const b = exemplar.get(tribes[j]!)!;
      for (const bg of Object.keys(BACKGROUNDS) as BgName[]) {
        const av = palette === 'A' ? a : repalette(a, palette);
        const bv = palette === 'A' ? b : repalette(b, palette);
        out.push(
          shotEl(
            `pair${palette}__${tribes[i]}-vs-${tribes[j]}__${bg}`,
            bg,
            10,
            card(av, 'compressed', COMPRESSED_W, true) + card(bv, 'compressed', COMPRESSED_W, true),
          ),
        );
      }
    }
  }
  return out;
}

/** A full board row at compressed size. Adjacency legibility is what this tests. */
export function rowShots(palette = 'A'): Shot[] {
  const line: CardView[] = [
    CARDS[1]!, CARDS[0]!, CARDS[2]!, CARDS[4]!, CARDS[6]!,
    CARDS[8]!, CARDS[3]!, CARDS[12]!, CARDS[9]!, CARDS[10]!,
    CARDS[7]!, CARDS[13]!, CARDS[14]!, CARDS[11]!, CARDS[15]!,
  ];
  const out: Shot[] = [];
  for (const n of [10, 15]) {
    for (const bg of Object.keys(BACKGROUNDS) as BgName[]) {
      const cards = line.slice(0, n).map((c) => (palette === 'A' ? c : repalette(c, palette)));
      out.push(
        shotEl(
          `row${palette}__${n}__${bg}`,
          bg,
          12,
          cards.map((c) => card(c, 'compressed', COMPRESSED_W, true)).join(''),
        ),
      );
    }
  }
  return out;
}

/** The same row with the charge suppressed, to test the spec's tier claim. */
export function rowNoChargeShots(): Shot[] {
  const line = [
    CARDS[1]!, CARDS[0]!, CARDS[2]!, CARDS[4]!, CARDS[6]!,
    CARDS[8]!, CARDS[3]!, CARDS[12]!, CARDS[9]!, CARDS[10]!,
    CARDS[7]!, CARDS[13]!, CARDS[14]!, CARDS[11]!, CARDS[15]!,
  ];
  const out: Shot[] = [];
  for (const bg of Object.keys(BACKGROUNDS) as BgName[]) {
    out.push(
      shotEl(
        `rownocharge__15__${bg}`,
        bg,
        12,
        line.map((c) => card(c, 'compressed', COMPRESSED_W, false)).join(''),
      ),
    );
  }
  return out;
}

/** Guard vs non-Guard of the same tribe, adjacent, at 70px. */
export function guardShots(): Shot[] {
  const out: Shot[] = [];
  const pairs: Array<[CardView, CardView]> = [
    [CARDS[4]!, CARDS[0]!],
    [CARDS[8]!, CARDS[5]!],
    [CARDS[2]!, CARDS[6]!],
    [CARDS[3]!, CARDS[7]!],
  ];
  for (const [plain, guard] of pairs) {
    for (const bg of Object.keys(BACKGROUNDS) as BgName[]) {
      out.push(
        shotEl(
          `guard__${plain.tribe}__${bg}`,
          bg,
          10,
          card(plain, 'compressed', COMPRESSED_W, true) + card(guard, 'compressed', COMPRESSED_W, true),
        ),
      );
    }
  }
  return out;
}

/** Widths below 70px, to find the floor if 70 works or the ceiling if it does not. */
export function widthLadderShots(): Shot[] {
  const out: Shot[] = [];
  const subjects = [CARDS[0]!, CARDS[1]!, CARDS[15]!];
  for (const w of [44, 54, 62, 70, 84, 100]) {
    for (const bg of Object.keys(BACKGROUNDS) as BgName[]) {
      out.push(
        shotEl(
          `ladder__${w}__${bg}`,
          bg,
          10,
          subjects.map((c) => card(c, 'compressed', w, true)).join(''),
        ),
      );
    }
  }
  return out;
}

export function allShots(): Shot[] {
  return [
    ...singleShots(),
    ...pairShots('A'),
    ...pairShots('B'),
    ...rowShots('A'),
    ...rowShots('B'),
    ...rowNoChargeShots(),
    ...mountShots(),
    ...guardShots(),
    ...widthLadderShots(),
  ];
}

export function buildPage(shots: readonly Shot[]): string {
  return (
    '<!doctype html><meta charset="utf-8"><title>heraldry probe</title>' +
    '<style>' +
    'html,body{margin:0;padding:0;background:#808080;font-family:system-ui,sans-serif}' +
    '.shot{display:block;width:max-content;line-height:0;margin:0 0 6px 0}' +
    '.row{display:flex;gap:6px;align-items:flex-start;line-height:0}' +
    'svg{display:block}' +
    '</style>' +
    shots.map((s) => s.html).join('\n')
  );
}

/** Numbers that back the visual verdict rather than replace it. */
export function contrastReport(palette = 'A'): string[] {
  const p = PALETTES[palette]!;
  const tribes = ['dwarf', 'elf', 'human', 'dragon'] as const;
  const lines: string[] = [];
  for (let i = 0; i < tribes.length; i += 1) {
    for (let j = i + 1; j < tribes.length; j += 1) {
      const ta = p[tribes[i]!] as Tincture;
      const tb = p[tribes[j]!] as Tincture;
      const ratio = contrastRatio(TINCTURES[ta].hex, TINCTURES[tb].hex);
      lines.push(
        `${tribes[i]} (${ta} ${TINCTURES[ta].hex}) vs ${tribes[j]} (${tb} ${TINCTURES[tb].hex}): luminance contrast ${ratio.toFixed(2)}:1`,
      );
    }
  }
  for (const bg of Object.keys(BACKGROUNDS) as BgName[]) {
    for (const t of tribes) {
      const tt = p[t] as Tincture;
      lines.push(
        `${t} (${tt}) on ${bg} background: ${contrastRatio(TINCTURES[tt].hex, BACKGROUNDS[bg]).toFixed(2)}:1`,
      );
    }
  }
  return lines;
}

/** Fixture self-check: does every card's blazon parse, and match its tribe's field? */
export function fixtureReport(): string[] {
  const lines: string[] = [];
  const a = PALETTES.A!;
  for (const c of CARDS) {
    const b = parseBlazon(c.blazon);
    if (b.field !== a[c.tribe]) {
      lines.push(
        `MISMATCH ${c.id}: tribe ${c.tribe} expects field ${a[c.tribe]}, blazon says ${b.field}`,
      );
    }
    if (c.guard && b.bordure === undefined) {
      lines.push(`MISMATCH ${c.id}: Guard with no bordure in its blazon`);
    }
    if (!c.guard && b.bordure !== undefined) {
      lines.push(`MISMATCH ${c.id}: non-Guard carrying a bordure`);
    }
    for (const w of blazonWarnings(b)) lines.push(`WARN ${c.id}: ${w}`);
  }
  if (lines.length === 0) lines.push('fixture clean: 16 cards, all blazons parse and agree with palette A');
  return lines;
}
