/**
 * Custom URL schemes.
 *
 * app://mjournal/…   serves the interface from the built renderer folder,
 *                    with a strict Content-Security-Policy.
 * mj-media://photo/<id> and mj-media://thumb/<id> serve photos. Files are
 *                    looked up by id in the database, so the interface can
 *                    never ask for an arbitrary path on disk.
 */
import { net, protocol } from 'electron';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MEDIA_SCHEME } from './store/photos';

export const APP_SCHEME = 'app';
export const APP_HOST = 'mjournal';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  `img-src 'self' ${MEDIA_SCHEME}: blob: data:`,
  "font-src 'self'",
  `connect-src 'self' ${MEDIA_SCHEME}:`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    // corsEnabled lets the interface fetch() photos to make thumbnails (only from its own origin, see below).
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

/** Origins allowed to read media with fetch(): the app itself, plus the dev server during development. */
function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  if (origin === APP_ORIGIN) return origin;
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl && origin === new URL(devUrl).origin) return origin;
  return null;
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });

export function handleAppProtocol(rendererDir: string): void {
  const root = normalize(rendererDir);
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return notFound();
    const pathname = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root + sep)) return notFound();
    try {
      const body = await readFile(file);
      const headers: Record<string, string> = {
        'Content-Type': MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      };
      if (file.endsWith('.html')) headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY;
      return new Response(body, { status: 200, headers });
    } catch {
      return notFound();
    }
  });
}

export function handleMediaProtocol(resolve: (kind: 'photo' | 'thumb', id: string) => string | null): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const kind = url.host;
    const id = url.pathname.slice(1);
    if ((kind !== 'photo' && kind !== 'thumb') || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return notFound();
    let path: string | null = null;
    try {
      path = resolve(kind, id);
    } catch {
      path = null;
    }
    if (!path || !existsSync(path)) return notFound();
    const response = await net.fetch(pathToFileURL(path).toString());
    if (!response.ok) return notFound();
    const headers: Record<string, string> = {
      'Content-Type': MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    const origin = allowedOrigin(request);
    if (origin) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers.Vary = 'Origin';
    }
    return new Response(response.body, { status: 200, headers });
  });
}
