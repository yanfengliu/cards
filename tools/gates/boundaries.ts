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
 *           and `requestAnimationFrame` are, and do. It reads the global
 *           **bare** (`document`), through the global object
 *           (`globalThis.document`, `window.x`, `self.x`) and through a string
 *           index on it (`globalThis['document']`) -- the checker resolves all
 *           three to the same symbol. See `GLOBAL_OBJECTS`.
 *   Catches a reference to `localStorage`, `sessionStorage` or `indexedDB` by
 *           name, because `@types/node` declares the first two and the checker
 *           rule above therefore cannot see them. The name is matched wherever
 *           it is **read** - bare, as any property member, or as a string index
 *           - and not only through the global object, so aliasing
 *           (`const g = globalThis; g.localStorage`) does not get past it. A
 *           declaration is not a read: `type X = { localStorage: string }` is a
 *           shape and does not trip it. See `STORAGE_GLOBALS`.
 *   Misses  a specifier built at runtime (`import(base + name)`), a boundary
 *           crossed through a third module that is itself allowed, and a DOM
 *           object handed in as an argument typed `unknown`. For the **DOM**
 *           half specifically, a global reached through an alias of the global
 *           object (`const g = globalThis; g.document`) is missed, because that
 *           half must test the base to keep `someElement.title` out of it; the
 *           storage half has no such gap. An index built at runtime
 *           (`globalThis[k]`) is missed by both. It does not police `node:`
 *           builtins, which ARCHITECTURE.md's rule does not name -- `engine`
 *           imports none today. It says nothing about `src/sim/` or
 *           `src/render/`.
 *   Depends on `lib.dom` being loadable. If it is not, the DOM half of this
 *           gate would pass vacuously, so the gate refuses to run instead.
 *
 * Every forbidden prefix and every spelling above are proved live on every run,
 * per scanned directory, against a probe file that breaks the rule once per
 * line -- and each expectation is bound to **its own line**, so a green result
 * means the detector fired for that spelling and not that some other line
 * covered for it.
 *
 * That binding is the repair for what this gate got wrong. Its first probe was
 * written in bare identifiers (`export const p: unknown = localStorage;`) while
 * every storage access in the repo is written `globalThis.localStorage`, and the
 * member name of a property access was exempt -- so the detector, its own
 * self-check and its recorded red-proof agreed with each other, and not one of
 * them touched a shape the code actually uses. `globalThis.localStorage` in
 * `src/run/run.ts` passed this gate, `tsc` and `gate:banned-apis` together.
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
/**
 * One line of a probe file and what the detector owes on it.
 *
 * The **line number is the binding**, and that is the whole point. The probe
 * this replaced asked only "did something fire for `localStorage`?", and one
 * bare-identifier line answered yes for every spelling at once - so the gate
 * could be blind to `globalThis.localStorage`, which is the only spelling this
 * repo uses, and still report that its detector had been proved. Each idiom now
 * stands on its own line and must be caught *there*.
 */
type ProbeLine = {
  readonly code: string;
  /** The prefix an import must land under, or the global a reference must name. */
  readonly under: string;
  readonly kind: 'import' | 'global';
  /** Named in the failure, so a silent shape says which spelling stopped working. */
  readonly shape: string;
};

/**
 * The spellings a reference to a global can take, written the way real code
 * writes them. `globalThis.x` comes first because it is the *only* spelling
 * `src/ui/` and `tools/ui-probe/` use: there is not one bare `localStorage`
 * under `src/`.
 */
function globalProbeLines(): ProbeLine[] {
  const lines: ProbeLine[] = [];
  const push = (code: string, under: string, shape: string): void => {
    lines.push({
      code: code.replace(/\$/g, `probe${lines.length}`),
      under,
      kind: 'global',
      shape,
    });
  };
  push('export const $: string = globalThis.document.title;', 'document', 'globalThis.document');
  push('export const $: string = document.title;', 'document', 'a bare document');
  push(
    "export const $: unknown = globalThis['document'];",
    'document',
    "globalThis['document']",
  );
  for (const g of STORAGE_GLOBALS) {
    push(`export const $: unknown = globalThis.${g};`, g, `globalThis.${g}`);
    push(`export const $: unknown = ${g};`, g, `a bare ${g}`);
    push(`export const $: unknown = globalThis[${JSON.stringify(g)}];`, g, `globalThis['${g}']`);
    push(`export const $: unknown = aliased.${g};`, g, `an aliased global object .${g}`);
  }
  return lines;
}

/**
 * Declared once at the top of every probe, so the aliasing shape above has a
 * base to read through. A base test alone cannot see this one, which is why the
 * storage half matches by name instead.
 */
const PROBE_PREAMBLE: readonly string[] = [
  "const aliased: typeof globalThis = globalThis;",
];

type Scanned = {
  readonly dir: string;
  readonly forbidden: readonly { readonly prefix: string; readonly probe: string }[];
  readonly probeFile: string;
  readonly probeSource: string;
  /** Indexed by 0-based line, so an expectation names the line it must fire on. */
  readonly probeLines: readonly (ProbeLine | null)[];
  readonly what: string;
};

function scanned(
  dir: string,
  forbidden: readonly { readonly prefix: string; readonly probe: string }[],
  what: string,
): Scanned {
  const probeLines: (ProbeLine | null)[] = [
    ...forbidden.map((f) => ({
      code: `import ${JSON.stringify(f.probe)};`,
      under: f.prefix,
      kind: 'import' as const,
      shape: `an import landing under ${f.prefix}`,
    })),
    ...PROBE_PREAMBLE.map(() => null),
    ...globalProbeLines(),
  ];
  const code = [
    ...forbidden.map((f) => `import ${JSON.stringify(f.probe)};`),
    ...PROBE_PREAMBLE,
    ...globalProbeLines().map((l) => l.code),
    '',
  ];
  return {
    dir,
    forbidden,
    probeFile: path.join(ROOT, ...dir.split('/'), '__gate_probe__.ts'),
    probeSource: code.join('\n'),
    probeLines,
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

/**
 * Expressions that denote the global object itself, so that `<base>.<name>` is
 * a reference to the global `<name>` and not to some object’s own property.
 *
 * This list is why the member half of `isNameSlot` is not the last word.
 * `globalThis.localStorage` is how **every** storage access in this repo is
 * written - `src/ui/profile.ts`, `src/ui/runapp.ts` and `tools/ui-probe/run.ts`,
 * with not one bare `localStorage` under `src/` - and the member name of a
 * property access was exempt, so the storage half of this gate could not see a
 * single real one. It was not merely narrow: its own probe was written in bare
 * identifiers, so the instrument check passed on a shape the code never uses,
 * and detector, self-check and recorded red-proof all agreed with each other
 * while none of them touched real code.
 */
const GLOBAL_OBJECTS: readonly string[] = ['globalThis', 'window', 'self'];

/**
 * True when the identifier is the member of a property access being *read*, as
 * opposed to a name being introduced. `g.localStorage` is a read whatever `g`
 * is; `type X = { localStorage: string }` introduces a field and reads nothing.
 */
function isMemberRead(node: ts.Identifier): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  return ts.isPropertyAccessExpression(parent) && parent.name === node;
}

/** True when `node` is an expression denoting the global object. */
function isGlobalObject(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return GLOBAL_OBJECTS.includes(node.text);
  if (ts.isParenthesizedExpression(node)) return isGlobalObject(node.expression);
  if (ts.isNonNullExpression(node)) return isGlobalObject(node.expression);
  if (ts.isAsExpression(node)) return isGlobalObject(node.expression);
  if (ts.isPropertyAccessExpression(node)) {
    return isGlobalObject(node.expression) && GLOBAL_OBJECTS.includes(node.name.text);
  }
  return false;
}

/**
 * True when `node` is the member name in `globalThis.x`, `window.x` or `self.x`
 * - a global reached through the global object, which the checker resolves to
 * the very same symbol as the bare identifier.
 */
function isGlobalMember(node: ts.Identifier): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.name === node &&
    isGlobalObject(parent.expression)
  );
}

/**
 * The string literal in `<something>[‘name’]`, which is the other spelling of a
 * member access and the one an identifier walk never sees. The checker resolves
 * the **argument** of `globalThis[‘document’]` to the global’s own symbol - the
 * element access as a whole resolves to nothing - so this is the node to ask.
 */
function indexedName(node: ts.Node): ts.StringLiteralLike | undefined {
  if (!ts.isStringLiteralLike(node)) return undefined;
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return undefined;
  return ts.isElementAccessExpression(parent) && parent.argumentExpression === node
    ? node
    : undefined;
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

    // One decision for every spelling of a named reference.
    //
    // `globalRead` gates the **DOM** half alone, because that half asks the
    // checker and the checker will resolve `someElement.title` into lib.dom just
    // as happily as `globalThis.document`. Only a bare identifier or a member of
    // the global object is a global.
    //
    // The **storage** half asks nothing of the base: it matches by name wherever
    // the name is read, which is what makes it proof against aliasing the global
    // object (`const g = globalThis; g.localStorage`). Neither scanned directory
    // has a legitimate member called `localStorage`, and being told to rename one
    // is a better failure than missing the real thing - the same trade the
    // STORAGE_GLOBALS comment already makes for a local variable.
    const flag = (name: string, atNode: ts.Node, globalRead: boolean): void => {
      const symbol = checker.getSymbolAtLocation(atNode);
      const declarations = symbol?.declarations;
      const domOnly =
        declarations !== undefined &&
        declarations.length > 0 &&
        declarations.every((d) => LIB_DOM.test(d.getSourceFile().fileName));
      if (globalRead && domOnly) {
        found.push({
          kind: 'dom',
          under: name,
          file: displayName,
          ...at(source, atNode),
          detail: `references the DOM global \`${name}\``,
        });
      } else if (STORAGE_GLOBALS.includes(name)) {
        found.push({
          kind: 'storage',
          under: name,
          file: displayName,
          ...at(source, atNode),
          detail:
            `references \`${name}\`, which is browser storage and so a hidden input the ` +
            `replay does not carry`,
        });
      }
    };

    if (ts.isIdentifier(node)) {
      const bare = !isNameSlot(node);
      if (bare || isMemberRead(node)) flag(node.text, node, bare || isGlobalMember(node));
    }

    const indexed = indexedName(node);
    if (indexed !== undefined) flag(indexed.text, indexed, true);

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

    // Every probe line is checked on its own line. Either half may be the one
    // that catches a storage global, and which it is is a fact about the type
    // declarations rather than about the rule: `indexedDB` is DOM-only and the
    // checker catches it, `localStorage` is declared by `@types/node` too and is
    // caught by name. Both count.
    const silent = s.probeLines.flatMap((line, i) => {
      if (line === null) return [];
      const wanted =
        line.kind === 'import' ? ['import'] : ['dom', 'storage'];
      const hit = probeHits.some(
        (v) => v.line === i + 1 && v.under === line.under && wanted.includes(v.kind),
      );
      return hit ? [] : [`line ${i + 1}, ${line.shape}`];
    });
    if (silent.length > 0) {
      const expected = s.probeLines.filter((l) => l !== null).length;
      console.error(
        `GATE BROKEN: ${s.dir}/'s probe breaks this gate's rule ${expected} time(s) and the ` +
          `detector reported ${expected - silent.length} of them. It stayed silent on:`,
      );
      for (const s2 of silent) console.error(`  ${s2}`);
      console.error(
        'The detector cannot be trusted to report an absence. A probe is only evidence for ' +
          'the spellings it actually contains: every storage access in this repo is written ' +
          '`globalThis.localStorage`, and an earlier probe made of bare identifiers passed ' +
          'while the gate could not see one of them.',
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

  const shapes = globalProbeLines().length;
  console.log(
    `Import boundary gate OK: ${files.get('src/engine')!.length} file(s) under src/engine/ ` +
      `import nothing from ${PREFIXES.join(', ')}, and they and the ` +
      `${files.get('src/run')!.length} file(s) under src/run/ reference no DOM-only global and ` +
      `none of ${STORAGE_GLOBALS.join(', ')} - bare, through globalThis, through a string ` +
      `index, or through an alias of the global object. Probe check: ${shapes} global ` +
      `spellings plus one import per forbidden prefix, each caught on its own probe line, ` +
      `in each scanned directory.`,
  );
}

// Called unconditionally, for the same reason as banned-apis.ts.
main();
