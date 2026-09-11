// The markup this app builds by string concatenation: escaped once, and drawn
// somewhere that can hear a click.
//
// Two claims, both about wiring rather than about what any screen says, and
// both found by an independent review reading code that every one of 237 tests
// ran straight past. Neither could have been found by running: a copy of a
// function is a copy of whatever a gate does not cover, and a button in a
// container no listener reaches renders perfectly and does nothing.
//
//   **One escaper.** `src/render/escape.ts` holds the only implementation.
//   There were eight, hand-copied; seven were right and the one in
//   `src/ui/runapp.ts` mapped `>` to `&quot;`. No shipped string holds a `>`
//   today - checked: no card name, no node line, no event label - so nothing
//   was wrong on screen, and nothing would have been until the first card
//   called something like `Scout > Skirmisher`. This gate holds the one
//   implementation to the four characters and holds `src/` to having no second
//   copy, so a ninth cannot appear and drift.
//
//   **Every panel is inside something that hears a click.** `runapp.ts` writes
//   its screens into elements it looks up by id, and delegates clicks from a
//   listened root. The HUD, `<header class="hud">`, is not inside `#run`, so
//   while the only listener was on `#run` the HUD's Restart button was dead -
//   from unit 8 until unit 12, through every gate the repo has. The rule is
//   bound to the *panel* rather than to the `data-run` attribute on purpose:
//   half the controls in `#run-node` are built by `sigils.ts` and
//   `classpick.ts`, so a check that looked for the attribute in the assignment
//   it was written by would not see them. Anything the app draws can hold a
//   control, so anything the app draws must be reachable.
//
// Bound of this file - what a green run does and does not prove:
//
//   Reads `src/ui/runapp.ts` as a TypeScript AST and `src/ui/index.html` as
//   markup; it runs no DOM and clicks nothing. It proves that every element
//   `runapp.ts` assigns `innerHTML` to is, or is inside, an element it attaches
//   a click listener to. It does **not** prove that the listener's switch
//   handles the action a given button names, that the handler does the right
//   thing, or that anything is visible. A click on a real control in a real
//   browser is `node tools/ui-probe/run.ts`, which is outside `npm run gates`
//   because it needs Chrome.
//   Both detectors are made to fire on a built-in probe before they are
//   trusted to report an absence, so "did not run" cannot come back as
//   "passed".
//
// Made to go red: see `docs/learning/gate-proofs.md`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { escapeHtml } from '../src/render/escape.ts';
import { iconSvg } from '../src/render/icons.ts';

// ---------------------------------------------------------------------------
// One escaper
// ---------------------------------------------------------------------------

test('text becomes markup through one escaper, and there is no second copy of it', () => {
  assert.equal(escapeHtml('&<>"'), '&amp;&lt;&gt;&quot;');
  // `&` first, or the other three are escaped twice.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(escapeHtml('a > b'), 'a &gt; b', 'the `>` case, which is the one that was wrong');
  assert.equal(escapeHtml('Scout > Skirmisher'), 'Scout &gt; Skirmisher');
  assert.equal(escapeHtml('nothing to do'), 'nothing to do');
  // Through a real render path, not only directly.
  assert.match(iconSvg('health', { size: 13, label: 'a > b' }), /a &gt; b/);

  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) files.push(full.split(path.sep).join('/'));
    }
  };
  walk('src');
  assert.ok(files.length > 20, `walked only ${files.length} file(s) under src/; the walk looks wrong`);
  const escapers = files.filter((f) => readFileSync(f, 'utf8').includes("'&amp;'"));
  assert.deepEqual(
    escapers,
    ['src/render/escape.ts'],
    'a second HTML escaper appeared. There is one, in src/render/escape.ts, and it is exported - ' +
      'import it rather than copying it, because a copy is a copy of whatever a gate does not cover.',
  );
});

// ---------------------------------------------------------------------------
// Every panel is inside something that hears a click
// ---------------------------------------------------------------------------

/** `id` → the ids of its ancestors, outermost first. Ids with no element are absent. */
function ancestry(html: string): Map<string, string[]> {
  const VOID = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);
  const out = new Map<string, string[]>();
  const stack: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    // Find the tag's closing `>`, ignoring one inside a quoted attribute value.
    let j = lt + 1;
    let quote: string | null = null;
    while (j < html.length) {
      const c = html[j]!;
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    const tag = html.slice(lt + 1, j);
    i = j + 1;
    if (tag.startsWith('/')) {
      stack.pop();
      continue;
    }
    const name = (/^[a-zA-Z0-9-]+/.exec(tag)?.[0] ?? '').toLowerCase();
    const id = /\bid\s*=\s*"([^"]*)"/.exec(tag)?.[1];
    if (id !== undefined) out.set(id, [...stack]);
    if (!tag.endsWith('/') && !VOID.has(name)) stack.push(id ?? '');
  }
  return out;
}

/** Which `dom.<key>` gets `innerHTML` written to it, which gets a click listener, and its id. */
function wiringOf(source: string): {
  readonly ids: Map<string, string>;
  readonly sinks: Set<string>;
  readonly listened: Set<string>;
} {
  const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const ids = new Map<string, string>();
  const sinks = new Set<string>();
  const listened = new Set<string>();

  /** `dom.<key>` → key, for any other expression undefined. */
  const domKey = (node: ts.Expression): string | undefined =>
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'dom'
      ? node.name.text
      : undefined;

  const visit = (node: ts.Node): void => {
    // const dom = { status: need<HTMLElement>('run-status'), ... }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'dom' &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
        const call = prop.initializer;
        if (!ts.isCallExpression(call)) continue;
        const arg = call.arguments[0];
        if (arg !== undefined && ts.isStringLiteralLike(arg)) ids.set(prop.name.text, arg.text);
      }
    }
    // dom.<key>.innerHTML = ...
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'innerHTML'
    ) {
      const key = domKey(node.left.expression);
      if (key !== undefined) sinks.add(key);
    }
    // dom.<key>.addEventListener('click', ...)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'addEventListener'
    ) {
      const first = node.arguments[0];
      const key = domKey(node.expression.expression);
      if (key !== undefined && first !== undefined && ts.isStringLiteralLike(first) && first.text === 'click') {
        listened.add(key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { ids, sinks, listened };
}

/** Panels `wiring` draws into that no click listener covers, as sentences. */
function unreachablePanels(
  wiring: ReturnType<typeof wiringOf>,
  tree: Map<string, string[]>,
): string[] {
  const roots = new Set([...wiring.listened].map((k) => wiring.ids.get(k) ?? `?${k}`));
  const problems: string[] = [];
  for (const key of [...wiring.sinks].sort()) {
    const id = wiring.ids.get(key);
    if (id === undefined) {
      problems.push(`dom.${key} is written to but is not in the \`dom\` map, so its id is unknown`);
      continue;
    }
    const chain = tree.get(id);
    if (chain === undefined) {
      problems.push(`dom.${key} writes into #${id}, which is not in src/ui/index.html`);
      continue;
    }
    if (!roots.has(id) && !chain.some((a) => roots.has(a))) {
      problems.push(
        `dom.${key} draws into #${id}, and neither it nor any of its ancestors ` +
          `[${chain.filter((a) => a !== '').join(', ')}] has a click listener. A control drawn ` +
          `there is dead. Listen on #${id}, or draw it inside one of [${[...roots].join(', ')}].`,
      );
    }
  }
  return problems;
}

test('every panel the run app draws into is inside something that hears a click', () => {
  const source = readFileSync('src/ui/runapp.ts', 'utf8');
  const html = readFileSync('src/ui/index.html', 'utf8');
  const wiring = wiringOf(source);
  const tree = ancestry(html);

  // Instrument checks, before the result is believed. A detector that found no
  // panels and no listeners would report an empty problem list exactly as a
  // correctly wired app does.
  assert.ok(wiring.ids.size >= 8, `found ${wiring.ids.size} element(s) in the dom map; the scan looks wrong`);
  assert.ok(wiring.sinks.size >= 5, `found ${wiring.sinks.size} panel(s) written to; the scan looks wrong`);
  assert.ok(wiring.listened.size >= 2, `found ${wiring.listened.size} click listener(s); the scan looks wrong`);
  assert.ok(tree.has('run') && tree.has('run-status'), 'index.html lost #run or #run-status');

  assert.deepEqual(unreachablePanels(wiring, tree), []);

  // The hard case, named rather than left to luck: the HUD is outside `#run`,
  // so it is covered only by a listener of its own. This is the instance the
  // review found - Restart sat there, dead, from unit 8 to unit 12.
  const hudChain = tree.get('run-status')!;
  assert.ok(hudChain.includes('app'), '#run-status is not inside #app any more');
  assert.equal(
    hudChain.includes('run'),
    false,
    '#run-status is now inside #run, so this gate has stopped testing the case it exists for',
  );
  // The control: a panel that *is* inside #run, so "not inside #run" above is a
  // fact about the HUD rather than about the ancestry walk.
  assert.ok(tree.get('run-node')!.includes('run'), '#run-node is not inside #run; the walk looks wrong');
  assert.ok(wiring.sinks.has('status'), 'the HUD is no longer drawn into, so this gate proves less');
  assert.ok(wiring.listened.has('status'), 'the HUD lost its click listener; every button in it is dead');

  // The detector fires: the same analysis over an app that draws a panel into
  // an element no listener covers reports it.
  const probe = wiringOf(
    [
      'const dom = {',
      "  run: need<HTMLElement>('run'),",
      "  status: need<HTMLElement>('run-status'),",
      '};',
      "dom.run.innerHTML = '<button data-run=\"x\">x</button>';",
      "dom.status.innerHTML = '<button data-run=\"y\">y</button>';",
      "dom.run.addEventListener('click', onRunClick);",
    ].join('\n'),
  );
  const found = unreachablePanels(probe, tree);
  assert.equal(found.length, 1, `the probe should report exactly one dead panel, it reported ${found.length}`);
  assert.match(found[0]!, /dom\.status draws into #run-status/);
  assert.match(found[0]!, /has a click listener/);
});
