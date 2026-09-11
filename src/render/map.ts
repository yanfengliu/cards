/**
 * The act map, as SVG.
 *
 * `src/run/map.ts` builds a map so that "a map where every path is equivalent
 * is not a map": no two nodes in one row share a type, and the route decides
 * most of the node types a run sees - measured at 5.70 points of win rate. That
 * decision only exists for a player who can *see* it, so this renderer draws
 * the whole act at once - every node with its type's icon and its name, every
 * edge - and never only the next row. A choice shows its consequences before
 * commit: hovering a reachable node lights up everything that can still be
 * reached from it, and `spreadFrom` says, exactly rather than by sampling, how
 * many of each node type the paths beyond it hold. That is unit 5's own
 * `pathSpread`, run on the sub-map a node roots.
 *
 * Same rules as the board. Type is never carried by colour alone: every node
 * wears its icon and its label, and the state of a node - walked, here,
 * reachable, ahead, passed - is a CSS class on the element, with the words on
 * `aria-label`. Nothing here reads `RunState`; it takes the map and the
 * position, which is what makes it a function a test can call.
 */

import { pathSpread } from '../run/map.ts';
import { NODE_TYPES, type ActMap, type MapNode, type NodeType } from '../run/types.ts';
import { iconSvg, type IconName } from './icons.ts';
import { escapeHtml as esc } from './escape.ts';

/** The icon each node type wears. One per `NodeType`, so a new type fails here. */
export const NODE_ICON: Readonly<Record<NodeType, IconName>> = {
  fight: 'fight',
  elite: 'elite',
  event: 'event',
  shop: 'shop',
  forge: 'forge',
  rest: 'rest',
  boss: 'boss',
};

export const NODE_LABEL: Readonly<Record<NodeType, string>> = {
  fight: 'Fight',
  elite: 'Elite',
  event: 'Event',
  shop: 'Shop',
  forge: 'Forge',
  rest: 'Rest',
  boss: 'Boss',
};

/** What going there means, in one sentence each. The map's own glossary. */
export const NODE_LINE: Readonly<Record<NodeType, string>> = {
  fight: 'A fight against an ordinary enemy. Win it for gold and a choice of one card; lose it and the run ends.',
  elite: 'A harder fight that pays more gold. The same rule: lose it and the run ends.',
  event: 'Something on the road with a choice in it. What it offers is not printed on the map.',
  shop: 'Three cards for sale. Buy one with the gold you have, or leave.',
  forge: 'Permanently upgrade one card in your deck: +1 Power, +1 Health, or -1 Energy.',
  rest: 'Heal a share of your maximum Health. Nothing is asked of you.',
  boss: "The act's boss. Beat it to reach the next act - or, at the last, to win the run.",
};

export type MapView = {
  readonly map: ActMap;
  /** Node ids walked in this act, in order. */
  readonly visited: readonly number[];
  /** The node the run stands on, or -1 before the act's entry. */
  readonly current: number;
  /** The nodes the run may travel to now. */
  readonly reachable: readonly number[];
  /** A reachable node the pointer or focus is on, or null. */
  readonly focus: number | null;
  /** A second line under a node - an encounter's name. Keyed by node id. */
  readonly captions?: ReadonlyMap<number, string>;
};

export type MapLayout = {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly colGap: number;
  readonly rowGap: number;
  readonly padX: number;
  readonly padY: number;
};

export const MAP_LAYOUT: MapLayout = {
  width: 0,
  height: 0,
  radius: 21,
  colGap: 118,
  rowGap: 84,
  padX: 78,
  padY: 44,
};

export function layoutFor(map: ActMap, base: MapLayout = MAP_LAYOUT): MapLayout {
  let cols = 1;
  for (const row of map.rows) cols = Math.max(cols, row.length);
  return {
    ...base,
    width: base.padX * 2 + base.colGap * (cols - 1),
    height: base.padY * 2 + base.rowGap * (map.rows.length - 1),
  };
}

/** Where a node's centre is drawn. A row is centred, and its nodes are `colGap` apart. */
export function nodePosition(map: ActMap, layout: MapLayout, id: number): { x: number; y: number } {
  const node = map.nodes[id];
  if (node === undefined) {
    throw new Error(`map: node ${id} is not on this map, which has ${map.nodes.length} node(s)`);
  }
  const width = map.rows[node.row]!.length;
  return {
    x: layout.width / 2 + (node.col - (width - 1) / 2) * layout.colGap,
    y: layout.padY + node.row * layout.rowGap,
  };
}

/** Every node still reachable from `id`, `id` included. */
export function reachableFrom(map: ActMap, id: number): Set<number> {
  const seen = new Set<number>();
  const stack = [id];
  while (stack.length > 0) {
    const at = stack.pop()!;
    if (seen.has(at)) continue;
    seen.add(at);
    const node = map.nodes[at];
    if (node === undefined) {
      throw new Error(`map: node ${at} is not on this map, which has ${map.nodes.length} node(s)`);
    }
    for (const n of node.next) stack.push(n);
  }
  return seen;
}

/**
 * The exact minimum and maximum count of each node type over every path from
 * `id` to the boss, `id` itself included.
 *
 * This is `pathSpread` on the sub-map `id` roots: the same nodes, with the rows
 * cut down to what `id` can still reach, and `id` alone as the entry row.
 * Reachability is closed under `next`, so every edge out of a kept node lands
 * on a kept node and the DP is well defined. Reusing the instrument rather
 * than re-deriving it is the point: what the map says a route holds is what
 * the measurement said a route holds.
 */
export function spreadFrom(map: ActMap, id: number): Map<NodeType, { min: number; max: number }> {
  const keep = reachableFrom(map, id);
  const root = map.nodes[id]!;
  const rows = map.rows
    .slice(root.row)
    .map((row) => row.filter((n) => keep.has(n)));
  return pathSpread({ act: map.act, rows, nodes: map.nodes });
}

/**
 * The spread as words, for the panel beside the map. Types with a fixed
 * count read as a number, types the route decides read as a range, and a
 * type no path holds is left out rather than written as "0 shops".
 */
export function spreadWords(spread: ReadonlyMap<NodeType, { min: number; max: number }>): string {
  const parts: string[] = [];
  for (const type of NODE_TYPES) {
    if (type === 'boss') continue;
    const v = spread.get(type);
    if (v === undefined || v.max === 0) continue;
    const label = NODE_LABEL[type].toLowerCase();
    const plural = (n: number): string => (n === 1 ? label : `${label}s`);
    parts.push(v.min === v.max ? `${v.min} ${plural(v.min)}` : `${v.min}–${v.max} ${plural(v.max)}`);
  }
  return parts.length === 0 ? 'only the boss' : parts.join(', ');
}

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

type NodeStanding = 'walked' | 'current' | 'reachable' | 'ahead' | 'passed';

/**
 * Which of the five states a node is in.
 *
 * `passed` is a node in a row the run has already gone through and did not
 * stand on. It stays on the map - dimmed - because the routes not taken are
 * part of reading the one that was.
 */
function standingOf(node: MapNode, view: MapView, currentRow: number): NodeStanding {
  if (node.id === view.current) return 'current';
  if (view.visited.includes(node.id)) return 'walked';
  if (view.reachable.includes(node.id)) return 'reachable';
  return node.row <= currentRow ? 'passed' : 'ahead';
}

const STANDING_WORDS: Readonly<Record<NodeStanding, string>> = {
  walked: 'walked',
  current: 'you are here',
  reachable: 'reachable now',
  ahead: 'further on',
  passed: 'not taken',
};

/**
 * The map as one SVG string.
 *
 * Nodes carry `data-node` and, when reachable, `role="button"` with a tab
 * stop, so the run screen can delegate clicks and key presses to the ids
 * rather than to positions. Everything else is a class the stylesheet reads.
 */
export function renderMapSvg(view: MapView): string {
  const { map } = view;
  const layout = layoutFor(map);
  const r = layout.radius;
  const currentRow = view.current < 0 ? -1 : map.nodes[view.current]!.row;
  const focusSet = view.focus === null ? null : reachableFrom(map, view.focus);
  const pos = new Map<number, { x: number; y: number }>();
  for (const node of map.nodes) pos.set(node.id, nodePosition(map, layout, node.id));

  const walkedEdges = new Set<string>();
  for (let i = 0; i + 1 < view.visited.length; i++) {
    walkedEdges.add(`${view.visited[i]}>${view.visited[i + 1]}`);
  }
  if (view.visited.length > 0 && view.current >= 0 && view.visited[view.visited.length - 1] !== view.current) {
    walkedEdges.add(`${view.visited[view.visited.length - 1]}>${view.current}`);
  }

  const edges: string[] = [];
  for (const node of map.nodes) {
    const from = pos.get(node.id)!;
    for (const n of node.next) {
      const to = pos.get(n)!;
      const classes = ['medge'];
      const key = `${node.id}>${n}`;
      if (walkedEdges.has(key)) classes.push('is-walked');
      else if (node.id === view.current && view.reachable.includes(n)) classes.push('is-open');
      else if (focusSet !== null && focusSet.has(node.id) && focusSet.has(n)) classes.push('is-in-focus');
      else if (node.row < currentRow || (node.row === currentRow && node.id !== view.current)) {
        classes.push('is-passed');
      }
      const midY = (from.y + r + (to.y - r)) / 2;
      edges.push(
        `<path class="${classes.join(' ')}" data-edge="${node.id}>${n}" ` +
          `d="M${r1(from.x)} ${r1(from.y + r)} C${r1(from.x)} ${r1(midY)}, ` +
          `${r1(to.x)} ${r1(midY)}, ${r1(to.x)} ${r1(to.y - r)}" fill="none"/>`,
      );
    }
  }

  const nodes: string[] = [];
  for (const node of map.nodes) {
    const p = pos.get(node.id)!;
    const standing = standingOf(node, view, currentRow);
    const classes = ['mnode', `mnode--${node.type}`, `is-${standing}`];
    if (view.focus === node.id) classes.push('is-focus');
    else if (focusSet !== null && focusSet.has(node.id)) classes.push('is-in-focus');
    const caption = view.captions?.get(node.id);
    const label = NODE_LABEL[node.type];
    const words = [label, ...(caption === undefined ? [] : [caption]), STANDING_WORDS[standing]].join(' — ');
    const interactive = standing === 'reachable';
    const iconSize = Math.round(r * 1.05);
    const attrs =
      `class="${classes.join(' ')}" data-node="${node.id}" data-type="${node.type}"` +
      (interactive ? ' role="button" tabindex="0"' : ' role="img"') +
      ` aria-label="${esc(words)}"`;
    nodes.push(
      `<g ${attrs}>` +
        `<title>${esc(words)}</title>` +
        `<circle class="mnode__ring" cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(r + 5)}"/>` +
        `<circle class="mnode__disc" cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(r)}"/>` +
        `<g class="mnode__icon" transform="translate(${r1(p.x - iconSize / 2)} ${r1(p.y - iconSize / 2)})">` +
        iconSvg(NODE_ICON[node.type], { size: iconSize, decorative: true }) +
        '</g>' +
        `<text class="mnode__label" x="${r1(p.x)}" y="${r1(p.y + r + 13)}" text-anchor="middle">${esc(label)}</text>` +
        (caption === undefined
          ? ''
          : `<text class="mnode__caption" x="${r1(p.x)}" y="${r1(p.y + r + 24)}" text-anchor="middle">${esc(caption)}</text>`) +
        '</g>',
    );
  }

  const title =
    `Act ${map.act + 1} map: ${map.rows.length} rows, ${map.nodes.length} nodes, ` +
    `${view.reachable.length} reachable now`;
  return (
    `<svg class="map" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" ` +
    `width="${layout.width}" height="${layout.height}" role="group" aria-label="${esc(title)}">` +
    `<g class="map__edges">${edges.join('')}</g>` +
    `<g class="map__nodes">${nodes.join('')}</g>` +
    '</svg>'
  );
}

/**
 * Move the focus highlight on an already-rendered map, in place.
 *
 * Re-rendering the SVG on hover replaces the element under the pointer, and a
 * click that started on the old element never completes - which is exactly
 * what happened to the first click on a hovered node. So hover toggles classes
 * on the elements that are there and rebuilds nothing. The classes are the
 * ones `renderMapSvg` writes for the same `focus`, so the two agree; an edge
 * or node that already carries a stronger state - walked, open, passed - is
 * left as it is, the way the renderer leaves it.
 */
export function applyMapFocus(root: ParentNode, map: ActMap, focus: number | null): void {
  const set = focus === null ? null : reachableFrom(map, focus);
  for (const el of Array.from(root.querySelectorAll<Element>('[data-node]'))) {
    const id = Number.parseInt((el as HTMLElement).dataset['node'] ?? '', 10);
    el.classList.toggle('is-focus', focus !== null && id === focus);
    el.classList.toggle('is-in-focus', set !== null && id !== focus && set.has(id));
  }
  for (const el of Array.from(root.querySelectorAll<Element>('[data-edge]'))) {
    const key = (el as HTMLElement).dataset['edge'] ?? '';
    const [a, b] = key.split('>').map((s) => Number.parseInt(s, 10));
    const stronger =
      el.classList.contains('is-walked') ||
      el.classList.contains('is-open') ||
      el.classList.contains('is-passed');
    el.classList.toggle(
      'is-in-focus',
      !stronger && set !== null && a !== undefined && b !== undefined && set.has(a) && set.has(b),
    );
  }
}
