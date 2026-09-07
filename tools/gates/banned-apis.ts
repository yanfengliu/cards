/**
 * Gate: the hidden inputs that would make a replay diverge appear nowhere in
 * the code the engine's determinism depends on.
 *
 * Two rules, because they are banned for the same reason but not over the same
 * ground:
 *
 *   `member` -- `Math.random`, `Date.now`, `performance.now`.
 *               ARCHITECTURE.md: "those three are how determinism dies
 *               quietly." Scanned under `src/`, `test/` and `tools/`, except
 *               `src/engine/rng.ts`, the one place allowed to name them.
 *
 *   `clock`  -- `new Date()` with no arguments, and `Date()` called without
 *               `new`. Both read the wall clock and neither is on
 *               ARCHITECTURE.md's list of three, which is an omission rather
 *               than a decision: a fight seeded off `new Date()` is exactly as
 *               unreproducible as one seeded off `Date.now()`. Scanned under
 *               `src/` and `test/` only.
 *
 * Why `clock` stops at `src/` and `test/` rather than exempting a file by name:
 * the ban is on code the engine's determinism depends on, and `tools/` is not
 * that code by construction, not by assertion -- `npm run gate:boundaries`
 * fails if anything under `src/engine/` imports from `tools/`, so nothing there
 * can enter a fight. `tools/heraldry-probe/shoot.ts` stamps its manifest with
 * `new Date().toISOString()`, which is the manifest's whole point, and a second
 * probe may do the same tomorrow without editing this file. `new Date(x)` with
 * an argument is not banned anywhere: it is a pure function of `x`.
 *
 * Bound of this gate -- what a green run does and does not prove:
 *
 *   Scans   every `.ts` file under `src/`, `test/` and `tools/` for `member`,
 *           and every `.ts` file under `src/` and `test/` for `clock`. No file
 *           is exempt from `clock`, `src/engine/rng.ts` included.
 *   Reads   the TypeScript AST, so comments and string literals are invisible
 *           to it. That is load-bearing: `src/engine/rng.ts` and
 *           `src/sim/measure.ts` both carry comments containing the literal
 *           text of all three member names, and a grep gate goes red on a clean
 *           tree because of them.
 *   Catches property access (`Math.random`), through an outer object
 *           (`globalThis.Math.random`, `window.performance.now`), computed
 *           access with a literal key (`Math['random']`), destructuring
 *           (`const { now } = Date`), `new Date()`, `new Date` without parens,
 *           `new globalThis.Date()`, and `Date()` as a plain call.
 *   Misses  access laundered through a value the parser cannot follow:
 *           `const M = Math; M.random()`, `const D = Date; new D()`, a key
 *           built at runtime (`Math['ran' + 'dom']`), a name reached by
 *           reflection, and any non-`.ts` file. It also misses a clock read
 *           inside `tools/`, which is the scope decision above rather than an
 *           oversight, and every other ambient input a replay does not carry -
 *           `process.env`, the file system, the network.
 *   Ignores whether the call is reachable. An unreachable `Math.random` still
 *           fails, on purpose.
 *
 * Exit 0 clean, 1 on a violation, 2 if the gate could not run.
 */

import ts from 'typescript';
import { nonEmpty, parse, rel, tsFilesUnder } from './scan.ts';

type Rule = 'member' | 'clock';

/** The allowed home for the three member names. Repo-relative, forward slashes. */
const EXEMPT = 'src/engine/rng.ts';

/** Directory prefixes each rule is scanned over. */
const SCOPE: Record<Rule, readonly string[]> = {
  member: ['src/', 'test/', 'tools/'],
  clock: ['src/', 'test/'],
};

/** object -> the member on it that is banned. */
const BANNED = new Map<string, string>([
  ['Math', 'random'],
  ['Date', 'now'],
  ['performance', 'now'],
]);

interface Violation {
  readonly rule: Rule;
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

function scan(source: ts.SourceFile, file: string, rules: ReadonlySet<Rule>): Violation[] {
  const found: Violation[] = [];

  const record = (node: ts.Node, rule: Rule): void => {
    const at = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({
      rule,
      file,
      line: at.line + 1,
      column: at.character + 1,
      text: node.getText(source).replace(/\s+/g, ' ').slice(0, 80),
    });
  };

  const members = rules.has('member');
  const clocks = rules.has('clock');

  const visit = (node: ts.Node): void => {
    if (members && ts.isPropertyAccessExpression(node)) {
      if (hit(objectName(node.expression), node.name.text)) record(node, 'member');
    } else if (members && ts.isElementAccessExpression(node)) {
      if (hit(objectName(node.expression), literalKey(node.argumentExpression))) {
        record(node, 'member');
      }
    } else if (
      members &&
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined
    ) {
      const object = objectName(node.initializer);
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name;
        const member = ts.isIdentifier(key) ? key.text : literalKeyOfName(key);
        if (hit(object, member)) record(node, 'member');
      }
    } else if (clocks && ts.isNewExpression(node)) {
      // `new Date()` and `new Date` read the clock. `new Date(x)` is a pure
      // function of `x` and is left alone.
      const argc = node.arguments?.length ?? 0;
      if (objectName(node.expression) === 'Date' && argc === 0) record(node, 'clock');
    } else if (clocks && ts.isCallExpression(node)) {
      // `Date()` without `new` returns the current time as a string whatever
      // arguments it is given. `Date.now()` is a property access and is the
      // `member` rule's business, not this one's.
      if (objectName(node.expression) === 'Date') record(node, 'clock');
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

/** Which rules apply to one repo-relative file path. */
function rulesFor(file: string): Set<Rule> {
  const rules = new Set<Rule>();
  if (file !== EXEMPT && SCOPE.member.some((p) => file.startsWith(p))) rules.add('member');
  if (SCOPE.clock.some((p) => file.startsWith(p))) rules.add('clock');
  return rules;
}

/**
 * Instrument check. The detector is asked to find a known set of violations
 * before it is trusted to report their absence, per rule -- a self-test that
 * only counted the total would pass with one rule dead and the other
 * over-firing.
 */
function selfTest(): void {
  const probe = [
    'const a = Math.random();',
    'const b = Date.now();',
    'const c = performance.now();',
    'const d = globalThis.Math.random();',
    "const e = Math['random']();",
    'const { now } = Date;',
    '// Math.random and new Date() in a comment must not count.',
    'const g = "Date.now and new Date() in a string must not count.";',
    'const h = Math.floor(1.5);',
    'const i = new Date();',
    'const j = new Date;',
    'const k = new globalThis.Date();',
    'const l = Date();',
    'const m = new Date(0);',
    'const n = new Date(2026, 0, 1);',
    'const o = new Map();',
  ].join('\n');
  const source = ts.createSourceFile(
    'gate-self-test.ts',
    probe,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
  const found = scan(source, 'gate-self-test.ts', new Set<Rule>(['member', 'clock']));
  const expected: Record<Rule, number> = { member: 6, clock: 4 };
  const actual: Record<Rule, number> = {
    member: found.filter((f) => f.rule === 'member').length,
    clock: found.filter((f) => f.rule === 'clock').length,
  };
  for (const rule of ['member', 'clock'] as const) {
    if (actual[rule] !== expected[rule]) {
      console.error(
        `GATE BROKEN: the banned-API detector found ${actual[rule]} "${rule}" violation(s) in ` +
          `its own self-test, expected ${expected[rule]}. It cannot be trusted to report an ` +
          `absence. Found: ${found.map((f) => `${f.rule}@${f.line}:${f.text}`).join(' | ') || '(none)'}`,
      );
      process.exit(2);
    }
  }
}

function main(): void {
  selfTest();

  const files = nonEmpty(
    [...tsFilesUnder('src'), ...tsFilesUnder('test'), ...tsFilesUnder('tools')],
    'banned APIs',
  );

  const violations: Violation[] = [];
  const scanned: Record<Rule, number> = { member: 0, clock: 0 };
  for (const absolute of files) {
    const name = rel(absolute);
    const rules = rulesFor(name);
    if (rules.size === 0) continue;
    for (const rule of rules) scanned[rule]++;
    violations.push(...scan(parse(absolute), name, rules));
  }
  if (scanned.member === 0 || scanned.clock === 0) {
    console.error(
      `GATE BROKEN: one of the rules had no files in scope (member: ${scanned.member}, ` +
        `clock: ${scanned.clock}). A rule that scanned nothing reports "did not run" as "passed".`,
    );
    process.exit(2);
  }

  if (violations.length > 0) {
    const members = violations.filter((v) => v.rule === 'member');
    const clocks = violations.filter((v) => v.rule === 'clock');
    console.error(`Banned API gate FAILED: ${violations.length} hidden input(s) into the engine.`);
    console.error('');
    if (members.length > 0) {
      console.error(
        `  ${members.length} use(s) of Math.random, Date.now or performance.now outside ${EXEMPT}:`,
      );
      for (const v of members) console.error(`    ${v.file}:${v.line}:${v.column}  ${v.text}`);
      console.error('');
    }
    if (clocks.length > 0) {
      console.error(
        `  ${clocks.length} wall-clock read(s) via the Date constructor under ` +
          `${SCOPE.clock.join(' or ')}:`,
      );
      for (const v of clocks) console.error(`    ${v.file}:${v.line}:${v.column}  ${v.text}`);
      console.error('');
    }
    console.error(
      `These are how determinism dies quietly: a fight must be a pure function of its seed and ` +
        `its action list, and each of them is a hidden extra argument the replay does not carry. ` +
        `Route randomness through an \`Rng\` from ${EXEMPT}, which is part of the fight state and ` +
        `therefore part of the replay. For a timestamp, either take it as an argument or move the ` +
        `code to \`tools/\`, which the engine cannot import.`,
    );
    process.exit(1);
  }

  console.log(
    `Banned API gate OK: ${scanned.member} file(s) under ${SCOPE.member.join(', ')} ` +
      `(excluding ${EXEMPT}) name none of Math.random, Date.now, performance.now, and ` +
      `${scanned.clock} file(s) under ${SCOPE.clock.join(', ')} read no wall clock through ` +
      `\`new Date()\` or \`Date()\` - outside comments and strings in both cases.`,
  );
}

// Called unconditionally. A `require.main`-style guard here would turn "the
// gate did not run" into a silent exit 0, which is the failure this file exists
// to avoid.
main();
