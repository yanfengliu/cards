/**
 * Renders one card to an SVG string, in one of two tiers.
 *
 * The four channels under test, and where each lives in this file:
 *
 *   numerals  -> `numerals()`    corner discs, drawn last so nothing occludes them
 *   silhouette-> `outlinePath()`  shield + heavy bordure for a Guard, plain rect otherwise
 *   field     -> `fieldFill()`    one flat tincture, from the card's tribe
 *   charge    -> `chargeLayer()`  one flat silhouette from the library
 *
 * No engine import, no game logic: this takes a plain view model and returns a
 * string. It does not know what a turn is.
 */

import { type Blazon, parseBlazon } from './blazon.ts';
import { getCharge } from './charges.ts';
import { type Tincture, hatchOf, hexOf, luminance } from './tinctures.ts';

export type Tier = 'compressed' | 'expanded';

/** What the renderer needs about a card. Deliberately not a `GameState` unit. */
export interface CardView {
  readonly id: string;
  readonly name: string;
  readonly tribe: string;
  readonly power: number;
  readonly health: number;
  readonly guard: boolean;
  readonly trait?: string;
  /**
   * Energy cost and Armour. Optional because they are not drawn - they exist so
   * the card's `aria-label` can say everything the card says, and a caller with
   * only the four painted channels (the heraldry probe's fixture) still builds.
   */
  readonly cost?: number;
  readonly armour?: number;
  /** The blazon string that lives in the card's data. */
  readonly blazon: string;
}

export interface RenderOptions {
  readonly tier: Tier;
  /** Card slot width in CSS px. Height is derived. */
  readonly width: number;
  /**
   * Draw the charge in the compressed tier. The spec says the charge is an
   * expanded-tier channel; this flag exists so the claim can be tested rather
   * than assumed.
   */
  readonly showCharge?: boolean;
  /** Adds `role`/`aria-label` so the card is inspectable and not only visible. */
  readonly label?: boolean;
  /**
   * Draw a pale halo just outside the dark outline. A single dark outline is
   * invisible on a dark board, so a sable card loses its boundary entirely; a
   * dark line plus a pale halo gives every card an edge on any ground.
   */
  readonly mount?: boolean;
  /**
   * Rule the field with its Petra Sancta hatching, so the tribe channel is
   * readable without colour vision.
   *
   * Off by default, and that default is load-bearing: `test/golden/heraldry/`
   * holds seven renders whose sha256 digests are what work unit 2's review is
   * bound to, and a hatched field would strand that review rather than inherit
   * it. With the flag absent this function returns exactly the bytes it did
   * before hatching existed.
   */
  readonly hatch?: boolean;
}

export const ASPECT = 1.4; // height / width, 5:7

const INK = '#0d0d12'; // card outline and numeral-disc fill
const DISC_RING = '#efece4'; // hairline around the numeral discs
const NUMERAL = '#ffffff';
const MOUNT = '#9aa0ad'; // pale halo, mid-value so it shows on light and dark alike

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

let idCounter = 0;
const nextId = (): number => (idCounter += 1);

/**
 * The card silhouette in a 0..W x 0..H box, inset by `inset` on every side.
 * Guard: a heater shield -- square shoulders, straight flanks, a point at base.
 * Otherwise: a rounded rectangle.
 */
function outlinePath(guard: boolean, w: number, h: number, inset: number): string {
  const x0 = inset;
  const x1 = w - inset;
  const y0 = inset;
  const y1 = h - inset;

  if (!guard) {
    const r = w * 0.055;
    return (
      `M${r2(x0 + r)} ${r2(y0)} H${r2(x1 - r)} A${r2(r)} ${r2(r)} 0 0 1 ${r2(x1)} ${r2(y0 + r)}` +
      ` V${r2(y1 - r)} A${r2(r)} ${r2(r)} 0 0 1 ${r2(x1 - r)} ${r2(y1)}` +
      ` H${r2(x0 + r)} A${r2(r)} ${r2(r)} 0 0 1 ${r2(x0)} ${r2(y1 - r)}` +
      ` V${r2(y0 + r)} A${r2(r)} ${r2(r)} 0 0 1 ${r2(x0 + r)} ${r2(y0)} Z`
    );
  }

  const shoulder = y0 + (y1 - y0) * 0.5;
  const midX = w / 2;
  return (
    `M${r2(x0)} ${r2(y0)} H${r2(x1)} V${r2(shoulder)}` +
    ` C${r2(x1)} ${r2(y0 + (y1 - y0) * 0.79)} ${r2(x0 + (x1 - x0) * 0.74)} ${r2(y0 + (y1 - y0) * 0.945)} ${r2(midX)} ${r2(y1)}` +
    ` C${r2(x0 + (x1 - x0) * 0.26)} ${r2(y0 + (y1 - y0) * 0.945)} ${r2(x0)} ${r2(y0 + (y1 - y0) * 0.79)} ${r2(x0)} ${r2(shoulder)}` +
    ' Z'
  );
}

/** Half-width of the drawable field at a given y, as a fraction of w/2. */
function fieldHalfWidthFrac(guard: boolean, yFrac: number): number {
  if (!guard) return 1;
  if (yFrac <= 0.5) return 1;
  // Approximates the bezier flank well enough to keep text inside it.
  const t = (yFrac - 0.5) / 0.5;
  return Math.max(0, 1 - t * t * 0.98);
}

interface Geometry {
  readonly w: number;
  readonly h: number;
  readonly stroke: number;
  readonly bordure: number;
  readonly discR: number;
  readonly discY: number;
  readonly discXL: number;
  readonly discXR: number;
}

function geometry(width: number, guard: boolean): Geometry {
  const w = width;
  const h = width * ASPECT;
  return {
    w,
    h,
    stroke: Math.max(1, w * 0.03),
    bordure: guard ? w * 0.095 : 0,
    discR: w * 0.155,
    discY: h * 0.135,
    discXL: w * 0.195,
    discXR: w * 0.805,
  };
}

function numerals(g: Geometry, power: number, health: number): string {
  const fs = (n: number): number =>
    String(n).length >= 2 ? g.w * 0.185 : g.w * 0.245;
  const ring = Math.max(0.75, g.w * 0.018);
  const disc = (cx: number, value: number): string =>
    `<circle cx="${r2(cx)}" cy="${r2(g.discY)}" r="${r2(g.discR)}" fill="${INK}" stroke="${DISC_RING}" stroke-width="${r2(ring)}"/>` +
    `<text x="${r2(cx)}" y="${r2(g.discY)}" fill="${NUMERAL}" font-size="${r2(fs(value))}"` +
    ` text-anchor="middle" dominant-baseline="central"` +
    ` font-family="Arial Black, Arial, Helvetica, sans-serif" font-weight="900"` +
    ` letter-spacing="-0.02em">${value}</text>`;
  return disc(g.discXL, power) + disc(g.discXR, health);
}

function chargeLayer(
  b: Blazon,
  g: Geometry,
  guard: boolean,
  tier: Tier,
): string {
  if (b.charge === undefined) return '';
  const charge = getCharge(b.charge.id);

  // The charge sits in the field, clear of the numeral discs above it and of
  // the shield's taper below. Expanded gives it more room because the compressed
  // tier has to leave the numerals unambiguous.
  const topFrac = tier === 'compressed' ? 0.3 : 0.29;
  const botFrac = guard ? (tier === 'compressed' ? 0.8 : 0.66) : tier === 'compressed' ? 0.9 : 0.7;
  const padX = guard ? g.bordure + g.w * 0.09 : g.w * 0.13;

  const boxW = g.w - padX * 2;
  const boxH = (botFrac - topFrac) * g.h;
  const size = Math.min(boxW, boxH);
  const scale = size / 100;
  const tx = (g.w - size) / 2;
  const ty = topFrac * g.h + (boxH - size) / 2;

  return (
    `<g transform="translate(${r2(tx)} ${r2(ty)}) scale(${r2(scale)})">` +
    `<path d="${charge.d}" fill="${hexOf(b.charge.tincture)}" fill-rule="${charge.fillRule}"/>` +
    '</g>'
  );
}

/**
 * The field's Petra Sancta hatching, clipped to the silhouette.
 *
 * Drawn as explicit lines rather than an SVG `<pattern>` for two reasons. A
 * pattern needs an id, and several cards share one document, so ids are the
 * exact hazard `clipId` already exists to avoid; and a pattern's tile is in user
 * units, so the same declaration turns to mush at 44px and to stripes at 250px.
 * Spacing derived from the card's own width scales with it instead.
 *
 * The ink follows the field's luminance: black engraving lines are invisible on
 * sable, so a dark field is hatched pale. That is a departure from the printed
 * convention, which only ever had one ink, and it is the right one - the
 * convention's purpose is to be *seen*.
 */
function hatchLayer(field: Tincture, g: Geometry, clipId: string): string {
  const pattern = hatchOf(field);
  if (pattern === 'none') return '';

  const step = Math.max(3.4, g.w * 0.105);
  // Below the reviewed 44px floor a hairline at 42% opacity disappears into the
  // field, which would leave the hatching present in the DOM and absent to the
  // eye - the worst of both. Small cards get a heavier, more opaque rule.
  const small = g.w < 56;
  const stroke = Math.max(small ? 1 : 0.7, g.w * (small ? 0.022 : 0.016));
  const pale = luminance(hexOf(field)) < 0.16;
  const ink = pale ? '#f2efe6' : '#12131a';
  const alpha = pale ? (small ? 0.62 : 0.5) : small ? 0.58 : 0.42;

  const lines: string[] = [];
  const vertical = (): void => {
    for (let x = step; x < g.w; x += step) lines.push(`M${r2(x)} 0 V${r2(g.h)}`);
  };
  const horizontal = (): void => {
    for (let y = step; y < g.h; y += step) lines.push(`M0 ${r2(y)} H${r2(g.w)}`);
  };
  // Slope 1 and slope -1, swept far enough left and right that the whole box is
  // crossed rather than only the middle of it.
  const diagonalDown = (): void => {
    for (let c = -g.h; c < g.w; c += step) lines.push(`M${r2(c)} 0 L${r2(c + g.h)} ${r2(g.h)}`);
  };
  const diagonalUp = (): void => {
    for (let c = 0; c < g.w + g.h; c += step) lines.push(`M${r2(c)} 0 L${r2(c - g.h)} ${r2(g.h)}`);
  };

  switch (pattern) {
    case 'vertical':
      vertical();
      break;
    case 'horizontal':
      horizontal();
      break;
    case 'diagonal-down':
      diagonalDown();
      break;
    case 'diagonal-up':
      diagonalUp();
      break;
    case 'cross':
      vertical();
      horizontal();
      break;
    case 'diagonal-up-horizontal':
      diagonalUp();
      horizontal();
      break;
    case 'dots': {
      // Staggered rows, so the dots read as a texture rather than as a grid that
      // could be mistaken for a cross-hatch at small size.
      const dot = Math.max(0.6, step * 0.17);
      const cells: string[] = [];
      let row = 0;
      for (let y = step * 0.6; y < g.h; y += step, row++) {
        for (let x = (row % 2 === 0 ? step * 0.5 : step); x < g.w; x += step) {
          cells.push(
            `M${r2(x)} ${r2(y)} m${r2(-dot)} 0 a${r2(dot)} ${r2(dot)} 0 1 0 ${r2(dot * 2)} 0` +
              ` a${r2(dot)} ${r2(dot)} 0 1 0 ${r2(-dot * 2)} 0 Z`,
          );
        }
      }
      return (
        `<path d="${cells.join(' ')}" fill="${ink}" fill-opacity="${alpha}"` +
        ` clip-path="url(#${clipId})"/>`
      );
    }
  }

  return (
    `<path d="${lines.join(' ')}" fill="none" stroke="${ink}" stroke-opacity="${alpha}"` +
    ` stroke-width="${r2(stroke)}" clip-path="url(#${clipId})"/>`
  );
}

function expandedText(card: CardView, b: Blazon, g: Geometry, clipId: string): string {
  const guard = card.guard;
  const lines: Array<{ text: string; size: number; fill: string; weight: number }> = [
    { text: card.name, size: g.w * 0.082, fill: '#ffffff', weight: 800 },
    {
      text: `${card.tribe}${card.trait ? ` · ${card.trait}` : ''}`,
      size: g.w * 0.058,
      fill: '#e6e2d8',
      weight: 600,
    },
    { text: b.source, size: g.w * 0.05, fill: '#c9c3b4', weight: 400 },
  ];

  const startFrac = guard ? 0.7 : 0.74;
  const step = g.w * 0.085;
  let out = '';

  // A dark plate behind the text, clipped to the card, so text never sits
  // directly on a field tincture it might not contrast with.
  const plateTop = startFrac * g.h - g.w * 0.075;
  out +=
    `<rect x="0" y="${r2(plateTop)}" width="${r2(g.w)}" height="${r2(g.h - plateTop)}"` +
    ` fill="#12131a" fill-opacity="0.9" clip-path="url(#${clipId})"/>` +
    // A hairline on the plate's top edge, because on a sable field the plate
    // and the field are the same value and the plate otherwise has no edge.
    `<rect x="0" y="${r2(plateTop)}" width="${r2(g.w)}" height="${r2(Math.max(1, g.w * 0.008))}"` +
    ` fill="#d9a520" fill-opacity="0.75" clip-path="url(#${clipId})"/>`;

  lines.forEach((ln, i) => {
    const y = startFrac * g.h + i * step;
    const halfFrac = fieldHalfWidthFrac(guard, y / g.h);
    const avail = g.w * halfFrac - (guard ? g.bordure * 1.6 : g.w * 0.08) * 1;
    // Rough advance width for a bold sans; shrink rather than overflow.
    const est = ln.text.length * ln.size * 0.52;
    const size = est > avail ? Math.max(ln.size * 0.6, (avail / est) * ln.size) : ln.size;
    out +=
      `<text x="${r2(g.w / 2)}" y="${r2(y)}" fill="${ln.fill}" font-size="${r2(size)}"` +
      ` text-anchor="middle" dominant-baseline="central"` +
      ` font-family="Segoe UI, system-ui, Helvetica, Arial, sans-serif" font-weight="${ln.weight}">` +
      `${esc(ln.text)}</text>`;
  });

  return out;
}

export function renderCard(card: CardView, opts: RenderOptions): string {
  const b = parseBlazon(card.blazon);
  const g = geometry(opts.width, card.guard);
  // The mount is drawn outside the silhouette, so the silhouette has to be
  // inset far enough for it to fit inside the SVG viewport -- otherwise the
  // halo is clipped away and only shows at the corners.
  const inset = opts.mount === true ? g.stroke * 1.75 : g.stroke / 2;
  const path = outlinePath(card.guard, g.w, g.h, inset);
  const showCharge = opts.showCharge ?? opts.tier === 'expanded';

  // Ids must be unique per SVG: several cards share one HTML document, and a
  // duplicate id makes every later card clip to the first card's silhouette.
  const clipId = `clip-${nextId()}`;
  let body = `<defs><clipPath id="${clipId}"><path d="${path}"/></clipPath></defs>`;

  // 0. Mount: a pale halo outside the outline, drawn first so the field and the
  //    dark outline cover its inner half and only the outer half shows.
  if (opts.mount === true) {
    body +=
      `<path d="${path}" fill="none" stroke="${MOUNT}"` +
      ` stroke-width="${r2(g.stroke * 3.2)}" stroke-linejoin="round"/>`;
  }

  // 1. Field.
  body += `<path d="${path}" fill="${hexOf(b.field)}"/>`;

  // 1b. The field's hatching, over the flat tincture and under everything else,
  //     so the charge and the numerals stay unruled. Off unless asked for.
  if (opts.hatch === true) body += hatchLayer(b.field, g, clipId);

  // 2. Bordure -- an inner band of exactly `bordure` px, made by stroking the
  //    silhouette at double width and clipping to it. Exact, unlike scaling.
  if (card.guard && b.bordure !== undefined) {
    body +=
      `<path d="${path}" fill="none" stroke="${hexOf(b.bordure)}"` +
      ` stroke-width="${r2(g.bordure * 2)}" clip-path="url(#${clipId})"/>`;
  }

  // 3. Charge.
  if (showCharge) body += chargeLayer(b, g, card.guard, opts.tier);

  // 4. Expanded-tier text.
  if (opts.tier === 'expanded') body += expandedText(card, b, g, clipId);

  // 5. Outline, over everything so the bordure cannot bleed past the edge.
  body +=
    `<path d="${path}" fill="none" stroke="${INK}" stroke-width="${r2(g.stroke)}"` +
    ` stroke-linejoin="round"/>`;

  // 6. Numerals last: nothing may occlude them.
  body += numerals(g, card.power, card.health);

  /*
   * The accessible name says everything the picture says, in the order the eye
   * reads it: what it is, what race, what it costs, the two numerals, then the
   * channels that are drawn as shape or colour rather than as text. Cost,
   * Armour and the trait list are the parts a sighted player gets from the
   * trait strip and the hover panel; without them here the card is a picture
   * with three of its channels missing.
   */
  const a11y = opts.label
    ? ` role="img" aria-label="${esc(
        [
          card.name,
          card.tribe,
          ...(card.cost === undefined ? [] : [`costs ${card.cost} energy`]),
          `${card.power} power`,
          `${card.health} health`,
          ...(card.armour !== undefined && card.armour > 0 ? [`${card.armour} armour`] : []),
          // `trait` is the whole trait list when the caller passes one, Guard
          // included, so the Guard flag only speaks for itself when it must.
          ...(card.guard && !/guard/i.test(card.trait ?? '') ? ['Guard'] : []),
          ...(card.trait === undefined ? [] : [card.trait]),
        ].join(', '),
      )}"`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(g.w)}" height="${r2(g.h)}"` +
    ` viewBox="0 0 ${r2(g.w)} ${r2(g.h)}"${a11y}>${body}</svg>`
  );
}
