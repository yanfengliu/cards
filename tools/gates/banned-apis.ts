/**
 * Gate: `Math.random`, `Date.now` and `performance.now` appear nowhere outside
 * `src/engine/rng.ts`.
 *
 * ARCHITECTURE.md: "those three are how determinism dies quietly." A fight is a
 * pure function of its seed and its action list, and each of these three is a
 * hidden extra argument that would make a replay diverge without any diff to
 * show for it.
 *
 * Bound of this gate -- what a green run does and does not prove:
 *
 *   Scans   every `.ts` file under `src/`, `test/` and `tools/`, except
 *           `src/engine/rng.ts`, which is the one place allowed to name them
 *           (it names them in a comment, saying it does not call them).
 *   Reads   the TypeScript AST, so comments and string literals are invisible
 *           to it. That is load-bearing: `src/engine/rng.ts` and
 *           `src/sim/measure.ts` both carry comments containing the literal
 *           text of all three names, and a grep gate goes red on a clean tree.
 *   Catches property access (`Math.random`), through an outer object
 *           (`globalThis.Math.random`, `window.performance.now`), computed
 *           access with a literal key (`Math['random']`), and destructuring
 *           (`const { now } = Date`).
 *   Misses  access laundered through a value the parser cannot follow:
 *           `const M = Math; M.random()`, a key built at runtime
 *           (`Math['ran' + 'dom']`), a name reached by reflection, and any
 *           non-`.ts` file. It also does not ban `new Date()`, which
 *           ARCHITECTURE.md's list does not name; `tools/heraldry-probe`
 *           stamps its manifest with one.
 *   Ignores whether the call is reachable. An unreachable `Math.random` still
 *           fails, on purpose.
 *
 * Exit 0 clean, 1 on a violation, 2 if the gate could not run.
 */

import ts from 'typescript';
import { nonEmpty, parse, rel, tsFilesUnder } from './scan.ts';

/** The allowed home. Named as a repo-relative path with forward slashes. */
const EXEMPT = 'src/engine/rng.ts';

/** object -> the member on it that is banned. */
const BANNED = new Map<string, string>([
  ['Math', 'random'],
  ['Date', 'now'],
  ['performance', 'now'],
]);

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}

/**
 * The trailing identifier of an object expression, so `Math`, `globalThis.Math`
 * and `window.performance` all reduce to the name that matters.
 */
function objectName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isParenthesizedExpression(expr)) return objectName(expr.expression);
  return undefined;
}

/** The literal key of a computed access, when there is one. */
function literalKey(expr: ts.Expression): string | undefined {
  if (ts.isStringLiteral(expr)) return expr.text;
  if (ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  return undefined;
}

function hit(object: string | undefined, member: string | undefined): boolean {
  return object !== undefined && member !== undefined && BANNED.get(object) === member;
}

function scan(source: ts.SourceFile, file: string): Violation[] {
  const found: Violation[] = [];

  const record = (node: ts.Node): void => {
    const at = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({
      file,
      line: at.line + 1,
      column: at.character + 1,
      text: node.getText(source).replace(/\s+/g, ' ').slice(0, 80),
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      if (hit(objectName(node.expression), node.name.text)) record(node);
    } else if (ts.isElementAccessExpression(node)) {
      if (hit(objectName(node.expression), literalKey(node.argumentExpression))) record(node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined
    ) {
      const object = objectName(node.initializer);
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name;
        const member = ts.isIdentifier(key) ? key.text : literalKeyOfName(key);
        if (hit(object, member)) record(node);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

function literalKeyOfName(name: ts.PropertyName | ts.BindingName): string | undefined {
  if (ts.isStringLiteral(name)) return name.text;
  return undefined;
}

/**
 * Instrument check. The detector is asked to find a known set of violations
 * before it is trusted to report their absence.
 */
function selfTest(): void {
  const probe = [
    'const a = Math.random();',
    'const b = Date.now();',
    'const c = performance.now();',
    'const d = globalThis.Math.random();',
    "const e = Math['random']();",
    'const { now } = Date;',
    '// Math.random in a comment must not count.',
    'const g = "Date.now in a string must not count.";',
    'const h = Math.floor(1.5);',
  ].join('\n');
  const source = ts.createSourceFile(
    'gate-self-test.ts',
    probe,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  const found = scan(source, 'gate-self-test.ts');
  const expected = 6;
  if (found.length !== expected) {
    console.error(
      `GATE BROKEN: the banned-API detector found ${found.length} violations in its own ` +
        `self-test, expected ${expected}. It cannot be trusted to report an absence. ` +
        `Found: ${found.map((f) => `${f.line}:${f.text}`).join(' | ') || '(none)'}`,
    );
    process.exit(2);
  }
}

function main(): void {
  selfTest();

  const files = nonEmpty(
    [...tsFilesUnder('src'), ...tsFilesUnder('test'), ...tsFilesUnder('tools')],
    'banned APIs',
  );

  const violations: Violation[] = [];
  let scanned = 0;
  for (const absolute of files) {
    const name = rel(absolute);
    if (name === EXEMPT) continue;
    scanned++;
    violations.push(...scan(parse(absolute), name));
  }

  if (violations.length > 0) {
    console.error(
      `Banned API gate FAILED: ${violations.length} use(s) of Math.random, Date.now or ` +
        `performance.now outside ${EXEMPT}.`,
    );
    console.error('');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}:${v.column}  ${v.text}`);
    }
    console.error('');
    console.error(
      `These three are how determinism dies quietly: a fight must be a pure function of its ` +
        `seed and its action list. Route the randomness through an \`Rng\` from ${EXEMPT}, ` +
        `which is part of the fight state and therefore part of the replay.`,
    );
    process.exit(1);
  }

  console.log(
    `Banned API gate OK: ${scanned} file(s) under src/, test/ and tools/ (excluding ${EXEMPT}) ` +
      `name none of Math.random, Date.now, performance.now outside comments and strings.`,
  );
}

// Called unconditionally. A `require.main`-style guard here would turn "the
// gate did not run" into a silent exit 0, which is the failure this file exists
// to avoid.
main();
