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

interface TinctureDef {
  readonly hex: string;
  readonly kind: TinctureClass;
}

export const TINCTURES: Readonly<Record<Tincture, TinctureDef>> = {
  or: { hex: '#d9a520', kind: 'metal' },
  argent: { hex: '#e8e6df', kind: 'metal' },
  gules: { hex: '#a3202a', kind: 'colour' },
  azure: { hex: '#26508f', kind: 'colour' },
  vert: { hex: '#2f6b3c', kind: 'colour' },
  sable: { hex: '#26262b', kind: 'colour' },
  purpure: { hex: '#6b2d6b', kind: 'colour' },
  tenne: { hex: '#a1592a', kind: 'colour' },
};

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
