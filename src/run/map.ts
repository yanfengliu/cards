// Map generation: one branching graph per act.
//
//   "A map where every path is equivalent is not a map."
//
// That is the whole specification, and it is met structurally rather than by
// hoping the dice cooperate: **no two nodes in one row share a type**. A row of
// three is therefore a choice between three different things, every time, and
// the act's paths differ in what they contain by construction. `pathSpread`
// below turns that from an argument into a number - the exact minimum and
// maximum count of each node type over every entry-to-boss path - and
// `test/run.test.ts` gates it over a seed window.
//
// The graph is layered and planar:
//
//   - each row holds 1..4 nodes, left to right
//   - every edge goes from row r to row r+1
//   - edges never cross, so a node's `col` is a position a player can read
//   - every node has an incoming edge (no unreachable node) and, above the
//     boss row, an outgoing one (no dead end)
//
// Planarity is the reason "left" and "right" mean anything on a map screen, and
// it is cheap: the base edge set is monotone by construction and every extra
// edge is checked against the same monotonicity before it is added.
//
// Everything here is a pure function of the `Rng` it is handed. The run
// generates all three maps at setup, before any choice is made, so the map is a
// function of the run seed alone and a route cannot perturb it.

import { type Rng, nextFloat, nextInt } from '../engine/rng.ts';
import { NODE_TYPES } from './types.ts';
import type { ActMap, MapNode, MapShape, NodeType, RowShape } from './types.ts';

/**
 * Weighted draw without replacement.
 *
 * Used for a row's node types. Returns `k` distinct types; `k` is clamped by
 * the caller to the number of entries, so this never runs out.
 */
function drawDistinctTypes(
  rng: Rng,
  weights: readonly { readonly type: NodeType; readonly weight: number }[],
  k: number,
): NodeType[] {
  const pool = weights.map((w) => ({ type: w.type, weight: w.weight }));
  const out: NodeType[] = [];
  for (let i = 0; i < k; i++) {
    let total = 0;
    for (const p of pool) total += p.weight;
    if (total <= 0 || pool.length === 0) {
      throw new Error(
        `map: row ran out of node types after ${i} of ${k}; a row's weight table needs at ` +
          `least as many positive-weight entries as the row is wide`,
      );
    }
    let roll = nextFloat(rng) * total;
    let chosen = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j]!.weight;
      if (roll < 0) {
        chosen = j;
        break;
      }
    }
    out.push(pool[chosen]!.type);
    pool.splice(chosen, 1);
  }
  return out;
}

function rowWidth(rng: Rng, shape: RowShape): number {
  const cap = shape.weights.filter((w) => w.weight > 0).length;
  const min = Math.max(1, Math.min(shape.minWidth, cap));
  const max = Math.max(min, Math.min(shape.maxWidth, cap));
  return min + nextInt(rng, max - min + 1);
}

/**
 * The base edge set between a row of `w` nodes and a row of `w2`.
 *
 * `k` walks 0..max(w,w2)-1 and both endpoints are monotone non-decreasing in
 * `k`, so the edges cannot cross; and because the longer side advances by one
 * every step, every node on both rows is touched. That is the coverage
 * guarantee - no unreachable node, no dead end - stated as arithmetic rather
 * than as a repair pass.
 */
function baseEdges(w: number, w2: number): { from: number; to: number }[] {
  const steps = Math.max(w, w2);
  const edges: { from: number; to: number }[] = [];
  let last = -1;
  for (let k = 0; k < steps; k++) {
    const from = Math.floor((k * w) / steps);
    const to = Math.floor((k * w2) / steps);
    const key = from * w2 + to;
    if (key === last) continue;
    last = key;
    edges.push({ from, to });
  }
  return edges;
}

/**
 * Generate one act's map.
 *
 * Draws, in a fixed order so the stream position is a function of the shape and
 * not of anything a player did: per row, the width, then the row's types, then
 * the extra-edge rolls for the row above it.
 */
export function generateAct(rng: Rng, act: number, shape: MapShape): ActMap {
  if (shape.rows.length < 2) {
    throw new Error(
      `map: an act needs at least two rows (an entry and a boss), got ${shape.rows.length}`,
    );
  }

  const rowTypes: NodeType[][] = [];
  for (const row of shape.rows) {
    const w = rowWidth(rng, row);
    rowTypes.push(drawDistinctTypes(rng, row.weights, w));
  }

  const rows: number[][] = [];
  const nodes: { id: number; row: number; col: number; type: NodeType; next: number[] }[] = [];
  let nextId = 0;
  for (let r = 0; r < rowTypes.length; r++) {
    const ids: number[] = [];
    const types = rowTypes[r]!;
    for (let c = 0; c < types.length; c++) {
      const id = nextId++;
      ids.push(id);
      nodes.push({ id, row: r, col: c, type: types[c]!, next: [] });
    }
    rows.push(ids);
  }

  for (let r = 0; r + 1 < rows.length; r++) {
    const upper = rows[r]!;
    const lower = rows[r + 1]!;
    // Targets per source, kept sorted. Non-crossing holds exactly when
    // max(targets[i]) <= min(targets[i+1]) for every adjacent pair, so the
    // whole planarity check below is two comparisons.
    const targets: number[][] = upper.map(() => []);
    for (const e of baseEdges(upper.length, lower.length)) {
      const list = targets[e.from]!;
      if (!list.includes(e.to)) list.push(e.to);
    }
    for (const list of targets) list.sort((a, b) => a - b);

    // One roll per source per direction, always both, in a fixed order. The
    // number of draws a row consumes is therefore a function of the row widths
    // alone - not of which edges happened to be legal - so a change to the
    // extra-edge rule cannot shift the rest of the map's stream sideways.
    //
    // Legality is the monotonicity above, checked against the neighbour that is
    // already final on the left and the neighbour that is still base on the
    // right. Sources are walked left to right, so the right-hand limit only
    // ever tightens later, and a limit that tightens cannot invalidate an edge
    // that was already accepted under it.
    for (let i = 0; i < upper.length; i++) {
      const wantLeft = nextFloat(rng) < shape.extraEdgeChance;
      const wantRight = nextFloat(rng) < shape.extraEdgeChance;
      const mine = targets[i]!;
      const leftLimit = i === 0 ? 0 : targets[i - 1]![targets[i - 1]!.length - 1]!;
      const rightLimit = i === upper.length - 1 ? lower.length - 1 : targets[i + 1]![0]!;

      if (wantLeft) {
        const lo = mine[0]!;
        if (lo - 1 >= leftLimit && lo - 1 >= 0) mine.unshift(lo - 1);
      }
      if (wantRight) {
        const hi = mine[mine.length - 1]!;
        if (hi + 1 <= rightLimit && hi + 1 < lower.length) mine.push(hi + 1);
      }
    }

    for (let i = 0; i < upper.length; i++) {
      nodes[upper[i]!]!.next = targets[i]!.map((t) => lower[t]!);
    }
  }

  const frozen: MapNode[] = nodes.map((n) => ({
    id: n.id,
    row: n.row,
    col: n.col,
    type: n.type,
    next: n.next.slice(),
  }));

  return { act, rows: rows.map((r) => r.slice()), nodes: frozen };
}

/**
 * The minimum and maximum number of each node type over every entry-to-boss
 * path, computed by dynamic programming over the rows in reverse.
 *
 * This is the "is it a map" instrument. A type whose min is below its max is a
 * type the route decides; if every type has min equal to max, every path
 * carries the same content and the branching is decorative. Exact, not
 * sampled - there is no path enumeration and no seed involved.
 */
export function pathSpread(map: ActMap): Map<NodeType, { min: number; max: number }> {
  const mins: (Map<NodeType, number> | null)[] = map.nodes.map(() => null);
  const maxs: (Map<NodeType, number> | null)[] = map.nodes.map(() => null);

  for (let r = map.rows.length - 1; r >= 0; r--) {
    for (const id of map.rows[r]!) {
      const node = map.nodes[id]!;
      const lo = new Map<NodeType, number>();
      const hi = new Map<NodeType, number>();
      if (node.next.length > 0) {
        for (const t of NODE_TYPES) {
          let mn = Infinity;
          let mx = -Infinity;
          for (const n of node.next) {
            mn = Math.min(mn, mins[n]!.get(t) ?? 0);
            mx = Math.max(mx, maxs[n]!.get(t) ?? 0);
          }
          lo.set(t, mn);
          hi.set(t, mx);
        }
      } else {
        for (const t of NODE_TYPES) {
          lo.set(t, 0);
          hi.set(t, 0);
        }
      }
      lo.set(node.type, (lo.get(node.type) ?? 0) + 1);
      hi.set(node.type, (hi.get(node.type) ?? 0) + 1);
      mins[id] = lo;
      maxs[id] = hi;
    }
  }

  const out = new Map<NodeType, { min: number; max: number }>();
  for (const t of NODE_TYPES) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const id of map.rows[0]!) {
      mn = Math.min(mn, mins[id]!.get(t) ?? 0);
      mx = Math.max(mx, maxs[id]!.get(t) ?? 0);
    }
    out.set(t, { min: mn, max: mx });
  }
  return out;
}

/** How many node types the route decides. Zero means the map is decorative. */
export function branchingTypes(map: ActMap): number {
  let n = 0;
  for (const [, v] of pathSpread(map)) if (v.max > v.min) n++;
  return n;
}

/**
 * Structural checks a generated map must satisfy, returned as messages rather
 * than thrown, so a gate can report all of them at once.
 *
 * These are the properties the generator claims: reachability both ways,
 * planarity, one type per node per row, and a single boss at the bottom.
 */
export function mapProblems(map: ActMap): string[] {
  const problems: string[] = [];
  const lastRow = map.rows.length - 1;

  const incoming = new Set<number>();
  for (const node of map.nodes) {
    for (const n of node.next) incoming.add(n);
  }

  for (const node of map.nodes) {
    if (node.row < lastRow && node.next.length === 0) {
      problems.push(`node ${node.id} (row ${node.row}) is a dead end`);
    }
    if (node.row > 0 && !incoming.has(node.id)) {
      problems.push(`node ${node.id} (row ${node.row}) is unreachable`);
    }
    for (const n of node.next) {
      const target = map.nodes[n];
      if (target === undefined || target.row !== node.row + 1) {
        problems.push(`node ${node.id} has an edge to ${n}, which is not in the row below it`);
      }
    }
  }

  for (let r = 0; r + 1 < map.rows.length; r++) {
    const upper = map.rows[r]!;
    for (let i = 0; i + 1 < upper.length; i++) {
      const mine = map.nodes[upper[i]!]!.next;
      const next = map.nodes[upper[i + 1]!]!.next;
      if (mine.length === 0 || next.length === 0) continue;
      const myMax = Math.max(...mine.map((n) => map.nodes[n]!.col));
      const nextMin = Math.min(...next.map((n) => map.nodes[n]!.col));
      if (myMax > nextMin) {
        problems.push(
          `row ${r}: the edges from node ${upper[i]!} and node ${upper[i + 1]!} cross ` +
            `(${myMax} > ${nextMin}); the map is not planar and left/right stops meaning anything`,
        );
      }
    }
  }

  for (let r = 0; r < map.rows.length; r++) {
    const seen = new Set<NodeType>();
    for (const id of map.rows[r]!) {
      const t = map.nodes[id]!.type;
      if (seen.has(t)) {
        problems.push(
          `row ${r} holds two "${t}" nodes; a row's nodes must differ, or the row is not a choice`,
        );
      }
      seen.add(t);
    }
  }

  const bossRow = map.rows[lastRow] ?? [];
  if (bossRow.length !== 1 || map.nodes[bossRow[0] ?? -1]?.type !== 'boss') {
    problems.push(`the last row must hold exactly one boss node, it holds [${bossRow.join(', ')}]`);
  }
  for (const node of map.nodes) {
    if (node.type === 'boss' && node.row !== lastRow) {
      problems.push(`node ${node.id} is a boss in row ${node.row}, not the last row`);
    }
  }

  return problems;
}
