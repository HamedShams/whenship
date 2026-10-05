import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createServer as createMcpServer } from './server';

export interface HttpOptions {
  /** dist/app.html: the single-file app (website, offline file and widget). */
  html: string;
  version: string;
  /** Public address (e.g. https://whenship.dev/). Defaults to the address the request came in on. */
  publicUrl?: string;
  /** True when bound to localhost only: DNS-rebinding guards on /mcp. */
  local: boolean;
  log?: (msg: string) => void;
}

/** Puts the boot config in front of the app script. */
export function withBoot(html: string, boot: Record<string, unknown>): string {
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  return html.replace('<!--WHENSHIP_BOOT-->', `<script>window.__WHENSHIP__=${json}</script>`);
}

const PRIVACY = (publicUrl: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>whenship privacy</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#1d2433;background:#fff}
@media(prefers-color-scheme:dark){body{color:#e6e9f0;background:#14161c}a{color:#91a7ff}}h1{font-size:24px}</style></head><body>
<h1>Privacy</h1>
<p><b>whenship stores nothing about you or your plans on its servers.</b> There are no accounts, no database and no cookies.</p>
<ul>
<li><b>Website:</b> your plan is kept in your own browser (local storage) until you clear it. Files you export are created in your browser.</li>
<li><b>Share links:</b> the whole plan is compressed into the part of the link after <code>#</code>. Browsers never send that part to a server, so the link is the only copy. Anyone you give it to can read the plan.</li>
<li><b>Claude connector:</b> when Claude calls a whenship tool, the plan is sent to this server, scheduled in memory and returned. It is not logged or kept. Claude's own data handling applies to your conversation.</li>
<li><b>Hosting:</b> the server's host may keep standard request logs (time, IP address, path) for security; plan data is never part of a path.</li>
</ul>
<p>Source code: <a href="https://github.com/HamedShams/whenship">github.com/HamedShams/whenship</a> (MIT). Questions: open an issue there.</p>
<p><a href="${publicUrl}">Back to whenship</a></p></body></html>`;

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function send(req: IncomingMessage, res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}) {
  const gzip = body.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  const data = gzip ? gzipSync(body) : Buffer.from(body);
  res.writeHead(status, {
    'content-type': type,
    'content-length': String(data.length),
    'cache-control': 'no-cache',
    vary: 'accept-encoding',
    ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    ...SECURITY_HEADERS,
    ...extra,
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

function originOf(req: IncomingMessage): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]!.trim() || 'http';
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0]!.trim();
  return `${proto}://${host}/`;
}

/** One small Node service: the web app at `/`, the MCP connector at `/mcp`. Stateless: nothing is stored. */
export function createHttpServer(opts: HttpOptions): Server {
  const log = opts.log ?? (() => undefined);
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  const pages = new Map<string, string>();
  const page = (publicUrl: string, mode: 'web' | 'widget') => {
    const k = `${mode} ${publicUrl}`;
    let html = pages.get(k);
    if (!html) {
      html = withBoot(opts.html, { mode, publicUrl, version: opts.version });
      if (pages.size > 20) pages.clear();
      pages.set(k, html);
    }
    return html;
  };

  const mcp = toNodeHandler(
    createMcpHandler(
      (ctx) => {
        const r = ctx.requestInfo;
        const publicUrl =
          opts.publicUrl ??
          (r
            ? originOf({ headers: { host: new URL(r.url).host, 'x-forwarded-proto': r.headers.get('x-forwarded-proto') ?? undefined, 'x-forwarded-host': r.headers.get('x-forwarded-host') ?? undefined } } as unknown as IncomingMessage)
            : 'http://localhost/');
        return createMcpServer({ html: page(publicUrl, 'widget'), publicUrl, version: opts.version });
      },
      { onerror: (err) => log(`mcp: ${err.message}`) },
    ),
  );

  return createNodeServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/mcp') {
      if (opts.local && (!validateHost(req, res) || !validateOrigin(req, res))) return;
      void mcp(req, res).catch((err: Error) => {
        log(`mcp: ${err.message}`);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const publicUrl = opts.publicUrl ?? originOf(req);
    switch (path) {
      case '/':
      case '/index.html':
        return send(req, res, 200, 'text/html; charset=utf-8', page(publicUrl, 'web'));
      case '/whenship.html':
        return send(req, res, 200, 'text/html; charset=utf-8', withBoot(opts.html, { mode: 'web', publicUrl, version: opts.version }), {
          'content-disposition': 'attachment; filename="whenship.html"',
        });
      case '/privacy':
        return send(req, res, 200, 'text/html; charset=utf-8', PRIVACY(publicUrl));
      case '/healthz':
        return send(req, res, 200, 'application/json', JSON.stringify({ ok: true, version: opts.version }));
      case '/robots.txt':
        return send(req, res, 200, 'text/plain', 'User-agent: *\nAllow: /\nDisallow: /mcp\n');
      default:
        return send(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
    }
  });
}
