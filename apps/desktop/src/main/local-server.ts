import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * The file a request path points at, or null if it would land outside the
 * renderer folder. Without this, "/../../secret" (or its %2e%2e%2f spelling)
 * would let any page on the machine read files next to the app.
 */
export function resolveInside(rootDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null; // malformed escape — not a real file name
  }
  if (decoded.includes('\0')) return null;
  const root = resolve(rootDir);
  // Leading slashes stripped so the path is joined onto root, never taken as absolute.
  const filePath = resolve(root, decoded.replace(/^[/\\]+/, ''));
  const rel = relative(root, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return filePath;
}

/**
 * Serves the packaged renderer over http://localhost instead of file://.
 * Cloudflare Turnstile validates against window.location.hostname, which a
 * file:// page doesn't have — see the implementation plan for why this exists.
 * electron-vite's own dev server already serves over http://localhost in dev,
 * so this is only used for production (packaged) builds.
 */
export async function startLocalServer(rootDir: string): Promise<{ url: string; close: () => void }> {
  let host = ''; // "127.0.0.1:<port>", set once listening
  const server: Server = createServer((req, res) => {
    void (async () => {
      // Only requests addressed to this server by its own address. A web page
      // elsewhere can point a domain name at 127.0.0.1 (DNS rebinding) and read
      // from here; its requests carry that domain as Host, so they stop here.
      if (!host || req.headers.host !== host) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
      const filePath = resolveInside(rootDir, urlPath === '/' ? '/index.html' : urlPath);
      if (filePath === null) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      try {
        const data = await readFile(filePath);
        const ext = extname(filePath);
        res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
        res.end(data);
      } catch {
        // SPA fallback: unknown paths resolve to index.html
        try {
          const data = await readFile(join(rootDir, 'index.html'));
          res.writeHead(200, { 'content-type': MIME['.html'] });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end('Not found');
        }
      }
    })();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject);
    // Port 0 = OS picks a free ephemeral port; avoids collisions with anything
    // else running on the employee's machine.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Failed to determine local server port'));
    });
  });

  host = `127.0.0.1:${port}`;
  return {
    url: `http://${host}`,
    close: () => server.close(),
  };
}
