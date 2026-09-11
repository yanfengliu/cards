// The markup this app builds by string concatenation: escaped once, and drawn
// somewhere that can hear a click.
//
// Three claims, all about wiring rather than about what any screen says. The
// first two were found by an independent review reading code that every one of
// 237 tests ran straight past; the third was found by a second review reading
// *this file*, which had gone narrow in three separate ways.
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
//   **A pinned session's writes are all routed through one flag.** `persist` is
//   false while `?unlocks=` pins the pool, and the three storage functions each
//   take it and no-op. Threading it was prose: nothing checked that every call
//   site passed it rather than `true`.
//
// Bound of this file - what a green run does and does not prove:
//
//   The **escaper** half walks `src/` off the filesystem and reads each file as
//   a TypeScript AST, so it sees an entity written in any quote style and in a
//   template literal. It was a substring search for `'&amp;'` with single
//   quotes, which a second escaper written with double quotes walked straight
//   past - the review reintroduced the original `>` -> `&quot;` defect that way
//   and it passed. One entity is enough to be an escaper here, because exactly
//   one file under `src/` writes one at all, so a *partial* escaper that never
//   handles `&` is caught as well. It does not see an escaper that builds its
//   entities by concatenation (`'&' + 'amp;'`) or one in another repo.
//
//   The **panel** half reads `src/ui/index.html` as markup and every file under
//   `src/ui/` that holds a `dom` map as a TypeScript AST; it runs no DOM and
//   clicks nothing. That file list is *discovered*, not restated - the previous
//   version named `src/ui/runapp.ts` in the test body while the escaper half of
//   this same file walked the filesystem, which is the rule that landed in
//   `docs/policies/local-rules.md` broken in one half of one file. A file with a
//   `dom` map that is neither analysed nor in `NOT_ANALYSED` turns this red.
//
//   It proves that every element such a file draws into is, or is inside, an
//   element it attaches a click listener to. "Draws into" now covers `innerHTML`
//   and `outerHTML` assignment, the DOM's own insert calls, a **local alias**
//   (`const hud = dom.status; hud.innerHTML = …`) and a panel **handed to a
//   helper** (`attachHtml(dom.node, …)`) - that last one is not hypothetical,
//   `src/ui/sigils.ts` exports `attachHtml`, and a two-line local helper plus a
//   removed listener passed the previous version 2/2 with a dead button.
//
//   Loose in the safe direction, deliberately: a panel handed to a helper that
//   only *reads* it is counted as drawn into, so this gate can report a panel
//   that is not in fact dead. That direction costs a false alarm; the other
//   direction ships a dead button.
//
//   It does **not** prove that the listener's switch handles the action a given
//   button names, that the handler does the right thing, or that anything is
//   visible. A click on a real control in a real browser is
//   `node tools/ui-probe/run.ts`, which is outside `npm run gates` because it
//   needs Chrome.
//
//   One thing it deliberately does not do: treat a click listener on
//   `document.body` as covering every panel. `runapp.ts` has one, and it is a
//   narrow filter for the theme and hatch buttons rather than a delegation
//   root, so that rule would have made this gate pass an app whose every panel
//   was dead. `src/ui/app.ts` reaches its controls exactly that way, through
//   `wireInput(document.body, …)`, and is excused by name in `NOT_ANALYSED`
//   rather than silently left out.
//
//   Every detector here is made to fire on a built-in probe before it is
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

/** Every `.ts` file under `dir`, repo-relative with forward slashes. */
function tsFilesUnder(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) files.push(full.split(path.sep).join('/'));
    }
  };
  walk(dir);
  return files.sort();
}

/** A file parsed once, for the several walks below. */
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', source, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
}

// ---------------------------------------------------------------------------
// One escaper
// ---------------------------------------------------------------------------

/**
 * The entities an escaper produces. Matched against string literals read off
 * the AST, so the quote style an author happened to use is irrelevant - which
 * it was not when this was `source.includes("'&amp;'")`, and a second escaper
 * written with double quotes was invisible to it.
 */
const ENTITIES: readonly string[] = ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;', '&apos;'];

/** Which of `ENTITIES` a file writes as a literal. */
function entitiesWritten(source: string): string[] {
  const lits: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n)) lits.push(n.text);
    if (ts.isTemplateExpression(n)) {
      lits.push(n.head.text);
      for (const span of n.templateSpans) lits.push(span.literal.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(source));
  return ENTITIES.filter((e) => lits.some((l) => l.includes(e)));
}

test('text becomes markup through one escaper, and there is no second copy of it', () => {
  assert.equal(escapeHtml('&<>"'), '&amp;&lt;&gt;&quot;');
  // `&` first, or the other three are escaped twice.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  assert.equal(escapeHtml('a > b'), 'a &gt; b', 'the `>` case, which is the one that was wrong');
  assert.equal(escapeHtml('Scout > Skirmisher'), 'Scout &gt; Skirmisher');
  assert.equal(escapeHtml('nothing to do'), 'nothing to do');
  // Through a real render path, not only directly.
  assert.match(iconSvg('health', { size: 13, label: 'a > b' }), /a &gt; b/);

  const files = tsFilesUnder('src');
  assert.ok(files.length > 20, `walked only ${files.length} file(s) under src/; the walk looks wrong`);

  const escapers = files.filter((f) => entitiesWritten(readFileSync(f, 'utf8')).length > 0);
  assert.deepEqual(
    escapers,
    ['src/render/escape.ts'],
    'a second HTML escaper appeared. There is one, in src/render/escape.ts, and it is exported - ' +
      'import it rather than copying it, because a copy is a copy of whatever a gate does not cover.',
  );
  // The one escaper writes all four, so a copy that handles three of them - or
  // one that maps `>` to `&quot;`, which is the defect this exists for - is a
  // file writing at least one entity and is caught by the list above.
  assert.deepEqual(
    entitiesWritten(readFileSync('src/render/escape.ts', 'utf8')),
    ['&amp;', '&lt;', '&gt;', '&quot;'],
    'src/render/escape.ts no longer writes all four entities',
  );

  // The detector fires. Each of these is a second escaper the previous version
  // of this check could not see, and each must be found on its own.
  const missed: string[] = [];
  const probes: readonly (readonly [string, string])[] = [
    ['double-quoted entities', 'const f = (c: string) => (c === "&" ? "&amp;" : c);'],
    ['a template literal', 'const f = (c: string) => `${c}&lt;`;'],
    ['a partial escaper that never handles &', "const f = (s: string) => s.replace(/</g, '&lt;');"],
    ['the original defect: > to &quot;', "const f = (c: string) => (c === '>' ? '&quot;' : c);"],
  ];
  for (const [what, src] of probes) {
    if (entitiesWritten(src).length === 0) missed.push(what);
  }
  assert.deepEqual(missed, [], 'the escaper detector stayed silent on a second escaper');
  // ...and does not fire on a file that writes no entity at all.
  assert.deepEqual(entitiesWritten("const f = (s: string) => s.trim();"), []);
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

/** Assigning to one of these puts markup into an element. */
const DRAW_ASSIGN = new Set(['innerHTML', 'outerHTML']);
/** Calling one of these puts markup or elements into an element. */
const DRAW_CALL = new Set([
  'insertAdjacentHTML', 'insertAdjacentElement', 'replaceChildren',
  'append', 'appendChild', 'prepend', 'replaceWith',
]);

/** True when the file declares a `const dom = { … }` map of looked-up elements. */
function hasDomMap(source: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === 'dom' &&
      n.initializer !== undefined &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(parse(source));
  return found;
}

/** Which `dom.<key>` gets drawn into, which gets a click listener, and its id. */
function wiringOf(source: string): {
  readonly ids: Map<string, string>;
  /** key → how it is drawn into, for the failure message. */
  readonly sinks: Map<string, string>;
  readonly listened: Set<string>;
} {
  const file = parse(source);
  const ids = new Map<string, string>();
  const alias = new Map<string, string>();
  const sinks = new Map<string, string>();
  const listened = new Set<string>();

  /** `dom.<key>` → key, for any other expression undefined. */
  const directKey = (node: ts.Expression): string | undefined =>
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'dom'
      ? node.name.text
      : undefined;

  // Pass one: the `dom` map, and local aliases of its entries. An alias is how
  // a panel escapes a detector that only knows `dom.<key>`.
  const collect = (node: ts.Node): void => {
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
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const key = directKey(node.initializer);
      if (key !== undefined) alias.set(node.name.text, key);
    }
    ts.forEachChild(node, collect);
  };
  collect(file);

  /** `dom.<key>`, or a local alias of one. */
  const keyOf = (node: ts.Expression): string | undefined => {
    const direct = directKey(node);
    if (direct !== undefined) return direct;
    return ts.isIdentifier(node) ? alias.get(node.text) : undefined;
  };

  const calleeName = (call: ts.CallExpression): string => {
    const e = call.expression;
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e)) return e.name.text;
    return 'a call';
  };

  const visit = (node: ts.Node): void => {
    // <panel>.innerHTML = … , and `+=`
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) &&
      ts.isPropertyAccessExpression(node.left) &&
      DRAW_ASSIGN.has(node.left.name.text)
    ) {
      const key = keyOf(node.left.expression);
      if (key !== undefined) sinks.set(key, `${node.left.name.text} =`);
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const member = node.expression.name.text;
      const key = keyOf(node.expression.expression);
      if (key !== undefined && DRAW_CALL.has(member)) sinks.set(key, `${member}()`);
      if (key !== undefined && member === 'addEventListener') {
        const first = node.arguments[0];
        if (first !== undefined && ts.isStringLiteralLike(first) && first.text === 'click') {
          listened.add(key);
        }
      }
    }

    // A panel handed to a helper. This gate cannot see inside the helper, and
    // `src/ui/sigils.ts` exports `attachHtml`, so a helper-shaped refactor is
    // the obvious way a draw leaves this file. Counted as a draw: a false alarm
    // on a helper that only reads the element is the safe direction.
    if (ts.isCallExpression(node)) {
      for (const arg of node.arguments) {
        const key = keyOf(arg);
        if (key !== undefined && !sinks.has(key)) {
          sinks.set(key, `handed to ${calleeName(node)}()`);
        }
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
  for (const key of [...wiring.sinks.keys()].sort()) {
    const how = wiring.sinks.get(key)!;
    const id = wiring.ids.get(key);
    if (id === undefined) {
      problems.push(`dom.${key} is drawn into (${how}) but is not in the \`dom\` map, so its id is unknown`);
      continue;
    }
    const chain = tree.get(id);
    if (chain === undefined) {
      problems.push(`dom.${key} draws into #${id}, which is not in src/ui/index.html`);
      continue;
    }
    if (!roots.has(id) && !chain.some((a) => roots.has(a))) {
      problems.push(
        `dom.${key} draws into #${id} (${how}), and neither it nor any of its ancestors ` +
          `[${chain.filter((a) => a !== '').join(', ')}] has a click listener. A control drawn ` +
          `there is dead. Listen on #${id}, or draw it inside one of [${[...roots].join(', ')}].`,
      );
    }
  }
  return problems;
}

/**
 * Files that hold a `dom` map and that this gate does **not** analyse, each with
 * the reason. This is not the gate restating its own subject: the subject is
 * discovered by walking `src/ui/`, and a file found there that is in neither
 * list turns this test red. What an entry buys is that the omission is
 * deliberate and written down, and the test below fails a stale one.
 */
const NOT_ANALYSED: ReadonlyMap<string, string> = new Map([
  [
    'src/ui/app.ts',
    'the fight screen reaches every control through `wireInput(document.body, …)` in ' +
      'src/ui/input.ts, so its listener is on the document rather than on a panel. This ' +
      'detector models a listener attached to a panel and would call every one of its panels ' +
      'dead. Widening it to "a body listener covers everything" is not free: runapp.ts also ' +
      'attaches a click listener to document.body, and that one is a narrow filter for the ' +
      'theme and hatch buttons rather than a delegation root - so that rule would make this ' +
      'gate pass an app whose every panel was dead.',
  ],
]);

test('every panel the run app draws into is inside something that hears a click', () => {
  const html = readFileSync('src/ui/index.html', 'utf8');
  const tree = ancestry(html);
  assert.ok(tree.has('run') && tree.has('run-status'), 'index.html lost #run or #run-status');

  // The subject is read off the filesystem, never restated. A third file that
  // grows a `dom` map is in this gate on the day it does.
  const withDomMap = tsFilesUnder('src/ui').filter((f) => hasDomMap(readFileSync(f, 'utf8')));
  assert.ok(
    withDomMap.length >= 2,
    `found ${withDomMap.length} file(s) under src/ui/ with a dom map; the walk looks wrong`,
  );
  for (const [f, why] of NOT_ANALYSED) {
    assert.ok(
      withDomMap.includes(f),
      `${f} is excused from this gate ("${why}") but no longer has a dom map. Delete the ` +
        `excuse, or fix the walk.`,
    );
  }
  const analysed = withDomMap.filter((f) => !NOT_ANALYSED.has(f));
  assert.deepEqual(
    analysed,
    ['src/ui/runapp.ts'],
    'a file under src/ui/ holds a dom map and is neither analysed by this gate nor listed in ' +
      'NOT_ANALYSED with a reason. Every panel an app draws can hold a control, so every one ' +
      'has to be reachable - bring it in, or say in NOT_ANALYSED why this detector cannot ' +
      'read it.',
  );

  for (const f of analysed) {
    const wiring = wiringOf(readFileSync(f, 'utf8'));

    // Instrument checks, before the result is believed. A detector that found no
    // panels and no listeners would report an empty problem list exactly as a
    // correctly wired app does.
    assert.ok(wiring.ids.size >= 8, `${f}: found ${wiring.ids.size} element(s) in the dom map; the scan looks wrong`);
    assert.ok(wiring.sinks.size >= 5, `${f}: found ${wiring.sinks.size} panel(s) drawn into; the scan looks wrong`);
    assert.ok(wiring.listened.size >= 2, `${f}: found ${wiring.listened.size} click listener(s); the scan looks wrong`);

    assert.deepEqual(unreachablePanels(wiring, tree), [], f);

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
  }

  // The detector fires, once per way a panel can be drawn into. Each probe
  // draws into #run-status and listens only on #run, so each must report
  // exactly one dead panel - and the previous version of this detector saw
  // only the first of them.
  const HEAD = [
    'const dom = {',
    "  run: need<HTMLElement>('run'),",
    "  status: need<HTMLElement>('run-status'),",
    '};',
    "dom.run.innerHTML = '<button data-run=\"x\">x</button>';",
  ];
  const TAIL = "dom.run.addEventListener('click', onRunClick);";
  const SHAPES: readonly (readonly [string, string])[] = [
    ['a direct innerHTML assignment', 'dom.status.innerHTML = \'<button>y</button>\';'],
    ['a local alias', "const hud = dom.status;\nhud.innerHTML = '<button>y</button>';"],
    ['a helper the panel is handed to', 'attachHtml(dom.status, someHtml);'],
    ['replaceChildren', 'dom.status.replaceChildren(makeButton());'],
    ['insertAdjacentHTML', "dom.status.insertAdjacentHTML('beforeend', '<button>y</button>');"],
  ];
  const blind: string[] = [];
  for (const [what, body] of SHAPES) {
    const probe = wiringOf([...HEAD, body, TAIL].join('\n'));
    const found = unreachablePanels(probe, tree);
    const sawIt = found.length === 1 && /dom\.status draws into #run-status/.test(found[0]!);
    if (!sawIt) blind.push(`${what} (reported ${found.length} problem(s))`);
  }
  assert.deepEqual(
    blind,
    [],
    'the panel detector stayed silent on a way of drawing into an element. A draw it cannot ' +
      'see is a dead button it cannot see.',
  );

  // ...and stays quiet when the same panel *is* listened on, so the reports
  // above are about reachability rather than about drawing.
  const wired = wiringOf(
    [...HEAD, 'attachHtml(dom.status, someHtml);', TAIL, "dom.status.addEventListener('click', onRunClick);"].join('\n'),
  );
  assert.deepEqual(unreachablePanels(wired, tree), []);
});

// ---------------------------------------------------------------------------
// A pinned session's writes all go through one flag
// ---------------------------------------------------------------------------

test('every storage call in the run app is routed through the persist flag', () => {
  const source = readFileSync('src/ui/runapp.ts', 'utf8');
  const file = parse(source);

  // The list of functions is read off the file: a storage function is one whose
  // **last parameter is `persist`**. A fourth one written tomorrow is in this
  // gate the day it exists, which a list typed in here would not be.
  const guarded = new Map<string, number>();
  const findGuarded = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name !== undefined && n.parameters.length > 0) {
      const last = n.parameters[n.parameters.length - 1]!;
      if (ts.isIdentifier(last.name) && last.name.text === 'persist') {
        guarded.set(n.name.text, n.parameters.length);
      }
    }
    ts.forEachChild(n, findGuarded);
  };
  findGuarded(file);
  assert.deepEqual(
    [...guarded.keys()].sort(),
    ['forgetRun', 'loadSavedRun', 'saveRun'],
    'the set of storage functions taking a persist flag changed',
  );

  // Every call to one of them passes the flag itself, never a literal. `?unlocks=`
  // pinning the pool means the session touches no stored state at all - not the
  // save, not the profile, and not the *delete*, or opening ?seed=7&unlocks=all
  // would throw away the real run on seed 7.
  const wrong: string[] = [];
  let calls = 0;
  const checkCalls = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const arity = guarded.get(n.expression.text);
      if (arity !== undefined) {
        calls++;
        const last = n.arguments[arity - 1];
        const ok = last !== undefined && ts.isIdentifier(last) && last.text === 'persist';
        if (!ok) {
          const { line } = file.getLineAndCharacterOfPosition(n.getStart(file));
          wrong.push(
            `src/ui/runapp.ts:${line + 1}  ${n.expression.text}(…) is passed ` +
              `\`${last === undefined ? 'nothing' : last.getText(file)}\` where the \`persist\` ` +
              `flag belongs`,
          );
        }
      }
    }
    ts.forEachChild(n, checkCalls);
  };
  checkCalls(file);

  assert.ok(calls >= 6, `found ${calls} storage call(s); the walk looks wrong`);
  assert.deepEqual(
    wrong,
    [],
    'a storage call in the run app does not pass the persist flag. A pinned session ' +
      '(?unlocks=…) must touch no stored state, so every one of these has to be routed ' +
      'through the same flag rather than called unconditionally.',
  );

  // The detector fires: the same walk over a call that hard-codes the flag
  // reports it.
  const probeFile = parse(
    [
      'export function saveRun(log: RunLog, persist: boolean): void {}',
      'function go() { saveRun(l, true); }',
    ].join('\n'),
  );
  let probeWrong = 0;
  const probeWalk = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'saveRun'
    ) {
      const last = n.arguments[1];
      if (!(last !== undefined && ts.isIdentifier(last) && last.text === 'persist')) probeWrong++;
    }
    ts.forEachChild(n, probeWalk);
  };
  probeWalk(probeFile);
  assert.equal(probeWrong, 1, 'the persist detector did not fire on a hard-coded flag');
});
