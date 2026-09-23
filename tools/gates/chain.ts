/**
 * `npm run gates`: every gate in order, cheapest first, each run as the command
 * its own `npm run <name>` script runs - but without starting npm to run it.
 *
 *   node tools/gates/chain.ts typecheck gate:boundaries ... verify:run
 *
 * **Why not `npm run a && npm run b && ...`, which is what this replaced.**
 * Each `npm run` boots the npm CLI before it runs anything, and the chain
 * started eight of them - itself and seven gates. Measured warm on 2026-09-23,
 * seven interleaved runs each: `npm run gate:work-plans` took a median 0.82s
 * where `node tools/gates/work-plans.ts` took 0.36s, so each start cost about
 * 0.45s, and this file saves seven of them. Five interleaved runs of the whole
 * gate at the same code took a median 28.1s through seven `npm run`s and
 * 21.0s through this file - more than seven starts explain, on a machine at
 * about 80% CPU from other work, so read the per-start figure as the saving
 * and the whole-gate pair as noisy. Fleet canon: anything slow on the critical
 * path is a defect.
 *
 * **Why it reads `package.json` rather than listing the commands here.** Every
 * gate stays runnable alone as `npm run <name>`, which `AGENTS.md` promises, so
 * its command has to live in exactly one place. This takes script *names* and
 * runs whatever `scripts[name]` says, so a gate whose arguments change in
 * `package.json` changes here too, and a name with no script is refused by
 * name. Each command runs through the platform shell with the repo's
 * `node_modules/.bin` first on the path, which is what `npm run` does.
 *
 * **What a green run proves, and its bound.** Exit 0 means every named script
 * ran and exited 0, in the order given; the first that does not stops the
 * chain, and its exit status is this command's, so a pipeline or a wrapper
 * cannot turn a red into a green. It does not set npm's own `npm_*` variables:
 * no gate read one when this was written (nothing under `src/`, `test/` or
 * `tools/` names `npm_`), and a gate that starts to must be run as `npm run`.
 * One list is still restated, and it is named rather than hidden: which scripts
 * are gates is the argument list in `package.json`. A script named `gate:*`
 * that the list leaves out is refused here with exit 2, because a gate nobody
 * runs reports "did not run" as "passed"; a gate named anything else is only
 * as safe as that list.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function fail(status: number, message: string): never {
  console.error(`gates: ${message}`);
  process.exit(status);
}

const names = process.argv.slice(2);
if (names.length === 0) {
  fail(
    2,
    'no gate named. Pass the package.json script names to run, in order, as the `gates` script ' +
      'in package.json does - every `gate:*` script among them, or the chain refuses to run.',
  );
}

let scripts: Record<string, unknown>;
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, unknown>;
  };
  scripts = pkg.scripts ?? {};
} catch (e) {
  fail(2, `cannot read package.json at ${ROOT}: ${e instanceof Error ? e.message : String(e)}`);
}

const commands: { readonly name: string; readonly command: string }[] = [];
for (const name of names) {
  const command = scripts[name];
  if (typeof command !== 'string' || command.trim() === '') {
    fail(
      2,
      `"${name}" is not a script in package.json, so it cannot be run as a gate. Scripts: ` +
        `${Object.keys(scripts).join(', ')}.`,
    );
  }
  commands.push({ name, command });
}
const unchained = Object.keys(scripts).filter((s) => s.startsWith('gate:') && !names.includes(s));
if (unchained.length > 0) {
  fail(
    2,
    `package.json defines ${unchained.join(', ')} and the chain does not run ${unchained.length === 1 ? 'it' : 'them'}. ` +
      `A gate that is never run reports "did not run" as "passed": add it to the \`gates\` script's list.`,
  );
}

// `npm run` puts the repo's own binaries first on the path; so does this. The
// key is looked up rather than assumed, because Windows spells it `Path`.
const env: NodeJS.ProcessEnv = { ...process.env };
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
env[pathKey] = [path.join(ROOT, 'node_modules', '.bin'), env[pathKey] ?? ''].join(path.delimiter);

const took: string[] = [];
const started = process.hrtime.bigint();
for (const { name, command } of commands) {
  console.log(`\n> gates: ${name} - ${command}\n`);
  const t0 = process.hrtime.bigint();
  const res = spawnSync(command, { cwd: ROOT, env, shell: true, stdio: 'inherit' });
  const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
  took.push(`${name} ${seconds.toFixed(1)}s`);
  if (res.error !== undefined) {
    fail(2, `could not start "${name}" (${command}): ${res.error.message}`);
  }
  if (res.status !== 0) {
    const later = commands.slice(commands.findIndex((c) => c.name === name) + 1).map((c) => c.name);
    fail(
      res.status ?? 1,
      `"${name}" failed (${res.status === null ? `killed by ${String(res.signal)}` : `exit ${res.status}`}), ` +
        `so the chain stops here${later.length > 0 ? ` and did not run ${later.join(', ')}` : ''}.`,
    );
  }
}
const total = Number(process.hrtime.bigint() - started) / 1e9;
console.log(`\ngates: all ${commands.length} passed in ${total.toFixed(1)}s - ${took.join(', ')}`);
