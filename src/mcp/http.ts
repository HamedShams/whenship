import { createServer as createNodeServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
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
  /**
   * The link-preview image (dist/og.png, served at /og.png), the 192 px tab icon with see-through corners (dist/icon.png,
   * served at /icon.png and /favicon.ico) and the edge-to-edge home-screen icon (dist/icon-touch.png, /apple-touch-icon.png).
   */
  images?: { og?: Buffer; icon?: Buffer; touch?: Buffer };
  /**
   * Pictures for a directory listing (dist/directory/*.png), served at /directory/<name>.png: the Claude directory's form
   * takes the addresses of its carousel screenshots and icon, on a domain the publisher controls, not uploads.
   */
  directory?: Record<string, Buffer>;
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Goes up when the icon's picture changes: browsers keep a site's icon for weeks, and only a new address makes them fetch it again. */
const ICON_V = 2;

/** Puts the boot config in front of the app script; the website also gets the tags that need its own address. */
export function withBoot(html: string, boot: Record<string, unknown>): string {
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  const url = boot.mode === 'web' && typeof boot.publicUrl === 'string' ? attr(boot.publicUrl) : '';
  const meta = url
    ? `<link rel="canonical" href="${url}"><meta property="og:url" content="${url}"><meta property="og:image" content="${url}og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:image" content="${url}og.png"><meta name="twitter:image:alt" content="whenship: a Gantt chart of client deliverables with deadline diamonds and expected delivery dates"><link rel="icon" type="image/png" sizes="192x192" href="${url}icon.png?v=${ICON_V}"><link rel="apple-touch-icon" href="${url}apple-touch-icon.png?v=${ICON_V}">`
    : '';
  // the website's icon is the PNG file (search engines can't use a data: URI); the offline file and the widget keep the inline one
  const page = url ? html.replace(/<link rel="icon" href="data:[^"]*"\s*\/?>\s*/, '') : html;
  return page.replace('<!--WHENSHIP_BOOT-->', `${meta}<script>window.__WHENSHIP__=${json}</script>`);
}

/** A plain text page in the site's style. */
const doc = (title: string, body: string, robots = 'index, follow', css = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="robots" content="${robots}"><style>body{font:16px/1.6 system-ui,sans-serif;max-width:680px;margin:40px auto;padding:0 16px;color:#1d2433;background:#fff}h1{font-size:24px}code{background:#eef0f5;padding:2px 6px;border-radius:4px;word-break:break-all}
@media(prefers-color-scheme:dark){body{color:#e6e9f0;background:#14161c}a{color:#91a7ff}code{background:#232733}}${css}</style></head><body>
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

/**
 * The picture on the connector page: a conversation with the chart in it, drawn in HTML and CSS (no image, no script),
 * so it is sharp at any size and reflows on a phone. The plan is the first example of the web app.
 */
const DEMO_CSS = `
.top{display:flex;align-items:center;margin:-12px 0 28px}
.top a{display:inline-flex;align-items:center;gap:8px;font-weight:700;color:inherit;text-decoration:none}
.top a:hover{text-decoration:underline}
h2{font-size:18px;margin:30px 0 8px}
.go{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 8px}
.go a{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid #c9cfdb;border-radius:8px;color:inherit;text-decoration:none;font-size:14.5px;font-weight:600}
.go a:hover,.go a:focus-visible{border-color:#4f46e5;color:#4f46e5}
.go a.main{background:#4f46e5;border-color:#4f46e5;color:#fff}
.go a.main:hover,.go a.main:focus-visible{background:#4338ca;color:#fff}
@media(prefers-color-scheme:dark){.go a{border-color:#3a4050}.go a:hover,.go a:focus-visible{border-color:#91a7ff;color:#91a7ff}.go a.main:hover,.go a.main:focus-visible{color:#fff}}
.demo{margin:22px 0 26px;padding:0;cursor:default;-webkit-user-select:none;user-select:none}
.demo-win{border-radius:14px;border:1px solid #2a2f3b;background:#14161c;overflow:hidden;box-shadow:0 12px 32px rgba(15,18,28,.18);pointer-events:none}
.demo-bar{display:flex;align-items:center;gap:6px;height:30px;padding:0 12px;background:#1b1e26;border-bottom:1px solid #2a2f3b;color:#9aa3b5;font-size:11.5px;letter-spacing:.02em}
.demo-bar i{width:9px;height:9px;border-radius:50%;background:#3a4050}
.demo-bar span{margin-left:8px}
.demo-bar b{margin-left:auto;padding:1px 8px;border-radius:999px;border:1px solid #3a4050;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.08em}
.demo-chat{display:flex;flex-direction:column;gap:12px;padding:16px;color:#e6e9f0;font-size:13.5px;line-height:1.45}
.demo-you{align-self:flex-end;max-width:82%;margin:0;padding:8px 12px;border-radius:14px 14px 4px 14px;background:#262b38}
.demo-who{display:flex;align-items:center;gap:7px;color:#9aa3b5;font-size:12px}
.demo-who i{width:9px;height:9px;border-radius:50%;background:#d97757}
.demo-card{border:1px solid #2a2f3b;border-radius:12px;background:#1b1e26;overflow:hidden}
.demo-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;padding:10px 12px;border-bottom:1px solid #2a2f3b}
.demo-head b{font-size:14px}
.demo-head span{color:#9aa3b5;font-size:12px}
.demo-row{display:grid;grid-template-columns:minmax(0,34%) 52px minmax(0,1fr);align-items:center;gap:8px;height:30px;padding:0 12px;border-bottom:1px solid #232733;font-size:12.5px}
.demo-row .n{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.demo-row .d{justify-self:start;padding:0 6px;border-radius:9px;border:1px solid transparent;font-size:11px;line-height:16px;white-space:nowrap;color:#9aa3b5}
.demo-row .d.ok{border-color:#2f9e63;background:#1d3a2c;color:#e6e9f0}.demo-row .d.tight{border-color:#b9813a;background:#3b2e1c;color:#e6e9f0}.demo-row .d.late{border-color:#c2575c;background:#40242a;color:#e6e9f0}
.demo-row .t{position:relative;height:100%;background:repeating-linear-gradient(90deg,transparent 0 calc(700%/26 - 1px),#232733 calc(700%/26 - 1px) calc(700%/26))}
.demo-row .t i{position:absolute;top:8px;height:14px;border-radius:4px;background:#12b886}
.demo-row .t i.m{background:#f59f00}
.demo-row .t i.over{border-radius:0 4px 4px 0;background:repeating-linear-gradient(135deg,#c2575c 0 3px,#40242a 3px 6px)}
.demo-row .t u{position:absolute;top:10px;width:9px;height:9px;margin-left:-5px;transform:rotate(45deg);border-radius:2px;background:#51cf66}
.demo-row .t u.tight{background:#ffa94d}.demo-row .t u.late{background:#ff6b6b}
.demo-opt{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:10px 12px 12px;padding:9px 11px;border-radius:10px;border:1px solid #6b4a3d;background:#241d1b}
.demo-opt span{flex:1 1 200px;min-width:0}
.demo-opt small{display:block;color:#d97757;font-size:11px}
.demo-opt em{display:block;color:#9aa3b5;font-style:normal;font-size:12px}
.demo-opt b{flex:none;padding:3px 12px;border:1px solid #3a4050;border-radius:8px;font-weight:600;font-size:12.5px;color:#9aa3b5}
.demo-say{margin:0}
.demo-box{padding:9px 12px;border-radius:12px;border:1px solid #2a2f3b;color:#6f7889}
.demo figcaption{margin-top:9px;font-size:13.5px;opacity:.75;text-align:center}
@media(max-width:480px){.demo-chat{padding:12px;font-size:13px}.demo-you{max-width:92%}.demo-row{grid-template-columns:minmax(0,42%) minmax(0,1fr);padding:0 10px}.demo-row .d{display:none}}`;

const DEMO = `<figure class="demo">
<div class="demo-win">
<div class="demo-bar" aria-hidden="true"><i></i><i></i><i></i><span>A conversation in Claude</span><b>Preview</b></div>
<div class="demo-chat" role="img" aria-label="A conversation in Claude: someone asks whether Sara will make her deadlines, and the answer contains the whenship chart with five items, one of them a day late, and an option that fixes it.">
<p class="demo-you">Sara has five client deliverables due this month. Will she make the deadlines?</p>
<div class="demo-who"><i></i>Claude · whenship</div>
<div class="demo-card">
<div class="demo-head"><b>Client deliverables</b><span>1 of 4 deadlines late as planned · all done 16 Dec</span></div>
<div class="demo-row"><span class="n">Quick fix for Acme</span><span class="d">23 Nov</span><span class="t"><i style="left:0;width:3.8%"></i></span></div>
<div class="demo-row"><span class="n">Appeal for Northwind</span><span class="d ok">27 Nov</span><span class="t"><i style="left:3.8%;width:15.4%"></i><u style="left:38.5%"></u></span></div>
<div class="demo-row"><span class="n">Research for Brightside</span><span class="d tight">4 Dec</span><span class="t"><i style="left:26.9%;width:19.2%"></i><u class="tight" style="left:61.5%"></u></span></div>
<div class="demo-row"><span class="n">Revise Lumen proposal</span><span class="d late">9 Dec</span><span class="t"><i class="m" style="left:0;width:7.7%"></i><i style="left:53.8%;width:7.7%;border-radius:4px 0 0 4px"></i><i class="over" style="left:61.5%;width:3.9%"></i><u class="late" style="left:61.5%"></u></span></div>
<div class="demo-row"><span class="n">Appeal for Kestrel</span><span class="d tight">16 Dec</span><span class="t"><i style="left:65.4%;width:26.9%"></i><u class="tight" style="left:97.5%"></u></span></div>
<div class="demo-opt"><span><small>An option, measured exactly</small>Do "Quick fix for Acme" after the dated work<em>1 more deadline met (Revise Lumen proposal)</em></span><b>Apply</b></div>
</div>
<p class="demo-say">One promise slips: the Lumen proposal lands a day late. Doing the quick fix after the dated work saves it. Drag anything in the chart to try your own change.</p>
<div class="demo-box" aria-hidden="true">Reply…</div>
</div>
</div>
<figcaption>A picture of it, not the thing itself. In Claude the chart is live: drag, edit, apply an option, and Claude sees what you change.</figcaption>
</figure>`;

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#4c6ef5"/><rect x="6" y="8" width="13" height="4" rx="2" fill="#fff"/><rect x="11" y="14" width="15" height="4" rx="2" fill="#fff" opacity=".85"/><rect x="9" y="20" width="9" height="4" rx="2" fill="#fff" opacity=".7"/><path d="M24 20.5l2.5 2.5-2.5 2.5-2.5-2.5z" fill="#ffd43b"/></svg>`;

/**
 * What a browser sees at /mcp: the address is for Claude, so show what it does there and say how to add it. What can be
 * pressed looks like a button or a link; the picture sits in a window frame marked "Preview" and takes no presses. The
 * ways on lead to the home page ("#home"), never into the middle of a plan the visitor tried earlier.
 */
const CONNECTOR = (publicUrl: string) => doc('whenship connector for Claude', `<div class="top"><a href="${publicUrl}#home">${LOGO} whenship</a></div>
<h1>whenship connector for Claude</h1>
<p>Ask Claude <i>"will we make the deadline?"</i> and get a chart you can work in, right in the conversation. Every date comes from whenship's scheduling engine, not from a guess.</p>
${DEMO}
<h2>Add it to Claude</h2>
<p>This address is the connector itself. Claude talks to it; a browser can't open it.</p>
<ol>
<li>In Claude (web or desktop), open <b>Settings → Connectors → Add custom connector</b>.</li>
<li>Name it <b>whenship</b> and paste this address: <code>${publicUrl}mcp</code></li>
<li>Click <b>Add</b>, then ask Claude, for example: <i>"Sara has five client deliverables due this month. Will she make the deadlines? Show it with whenship."</i></li>
</ol>
<p>On a Team or Enterprise plan, an owner adds it once under <b>Organization settings → Connectors</b>; everyone else then clicks <b>Connect</b>.</p>
<p>No sign-in and nothing stored (see <a href="${publicUrl}privacy">privacy</a>).</p>
<h2>Or use it without Claude</h2>
<div class="go"><a class="main" href="${publicUrl}#home">Open whenship in the browser →</a><a href="https://github.com/HamedShams/whenship#use-it-in-claude">Run it on your own computer →</a></div>`, 'noindex', DEMO_CSS);

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
  // which build of the page this server hands out: a page left open across a deploy asks, and offers a reload
  const build = createHash('sha256').update(opts.html).digest('hex').slice(0, 10);
  const pages = new Map<string, string>();
  const page = (publicUrl: string, mode: 'web' | 'widget') => {
    const k = `${mode} ${publicUrl}`;
    let html = pages.get(k);
    if (!html) {
      html = withBoot(opts.html, { mode, publicUrl, version: opts.version, build });
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
    // only the names loaded at start-up are ever served: nothing in the address reaches the file system
    const picture = /^\/directory\/([a-z0-9][a-z0-9-]*\.png)$/.exec(path);
    if (picture) {
      const file = opts.directory?.[picture[1]!];
      if (file) return send(req, res, 200, 'image/png', file, { 'cache-control': 'public, max-age=86400' });
      return send(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
    }
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
        return send(req, res, 200, 'application/json', JSON.stringify({ ok: true, version: opts.version, build }));
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
      case '/favicon.ico':
      case '/apple-touch-icon.png':
      case '/apple-touch-icon-precomposed.png': {
        // a phone's home screen rounds the icon itself and shows black where a picture is see-through: it gets the edge-to-edge one
        const image = path === '/og.png' ? opts.images?.og : path.startsWith('/apple-touch-icon') ? (opts.images?.touch ?? opts.images?.icon) : opts.images?.icon;
        if (image) return send(req, res, 200, 'image/png', image, { 'cache-control': 'public, max-age=86400' });
        return send(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
      }
      default:
        return send(req, res, 404, 'text/plain; charset=utf-8', 'Not found');
    }
  });
}
