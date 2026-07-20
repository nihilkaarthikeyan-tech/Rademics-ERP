import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

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
 * Serves the packaged renderer over http://localhost instead of file://.
 * Cloudflare Turnstile validates against window.location.hostname, which a
 * file:// page doesn't have — see the implementation plan for why this exists.
 * electron-vite's own dev server already serves over http://localhost in dev,
 * so this is only used for production (packaged) builds.
 */
export async function startLocalServer(rootDir: string): Promise<{ url: string; close: () => void }> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const urlPath = (req.url ?? '/').split('?')[0] ?? '/';
      const relative = urlPath === '/' ? '/index.html' : urlPath;
      const filePath = join(rootDir, relative);

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

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => server.close(),
  };
}
