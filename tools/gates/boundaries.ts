/**
 * Gate: `src/engine/` imports nothing from `src/content/`, `src/render/`,
 * `src/ui/` or `tools/`, and touches no DOM global.
 *
 * ARCHITECTURE.md: "`engine` depends on nothing, and everything depends on
 * `engine`", and "make this a lint rule, not a good intention." The engine is
 * the thing a seed and an action list replay through; anything it reaches for
 * that lives above it is a second input the replay does not carry.
 *
 * `src/content/` is on that list for the same reason and was the one the
 * diagram already forbade and the code did anyway: content imports engine
 * types, and engine imported content's cards back, so the one-way arrow was a
 * cycle. A cycle is not a boundary. A fight is handed a `CardPool`.
 *
 * Bound of this gate -- what a green run does and does not prove:
 *
 *   Scans   every `.ts` file under `src/engine/`. Only that direction: the rule
 *           is one-way, and everything is free to import `engine`.
 *   Catches static `import`/`export ... from`, `import type`, side-effect
 *           imports, dynamic `import()` and `require()` with a literal
 *           specifier -- resolved relative to the importing file, so `../` and
 *           `../../` paths land in the same place a bundler would put them.
 *   Catches a reference to any global declared only in `lib.dom`, resolved
 *           through the TypeScript checker rather than a hand-written word
 *           list. `console` and `fetch` are not DOM-only -- Node declares them
 *           too -- so they do not trip it; `document`, `window`, `HTMLElement`
 *           and `requestAnimationFrame` are, and do.
 *   Misses  a specifier built at runtime (`import(base + name)`), a boundary
 *           crossed through a third module that is itself allowed, and a DOM
 *           object handed in as an argument typed `unknown`. It does not
 *           police `node:` builtins, which ARCHITECTURE.md's rule does not
 *           name -- `engine` imports none today.
 *   Depends on `lib.dom` being loadable. If it is not, the DOM half of this
 *           gate would pass vacuously, so the gate refuses to run instead.
 *
 * Every forbidden prefix and the DOM half are proved live on every run against
 * a probe file that violates each of them, so a green result means the detector
 * fired for each one and not merely that it found nothing.
 *
 * Exit 0 clean, 1 on a violation, 2 if the gate could not run.
 */

import * as path from 'node:path';
import ts from 'typescript';
import { ROOT, nonEmpty, rel, tsFilesUnder, tsconfigOptions } from './scan.ts';

/**
 * Repo-relative prefixes `src/engine/` may not reach into, each paired with a
 * specifier that lands inside it when written in a file in `src/engine/`. That
 * specifier is the prefix's own probe: every prefix is made to fire on every
 * run, so a prefix that has quietly stopped matching says so instead of
 * passing. A probe specifier does not have to resolve to a file - the import
 * half of this rule is path arithmetic, and `src/ui/` does not exist yet - but
 * two of the four do, which is what keeps the arithmetic honest.
 */
const FORBIDDEN: readonly { readonly prefix: string; readonly probe: string }[] = [
  { prefix: 'src/content/', probe: '../content/cards.ts' },
  { prefix: 'src/render/', probe: '../render/heraldry/card.ts' },
  { prefix: 'src/ui/', probe: '../ui/input.ts' },
  { prefix: 'tools/', probe: '../../tools/gates/__probe__.ts' },
];

const PREFIXES: readonly string[] = FORBIDDEN.map((f) => f.prefix);

/** A virtual file, never written to disk, that breaks every half of the rule. */
const PROBE = path.join(ROOT, 'src', 'engine', '__gate_probe__.ts');
const PROBE_SOURCE = [
  ...FORBIDDEN.map((f) => `import ${JSON.stringify(f.probe)};`),
  'export const probeTitle: string = document.title;',
  '',
].join('\n');

const LIB_DOM = /[\\/]lib\.dom(\.[a-z]+)*\.d\.ts$/;

interface Violation {
  readonly kind: 'import' | 'dom';
  /** Which forbidden prefix an import landed under; null for a DOM reference. */
  readonly under: string | null;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly detail: string;
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

/** The literal text of a module specifier, when the node has one. */
function specifierOf(node: ts.Node): ts.StringLiteralLike | undefined {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier;
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
    const first = node.arguments[0];
    if ((isDynamicImport || isRequire) && first !== undefined && ts.isStringLiteralLike(first)) {
      return first;
    }
  }
  if (
    ts.isImportTypeNode(node) &&
    ts.isLiteralTypeNode(node.argument) &&
    ts.isStringLiteralLike(node.argument.literal)
  ) {
    return node.argument.literal;
  }
  return undefined;
}

/**
 * Where a specifier lands, as a repo-relative posix path. Bare specifiers
 * (`node:fs`, `typescript`) return undefined: they are not repo paths and this
 * rule is about repo directories.
 */
function landsAt(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  return rel(path.resolve(path.dirname(fromFile), specifier));
}

/** True when the identifier is a name being declared or a member being named. */
function isNameSlot(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node & { name?: ts.Node; right?: ts.Node };
  if (parent === undefined) return false;
  if (parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  return false;
}

function at(source: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}

function analyse(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  displayName: string,
): Violation[] {
  const found: Violation[] = [];

  const visit = (node: ts.Node): void => {
    const specifier = specifierOf(node);
    if (specifier !== undefined) {
      const target = landsAt(source.fileName, specifier.text);
      if (target !== undefined) {
        const hit = PREFIXES.find((prefix) => `${target}/`.startsWith(prefix));
        if (hit !== undefined) {
          found.push({
            kind: 'import',
            under: hit,
            file: displayName,
            ...at(source, specifier),
            detail: `imports ${JSON.stringify(specifier.text)}, which is ${target} under ${hit}`,
          });
        }
      }
    }

    if (ts.isIdentifier(node) && !isNameSlot(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const declarations = symbol?.declarations;
      if (
        declarations !== undefined &&
        declarations.length > 0 &&
        declarations.every((d) => LIB_DOM.test(d.getSourceFile().fileName))
      ) {
        found.push({
          kind: 'dom',
          under: null,
          file: displayName,
          ...at(source, node),
          detail: `references the DOM global \`${node.text}\``,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

function main(): void {
  const engineFiles = nonEmpty(tsFilesUnder('src/engine'), 'the engine import boundary');

  const options = tsconfigOptions();
  const libs = options.lib ?? [];
  if (!libs.some((l) => LIB_DOM.test(l))) {
    options.lib = [...libs, 'lib.dom.d.ts'];
  }

  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (f) => (samePath(f, PROBE) ? PROBE_SOURCE : readFile(f));
  host.fileExists = (f) => (samePath(f, PROBE) ? true : fileExists(f));
  host.getSourceFile = (f, version, onError, shouldCreate) =>
    samePath(f, PROBE)
      ? ts.createSourceFile(f, PROBE_SOURCE, version, true, ts.ScriptKind.TS)
      : getSourceFile(f, version, onError, shouldCreate);

  const program = ts.createProgram({
    rootNames: [...engineFiles, PROBE],
    options,
    host,
  });
  const checker = program.getTypeChecker();

  if (!program.getSourceFiles().some((f) => LIB_DOM.test(f.fileName))) {
    console.error(
      'GATE BROKEN: lib.dom was not loaded, so the DOM half of this gate would pass ' +
        'without checking anything. Refusing to report a result.',
    );
    process.exit(2);
  }

  // Instrument check: the detector is made to fire before it is trusted to
  // report an absence.
  const probeSource = program.getSourceFile(PROBE);
  if (probeSource === undefined) {
    console.error('GATE BROKEN: the probe file was not added to the program. The gate did not run.');
    process.exit(2);
  }
  const probeHits = analyse(probeSource, checker, 'src/engine/__gate_probe__.ts');
  const probeImports = probeHits.filter((v) => v.kind === 'import');
  const probeDom = probeHits.filter((v) => v.kind === 'dom').length;
  const firedFor = new Set(probeImports.map((v) => v.under));
  const silent = PREFIXES.filter((p) => !firedFor.has(p));
  if (probeImports.length !== FORBIDDEN.length || probeDom !== 1 || silent.length > 0) {
    console.error(
      `GATE BROKEN: the probe should trip one import violation per forbidden prefix ` +
        `(${FORBIDDEN.length}) and one DOM violation; it tripped ${probeImports.length} and ` +
        `${probeDom}${silent.length > 0 ? `, and stayed silent on ${silent.join(', ')}` : ''}. ` +
        `The detector cannot be trusted to report an absence.`,
    );
    process.exit(2);
  }

  const violations: Violation[] = [];
  for (const file of engineFiles) {
    const source = program.getSourceFile(file);
    if (source === undefined) {
      console.error(`GATE BROKEN: ${rel(file)} is not in the program. The gate did not run.`);
      process.exit(2);
    }
    violations.push(...analyse(source, checker, rel(file)));
  }

  if (violations.length > 0) {
    console.error(
      `Import boundary gate FAILED: ${violations.length} violation(s) of the rule that ` +
        `src/engine/ imports nothing from ${PREFIXES.join(', ')} and touches no DOM global.`,
    );
    console.error('');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}:${v.column}  ${v.detail}`);
    }
    console.error('');
    console.error(
      'The engine is replayed from a seed and an action list. Anything it reaches for above ' +
        'itself is a second input the replay does not carry. Move the code that needs content, ' +
        'render, ui, tools or the DOM out of the engine, and let it import the engine instead. ' +
        'Cards are handed to a fight as a CardPool; the engine does not reach for them.',
    );
    process.exit(1);
  }

  console.log(
    `Import boundary gate OK: ${engineFiles.length} file(s) under src/engine/ import nothing ` +
      `from ${PREFIXES.join(', ')} and reference no DOM-only global. ` +
      `Probe check: detector fired for every prefix and for the DOM half.`,
  );
}

// Called unconditionally, for the same reason as banned-apis.ts.
main();
