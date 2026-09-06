/**
 * The charge library.
 *
 * Every charge is a flat silhouette in a 0..100 box, drawn as one `d` string.
 * Flat and single-tincture is not a simplification of heraldry, it *is*
 * heraldry: a charge is defined by its outline, which is why the idiom survives
 * being shrunk. Where a charge needs an internal void (an eye, a crescent's
 * bite) the void is a subpath and the fill rule is evenodd, so the field shows
 * through rather than a second colour being introduced.
 *
 * Eight charges, chosen for silhouette spread rather than for coverage: one
 * top-heavy vertical, one pointed organic, one blocky, one irregular organic,
 * one thin vertical, one open curve, one radial, one wide horizontal. If the
 * idiom works, it works across that spread; if it fails, it should fail on the
 * ones that are least distinct in outline.
 */

export type ChargeId =
  | 'hammer'
  | 'leaf'
  | 'tower'
  | 'wyvern'
  | 'sword'
  | 'crescent'
  | 'mullet'
  | 'eagle';

export interface Charge {
  readonly id: ChargeId;
  /** Blazon-ish name, used in the rendered card text. */
  readonly name: string;
  /** Path data in a 0..100 x 0..100 box. */
  readonly d: string;
  readonly fillRule: 'nonzero' | 'evenodd';
}

const defs: readonly Charge[] = [
  {
    id: 'hammer',
    name: 'a hammer',
    fillRule: 'nonzero',
    // Top-heavy vertical: a hexagonal head over a stout haft.
    d: 'M20 14 L80 14 L88 34 L80 54 L20 54 L12 34 Z M42 54 L58 54 L58 96 L42 96 Z',
  },
  {
    id: 'leaf',
    name: 'a leaf',
    fillRule: 'nonzero',
    // Pointed organic: a pointed blade on a short stem.
    d: 'M50 4 C74 24 84 50 72 72 C65 84 57 90 50 93 C43 90 35 84 28 72 C16 50 26 24 50 4 Z M45 84 L55 84 L55 99 L45 99 Z',
  },
  {
    id: 'tower',
    name: 'a tower',
    fillRule: 'nonzero',
    // Blocky: crenellated cap over a narrower shaft.
    d: 'M12 10 L28 10 L28 24 L42 24 L42 10 L58 10 L58 24 L72 24 L72 10 L88 10 L88 40 L78 40 L78 96 L22 96 L22 40 L12 40 Z',
  },
  {
    id: 'wyvern',
    name: "a wyvern's head",
    fillRule: 'evenodd',
    // Irregular organic: a head in profile facing dexter -- snout at the left,
    // brow spike, a horn swept back, a jaw step, and the eye voided so the
    // field shows through and the shape reads as a head rather than a blob.
    d:
      'M2 54 L28 38 L42 34 L48 20 L58 32 L70 24 L96 4 L84 36 L94 58' +
      ' L84 80 L58 88 L34 78 L22 72 L30 64 L12 64 Z' +
      ' M40 50 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 Z',
  },
  {
    id: 'sword',
    name: 'a sword',
    fillRule: 'nonzero',
    // Thin vertical with a strong cross: blade, guard, grip, pommel.
    d:
      'M50 2 L60 20 L60 58 L40 58 L40 20 Z' +
      ' M16 58 L84 58 L84 70 L16 70 Z' +
      ' M43 70 L57 70 L57 82 L43 82 Z' +
      ' M50 82 m-11 0 a11 11 0 1 0 22 0 a11 11 0 1 0 -22 0 Z',
  },
  {
    id: 'crescent',
    name: 'a crescent',
    fillRule: 'nonzero',
    // Open curve, horns up. Traced as ONE outline between the two circles'
    // intersection points -- outer arc r36 about (50,54) the long way under,
    // inner arc r28 about (50,36) back over the top. Two closed circles with a
    // hole rule does not work here: the biting circle protrudes above the outer
    // one, and both evenodd and nonzero fill that protrusion as a stray ring.
    d:
      'M22.49 30.78 A36 36 0 1 0 77.51 30.78' +
      ' A28 28 0 1 1 22.49 30.78 Z',
  },
  {
    id: 'mullet',
    name: 'a mullet',
    fillRule: 'nonzero',
    // Radial: a six-pointed star.
    d:
      'M50 8 L59.5 34.4 L86.4 29.8 L69 51 L86.4 72.2 L59.5 67.6' +
      ' L50 94 L40.5 67.6 L13.6 72.2 L31 51 L13.6 29.8 L40.5 34.4 Z',
  },
  {
    id: 'eagle',
    name: 'an eagle',
    fillRule: 'nonzero',
    // Wide horizontal: an eagle displayed. One outline, head joined to the
    // body -- a detached head circle and thin wing bars read as a stick figure.
    d:
      'M50 2 C57 2 62 7 62 14 L66 24 L98 6 L94 42 L68 50 L66 64' +
      ' L82 72 L66 80 L68 98 L50 90 L32 98 L34 80 L18 72 L34 64' +
      ' L32 50 L6 42 L2 6 L34 24 L38 14 L24 10 L39 6 C41 3 45 2 50 2 Z',
  },
];

export const CHARGES: ReadonlyMap<ChargeId, Charge> = new Map(
  defs.map((c) => [c.id, c]),
);

export const CHARGE_IDS: readonly ChargeId[] = defs.map((c) => c.id);

export function isChargeId(value: string): value is ChargeId {
  return CHARGES.has(value as ChargeId);
}

export function getCharge(id: ChargeId): Charge {
  const c = CHARGES.get(id);
  if (c === undefined) {
    throw new Error(
      `Unknown charge "${id}". Known charges: ${CHARGE_IDS.join(', ')}.`,
    );
  }
  return c;
}
