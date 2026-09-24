// The fight check reaches nothing the fight is built from.
//
// `src/run/sigils.ts` holds a fight to the run's content plus its ledger. Its
// subject is what `fightSetupFor` builds, and its expected side has to be read
// off something else. Finding F1 of the re-review of `2b040d9` was an expected
// side read off `encounterFor`, the function `fightSetupFor` builds the enemy
// from: a boss that gained the player's Power inside `encounterFor` moved both
// sides together and passed all seven gates. `7d883bd` fixed it by restating
// the pick in `printedEncounter`. Nothing stopped a later edit from routing it
// back. On its own that edit changes no number, so no test of behaviour can
// see it; with the review's mutation beside it, the whole suite and
// `verify:run` passed. This file reads the code instead of a fight.
//
// Nothing below is a list of the functions it checks. Both sides are found in
// the code on every run:
//
//   The builders. Every function declared at the top level of a file under
//   `src/run/` whose return type is `FightSetup` or assignable to it - today
//   that is `fightSetupFor` alone - and every function they reach, in any file
//   except those under `src/engine/`. The engine is left out because its
//   primitives are shared on purpose: `printedEncounter` restates the pick
//   with the engine's own `mixSeeds`. A value such as `TAG_ENCOUNTER` is walked
//   through but is not a builder; only a function, a method or a class is.
//
//   The check. Every declaration at the top level of `src/run/sigils.ts` in
//   which some name - a parameter, a local, a return type - has the type
//   `Fight` or `FightSetup`, or one assignable to either; every declaration
//   there that refers to one of those, repeated until nothing is added; and
//   everything they reach, in any file, stopping at each builder.
//   `sigilProblems` compares two run-layer records and holds no fight, so it is
//   outside the check, and its call to `sigilById` - which the fight is built
//   from, through `heldHeroSigils` - is not this file's business.
//
//   "Reach" is any reference in code, resolved by the TypeScript checker to
//   the declaration it names, and followed from there: a call, a helper in the
//   same file or in another, a renamed import, a namespace member, a string
//   index into a namespace, a destructured export, a function passed as a
//   value, a module-level alias or table of functions, a shorthand property, a
//   parameter's default, and a function that refers to one of the check's.
//   Each of those is one function of the probe below, and the probe has to
//   come back exactly right before the real check is read. A name inside a type
//   is not a reach: a type runs no code. A local that shadows a builder's name
//   is not one either, because a reference is resolved to its declaration, not
//   matched by its spelling.
//
// The main test fails when:
//
//   1. the check reaches a builder without a function that returns a
//      `FightSetup` between them. It stops at that function, because a
//      reading has to build what it checks;
//   2. the check reaches a function that returns a `FightSetup` along more than
//      one path. One is the setup that `fightSigilProblems` reads. A second can
//      only be an expected value read off a second copy of the thing checked;
//   3. a doc comment in `sigils.ts` says what a function's expected side is
//      "never off", "nothing off" or "never through", and a name it gives is
//      not a builder, or the function it is written on is not in the check.
//      That holds each such sentence to the code: it cannot name a function
//      the fight is not built from, and it cannot sit on a function this test
//      does not read;
//   4. it found no builder, no function of the check or no such sentence, or
//      a file it read does not parse. A walk that finds nothing reports "did
//      not run" as "passed".
//
// Bound - what a green run does not prove:
//
//   It follows references, not values. An expected side read off data that a
//   builder produced - a field of the run, the setup itself, an argument that
//   a caller outside the check passes in, a module-level variable a builder
//   fills at run time - names no builder, and is not seen. The setup reading
//   holding `setup.enemyHero` to itself would be that case.
//
//   A call through a member of an interface or a type - `pool.card(id)`,
//   `agent.placement(...)` - names a declaration with no body, so it is not
//   followed. Neither is a key built at run time, or anything reached by
//   reflection. A builder written as a class method, or declared anywhere but
//   the top level of a file under `src/run/`, is not found.
//
//   It cannot tell an expected value from any other use. A builder called only
//   to name something in a message counts as reached.
//
//   Rule 2 tells the one setup a reading builds from a second one only by
//   counting. A check that stopped building its own setup, and built one for
//   an expected value instead, would pass it.
//
//   It reads `src/run/sigils.ts` and what that reaches. A comparison written
//   anywhere else - `src/sim/runmeasure.ts`, a test - is not read. Nor is one
//   moved into a declaration of `sigils.ts` that holds neither type, refers to
//   nothing that does, and is reached by nothing that does.
//
//   A function the fight is built from that lives under `src/engine/` is not a
//   builder here. If one the doc comments name moved there, rule 3 would say
//   so; an unnamed one would leave quietly.
//
// Mutations watched going red, and the controls that stayed green, are in
// `docs/learning/gate-proofs.md` under 2026-09-23.

import * as path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

import { ROOT, rel, tsFilesUnder, tsconfigOptions } from '../tools/gates/scan.ts';

// ---------------------------------------------------------------------------
// What is read
// ---------------------------------------------------------------------------

/** Where the check, the subject's types and the builders are. Every path is repo-relative. */
type Config = {
  /** The file the check is in. */
  readonly check: string;
  /** The file that declares the types named below. */
  readonly types: string;
  /** A function of the check holds a value of one of these types. */
  readonly held: readonly string[];
  /** A builder returns this type. */
  readonly built: string;
  /** The directory a builder is declared in. */
  readonly builders: string;
  /** The directory left out of what a builder reaches: the layer below, shared on purpose. */
  readonly shared: string;
};

const REAL: Config = {
  check: 'src/run/sigils.ts',
  types: 'src/engine/fight.ts',
  held: ['Fight', 'FightSetup'],
  built: 'FightSetup',
  builders: 'src/run/',
  shared: 'src/engine/',
};

// ---------------------------------------------------------------------------
// The probe: every spelling of a reach, each in a function of its own
// ---------------------------------------------------------------------------

/** Never written to disk. The compiler is served these files from memory. */
const PROBE_DIR = '.gate-probe';

const PROBE_SOURCES: Readonly<Record<string, string>> = {
  'engine/fight.ts': [
    'export type Setup = { readonly enemy: number; readonly hero: number };',
    'export type Match = { readonly round: number; readonly setup: Setup };',
    'export function mix(a: number, b: number): number {',
    '  return (a * 31 + b) | 0;',
    '}',
  ].join('\n'),
  'run/build.ts': [
    "import { type Setup, mix } from '../engine/fight.ts';",
    'export const TAG = 7;',
    'export function encounterOf(seed: number): number {',
    '  return mix(seed, TAG) % 3;',
    '}',
    'export function heroOf(seed: number): number {',
    '  return seed + 1;',
    '}',
    'export function setupFor(seed: number): Setup {',
    '  return { enemy: encounterOf(seed), hero: heroOf(seed) };',
    '}',
    'export function wrapsEncounter(seed: number): number {',
    '  return encounterOf(seed);',
    '}',
    'export function unrelated(seed: number): number {',
    '  return seed * 2;',
    '}',
  ].join('\n'),
  'run/spellings.ts': [
    "import { type Match, type Setup, mix } from '../engine/fight.ts';",
    "import * as build from './build.ts';",
    "import { TAG, encounterOf, heroOf, setupFor, unrelated, wrapsEncounter } from './build.ts';",
    "import { encounterOf as renamed } from './build.ts';",
    'const aliased = encounterOf;',
    'const table = { pick: heroOf };',
    'const { heroOf: destructured } = build;',
    '/** Reads one setup, and its expected side is never read off `encounterOf` or `heroOf`. */',
    'export function subject(seed: number): boolean {',
    '  const s: Setup = setupFor(seed);',
    '  // encounterOf(seed), named in a comment, is not a reach.',
    '  return s.enemy === mix(seed, TAG) % 3 && s.hero === seed + 1 && unrelated(seed) > 0;',
    '}',
    'export function direct(m: Match): number {',
    '  return encounterOf(m.round);',
    '}',
    'export function viaLocalHelper(m: Match): number {',
    '  return local(m.round);',
    '}',
    'function local(n: number): number {',
    '  return heroOf(n);',
    '}',
    'export function viaModuleHelper(m: Match): number {',
    '  return wrapsEncounter(m.round);',
    '}',
    'export function viaRename(m: Match): number {',
    '  return renamed(m.round);',
    '}',
    'export function viaNamespace(m: Match): number {',
    '  return build.heroOf(m.round);',
    '}',
    'export function viaElement(m: Match): number {',
    "  return build['encounterOf'](m.round);",
    '}',
    'export function viaDestructure(m: Match): number {',
    '  return destructured(m.round);',
    '}',
    'export function viaCallback(m: Match): number[] {',
    '  return [m.round].map(encounterOf);',
    '}',
    'export function viaAlias(m: Match): number {',
    '  return aliased(m.round);',
    '}',
    'export function viaTable(m: Match): number {',
    '  return table.pick(m.round);',
    '}',
    'export function viaDefault(m: Match, f: (n: number) => number = heroOf): number {',
    '  return f(m.round);',
    '}',
    'export function viaShorthand(m: Match): number {',
    '  const o = { encounterOf };',
    '  return o.encounterOf(m.round);',
    '}',
    'export function viaCaller(seed: number): number {',
    '  return Number(subject(seed)) + heroOf(seed);',
    '}',
    'export function shadowed(m: Match): number {',
    '  const encounterOf = (n: number): number => n;',
    '  return encounterOf(m.round);',
    '}',
    'export function mentioned(m: Match): string {',
    '  return `encounterOf(${m.round}) and heroOf are only named in this string`;',
    '}',
    'export function ledgerLike(seed: number): number {',
    '  return heroOf(seed);',
    '}',
  ].join('\n'),
  'run/twice.ts': [
    "import type { Match } from '../engine/fight.ts';",
    "import { setupFor } from './build.ts';",
    'export function twice(m: Match): boolean {',
    '  return setupFor(m.round).enemy === setupFor(m.round).hero;',
    '}',
  ].join('\n'),
  'run/helper-twice.ts': [
    "import type { Match } from '../engine/fight.ts';",
    "import { setupFor } from './build.ts';",
    'function enemyAt(n: number): number {',
    '  return setupFor(n).enemy;',
    '}',
    'export function reading(m: Match): boolean {',
    '  return enemyAt(m.round) === enemyAt(m.round + 1);',
    '}',
  ].join('\n'),
  'run/claims.ts': [
    "import type { Match } from '../engine/fight.ts';",
    '/** Its expected side is never read off `wrapsEncounter`. */',
    'export function claimsWrong(m: Match): number {',
    '  return m.round;',
    '}',
    '/** Its expected side is never read off `encounterOf`. */',
    'export function notInCheck(n: number): number {',
    '  return n;',
    '}',
  ].join('\n'),
};

const probeConfig = (check: string): Config => ({
  check: `${PROBE_DIR}/run/${check}`,
  types: `${PROBE_DIR}/engine/fight.ts`,
  held: ['Match', 'Setup'],
  built: 'Setup',
  builders: `${PROBE_DIR}/run/`,
  shared: `${PROBE_DIR}/engine/`,
});

/**
 * What the probe must find: for each function of `spellings.ts` the check
 * holds, the builders it reaches. The keys are all of the check - `local`,
 * `ledgerLike` and the three module-level values are not in it - and each
 * expectation is bound to its own function, so a spelling the walk stopped
 * following fails by name rather than being covered for by another.
 */
const SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  subject: [],
  direct: ['encounterOf'],
  viaLocalHelper: ['heroOf'],
  viaModuleHelper: ['encounterOf'],
  viaRename: ['encounterOf'],
  viaNamespace: ['heroOf'],
  viaElement: ['encounterOf'],
  viaDestructure: ['heroOf'],
  viaCallback: ['encounterOf'],
  viaAlias: ['encounterOf'],
  viaTable: ['heroOf'],
  viaDefault: ['heroOf'],
  viaShorthand: ['encounterOf'],
  viaCaller: ['heroOf'],
  shadowed: [],
  mentioned: [],
};

// ---------------------------------------------------------------------------
// The program, and the graph of what refers to what
// ---------------------------------------------------------------------------

/** A declaration the walk can reach: a function, a method, a class or a module-level value. */
type Unit = {
  readonly decl: ts.Node;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  /** What is walked when the unit is reached. */
  readonly code: ts.Node;
  /** A function, a method or a class, as opposed to a value. Only these can be builders. */
  readonly isFunction: boolean;
};

type Edge = { readonly to: Unit; readonly line: number };

function makeProgram(): ts.Program {
  const options = tsconfigOptions();
  const served = new Map<string, string>();
  for (const [p, source] of Object.entries(PROBE_SOURCES)) {
    served.set(path.resolve(ROOT, PROBE_DIR, ...p.split('/')), source);
  }
  const dirs = new Set<string>();
  for (const f of served.keys()) {
    for (let d = path.dirname(f); d.length > ROOT.length; d = path.dirname(d)) dirs.add(d);
  }
  const probe = (f: string): string | undefined => served.get(path.resolve(f));
  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (f) => probe(f) ?? readFile(f);
  host.fileExists = (f) => probe(f) !== undefined || fileExists(f);
  host.directoryExists = (d) => dirs.has(path.resolve(d)) || (directoryExists?.(d) ?? true);
  host.getSourceFile = (f, language, onError, shouldCreate) => {
    const source = probe(f);
    return source === undefined
      ? getSourceFile(f, language, onError, shouldCreate)
      : ts.createSourceFile(f, source, language, true, ts.ScriptKind.TS);
  };
  return ts.createProgram({
    rootNames: [...tsFilesUnder('src/run'), ...served.keys()],
    options,
    host,
  });
}

function isFunctionLike(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n) ||
    ts.isConstructorDeclaration(n)
  );
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  while (
    ts.isParenthesizedExpression(x) ||
    ts.isAsExpression(x) ||
    ts.isSatisfiesExpression(x) ||
    ts.isNonNullExpression(x) ||
    ts.isTypeAssertionExpression(x)
  ) {
    x = x.expression;
  }
  return x;
}

function lineOf(node: ts.Node): number {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

type Graph = ReturnType<typeof graphOf>;

function graphOf(program: ts.Program) {
  const checker = program.getTypeChecker();
  const units = new Map<ts.Node, Unit | null>();
  const edgeCache = new Map<Unit, readonly Edge[]>();

  function makeUnit(decl: ts.Node): Unit | undefined {
    const sf = decl.getSourceFile();
    if (sf.isDeclarationFile) return undefined;
    const file = rel(sf.fileName);
    if (file.startsWith('..') || file.split('/').includes('node_modules')) return undefined;
    // A local is walked with the function it is declared in.
    for (let p = decl.parent; p !== undefined; p = p.parent) if (isFunctionLike(p)) return undefined;
    let code: ts.Node;
    let isFunction: boolean;
    if (
      ts.isFunctionDeclaration(decl) ||
      ts.isMethodDeclaration(decl) ||
      ts.isGetAccessorDeclaration(decl) ||
      ts.isSetAccessorDeclaration(decl) ||
      ts.isConstructorDeclaration(decl)
    ) {
      if (decl.body === undefined) return undefined;
      code = decl;
      isFunction = true;
    } else if (ts.isClassDeclaration(decl)) {
      code = decl;
      isFunction = true;
    } else if (ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl)) {
      if (decl.initializer === undefined) return undefined;
      code = decl.initializer;
      const init = unwrap(decl.initializer);
      isFunction = ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init);
    } else if (ts.isBindingElement(decl)) {
      code = decl;
      isFunction = false;
    } else {
      return undefined;
    }
    const named = (decl as { readonly name?: ts.Node }).name;
    const name = named === undefined ? ts.SyntaxKind[decl.kind] : named.getText(sf);
    return { decl, name, file, line: lineOf(decl), code, isFunction };
  }

  function unitFor(decl: ts.Node): Unit | undefined {
    const known = units.get(decl);
    if (known !== undefined) return known ?? undefined;
    const made = makeUnit(decl);
    units.set(decl, made ?? null);
    return made;
  }

  function unitsOf(symbol: ts.Symbol): Unit[] {
    const s = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const out: Unit[] = [];
    for (const d of s.declarations ?? []) {
      const u = unitFor(d);
      if (u !== undefined) out.push(u);
    }
    return out;
  }

  function symbolAt(node: ts.Node): ts.Symbol | undefined {
    const parent: ts.Node | undefined = node.parent;
    if (parent !== undefined && ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
      return checker.getShorthandAssignmentValueSymbol(parent);
    }
    return checker.getSymbolAtLocation(node);
  }

  /** Every reference `u`'s code makes to a unit, one edge per place it is made. */
  function edges(u: Unit): readonly Edge[] {
    const cached = edgeCache.get(u);
    if (cached !== undefined) return cached;
    const out: Edge[] = [];
    const add = (node: ts.Node): void => {
      const symbol = symbolAt(node);
      if (symbol === undefined) return;
      for (const to of unitsOf(symbol)) if (to !== u) out.push({ to, line: lineOf(node) });
    };
    const walk = (node: ts.Node): void => {
      if (ts.isTypeNode(node)) return; // A type runs no code.
      if (ts.isIdentifier(node)) {
        add(node);
      } else if (
        ts.isStringLiteralLike(node) &&
        node.parent !== undefined &&
        ts.isElementAccessExpression(node.parent) &&
        node.parent.argumentExpression === node
      ) {
        add(node);
      }
      ts.forEachChild(node, walk);
    };
    const decl = u.decl;
    if (ts.isBindingElement(decl)) {
      // `const { a: b } = x`: the property of `x` it takes, and whatever `x` itself reaches.
      const pattern = decl.parent;
      const holder = pattern.parent;
      if (ts.isVariableDeclaration(holder) && holder.initializer !== undefined) {
        const key = decl.propertyName ?? decl.name;
        if (ts.isObjectBindingPattern(pattern) && ts.isIdentifier(key)) {
          const property = checker.getTypeAtLocation(holder.initializer).getProperty(key.text);
          if (property !== undefined) {
            for (const to of unitsOf(property)) if (to !== u) out.push({ to, line: u.line });
          }
        }
        walk(holder.initializer);
      }
    } else {
      walk(u.code);
    }
    edgeCache.set(u, out);
    return out;
  }

  /** The type `name` exported from `file` declares. */
  function declared(file: string, name: string): ts.Type {
    const sf = program.getSourceFile(path.join(ROOT, file));
    assert.ok(sf !== undefined, `${file} is not in the program this test builds, so ${name} cannot be read from it`);
    const mod = checker.getSymbolAtLocation(sf);
    assert.ok(mod !== undefined, `${file} has no module symbol, so ${name} cannot be read from it`);
    const exported = checker.getExportsOfModule(mod).find((s) => s.name === name);
    assert.ok(exported !== undefined, `${file} exports no ${name}`);
    const s = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    return checker.getDeclaredTypeOfSymbol(s);
  }

  /** `t` is a `target`: the same named type, or one assignable to it. Never `any`, `unknown` or `never`. */
  function isA(t: ts.Type, target: ts.Type): boolean {
    if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false;
    if (t.aliasSymbol !== undefined && t.aliasSymbol === target.aliasSymbol) return true;
    return checker.isTypeAssignableTo(t, target);
  }

  /** Some name in `u`'s declaration - its signature included - has a type among `types`. */
  function holds(u: Unit, types: readonly ts.Type[]): boolean {
    let found = false;
    const walk = (node: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(node)) {
        const t = checker.getTypeAtLocation(node);
        if (types.some((h) => isA(t, h))) {
          found = true;
          return;
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(u.decl);
    return found;
  }

  function returnsA(fn: ts.SignatureDeclaration, target: ts.Type): boolean {
    const sig = checker.getSignatureFromDeclaration(fn);
    return sig !== undefined && isA(checker.getReturnTypeOfSignature(sig), target);
  }

  /** The units declared at the top level of `sf`, with the signature of each that is a function. */
  function topLevel(sf: ts.SourceFile): { readonly unit: Unit; readonly fn: ts.SignatureDeclaration | undefined }[] {
    const out: { readonly unit: Unit; readonly fn: ts.SignatureDeclaration | undefined }[] = [];
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st)) {
        const unit = unitFor(st);
        if (unit !== undefined) out.push({ unit, fn: st });
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const unit = unitFor(d);
          if (unit === undefined) continue;
          const init = d.initializer === undefined ? undefined : unwrap(d.initializer);
          const fn = init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? init : undefined;
          out.push({ unit, fn });
        }
      }
    }
    return out;
  }

  return { program, edges, declared, holds, returnsA, topLevel };
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

type Leak = { readonly target: Unit; readonly via: readonly Unit[] };
type Claim = { readonly holder: Unit; readonly names: readonly string[] };

type Analysis = {
  /** The functions that return the built type. */
  readonly roots: readonly Unit[];
  /** Every builder, with the way a root reaches it. */
  readonly built: ReadonlyMap<Unit, readonly Unit[]>;
  /** The functions of the check the walk starts from. */
  readonly seeds: readonly Unit[];
  /** Everything the check reaches, stopping at each builder. */
  readonly reached: ReadonlySet<Unit>;
  /** Per function of the check: each builder it reaches with no root between, and how. */
  readonly leaks: ReadonlyMap<Unit, readonly Leak[]>;
  /** How many paths lead from the check to a root, and the first few of them. */
  readonly pathCount: number;
  readonly paths: readonly string[];
  readonly claims: readonly Claim[];
  /** Names a doc comment gives that no builder has. */
  readonly badNames: readonly { readonly holder: Unit; readonly name: string }[];
  /** Functions whose doc comment makes the claim and that are not in the check. */
  readonly outside: readonly Unit[];
};

const NAME = '`[A-Za-z_$][\\w$]*`';
/** "never off `a`, `b` or `c`", "nothing off ...", "never read off ...", "never through ...". */
const CLAIM = new RegExp(
  `\\b(?:never|nothing)\\s+(?:read\\s+)?(?:off|through)\\s+(${NAME}(?:(?:\\s*,\\s*(?:(?:or|and)\\s+)?|\\s+(?:or|and)\\s+)${NAME})*)`,
  'gi',
);

/** The text of the doc comment on a top-level declaration, one line, `*` margins stripped. */
function docOf(decl: ts.Node): string {
  const statement = ts.isVariableDeclaration(decl) ? decl.parent.parent : decl;
  const sf = decl.getSourceFile();
  const ranges = ts.getLeadingCommentRanges(sf.text, statement.getFullStart()) ?? [];
  return ranges
    .map((r) => sf.text.slice(r.pos, r.end))
    .filter((c) => c.startsWith('/**'))
    .map((c) =>
      c
        .slice(3, -2)
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*\*?\s?/, ''))
        .join(' '),
    )
    .join(' ')
    .replace(/\s+/g, ' ');
}

function analyse(g: Graph, cfg: Config): Analysis {
  const builtType = g.declared(cfg.types, cfg.built);
  const heldTypes = cfg.held.map((n) => g.declared(cfg.types, n));

  // The builders: the functions that return the built type, and all they reach.
  const roots: Unit[] = [];
  for (const sf of g.program.getSourceFiles()) {
    if (!rel(sf.fileName).startsWith(cfg.builders)) continue;
    for (const { unit, fn } of g.topLevel(sf)) {
      if (fn !== undefined && g.returnsA(fn, builtType)) roots.push(unit);
    }
  }
  const built = new Map<Unit, readonly Unit[]>();
  {
    const seen = new Set<Unit>();
    const queue: [Unit, readonly Unit[]][] = roots.map((r) => [r, [r]]);
    for (let i = 0; i < queue.length; i++) {
      const [u, via] = queue[i]!;
      if (seen.has(u)) continue;
      seen.add(u);
      if (u.isFunction && !u.file.startsWith(cfg.shared)) built.set(u, via);
      for (const e of g.edges(u)) if (!seen.has(e.to)) queue.push([e.to, [...via, e.to]]);
    }
  }
  const isRoot = new Set(roots);

  // The check: what holds a fight, and what refers to what does.
  const checkFile = g.program.getSourceFile(path.join(ROOT, cfg.check));
  assert.ok(checkFile !== undefined, `${cfg.check} is not in the program this test builds`);
  const top = g.topLevel(checkFile).map((t) => t.unit);
  const seedSet = new Set(top.filter((u) => g.holds(u, heldTypes)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const u of top) {
      if (!seedSet.has(u) && g.edges(u).some((e) => seedSet.has(e.to))) {
        seedSet.add(u);
        grew = true;
      }
    }
  }
  const seeds = [...seedSet];

  // Reach, one seed at a time, stopping at every builder.
  const reached = new Set<Unit>();
  const leaks = new Map<Unit, readonly Leak[]>();
  for (const s of seeds) {
    const found: Leak[] = [];
    const seen = new Set<Unit>([s]);
    const queue: [Unit, readonly Unit[]][] = [[s, [s]]];
    for (let i = 0; i < queue.length; i++) {
      const [u, via] = queue[i]!;
      reached.add(u);
      for (const e of g.edges(u)) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        if (built.has(e.to)) {
          if (!isRoot.has(e.to)) found.push({ target: e.to, via: [...via, e.to] });
          continue;
        }
        queue.push([e.to, [...via, e.to]]);
      }
    }
    leaks.set(s, found);
  }

  // Paths from the check's entries - what nothing else in the check refers to - to a root.
  const referred = new Set<Unit>();
  for (const u of reached) for (const e of g.edges(u)) referred.add(e.to);
  const entries = [...reached].filter((u) => !referred.has(u));
  const memo = new Map<Unit, number>();
  const onStack = new Set<Unit>();
  const count = (u: Unit): number => {
    const known = memo.get(u);
    if (known !== undefined) return known;
    if (onStack.has(u)) return 0;
    onStack.add(u);
    let n = 0;
    for (const e of g.edges(u)) {
      if (isRoot.has(e.to)) n++;
      else if (!built.has(e.to) && reached.has(e.to)) n += count(e.to);
    }
    onStack.delete(u);
    memo.set(u, n);
    return n;
  };
  const pathCount = entries.reduce((n, u) => n + count(u), 0);
  const paths: string[] = [];
  const list = (u: Unit, shown: string, on: ReadonlySet<Unit>): void => {
    for (const e of g.edges(u)) {
      if (paths.length >= 10 || on.has(e.to)) continue;
      const step = `${shown} -> ${e.to.name} (${u.file}:${e.line})`;
      if (isRoot.has(e.to)) paths.push(step);
      else if (!built.has(e.to) && reached.has(e.to)) list(e.to, step, new Set([...on, e.to]));
    }
  };
  for (const u of entries) list(u, u.name, new Set([u]));

  // The doc comments that say what an expected side is never read off.
  const claims: Claim[] = [];
  for (const u of top) {
    for (const m of docOf(u.decl).matchAll(CLAIM)) {
      const names = [...(m[1] ?? '').matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((x) => x[1] ?? '');
      claims.push({ holder: u, names });
    }
  }
  const builtNames = new Set([...built.keys()].map((u) => u.name));
  const badNames = claims.flatMap((c) =>
    c.names.filter((n) => !builtNames.has(n)).map((name) => ({ holder: c.holder, name })),
  );
  const outside = [...new Set(claims.map((c) => c.holder))].filter((h) => !reached.has(h));

  return { roots, built, seeds, reached, leaks, pathCount, paths, claims, badNames, outside };
}

const where = (u: Unit): string => `${u.file}:${u.line}`;
const chain = (us: readonly Unit[]): string => us.map((u) => u.name).join(' -> ');

/** Every rule the analysis breaks, as a sentence naming what, where, and what would satisfy it. */
function problemsOf(a: Analysis, cfg: Config): string[] {
  const out: string[] = [];
  const said = new Set<string>();
  for (const found of a.leaks.values()) {
    for (const { target, via } of found) {
      const reacher = via[via.length - 2] ?? via[0]!;
      const key = `${reacher.name}@${where(reacher)} -> ${target.name}`;
      if (said.has(key)) continue;
      said.add(key);
      out.push(
        `${reacher.name} (${where(reacher)}) reaches ${target.name} (${where(target)}), by ` +
          `${chain(via)}, and the fight is built from ${target.name}: ${chain(a.built.get(target) ?? [])}. ` +
          `An expected side read off a function the fight is built from moves with it: a change ` +
          `inside ${target.name} moves both sides together, and the check cannot see it - finding F1 ` +
          `in docs/learning/gate-proofs.md. Restate what ${target.name} works out from the content, ` +
          `the way the enemy hero's expected Power is read off the act's table rather than asked of ` +
          `encounterFor.`,
      );
    }
  }
  if (a.pathCount > 1) {
    out.push(
      `${cfg.check} reaches a function that returns a ${cfg.built} along ${a.pathCount} paths:\n    ` +
        `${a.paths.join('\n    ')}\n  One is the setup the check reads and holds to the ledger. ` +
        `Any other builds a second copy of the thing checked, so an expected value read off it ` +
        `agrees with the subject whatever the builder does. Read the expected value off the ` +
        `content instead.`,
    );
  }
  for (const { holder, name } of a.badNames) {
    out.push(
      `the doc comment on ${holder.name} (${where(holder)}) says its expected side is never read ` +
        `off \`${name}\`, and the fight is built from no function by that name - it is built from ` +
        `${[...a.built.keys()].map((u) => u.name).join(', ')}. A sentence about what a check does not ` +
        `read is written from the code (docs/policies/local-rules.md): name the builders, or ` +
        `drop the name.`,
    );
  }
  for (const holder of a.outside) {
    out.push(
      `the doc comment on ${holder.name} (${where(holder)}) says what its expected side is never ` +
        `read off, and ${holder.name} is not in the check this test reads: no ${cfg.held.join(' or ')} ` +
        `is held in it or in anything that calls it, and nothing in the check reaches it. Its claim is ` +
        `held by nothing. Connect it to the check, or move the sentence to a function that is.`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

let built: { readonly graph: Graph } | undefined;
function graph(): Graph {
  if (built === undefined) {
    const program = makeProgram();
    // A walk over a file that does not parse reads whatever the parser salvaged.
    const broken = program
      .getSyntacticDiagnostics()
      .filter((d) => d.file !== undefined && !d.file.isDeclarationFile && !rel(d.file.fileName).startsWith('..'))
      .map((d) => `${rel(d.file!.fileName)}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    assert.deepEqual(broken, [], 'a file this test reads does not parse, so what it would report is not about that file');
    built = { graph: graphOf(program) };
  }
  return built.graph;
}

/** Each way the probe came back other than exactly as `SPELLINGS` and the three other probe files say. */
function probeMisses(): string[] {
  const g = graph();
  const misses: string[] = [];

  const s = analyse(g, probeConfig('spellings.ts'));
  const seedNames = s.seeds.map((u) => u.name).sort();
  const wanted = Object.keys(SPELLINGS).sort();
  if (seedNames.join(',') !== wanted.join(',')) {
    misses.push(`spellings.ts: the check held [${seedNames.join(', ')}], where it is [${wanted.join(', ')}]`);
  }
  for (const seed of s.seeds) {
    const got = [...new Set((s.leaks.get(seed) ?? []).map((l) => l.target.name))].sort();
    const want = [...(SPELLINGS[seed.name] ?? [])].sort();
    if (got.join(',') !== want.join(',')) {
      misses.push(`spellings.ts: ${seed.name} reaches the builders [${got.join(', ')}], where it reaches [${want.join(', ')}]`);
    }
  }
  const builders = [...s.built.keys()].map((u) => u.name).sort().join(',');
  if (builders !== 'encounterOf,heroOf,setupFor') {
    misses.push(`build.ts: the builders came out as [${builders}], where they are encounterOf, heroOf and setupFor`);
  }
  if (s.pathCount !== 1) misses.push(`spellings.ts: ${s.pathCount} path(s) to setupFor, where there is exactly 1`);
  if (s.claims.length !== 1 || s.badNames.length > 0 || s.outside.length > 0) {
    misses.push(
      `spellings.ts: read ${s.claims.length} claim(s), ${s.badNames.length} naming a non-builder and ` +
        `${s.outside.length} outside the check, where it is one good claim on subject`,
    );
  }

  for (const [file, what] of [
    ['twice.ts', 'a second setup built in the function itself'],
    ['helper-twice.ts', 'a second setup built through a helper called twice'],
  ] as const) {
    const a = analyse(g, probeConfig(file));
    if (a.pathCount !== 2) misses.push(`${file}: ${a.pathCount} path(s) to setupFor for ${what}, where there are 2`);
    if ([...a.leaks.values()].some((l) => l.length > 0)) misses.push(`${file}: reported a builder reached, where none is`);
  }

  const c = analyse(g, probeConfig('claims.ts'));
  const bad = c.badNames.map((b) => `${b.holder.name}:${b.name}`).join(',');
  if (bad !== 'claimsWrong:wrapsEncounter') {
    misses.push(`claims.ts: the names given that are no builder came out as [${bad}], where it is claimsWrong:wrapsEncounter`);
  }
  const outside = c.outside.map((u) => u.name).join(',');
  if (outside !== 'notInCheck') {
    misses.push(`claims.ts: the claims outside the check came out as [${outside}], where it is notInCheck`);
  }
  return misses;
}

test('the reach walk finds every spelling of a reach in its own probe function, and nothing in the clean ones', () => {
  // The instrument check. Each spelling the header says is followed is one
  // function of `PROBE_SOURCES['run/spellings.ts']`, bound to its own entry in
  // `SPELLINGS`, so a spelling the walk stopped following fails by name. The
  // clean ones - a restated pick through the shared engine function, a local
  // that shadows a builder's name, a builder named in a string and in a
  // comment - must reach nothing. `ledgerLike` calls a builder, holds no
  // `Match`, refers to nothing that does and is reached by nothing that does,
  // so it must not be in the check at all: it stands for `sigilProblems`.
  assert.deepEqual(
    probeMisses(),
    [],
    'the reach walk did not come back exactly right on its own probe, so it cannot be trusted to ' +
      'report that the fight check reaches no builder',
  );
});

test('the fight check reaches nothing the fight is built from, except along one path to the function that builds the setup it reads', (t) => {
  // Mutations watched going red: `printedEncounter` rewritten to call
  // `encounterFor`; the same through a helper in `sigils.ts` and through one
  // in `nodes.ts`; `readLedger` summing `heldHeroSigils`; `cardProblems`
  // expecting `grantedTraits`; the fight reading's hero expected off
  // `heroSpecFor`; the enemy hero expected off a second `fightSetupFor`. See
  // docs/learning/gate-proofs.md, 2026-09-23.
  assert.deepEqual(probeMisses(), [], 'the probe did not come back exactly right; see the test above');

  const a = analyse(graph(), REAL);

  // Found its subject at all: a walk that finds nothing agrees with everything.
  assert.ok(
    a.roots.length > 0,
    `no function at the top level of a file under ${REAL.builders} returns a ${REAL.built}, so there is ` +
      `no builder to hold the check apart from. The fight is built somewhere this test does not look.`,
  );
  assert.ok(
    a.seeds.length > 0,
    `no function in ${REAL.check} holds a ${REAL.held.join(' or ')}, so there is no check to read.`,
  );
  assert.ok(
    a.claims.length > 0,
    `no doc comment in ${REAL.check} says what an expected side is "never off", "nothing off" or ` +
      '"never through". Those sentences are what this test holds the names of the builders to, and ' +
      'finding none means either the sentences were reworded or this reader went blind. Write the ' +
      'claim in one of those forms, or change the reader here.',
  );

  t.diagnostic(`builders: ${a.roots.map((u) => u.name).join(', ')} and what they reach - ${[...a.built.keys()].map((u) => `${u.name} (${u.file})`).join(', ')}`);
  t.diagnostic(`the check: ${a.seeds.map((u) => u.name).join(', ')}; it reaches ${a.reached.size} functions and values - ${[...a.reached].map((u) => u.name).join(', ')}`);
  t.diagnostic(`paths to a builder that returns a ${REAL.built}: ${a.pathCount} - ${a.paths.join('; ')}`);
  t.diagnostic(`claims held: ${a.claims.map((c) => `${c.holder.name} [${c.names.join(', ')}]`).join('; ')}`);

  assert.deepEqual(problemsOf(a, REAL), [], 'the fight check reaches what the fight is built from');
});
