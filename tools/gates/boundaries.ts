/**
 * Gate: `src/engine/` imports nothing from `src/content/`, `src/render/`,
 * `src/ui/` or `tools/`, and neither `src/engine/` nor `src/run/` touches a DOM
 * global.
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
 * **`src/run/` is scanned for the hidden-input halves only** - the DOM and
 * browser storage - and the reason is the design's "no persistent power": the
 * run layer is a pure function of a seed, a class and an unlock set, and
 * storage is the one way a number could reach it from outside that.
 * `test/unlocks.test.ts` holds two runs at different unlock sets to identical
 * starting state, which cannot see a bonus read from storage - it would move
 * both arms alike. The import half is *not* applied here: `src/run/content.ts`
 * binds the run layer to `src/content/` by design, so the rule there is about
 * hidden inputs rather than about direction.
 *
 * Bound of this gate -- what a green run does and does not prove:
 *
 *   Scans   every `.ts` file under `src/engine/` for both halves, and every
 *           `.ts` file under `src/run/` for the DOM half. Only those
 *           directions: the import rule is one-way, and everything is free to
 *           import `engine`.
 *   Catches static `import`/`export ... from`, `import type`, side-effect
 *           imports, dynamic `import()` and `require()` with a literal
 *           specifier -- resolved relative to the importing file, so `../` and
 *           `../../` paths land in the same place a bundler would put them.
 *   Catches a reference to any global declared only in `lib.dom`, resolved
 *           through the TypeScript checker rather than a hand-written word
 *           list. `console` and `fetch` are not DOM-only -- Node declares them
 *           too -- so they do not trip it; `document`, `window`, `indexedDB`
 *           and `requestAnimationFrame` are, and do.
 *   Catches a reference to `localStorage` or `sessionStorage` by name, because
 *           `@types/node` declares both and the checker rule above therefore
 *           cannot see them. See `STORAGE_GLOBALS`.
 *   Misses  a specifier built at runtime (`import(base + name)`), a boundary
 *           crossed through a third module that is itself allowed, and a DOM
 *           object handed in as an argument typed `unknown`. It does not
 *           police `node:` builtins, which ARCHITECTURE.md's rule does not
 *           name -- `engine` imports none today. It says nothing about
 *           `src/sim/` or `src/render/`.
 *   Depends on `lib.dom` being loadable. If it is not, the DOM half of this
 *           gate would pass vacuously, so the gate refuses to run instead.
 *
 * Every forbidden prefix and the DOM half are proved live on every run, per
 * scanned directory, against a probe file that violates each of them, so a
 * green result means the detector fired for each one and not merely that it
 * found nothing.
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
 * half of this rule is path arithmetic - but three of the four do, which is
 * what keeps the arithmetic honest.
 */
const FORBIDDEN: readonly { readonly prefix: string; readonly probe: string }[] = [
  { prefix: 'src/content/', probe: '../content/cards.ts' },
  { prefix: 'src/render/', probe: '../render/heraldry/card.ts' },
  { prefix: 'src/ui/', probe: '../ui/input.ts' },
  { prefix: 'tools/', probe: '../../tools/gates/__probe__.ts' },
];

const PREFIXES: readonly string[] = FORBIDDEN.map((f) => f.prefix);

/**
 * Browser storage, banned by **name** in every scanned directory rather than
 * through the checker, and that is not laziness - it is the instrument check
 * finding the first version of this rule to be false.
 *
 * The DOM half below flags an identifier whose declarations are *all* in
 * `lib.dom`, which is what keeps `console` and `fetch` out of it. `localStorage`
 * is declared in `lib.dom` **and** in `@types/node/web-globals/storage.d.ts`,
 * so it is not DOM-only and the checker will never flag it. The gate's own
 * probe said so on the first run - `it tripped 0 and 0` - which is exactly what
 * a probe is for.
 *
 * So these three are a list, each proved to fire on every run. A local variable
 * that happens to be called `localStorage` would trip it too; there is none,
 * and being told to rename one is a better failure than missing the real thing.
 */
const STORAGE_GLOBALS: readonly string[] = ['localStorage', 'sessionStorage', 'indexedDB'];

/**
 * One scanned directory: which prefixes it may not reach into, and a virtual
 * file - never written to disk - that breaks every half of its own rule.
 *
 * `src/run/` carries an empty prefix list, so its probe breaks the DOM and
 * storage halves alone: the run layer is free to import `src/content/` -
 * `src/run/content.ts` is the binding that does - and what it may not do is
 * read a hidden input.
 */
type Scanned = {
  readonly dir: string;
  readonly forbidden: readonly { readonly prefix: string; readonly probe: string }[];
  readonly probeFile: string;
  readonly probeSource: string;
  readonly what: string;
};

function scanned(
  dir: string,
  forbidden: readonly { readonly prefix: string; readonly probe: string }[],
  what: string,
): Scanned {
  return {
    dir,
    forbidden,
    probeFile: path.join(ROOT, ...dir.split('/'), '__gate_probe__.ts'),
    probeSource: [
      ...forbidden.map((f) => `import ${JSON.stringify(f.probe)};`),
      'export const probeTitle: string = document.title;',
      ...STORAGE_GLOBALS.map((g, i) => `export const probeStore${i}: unknown = ${g};`),
      '',
    ].join('\n'),
    what,
  };
}

const SCANNED: readonly Scanned[] = [
  scanned('src/engine', FORBIDDEN, 'the engine import boundary'),
  scanned('src/run', [], 'the run layer hidden-input boundary'),
];

const LIB_DOM = /[\\/]lib\.dom(\.[a-z]+)*\.d\.ts$/;

interface Violation {
  readonly kind: 'import' | 'dom' | 'storage';
  /** The forbidden prefix an import landed under, or the global a reference named. */
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
  prefixes: readonly string[],
): Violation[] {
  const found: Violation[] = [];

  const visit = (node: ts.Node): void => {
    const specifier = specifierOf(node);
    if (specifier !== undefined) {
      const target = landsAt(source.fileName, specifier.text);
      if (target !== undefined) {
        const hit = prefixes.find((prefix) => `${target}/`.startsWith(prefix));
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
          under: node.text,
          file: displayName,
          ...at(source, node),
          detail: `references the DOM global \`${node.text}\``,
        });
      } else if (STORAGE_GLOBALS.includes(node.text)) {
        found.push({
          kind: 'storage',
          under: node.text,
          file: displayName,
          ...at(source, node),
          detail:
            `references \`${node.text}\`, which is browser storage and so a hidden input the ` +
            `replay does not carry`,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

function main(): void {
  const files = new Map<string, string[]>();
  for (const s of SCANNED) {
    files.set(s.dir, nonEmpty(tsFilesUnder(s.dir), s.what));
  }

  const options = tsconfigOptions();
  const libs = options.lib ?? [];
  if (!libs.some((l) => LIB_DOM.test(l))) {
    options.lib = [...libs, 'lib.dom.d.ts'];
  }

  const probeFor = (f: string): Scanned | undefined =>
    SCANNED.find((s) => samePath(f, s.probeFile));

  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (f) => probeFor(f)?.probeSource ?? readFile(f);
  host.fileExists = (f) => (probeFor(f) !== undefined ? true : fileExists(f));
  host.getSourceFile = (f, version, onError, shouldCreate) => {
    const probe = probeFor(f);
    return probe === undefined
      ? getSourceFile(f, version, onError, shouldCreate)
      : ts.createSourceFile(f, probe.probeSource, version, true, ts.ScriptKind.TS);
  };

  const program = ts.createProgram({
    rootNames: [...SCANNED.flatMap((s) => [...files.get(s.dir)!, s.probeFile])],
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

  const violations: Violation[] = [];
  for (const s of SCANNED) {
    const prefixes = s.forbidden.map((f) => f.prefix);

    // Instrument check: the detector is made to fire before it is trusted to
    // report an absence, once per scanned directory. A second directory added
    // with no probe of its own would otherwise inherit the first one's word.
    const probeSource = program.getSourceFile(s.probeFile);
    if (probeSource === undefined) {
      console.error(
        `GATE BROKEN: the probe file for ${s.dir}/ was not added to the program. The gate did ` +
          `not run.`,
      );
      process.exit(2);
    }
    const probeHits = analyse(probeSource, checker, `${s.dir}/__gate_probe__.ts`, prefixes);
    const probeImports = probeHits.filter((v) => v.kind === 'import');
    const firedFor = new Set(probeImports.map((v) => v.under));
    const silentPrefixes = prefixes.filter((p) => !firedFor.has(p));
    const sawDocument = probeHits.some((v) => v.kind === 'dom' && v.under === 'document');
    // Either half may be the one that catches a storage global, and which it is
    // is a fact about the type declarations rather than about the rule:
    // `indexedDB` is DOM-only and is caught by the checker, `localStorage` is
    // declared by `@types/node` as well and is caught by name. Both count.
    const firedStorage = new Set(
      probeHits.filter((v) => v.kind === 'storage' || v.kind === 'dom').map((v) => v.under),
    );
    const silentStorage = STORAGE_GLOBALS.filter((g) => !firedStorage.has(g));
    if (
      probeImports.length !== s.forbidden.length ||
      silentPrefixes.length > 0 ||
      !sawDocument ||
      silentStorage.length > 0
    ) {
      console.error(
        `GATE BROKEN: ${s.dir}/'s probe should trip one import violation per forbidden prefix ` +
          `(${s.forbidden.length}), one DOM violation on \`document\`, and one on each of ` +
          `${STORAGE_GLOBALS.join(', ')}. It tripped ${probeImports.length} import(s), ` +
          `${sawDocument ? 'saw' : 'did not see'} \`document\`` +
          `${silentPrefixes.length > 0 ? `, stayed silent on ${silentPrefixes.join(', ')}` : ''}` +
          `${silentStorage.length > 0 ? `, and stayed silent on ${silentStorage.join(', ')}` : ''}. ` +
          `The detector cannot be trusted to report an absence.`,
      );
      process.exit(2);
    }

    for (const file of files.get(s.dir)!) {
      const source = program.getSourceFile(file);
      if (source === undefined) {
        console.error(`GATE BROKEN: ${rel(file)} is not in the program. The gate did not run.`);
        process.exit(2);
      }
      violations.push(...analyse(source, checker, rel(file), prefixes));
    }
  }

  if (violations.length > 0) {
    console.error(
      `Import boundary gate FAILED: ${violations.length} violation(s) of the rule that ` +
        `src/engine/ imports nothing from ${PREFIXES.join(', ')} and that neither src/engine/ ` +
        `nor src/run/ touches a DOM global.`,
    );
    console.error('');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}:${v.column}  ${v.detail}`);
    }
    console.error('');
    console.error(
      'The engine is replayed from a seed and an action list, and a run is a pure function of ' +
        'its seed, its class and its unlock set. Anything either of them reaches for above ' +
        'itself is a second input the replay does not carry, and a number read from ' +
        'localStorage is persistent power the design does not have. Move the code that needs ' +
        'content, render, ui, tools or the DOM out, and let it import the engine and the run ' +
        'layer instead. Cards are handed to a fight as a CardPool; the engine does not reach ' +
        'for them, and the run layer is handed its unlock set.',
    );
    process.exit(1);
  }

  console.log(
    `Import boundary gate OK: ${files.get('src/engine')!.length} file(s) under src/engine/ ` +
      `import nothing from ${PREFIXES.join(', ')}, and they and the ` +
      `${files.get('src/run')!.length} file(s) under src/run/ reference no DOM-only global and ` +
      `none of ${STORAGE_GLOBALS.join(', ')}. Probe check: the detector fired for every prefix, ` +
      `for \`document\`, and for each storage global, in each scanned directory.`,
  );
}

// Called unconditionally, for the same reason as banned-apis.ts.
main();
