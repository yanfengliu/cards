/**
 * Shared plumbing for the determinism gates: where the repo is, and which
 * TypeScript files to look at.
 *
 * The gates parse with the TypeScript compiler that is already a devDependency
 * rather than grepping. That is not fastidiousness: three comments in this repo
 * contain the literal text `Math.random`, `Date.now` and `performance.now` in
 * order to say those calls appear nowhere, and a grep gate goes red on a clean
 * tree because of them. A gate built from the same symbol as the thing it
 * checks proves only that the text agrees with itself.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Repo root, two levels up from `tools/gates/`. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Repo-relative path with forward slashes, so prefix tests read the same on Windows. */
export function rel(absolute: string): string {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

/**
 * Every `.ts` file under `dir` (repo-relative), sorted. A missing directory is
 * not an error -- `src/ui/` does not exist yet -- but see `nonEmpty`: a gate
 * that scanned nothing must say so rather than pass.
 */
export function tsFilesUnder(dir: string): string[] {
  const root = path.join(ROOT, dir);
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue;
    out.push(path.join(entry.parentPath, entry.name));
  }
  return out.sort();
}

/**
 * Stop with a distinct exit status when a gate found nothing to inspect. A gate
 * that cannot tell "passed" from "did not run" reports the second as the first.
 */
export function nonEmpty(files: string[], what: string): string[] {
  if (files.length === 0) {
    console.error(`GATE BROKEN: found no files to scan for ${what}. The gate did not run.`);
    process.exit(2);
  }
  return files;
}

/** Parse one file into an AST. No program, no checker, no type resolution. */
export function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );
}

/** Compiler options from the repo's own `tsconfig.json`. */
export function tsconfigOptions(): ts.CompilerOptions {
  const configPath = path.join(ROOT, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new Error(
      `Cannot read ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT, undefined, configPath);
  return parsed.options;
}
