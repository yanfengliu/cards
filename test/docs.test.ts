// The documents that describe the code say what is on disk.
//
// A final acceptance review on 2026-09-22 found three of them describing a
// codebase that no longer existed:
//
//   - `ARCHITECTURE.md`'s source tree named `actions.ts`, `effects.ts`,
//     `replay.ts` and four `.json` files that never existed, and had no
//     `src/run/` at all;
//   - the status paragraphs of `ARCHITECTURE.md` and `AGENTS.md` still said
//     there was no UI layer, and named neither `src/run/` nor `src/ui/`;
//   - `README.md` never said `?class=` existed.
//
// Each was a list typed once and then left while its subject grew, which is
// the shape `docs/policies/local-rules.md` names for gates: a check whose
// subject is a list reads that list and never restates it. It holds for a
// document too. Each test below reads its subject off the disk or the code
// and holds the document to it.
//
// Bound of this gate - what a green run does and does not prove:
//
//   The tree. Every directory under `src/`, at every depth, and every entry in
//   each, against the fenced block in `ARCHITECTURE.md` that opens with the
//   line `src/`. Both directions: a line naming a file that is not there, and
//   a file no line names. It says nothing about the prose around the block.
//
//   The layers. Every top-level directory under `src/` is named, written as
//   `src/<dir>/`, in `AGENTS.md`'s "## What this is" section and in the
//   `Status:` paragraph of `ARCHITECTURE.md`. Named, not described truly: a
//   status line that names every layer and says something false about one
//   passes.
//
//   The address. Every parameter the app reads through a `URLSearchParams` -
//   a variable made with `new URLSearchParams(…)` or a parameter typed as one,
//   asked `.get('…')` or `.has('…')` with a literal, in any file under
//   `src/ui/` - is written in `README.md` as `?<name>=` or `&<name>=`. A
//   parameter read any other way, or under a computed name, is not seen; the
//   walk asserts it found `seed`, so a walk that finds nothing cannot pass.
//
// Made to go red: see `docs/learning/gate-proofs.md`, entry of 2026-09-22.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function linesOf(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Every directory under `src/`, as `run/` or `render/heraldry/`, with its entries - directories ending in `/`. */
function treeOnDisk(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (rel: string): void => {
    const entries = readdirSync(path.join(ROOT, 'src', rel), { withFileTypes: true });
    out.set(
      `${rel}/`,
      entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort(),
    );
    for (const e of entries) if (e.isDirectory()) walk(rel === '' ? e.name : `${rel}/${e.name}`);
  };
  for (const e of readdirSync(path.join(ROOT, 'src'), { withFileTypes: true })) {
    if (e.isDirectory()) walk(e.name);
  }
  return out;
}

/** The fenced block in `ARCHITECTURE.md` that opens with `src/`, as directory -> entries. */
function treeInArchitecture(): Map<string, string[]> {
  const lines = linesOf(read('ARCHITECTURE.md'));
  const start = lines.findIndex((l, i) => l.trim() === 'src/' && lines[i - 1]?.trim() === '```');
  assert.ok(start >= 0, 'ARCHITECTURE.md has no fenced block opening with the line "src/"; the source tree is gone');
  const out = new Map<string, string[]>();
  for (let i = start + 1; i < lines.length && lines[i]!.trim() !== '```'; i++) {
    const words = lines[i]!.trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;
    const [dir, ...entries] = words;
    assert.ok(dir!.endsWith('/'), `ARCHITECTURE.md's tree line "${lines[i]!.trim()}" does not start with a directory`);
    out.set(dir!, entries.sort());
  }
  return out;
}

/** The block the tree should be, for the failure message. */
function treeBlock(tree: Map<string, string[]>): string {
  const dirs = [...tree.keys()].sort();
  const width = Math.max(...dirs.map((d) => d.length)) + 3;
  return ['src/', ...dirs.map((d) => `  ${d.padEnd(width)}${tree.get(d)!.join('  ')}`)].join('\n');
}

test("ARCHITECTURE.md's source tree is the tree on disk", () => {
  const disk = treeOnDisk();
  const doc = treeInArchitecture();
  // The walk found its subject: the engine is always there.
  assert.ok(disk.has('engine/') && disk.get('engine/')!.includes('resolver.ts'), 'the walk over src/ found no engine');
  const fix = `\n\nThe block that matches the disk:\n\n${treeBlock(disk)}\n`;
  for (const [dir, entries] of disk) {
    const listed = doc.get(dir);
    assert.ok(listed !== undefined, `ARCHITECTURE.md's tree has no line for src/${dir}, which is on disk.${fix}`);
    const missing = entries.filter((e) => !listed.includes(e));
    const extra = listed.filter((e) => !entries.includes(e));
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `ARCHITECTURE.md's line for src/${dir} leaves out [${missing.join(', ')}] and names ` +
        `[${extra.join(', ')}], which ${extra.length === 1 ? 'is' : 'are'} not on disk.${fix}`,
    );
  }
  for (const dir of doc.keys()) {
    assert.ok(disk.has(dir), `ARCHITECTURE.md's tree names src/${dir}, which is not on disk.${fix}`);
  }
});

/** The top-level directories under `src/`. */
function layers(): string[] {
  return readdirSync(path.join(ROOT, 'src'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** `AGENTS.md` from "## What this is" to the next section or the canon block. */
function agentsWhatThisIs(): string {
  const lines = linesOf(read('AGENTS.md'));
  const start = lines.indexOf('## What this is');
  assert.ok(start >= 0, 'AGENTS.md has no "## What this is" section');
  const end = lines.findIndex((l, i) => i > start && (l.startsWith('## ') || l.startsWith('<!-- FLEET-CANON')));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** The `Status:` paragraph of `ARCHITECTURE.md`. */
function architectureStatus(): string {
  const status = linesOf(read('ARCHITECTURE.md')).find((l) => l.startsWith('Status:'));
  assert.ok(status !== undefined, 'ARCHITECTURE.md has no "Status:" paragraph');
  return status;
}

test('the status lines name every layer the code has', () => {
  const dirs = layers();
  assert.ok(dirs.includes('engine') && dirs.length >= 6, `src/ holds [${dirs.join(', ')}]; the walk is reading the wrong tree`);
  for (const [doc, text] of [
    ['AGENTS.md\'s "What this is"', agentsWhatThisIs()],
    ["ARCHITECTURE.md's Status paragraph", architectureStatus()],
  ] as const) {
    const missing = dirs.filter((d) => !text.includes(`src/${d}/`));
    assert.deepEqual(
      missing,
      [],
      `${doc} does not name ${missing.map((d) => `src/${d}/`).join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} ` +
        `on disk. A status line that leaves out a layer is how "there is no UI layer" outlived the UI.\n\n${text}`,
    );
  }
});

/** Every `.ts` file under `dir`, repo-relative. */
function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.ts')) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

/** The names a file reads out of the address, through anything it holds as a `URLSearchParams`. */
function addressParametersIn(rel: string): string[] {
  const sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  const holders = new Set<string>();
  const found: string[] = [];
  const collect = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer !== undefined &&
      ts.isNewExpression(n.initializer) &&
      n.initializer.expression.getText(sf) === 'URLSearchParams'
    ) {
      holders.add(n.name.text);
    }
    if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.type?.getText(sf) === 'URLSearchParams') {
      holders.add(n.name.text);
    }
    ts.forEachChild(n, collect);
  };
  const reads = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === 'get' || n.expression.name.text === 'has') &&
      ts.isIdentifier(n.expression.expression) &&
      holders.has(n.expression.expression.text) &&
      n.arguments[0] !== undefined &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      found.push(n.arguments[0].text);
    }
    ts.forEachChild(n, reads);
  };
  collect(sf);
  reads(sf);
  return found;
}

test('the README names every address parameter the app reads', () => {
  const read_ = new Set(tsFilesUnder('src/ui').flatMap(addressParametersIn));
  assert.ok(read_.has('seed'), `the walk over src/ui/ found the parameters [${[...read_].join(', ')}] and not "seed"; it is not reading the address`);
  const readme = read('README.md');
  const missing = [...read_].sort().filter((p) => !readme.includes(`?${p}=`) && !readme.includes(`&${p}=`));
  assert.deepEqual(
    missing,
    [],
    `the app reads ${missing.map((p) => `?${p}=`).join(', ')} from the address and README.md never says so. ` +
      `A parameter the README does not name is one a player cannot find.`,
  );
});
