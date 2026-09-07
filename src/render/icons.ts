/**
 * The icon set, drawn in code.
 *
 * `ARCHITECTURE.md` is explicit that this repo has no image assets and does not
 * want any - card art is a blazon rendered to SVG - and an icon font or a sprite
 * sheet would be exactly the pipeline that rule exists to avoid. So every icon
 * here is one path string in a 0..24 box, the same way a charge is one path
 * string in a 0..100 box.
 *
 * Two properties this file is built for:
 *
 *   One idea, one shape. An icon is looked up by *meaning* - `power`, `guard`,
 *   `relay` - and the same meaning draws the same shape wherever it appears: on
 *   the trait strip under a compressed card, in the hover panel that explains
 *   that strip, and in the hint line under the hand. A player who learns the
 *   diamond once has learned it everywhere.
 *
 *   An icon is never the only carrier. `iconSvg` takes a `label` and puts it on
 *   `aria-label` with `role="img"`; a decorative icon that sits beside its own
 *   name in text is marked `aria-hidden` instead, so a screen reader reads the
 *   name once rather than twice. There is no third option: a labelled icon or a
 *   hidden one next to text. An unlabelled, unhidden icon is a bug.
 *
 * Shapes are chosen for silhouette spread at 11px, which is the size the trait
 * strip under a 44px card gets. Nothing here relies on stroke width, colour or
 * interior detail to be told apart.
 */

export type IconName =
  // The numbers on every card.
  | 'power'
  | 'health'
  | 'cost'
  | 'armour'
  // The traits. One per `Trait` in `engine/state.ts`; `glossary.ts` binds them.
  | 'guard'
  | 'relay'
  | 'wake'
  // The rest of the card.
  | 'target'
  | 'field'
  | 'charge'
  | 'position'
  | 'blank'
  // Tribes. One per `Tribe` in `engine/state.ts`; `glossary.ts` binds them.
  | 'human'
  | 'dwarf'
  | 'elf'
  | 'orc'
  | 'beast'
  | 'hero';

interface IconDef {
  readonly d: string;
  readonly fillRule: 'nonzero' | 'evenodd';
  /** What the shape is, for a reader who has to be told rather than shown. */
  readonly shape: string;
}

/** A circle as an arc pair, so a path can hold rings and voids. */
function circle(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy} m${-r} 0 a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx} ${cy} m${-rx} 0 a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
}

const ICONS: Readonly<Record<IconName, IconDef>> = {
  // Blade, crossguard, grip, pommel - the same four parts as the `sword` charge,
  // squared up so it survives being drawn at eleven pixels.
  power: {
    shape: 'a sword',
    fillRule: 'nonzero',
    d: 'M12 1.5 L14.8 7 V13.5 H9.2 V7 Z M4 13.5 H20 V16.2 H4 Z M10.2 16.2 H13.8 V19 H10.2 Z' +
      circle(12, 20.8, 2.4),
  },
  health: {
    shape: 'a heart',
    fillRule: 'nonzero',
    d: 'M12 21.6 C6 17 3 13.4 3 9.7 A4.7 4.7 0 0 1 12 7.3 A4.7 4.7 0 0 1 21 9.7 C21 13.4 18 17 12 21.6 Z',
  },
  // Energy, as the bolt it is drawn as everywhere else in software. The tray's
  // energy pips are discs; the bolt is what says "this many of those".
  cost: {
    shape: 'a lightning bolt',
    fillRule: 'nonzero',
    d: 'M13.6 1.5 L4 13.2 H10.2 L9.4 22.5 L20 10.2 H13 Z',
  },
  // Two nested chevrons: a hit arriving from above and being turned aside. It
  // must not read as a shield, because the shield is Guard and Guard is a
  // different rule.
  armour: {
    shape: 'two stacked chevrons',
    fillRule: 'nonzero',
    d: 'M2.5 12.6 L12 4 L21.5 12.6 L19.1 14.8 L12 8.4 L4.9 14.8 Z' +
      ' M2.5 18.8 L12 10.2 L21.5 18.8 L19.1 21 L12 14.6 L4.9 21 Z',
  },
  // The heater shield, deliberately the same silhouette the card itself takes
  // when it is a Guard. The card outline is the Guard channel per
  // `ARCHITECTURE.md`; this is that channel, shrunk to icon size.
  guard: {
    shape: 'a heater shield',
    fillRule: 'nonzero',
    d: 'M3.5 2.5 H20.5 V11.6 C20.5 16.8 16.8 20.8 12 22.4 C7.2 20.8 3.5 16.8 3.5 11.6 Z',
  },
  // An arrow handing something to the right, which is literally what Relay does.
  relay: {
    shape: 'an arrow pointing right',
    fillRule: 'nonzero',
    d: 'M2.5 9.4 H13 V4.6 L21.8 12 L13 19.4 V14.6 H2.5 Z',
  },
  // An arrow rising off a baseline: something that was down comes up.
  wake: {
    shape: 'an arrow rising from a line',
    fillRule: 'nonzero',
    d: 'M12 1.8 L19.6 10.4 H15 V16.8 H9 V10.4 H4.4 Z M4 19.2 H20 V22 H4 Z',
  },
  // A ring around a dot: the chance an attack lands here.
  target: {
    shape: 'a target ring',
    fillRule: 'evenodd',
    d: circle(12, 12, 9.2) + circle(12, 12, 6.4) + circle(12, 12, 2.8),
  },
  // A shield ruled with vertical lines: the heraldic field, and the hatching
  // convention that lets a field be read without its colour.
  field: {
    shape: 'a hatched shield',
    fillRule: 'evenodd',
    d:
      'M3.5 2.5 H20.5 V11.6 C20.5 16.8 16.8 20.8 12 22.4 C7.2 20.8 3.5 16.8 3.5 11.6 Z' +
      ' M6.6 5.2 V16.4 H8.2 V5.2 Z M11.2 5.2 V19.6 H12.8 V5.2 Z M15.8 5.2 V16.4 H17.4 V5.2 Z',
  },
  // A shield carrying a device: the charge, which is the card's own identity.
  charge: {
    shape: 'a shield bearing a star',
    fillRule: 'evenodd',
    d:
      'M3.5 2.5 H20.5 V11.6 C20.5 16.8 16.8 20.8 12 22.4 C7.2 20.8 3.5 16.8 3.5 11.6 Z' +
      ' M12 5.6 L13.9 10.2 L18.8 10.6 L15.1 13.8 L16.2 18.6 L12 16 L7.8 18.6 L8.9 13.8' +
      ' L5.2 10.6 L10.1 10.2 Z',
  },
  // An empty box. "This card has no trait" is a real statement about the card
  // and needs its own shape - reusing `position` for it would have made one
  // drawing mean two things, which is the rule this module exists to keep.
  blank: {
    shape: 'an empty box',
    fillRule: 'evenodd',
    d: 'M3 5 H21 V19 H3 Z M5.4 7.4 V16.6 H18.6 V7.4 Z',
  },
  // Three slots in a row with the middle one marked: where a card stands.
  position: {
    shape: 'three slots with the middle one filled',
    fillRule: 'evenodd',
    d:
      'M1.5 6 H7.5 V18 H1.5 Z M3.1 7.6 V16.4 H5.9 V7.6 Z' +
      ' M9 6 H15 V18 H9 Z' +
      ' M16.5 6 H22.5 V18 H16.5 Z M18.1 7.6 V16.4 H20.9 V7.6 Z',
  },

  human: {
    shape: 'a head and shoulders',
    fillRule: 'nonzero',
    d: circle(12, 6.4, 4.3) + ' M2.8 22 C2.8 16.3 6.9 12.6 12 12.6 C17.1 12.6 21.2 16.3 21.2 22 Z',
  },
  // The horn is what makes an anvil an anvil. A symmetric version of this drew
  // as a table at 11px, so the left edge tapers to a point and the silhouette is
  // asymmetric on purpose.
  dwarf: {
    shape: 'an anvil',
    fillRule: 'nonzero',
    d:
      'M1.5 9.2 L7 5.8 H21.5 V11.8 H7 Z' +
      ' M8.6 11.8 H16.4 L14.2 17.6 H10.8 Z' +
      ' M5.4 17.2 H18.6 V22 H5.4 Z',
  },
  // The tip has to stay sharp or the leaf draws as an egg. The first control
  // point sits close to the apex for exactly that reason.
  elf: {
    shape: 'a pointed leaf with a midrib',
    fillRule: 'evenodd',
    d:
      'M12 1.2 C13.6 6.2 19.6 9.4 17.7 17.2 C16.7 21 13.6 21.9 12 22.6' +
      ' C10.4 21.9 7.3 21 6.3 17.2 C4.4 9.4 10.4 6.2 12 1.2 Z' +
      ' M11.35 6.5 V21.6 H12.65 V6.5 Z',
  },
  orc: {
    shape: 'a pair of tusks',
    fillRule: 'nonzero',
    d:
      'M6.6 22 C3.6 15.4 4.8 7.8 8.9 2.6 C8.9 9.6 9.9 15.8 11.1 22 Z' +
      ' M17.4 22 C20.4 15.4 19.2 7.8 15.1 2.6 C15.1 9.6 14.1 15.8 12.9 22 Z',
  },
  beast: {
    shape: 'a paw print',
    fillRule: 'nonzero',
    d:
      'M12 22 C8.3 22 5.7 20 5.7 17.4 C5.7 14.4 8.8 12.4 12 12.4' +
      ' C15.2 12.4 18.3 14.4 18.3 17.4 C18.3 20 15.7 22 12 22 Z' +
      ellipse(5.4, 9.6, 2.5, 3.2) +
      ellipse(10, 6.4, 2.4, 3.4) +
      ellipse(14.9, 6.4, 2.4, 3.4) +
      ellipse(19.4, 9.6, 2.5, 3.2),
  },
  hero: {
    shape: 'a crown',
    fillRule: 'nonzero',
    d: 'M2 6.4 L7.4 11.6 L12 3 L16.6 11.6 L22 6.4 V17.4 H2 Z M2 19 H22 V21.8 H2 Z',
  },
};

export function iconShape(name: IconName): string {
  return ICONS[name].shape;
}

export const ICON_NAMES: readonly IconName[] = Object.keys(ICONS) as IconName[];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

export interface IconOptions {
  /** Edge length in CSS px. The box is square. */
  readonly size?: number;
  /**
   * The accessible name. Required unless `decorative` is set, because an icon
   * with neither is a symbol whose meaning lives somewhere else - which is the
   * whole defect this module was added to fix.
   */
  readonly label?: string;
  /**
   * The icon sits directly beside its own name in visible text, so a screen
   * reader should skip it rather than say the name twice.
   */
  readonly decorative?: boolean;
  readonly className?: string;
}

/**
 * One icon as an SVG string.
 *
 * Throws when asked for an unnamed, non-decorative icon. That is deliberate and
 * it fires at render time rather than in review: the rule "an icon is never the
 * sole carrier of meaning" is only worth writing down if breaking it is loud.
 */
export function iconSvg(name: IconName, opts: IconOptions = {}): string {
  const def = ICONS[name];
  const size = opts.size ?? 14;
  const decorative = opts.decorative === true;
  const label = opts.label;
  if (!decorative && (label === undefined || label.length === 0)) {
    throw new Error(
      `icons: the "${name}" icon was asked for with no accessible name and without ` +
        `decorative:true. An icon must never be the only carrier of its meaning - either ` +
        `pass label:"..." , or pass decorative:true when the icon sits beside that same ` +
        `text on screen.`,
    );
  }
  const a11y = decorative
    ? ' aria-hidden="true" focusable="false"'
    : ` role="img" aria-label="${esc(label as string)}"`;
  const cls = opts.className === undefined ? '' : ` class="${esc(opts.className)}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"` +
    `${cls}${a11y}><path d="${def.d}" fill="currentColor" fill-rule="${def.fillRule}"/></svg>`
  );
}
