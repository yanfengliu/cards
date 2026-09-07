/**
 * Heraldic tinctures.
 *
 * Real heraldry splits tinctures into metals (or, argent) and colours (gules,
 * azure, vert, sable, purpure, tenne). The rule of tincture -- never colour on
 * colour, never metal on metal -- exists for exactly the reason this probe
 * exists: contrast at distance. We keep the vocabulary so the blazon reads like
 * a blazon, and we keep the rule as an advisory check rather than a hard error,
 * because the probe needs to be able to render a violation to show what it
 * costs.
 */

export type Tincture =
  | 'or'
  | 'argent'
  | 'gules'
  | 'azure'
  | 'vert'
  | 'sable'
  | 'purpure'
  | 'tenne';

export type TinctureClass = 'metal' | 'colour';

/**
 * Petra Sancta hatching: the printer's convention, in use since 1638, for
 * writing a tincture down when the colour cannot be shown.
 *
 * It is here rather than in a UI file because it is part of what a tincture
 * *is*, exactly as its hex is. Its modern use is the one it was invented for:
 * the board distinguishes tribes by field colour alone, gules and vert sit side
 * by side on the player's line, and roughly one man in twelve cannot separate
 * red from green. Hatching gives that player the same channel in shape.
 */
export type HatchPattern =
  | 'none'
  | 'vertical'
  | 'horizontal'
  | 'diagonal-down'
  | 'diagonal-up'
  | 'cross'
  | 'diagonal-up-horizontal'
  | 'dots';

interface TinctureDef {
  readonly hex: string;
  readonly kind: TinctureClass;
  readonly hatch: HatchPattern;
}

export const TINCTURES: Readonly<Record<Tincture, TinctureDef>> = {
  or: { hex: '#d9a520', kind: 'metal', hatch: 'dots' },
  // Argent is left plain by the convention, which is why it is the one tincture
  // that hatching cannot help with. No tribe uses it as a field.
  argent: { hex: '#e8e6df', kind: 'metal', hatch: 'none' },
  gules: { hex: '#a3202a', kind: 'colour', hatch: 'vertical' },
  azure: { hex: '#26508f', kind: 'colour', hatch: 'horizontal' },
  vert: { hex: '#2f6b3c', kind: 'colour', hatch: 'diagonal-down' },
  sable: { hex: '#26262b', kind: 'colour', hatch: 'cross' },
  purpure: { hex: '#6b2d6b', kind: 'colour', hatch: 'diagonal-up' },
  tenne: { hex: '#a1592a', kind: 'colour', hatch: 'diagonal-up-horizontal' },
};

export function hatchOf(t: Tincture): HatchPattern {
  return TINCTURES[t].hatch;
}

export function isTincture(value: string): value is Tincture {
  return Object.hasOwn(TINCTURES, value);
}

export function hexOf(t: Tincture): string {
  return TINCTURES[t].hex;
}

/** True when placing `on` over `under` breaks the rule of tincture. */
export function violatesRuleOfTincture(under: Tincture, on: Tincture): boolean {
  return TINCTURES[under].kind === TINCTURES[on].kind;
}

/** Relative luminance, sRGB, WCAG definition. Used only for contrast reporting. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG contrast ratio between two hex colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A colour as a viewer with the named colour-vision deficiency sees it.
 *
 * An LMS projection: convert to linear RGB, into cone response, collapse the
 * missing cone onto the plane the remaining two span, and come back. It is a
 * simulation and not an experience, so it is used the only way a simulation can
 * honestly be used - to *fail* a design, never to pass one. Two fields whose
 * simulated colours land on top of each other are certainly indistinguishable;
 * two that come out far apart still have to be looked at.
 */
export type ColourVision = 'protanopia' | 'deuteranopia' | 'tritanopia';

function toLinear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function toByte(v: number): string {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255).toString(16).padStart(2, '0');
}

/** Hunt-Pointer-Estevez cone fundamentals, normalised to D65. */
const RGB_TO_LMS: readonly number[] = [
  0.31399022, 0.63951294, 0.04649755, 0.15537241, 0.75789446, 0.0867014, 0.01775239, 0.10944209,
  0.87256922,
];
const LMS_TO_RGB: readonly number[] = [
  5.47221206, -4.6419601, 0.16963708, -1.1252419, 2.29317094, -0.1678952, 0.02980165, -0.19318073,
  1.16364789,
];

/** Collapse the missing cone onto the plane the other two span. */
function projection(kind: ColourVision): readonly number[] {
  if (kind === 'protanopia') return [0, 1.05118294, -0.05116099, 0, 1, 0, 0, 0, 1];
  if (kind === 'deuteranopia') return [1, 0, 0, 0.9513092, 0, 0.04866992, 0, 0, 1];
  return [1, 0, 0, 0, 1, 0, -0.86744736, 1.86727089, 0];
}

function mul(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
    }
  }
  return out;
}

/**
 * The whole simulation as one 3x3 matrix over **linear** RGB, row-major.
 *
 * Exported so a screenshot and a test can measure the same thing. The probe that
 * photographs the board through a deuteranopia filter feeds these nine numbers
 * to `feColorMatrix` with `color-interpolation-filters="linearRGB"`, which is
 * the same arithmetic `simulate` does - so the picture a reviewer looks at and
 * the number a gate asserts on cannot disagree. Feeding the filter a different
 * approximation was the first version of this, and it made the two arms of the
 * comparison differ by more than the variable under test.
 */
export function cvdMatrix(kind: ColourVision): number[] {
  return mul(LMS_TO_RGB, mul(projection(kind), RGB_TO_LMS));
}

export function simulate(hex: string, kind: ColourVision): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = toLinear((n >> 16) & 255);
  const g = toLinear((n >> 8) & 255);
  const b = toLinear(n & 255);
  const k = cvdMatrix(kind);
  return (
    `#${toByte(k[0]! * r + k[1]! * g + k[2]! * b)}` +
    `${toByte(k[3]! * r + k[4]! * g + k[5]! * b)}` +
    `${toByte(k[6]! * r + k[7]! * g + k[8]! * b)}`
  );
}

/** Euclidean distance between two hex colours in sRGB bytes, 0..441. */
export function colourDistance(a: string, b: string): number {
  const na = Number.parseInt(a.slice(1), 16);
  const nb = Number.parseInt(b.slice(1), 16);
  const dr = ((na >> 16) & 255) - ((nb >> 16) & 255);
  const dg = ((na >> 8) & 255) - ((nb >> 8) & 255);
  const db = (na & 255) - (nb & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
