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
  /** The link-preview image (dist/og.png, served at /og.png) and the 192 px app icon (dist/icon.png, served at /icon.png and /favicon.ico). */
  images?: { og?: Buffer; icon?: Buffer };
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Puts the boot config in front of the app script; the website also gets the tags that need its own address. */
export function withBoot(html: string, boot: Record<string, unknown>): string {
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  const url = boot.mode === 'web' && typeof boot.publicUrl === 'string' ? attr(boot.publicUrl) : '';
  const meta = url
    ? `<link rel="canonical" href="${url}"><meta property="og:url" content="${url}"><meta property="og:image" content="${url}og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:image" content="${url}og.png"><meta name="twitter:image:alt" content="whenship: a Gantt chart of client deliverables with deadline diamonds and expected delivery dates"><link rel="icon" type="image/png" sizes="192x192" href="${url}icon.png"><link rel="apple-touch-icon" href="${url}icon.png">`
    : '';
  // the website's icon is the PNG file (search engines can't use a data: URI); the offline file and the widget keep the inline one
  const page = url ? html.replace(/<link rel="icon" href="data:[^"]*"\s*\/?>\s*/, '') : html;
  return page.replace('<!--WHENSHIP_BOOT-->', `${meta}<script>window.__WHENSHIP__=${json}</script>`);
}

/** A plain text page in the site's style. */
const doc = (title: string, body: string, robots = 'index, follow') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="robots" content="${robots}"><style>body{font:16px/1.6 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#1d2433;background:#fff}h1{font-size:24px}code{background:#eef0f5;padding:2px 6px;border-radius:4px;word-break:break-all}
@media(prefers-color-scheme:dark){body{color:#e6e9f0;background:#14161c}a{color:#91a7ff}code{background:#232733}}</style></head><body>
${body}</body></html>`;

const PRIVACY = (publicUrl: string) => doc('whenship privacy', `<h1>Privacy</h1>
<p><b>whenship stores nothing about you or your plans on its servers.</b> There are no accounts, no database and no cookies.</p>
<ul>
<li><b>Website:</b> your plan is kept in your own browser (local storage) until you clear it. Files you export are created in your browser.</li>
<li><b>Share links:</b> the whole plan is compressed into the part of the link after <code>#</code>. Browsers never send that part to a server, so the link is the only copy. Anyone you give it to can read the plan.</li>
<li><b>Claude connector:</b> when Claude calls a whenship tool, the plan is sent to this server, scheduled in memory and returned. It is not logged or kept. Claude's own data handling applies to your conversation.</li>
<li><b>Hosting:</b> the server's host may keep standard request logs (time, IP address, path) for security; plan data is never part of a path.</li>
</ul>
<p>Source code: <a href="https://github.com/HamedShams/whenship">github.com/HamedShams/whenship</a> (BSD-3-Clause), made by <a href="https://hamedshams.com">Seyed Hamed Shams</a>. Questions: open an issue there.</p>
<p><a href="${publicUrl}">Back to whenship</a></p>`);

/** /llms.txt: a plain summary for AI assistants and agents that read a site before using it (llmstxt.org). */
const LLMS = (publicUrl: string) => `# whenship

> A tiny planner for small teams that answers "when will it ship?": list the work, who does it and roughly how long it takes, and whenship schedules it, shows which deadlines will slip and why, and suggests changes that meet more of them. Free, open source (BSD 3-Clause), no accounts; plans stay with the user.

whenship is a deterministic scheduler, not an estimate from a language model: every date and every suggestion is an exact re-plan. Effort can be seen as planned (1×), likely (1.6×) or as a safe bet (3.1×), with a chance of meeting each deadline.

## Use it

- [Web app](${publicUrl}): paste a list or start from a sample; scheduling runs in the browser.
- MCP connector for Claude and other MCP hosts: \`${publicUrl}mcp\` (Streamable HTTP, no sign-in). Tools: show_plan (interactive chart), what_if, find_options, export_plan.
- Local: \`npx whenship\` (web app) or \`npx whenship --stdio\` (MCP server); a Claude Desktop extension is attached to each GitHub release.

## Docs

- [README: plan format, how the dates and suggestions work](https://github.com/HamedShams/whenship#readme)
- [Privacy](${publicUrl}privacy): nothing about users or plans is stored on the server.
- Made by [Seyed Hamed Shams](https://hamedshams.com).
`;

/** What a browser sees at /mcp: the address is for Claude, so say how to add it there. */
const CONNECTOR = (publicUrl: string) => doc('whenship connector for Claude', `<h1>whenship connector for Claude</h1>
<p>This address is whenship's connector. Claude talks to it; a browser can't open it. To use whenship inside Claude:</p>
<ol>
<li>In Claude (web or desktop), open <b>Settings → Connectors → Add custom connector</b>.</li>
<li>Name it <b>whenship</b> and paste this address: <code>${publicUrl}mcp</code></li>
<li>Click <b>Add</b>, then ask Claude, for example: <i>"Sara has five client deliverables due this month. Will she make the deadlines? Show it with whenship."</i></li>
</ol>
<p>On a Team or Enterprise plan, an owner adds it once under <b>Organization settings → Connectors</b>; everyone else then clicks <b>Connect</b>.</p>
<p>No sign-in and nothing stored (see <a href="${publicUrl}privacy">privacy</a>). Prefer to run it on your own computer? See the <a href="https://github.com/HamedShams/whenship#use-it-in-claude">other ways to use it in Claude</a>.</p>
<p><a href="${publicUrl}">Open the whenship app</a></p>`, 'noindex');

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function send(req: IncomingMessage, res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) {
  const gzip = typeof body === 'string' && body.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
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
      const accept = String(req.headers.accept ?? '');
      if (req.method === 'GET' && accept.includes('text/html') && !accept.includes('text/event-stream')) {
        return send(req, res, 200, 'text/html; charset=utf-8', CONNECTOR(attr(opts.publicUrl ?? originOf(req))));
      }
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
        return send(req, res, 200, 'text/html; charset=utf-8', PRIVACY(attr(publicUrl)));
      case '/healthz':
        return send(req, res, 200, 'application/json', JSON.stringify({ ok: true, version: opts.version }));
      case '/robots.txt':
        return send(req, res, 200, 'text/plain', `User-agent: *\nAllow: /\nDisallow: /mcp\nSitemap: ${publicUrl}sitemap.xml\n`);
      case '/llms.txt':
        return send(req, res, 200, 'text/plain; charset=utf-8', LLMS(publicUrl));
      case '/sitemap.xml':
        return send(
          req,
          res,
          200,
          'application/xml',
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${attr(publicUrl)}</loc></url><url><loc>${attr(publicUrl)}privacy</loc></url></urlset>\n`,
        );
      case '/og.png':
      case '/icon.png':
      case '/favicon.ico': {
        const image = path === '/og.png' ? opts.images?.og : opts.images?.icon;
        if (image) return send(req, res, 200, 'image/png', image, { 'cache-control': 'public, max-age=86400' });
        return send(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
      }
      default:
        return send(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
    }
  });
}
