// The map on screen shows the whole act and says what a route holds.
//
// Unit 5 built the map so the route decides most node types a run sees, and
// measured that decision at 5.70 points of win rate. It only exists for a
// player who can see it, so the renderer's claims are gated here rather than
// eyeballed: every node is drawn with its type's icon and label, every edge is
// drawn, the reachable nodes and only they are controls, and the "beyond it"
// spread a node advertises is `pathSpread` on the sub-map it roots - the same
// instrument `test/run.test.ts` gates against brute-force enumeration.
//
// Bound of this gate - what a green run does and does not prove:
//
//   Renders the shipped map shape over 40 seeds x 3 acts, and checks the SVG
//   string by counting attributes and classes. It proves the structure of the
//   markup, not what it looks like: nothing about colour, layout, overlap or
//   pixels, which `tools/ui-probe/run.ts` photographs instead.
//   `spreadFrom` is compared with `pathSpread` at the entry, where the two
//   must coincide, and with brute-force enumeration from every node of eight
//   small maps. It says nothing about `applyMapFocus`, which needs a DOM.
//
// Made to go red: dropping the reachable branch of `standingOf` (so nothing is
// ever `is-reachable`) fails "reachable nodes are the controls" with "seed 1:
// buttons, actual 0, expected 1"; filtering `rows` in `spreadFrom` without
// `slice(root.row)` fails the enumeration check at seed 1 node 1 with
// `{ min: Infinity, max: -Infinity }` against `{ min: 2, max: 3 }` for "fight".
// See `docs/learning/gate-proofs.md`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/engine/rng.ts';
import { RUN_CONTENT } from '../src/run/content.ts';
import { generateAct, pathSpread } from '../src/run/map.ts';
import { startRun, travelOptions } from '../src/run/run.ts';
import { NODE_TYPES, type ActMap, type NodeType } from '../src/run/types.ts';
import { NODE_LABEL, reachableFrom, renderMapSvg, spreadFrom, spreadWords } from '../src/render/map.ts';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('every node and every edge of every act is drawn, labelled by type', () => {
  let nodesDrawn = 0;
  for (const seed of SEEDS) {
    const run = startRun(RUN_CONTENT, seed);
    for (const map of run.maps) {
      const svg = renderMapSvg({
        map,
        visited: [],
        current: -1,
        reachable: map.rows[0]!.slice(),
        focus: null,
      });
      let edges = 0;
      for (const node of map.nodes) {
        edges += node.next.length;
        assert.equal(count(svg, `data-node="${node.id}"`), 1, `seed ${seed} act ${map.act + 1}: node ${node.id} drawn ${count(svg, `data-node="${node.id}"`)} times`);
        for (const n of node.next) {
          assert.equal(count(svg, `data-edge="${node.id}>${n}"`), 1, `seed ${seed}: edge ${node.id}>${n} missing`);
        }
        nodesDrawn++;
      }
      assert.equal(count(svg, 'data-edge="'), edges, `seed ${seed} act ${map.act + 1}: edge count`);
      for (const type of NODE_TYPES) {
        const of = map.nodes.filter((n) => n.type === type).length;
        assert.equal(count(svg, `class="mnode mnode--${type} `), of, `seed ${seed}: ${type} nodes`);
        assert.equal(count(svg, `>${NODE_LABEL[type]}</text>`), of, `seed ${seed}: ${type} labels`);
      }
    }
  }
  assert.ok(nodesDrawn > 2000, `walked only ${nodesDrawn} nodes, which is not the corpus this expects`);
});

test('reachable nodes are the controls, and only they are', () => {
  for (const seed of SEEDS) {
    const run = startRun(RUN_CONTENT, seed);
    const map = run.maps[0]!;
    const reachable = travelOptions(run).map((o) => o.id);
    const svg = renderMapSvg({ map, visited: [], current: -1, reachable, focus: null });
    assert.equal(count(svg, 'role="button"'), reachable.length, `seed ${seed}: buttons`);
    assert.equal(count(svg, 'is-reachable'), reachable.length, `seed ${seed}: reachable class`);
    // The words, once per node on its `aria-label`; the `<title>` and the
    // root's own label carry them too, so the dash pins the per-node form.
    assert.equal(count(svg, '— reachable now"'), reachable.length, `seed ${seed}: the words`);
    for (const id of reachable) {
      const at = svg.indexOf(`data-node="${id}"`);
      const open = svg.lastIndexOf('<g class="mnode', at);
      const tag = svg.slice(open, svg.indexOf('>', at));
      assert.ok(tag.includes('is-reachable') && tag.includes('tabindex="0"'), `seed ${seed}: node ${id} is not a control`);
    }

    // Walk one node and the picture changes with it: the node walked is
    // current, the row's other nodes are passed, its `next` are reachable.
    const first = reachable[0]!;
    const next = map.nodes[first]!.next;
    const after = renderMapSvg({ map, visited: [first], current: first, reachable: next, focus: null });
    assert.equal(count(after, 'is-current'), 1, `seed ${seed}: one current node`);
    assert.equal(count(after, 'role="button"'), next.length, `seed ${seed}: the next row's controls`);
    for (const n of next) assert.equal(count(after, `data-edge="${first}>${n}" `), 1);
    assert.equal(count(after, 'is-open'), next.length, `seed ${seed}: the open edges`);
  }
});

test('what a node says lies beyond it is pathSpread on the sub-map it roots', () => {
  // At the entry of a one-node entry row the two must coincide exactly.
  for (const seed of SEEDS) {
    const map = startRun(RUN_CONTENT, seed).maps[1]!;
    const entry = map.rows[0]!;
    assert.equal(entry.length, 1, 'the shipped shape has a single entry node');
    const whole = pathSpread(map);
    const from = spreadFrom(map, entry[0]!);
    for (const type of NODE_TYPES) {
      assert.deepEqual(from.get(type), whole.get(type), `seed ${seed}: "${type}" differs at the entry`);
    }
  }

  // From every node of a few small maps, against brute-force enumeration.
  let compared = 0;
  for (const seed of [1, 2, 3, 7, 11, 19, 23, 41]) {
    const map: ActMap = generateAct(makeRng(seed, 'test-map'), 0, RUN_CONTENT.mapShape);
    for (const root of map.nodes) {
      const brute = new Map<NodeType, { min: number; max: number }>();
      const walk = (id: number, counts: Map<NodeType, number>): void => {
        const node = map.nodes[id]!;
        const c = new Map(counts);
        c.set(node.type, (c.get(node.type) ?? 0) + 1);
        if (node.next.length === 0) {
          for (const t of NODE_TYPES) {
            const n = c.get(t) ?? 0;
            const cur = brute.get(t);
            brute.set(t, cur === undefined ? { min: n, max: n } : { min: Math.min(cur.min, n), max: Math.max(cur.max, n) });
          }
          return;
        }
        for (const n of node.next) walk(n, c);
      };
      walk(root.id, new Map());
      const got = spreadFrom(map, root.id);
      for (const t of NODE_TYPES) {
        assert.deepEqual(got.get(t), brute.get(t), `seed ${seed} node ${root.id}: "${t}"`);
      }
      // And the reachable set is what the enumeration walked.
      const seen = reachableFrom(map, root.id);
      assert.ok(seen.has(root.id));
      for (const id of seen) assert.ok(map.nodes[id]!.row >= root.row);
      compared++;
    }
  }
  assert.ok(compared >= 100, `compared only ${compared} roots`);
});

test('the spread reads as words a player can act on', () => {
  const words = spreadWords(
    new Map<NodeType, { min: number; max: number }>([
      ['fight', { min: 2, max: 3 }],
      ['elite', { min: 0, max: 1 }],
      ['event', { min: 1, max: 1 }],
      ['shop', { min: 0, max: 0 }],
      ['forge', { min: 0, max: 2 }],
      ['rest', { min: 1, max: 1 }],
      ['boss', { min: 1, max: 1 }],
    ]),
  );
  assert.equal(words, '2–3 fights, 0–1 elite, 1 event, 0–2 forges, 1 rest');
  assert.equal(spreadWords(new Map([['boss', { min: 1, max: 1 }]])), 'only the boss');
});
