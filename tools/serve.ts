/**
 * The dev server. `npm start` runs this; it is the whole build step.
 *
 * `AGENTS.md`: "Node runs the `.ts` sources directly by stripping their types,
 * so there is no build step and no compiled artifact to fall out of sync." A
 * browser cannot do that, so this server does the same thing Node does, on the
 * way out: `node:module`'s `stripTypeScriptTypes` erases the annotations and
 * hands the browser plain ES modules. Nothing is bundled, nothing is cached to
 * disk, and the file the browser runs is the file on disk minus its types - so
 * a stale build cannot exist.
 *
 * Import specifiers keep their `.ts` extension, exactly as `tsconfig.json`'s
 * `allowImportingTsExtensions` writes them, and are served as
 * `text/javascript`. The browser resolves them as modules because the
 * content-type says so; the extension is not consulted.
 *
 * Bound: this is a development server. It binds to loopback, serves only files
 * under the repository root, resolves every path against that root and refuses
 * anything that escapes it. It is not hardened for anything else and is not
 * meant to be.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENTRY = '/src/ui/index.html';
const PORT = Number.parseInt(process.env['PORT'] ?? '5175', 10);

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Repo-relative and inside the repo, or null. */
function resolveInsideRoot(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const target = path.resolve(ROOT, `.${decoded}`);
  const rel = path.relative(ROOT, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

const server = createServer((req, res) => {
  void (async () => {
    const urlPath = req.url === undefined || req.url === '/' ? ENTRY : req.url;
    const file = resolveInsideRoot(urlPath);
    if (file === null) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end(
        `Refused ${urlPath}: it resolves outside the repository root ${ROOT}. ` +
          `This server only serves files under that directory.`,
      );
      return;
    }

    try {
      const info = await stat(file);
      if (info.isDirectory()) {
        res.writeHead(302, { location: ENTRY });
        res.end();
        return;
      }
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(
        `Not found: ${urlPath}. Looked for ${path.relative(ROOT, file)} under ${ROOT}. ` +
          `The app's entry point is ${ENTRY}.`,
      );
      return;
    }

    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext] ?? 'application/octet-stream';

    if (ext === '.ts') {
      const source = await readFile(file, 'utf8');
      let out: string;
      try {
        out = stripTypeScriptTypes(source, { mode: 'strip' });
      } catch (e) {
        // A stripping failure is a real error in the source, and a browser that
        // gets a 500 with no body reports "failed to load module" and nothing
        // else. Send the message back as a module that throws it.
        const message = `Cannot strip types from ${path.relative(ROOT, file)}: ${(e as Error).message}`;
        res.writeHead(200, { 'content-type': TYPES['.ts']!, 'cache-control': 'no-store' });
        res.end(`throw new Error(${JSON.stringify(message)});`);
        console.error(message);
        return;
      }
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(out);
      return;
    }

    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(await readFile(file));
  })().catch((e: unknown) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`Server error for ${req.url}: ${(e as Error).message}`);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`cards: http://127.0.0.1:${PORT}${ENTRY}`);
  console.log(`serving ${ROOT}, stripping .ts on the way out. Ctrl+C to stop.`);
});
