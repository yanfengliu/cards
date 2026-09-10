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
  // The traits. One per `Trait` in `engine/state.ts`; `glossary.ts` binds them,
  // the last two through `class-terms.ts`.
  | 'guard'
  | 'relay'
  | 'wake'
  | 'volley'
  | 'scorch'
  // The classes. One per `ClassId` in `content/classes.ts`; `class-terms.ts`
  // binds them, and the hero plate wears its class's as a crest.
  | 'knight'
  | 'ranger'
  | 'mage'
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
  | 'hero'
  // The run. One per `NodeType` in `run/types.ts`; `render/map.ts` binds them.
  | 'fight'
  | 'elite'
  | 'event'
  | 'shop'
  | 'forge'
  | 'rest'
  | 'boss'
  // The run's two readouts that are not a node.
  | 'gold'
  | 'deck';

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
  // Two arrows flying the same way, one behind the other: two swings from one
  // act. Relay is one arrow handing something along; this is a pair in flight.
  volley: {
    shape: 'two arrows flying right, one above the other',
    fillRule: 'nonzero',
    d:
      'M2 5.6 H10.4 V2.6 L18 7 L10.4 11.4 V8.4 H2 Z' +
      ' M6 15.6 H14.4 V12.6 L22 17 L14.4 21.4 V18.4 H6 Z',
  },
  // A single flame with a hollow core. The campfire (`rest`) is a flame over
  // two logs; this one stands alone and is hollow, so the two silhouettes
  // differ at eleven pixels and not only in their bases.
  scorch: {
    shape: 'a lone flame with a hollow core',
    fillRule: 'evenodd',
    d:
      'M12 1.2 C15.2 5.4 19.4 8.6 19.4 14.2 C19.4 18.8 16.1 22.4 12 22.4' +
      ' C7.9 22.4 4.6 18.8 4.6 14.2 C4.6 11 6.6 9.2 7.8 6.6 C8.4 9 9.4 10.4 11 11.2' +
      ' C10.4 7.6 10.9 4.4 12 1.2 Z' +
      ' M12 19.6 C13.9 19.6 15.2 18.3 15.2 16.5 C15.2 14.9 13.9 13.9 13.2 12.6' +
      ' C12.8 13.9 12.2 14.5 11.5 14.9 C11.1 13.9 11 13.1 11.2 12.2 C9.9 13.4 8.8 14.7' +
      ' 8.8 16.5 C8.8 18.3 10.1 19.6 12 19.6 Z',
  },

  // ---- the classes, worn as the hero plate's crest and shown on the class
  // pick. Each is the thing the class fights with, not a portrait.

  // A great helm: a rounded crown over a face plate with an eye slit and a
  // breath line. Not a shield - that is Guard - and not a sword, which is Power.
  knight: {
    shape: 'a great helm with an eye slit',
    fillRule: 'evenodd',
    d:
      'M12 1.6 C7.2 1.6 4 4.8 4 9.6 V22 H20 V9.6 C20 4.8 16.8 1.6 12 1.6 Z' +
      ' M6.6 10.4 H17.4 V12.8 H6.6 Z M11.1 14.4 H12.9 V19.6 H11.1 Z',
  },
  // A bow, strung, with an arrow nocked and pointing right. The bow is what
  // makes it a bow rather than an arrow: Relay and Volley are arrows alone.
  ranger: {
    shape: 'a strung bow with an arrow nocked',
    fillRule: 'nonzero',
    d:
      'M5.2 1.6 C12.6 5.6 12.6 18.4 5.2 22.4 L7.4 22.4 C14.8 18.4 14.8 5.6 7.4 1.6 Z' +
      ' M5.4 2.2 H6.4 V21.8 H5.4 Z' +
      ' M7.8 10.9 H17.2 V9.2 L22.4 12 L17.2 14.8 V13.1 H7.8 Z',
  },
  // A pointed hat over a brim, with a star on the cone. The star is what stops
  // it reading as a plain triangle on a bar at small size.
  mage: {
    shape: 'a pointed hat with a star, over a brim',
    fillRule: 'evenodd',
    d:
      'M12 1.2 L17.2 15.2 H21.4 L22.6 18.4 H1.4 L2.6 15.2 H6.8 Z' +
      ' M12 6.2 L12.9 8.6 L15.5 8.8 L13.5 10.5 L14.1 13.1 L12 11.7 L9.9 13.1 L10.5 10.5' +
      ' L8.5 8.8 L11.1 8.6 Z' +
      ' M3.2 19.6 H20.8 V22 H3.2 Z',
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

  // ---- the map. Each is a node type a player routes through, and the map is
  // read at about 20px, so these are silhouettes the way the trait pips are.

  // Two swords crossed at the hilt, each with its guard and pommel, so the X
  // is a pair of weapons and not a cross. One sword is the `power` icon's four
  // parts turned through 45 degrees; the other is its mirror.
  fight: {
    shape: 'two crossed swords',
    fillRule: 'nonzero',
    d:
      'M4.93 4.93 L7.19 5.49 L16.38 14.69 L14.69 16.38 L5.49 7.19 Z' +
      ' M12.99 18.08 L18.08 12.99 L19.21 14.12 L14.12 19.21 Z' +
      ' M15.96 17.37 L17.37 15.96 L19.64 18.22 L18.22 19.64 Z' +
      circle(19.78, 19.78, 1.7) +
      ' M19.07 4.93 L16.81 5.49 L7.62 14.69 L9.31 16.38 L18.51 7.19 Z' +
      ' M11.01 18.08 L5.92 12.99 L4.79 14.12 L9.88 19.21 Z' +
      ' M8.04 17.37 L6.63 15.96 L4.36 18.22 L5.78 19.64 Z' +
      circle(4.22, 19.78, 1.7),
  },
  // A round head with five spikes on a handle. Harder than a fight, and it
  // says so with a weapon that is heavier than a sword.
  elite: {
    shape: 'a spiked mace',
    fillRule: 'nonzero',
    d:
      circle(12, 9, 5) +
      ' M10.7 4.4 L12 1 L13.3 4.4 Z' +
      ' M15.33 5.57 L18.93 5 L16.63 7.83 Z' +
      ' M16.63 10.17 L18.93 13 L15.33 12.43 Z' +
      ' M7.37 10.17 L5.07 13 L8.67 12.43 Z' +
      ' M7.37 7.83 L5.07 5 L8.67 5.57 Z' +
      ' M10.9 13 H13.1 V22.5 H10.9 Z',
  },
  // A signpost: an arrow-shaped board on a post. Something on the road whose
  // outcome is not printed on the map.
  event: {
    shape: 'a signpost',
    fillRule: 'nonzero',
    d: 'M11 3 H13 V22.5 H11 Z M5.5 6.5 H17.5 L20.8 9.5 L17.5 12.5 H5.5 Z M8 20.5 H16 V22.5 H8 Z',
  },
  // A balance on a post with a pan each side. Trade, not treasure - the coin
  // purse is `gold`, which is what you spend here.
  shop: {
    shape: 'a pair of scales',
    fillRule: 'nonzero',
    d:
      'M11.2 3 H12.8 V21 H11.2 Z M6 20.5 H18 V22.5 H6 Z M3 6 H21 V7.6 H3 Z' +
      ' M3 7.4 L1.2 13.6 L2.4 13.6 L4.2 7.4 Z M4.2 7.4 L9.6 13.6 L8.4 13.6 L3 7.4 Z' +
      ' M21 7.4 L22.8 13.6 L21.6 13.6 L19.8 7.4 Z M19.8 7.4 L14.4 13.6 L15.6 13.6 L21 7.4 Z' +
      ' M1.5 13.5 H9.5 A4 4 0 0 1 1.5 13.5 Z M14.5 13.5 H22.5 A4 4 0 0 1 14.5 13.5 Z',
  },
  // A hammer, head up-left and handle down-right. The anvil is taken: it is
  // the dwarf, and one shape means one thing.
  forge: {
    shape: 'a hammer',
    fillRule: 'nonzero',
    d: 'M3.5 4.5 H15.5 V11.5 H3.5 Z M14.28 7.21 L22.28 20.21 L19.72 21.79 L11.72 8.79 Z',
  },
  // A flame over two crossed logs.
  rest: {
    shape: 'a campfire',
    fillRule: 'nonzero',
    d:
      'M12 2.5 C14.5 6 17.6 8.4 17.6 12.6 C17.6 15.6 15.2 17.6 12 17.6 C8.8 17.6 6.4 15.6 6.4 12.6' +
      ' C6.4 10 8.2 8.6 9 6.4 C9.6 8.4 10.2 9.6 11.6 10.2 C11 7.4 11.4 4.8 12 2.5 Z' +
      ' M3 19.6 L20.6 21.4 L20.4 23 L2.8 21.2 Z M21 19.6 L3.4 21.4 L3.6 23 L21.2 21.2 Z',
  },
  // A skull: cranium, jaw with teeth, two eye holes and a nose. The one node
  // that ends an act.
  boss: {
    shape: 'a skull',
    fillRule: 'evenodd',
    d:
      'M4.5 10 A7.5 7.5 0 0 1 19.5 10 V13.2 C19.5 14.6 18.4 15.6 17 15.8 V21 H15.2 V18.8 H13.2 V21' +
      ' H10.8 V18.8 H8.8 V21 H7 V15.8 C5.6 15.6 4.5 14.6 4.5 13.2 Z' +
      circle(9.2, 10.6, 2.1) +
      circle(14.8, 10.6, 2.1) +
      ' M12 13 L10.9 15.2 H13.1 Z',
  },
  // A tied money bag: the run's currency, which only a shop takes.
  gold: {
    shape: 'a tied money bag',
    fillRule: 'nonzero',
    d:
      'M12 4 C9 4 8.6 6.6 8.6 7.4 C4.8 9.8 3.2 14 3.6 17.4 C4 20.6 7 22.4 12 22.4 C17 22.4 20 20.6' +
      ' 20.4 17.4 C20.8 14 19.2 9.8 15.4 7.4 C15.4 6.6 15 4 12 4 Z M8.2 7.2 H15.8 V8.8 H8.2 Z',
  },
  // Two cards, one behind the other.
  deck: {
    shape: 'two overlapping cards',
    fillRule: 'nonzero',
    d: 'M4.5 3.5 H15 V17.5 H4.5 Z M9 6.5 H19.5 V20.5 H9 Z',
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
