import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createHttpServer } from '../../src/mcp/http';
import { compare, UI_URI } from '../../src/mcp/server';
import { decodeShareLink } from '../../src/io/format';
import { applyChanges } from '../../src/engine';
import { plan } from '../helpers';

const HTML = '<!doctype html><html><head><!--WHENSHIP_BOOT--></head><body><div id="app"></div></body></html>';

const PLAN = {
  title: 'Client deliverables',
  start: '2026-10-05',
  lanes: [{ name: 'Sara' }, { name: 'Martin', availability: 50 }],
  items: [
    { name: 'Quick fix', who: 'Sara', days: 1 },
    { name: 'Appeal A', who: 'Sara', days: 4, deadline: '2026-10-14' },
    { name: 'Research B', who: 'Sara', days: 5, deadline: '2026-10-16' },
    { name: 'Proposal C', work: [{ lane: 'Martin', days: 1 }, { lane: 'Sara', days: 3, after: 'Martin' }], deadline: '2026-10-20' },
  ],
};

type ToolResult = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const textOf = (r: unknown) => (r as ToolResult).content.map((c) => c.text ?? '').join('\n');

let server: Server;
let base: string;
let client: Client;

beforeAll(async () => {
  server = createHttpServer({ html: HTML, version: '1.0.0-test', local: true });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
});

afterAll(async () => {
  await client?.close();
  await new Promise((resolve) => server.close(resolve));
});

describe('MCP connector', () => {
  it('lists four read-only tools with titles; only show_plan has a UI', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['export_plan', 'find_options', 'show_plan', 'what_if']);
    for (const t of tools) {
      expect(t.title).toBeTruthy();
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.description!.length).toBeLessThan(800);
      // directory rule: descriptions say what and when, not how Claude must behave
      expect(t.description).not.toMatch(/\b(you must|always call|never calculate|do not)\b/i);
    }
    // switched-off features are not offered to Claude
    expect(JSON.stringify(tools)).not.toMatch(/daysOff|addDaysOff/);
    const planProps = ((tools.find((t) => t.name === 'show_plan')!.inputSchema.properties as Record<string, { properties: Record<string, { items?: { properties: Record<string, unknown> } }> }>).plan!).properties;
    expect(Object.keys(planProps)).not.toContain('currency');
    expect(Object.keys(planProps.items!.items!.properties)).not.toContain('value');
    const exportFormats = (tools.find((t) => t.name === 'export_plan')!.inputSchema.properties as { format: { enum: string[] } }).format.enum;
    expect(exportFormats).toEqual(['json', 'csv', 'ics', 'markdown', 'link']);
    const show = tools.find((t) => t.name === 'show_plan')!;
    expect((show._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe(UI_URI);
    expect(tools.filter((t) => (t._meta as { ui?: unknown } | undefined)?.ui)).toHaveLength(1);
  });

  it('offers exactly the three forecast lenses, with the current numbers only', async () => {
    const { tools } = await client.listTools();
    for (const t of tools) {
      const lens = (t.inputSchema.properties as Record<string, { enum?: string[]; description?: string }>).lens;
      expect(lens?.enum, t.name).toEqual(['planned', 'likely', 'safe']);
      expect(lens?.description).toMatch(/likely 1\.6×, safe bet 3\.1×/);
    }
    // nothing anywhere still describes the retired lenses (safe bet 2.7×, worst case 3.9×)
    const everything = JSON.stringify(tools) + (client.getInstructions() ?? '');
    expect(everything).not.toMatch(/worst|2\.7×|3\.9×|2\.5×|P80/i);
    expect(client.getInstructions()).toMatch(/likely 1\.6×, safe bet 3\.1×/);
  });

  it('tells the model what the engine is authoritative for, without telling it how to behave', () => {
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toMatch(/authoritative answer/);
    expect(instructions).toMatch(/stays as given/);
    expect(instructions).toMatch(/suggestions/);
    expect(instructions).not.toMatch(/\b(do not|never|you must|always)\b/i); // descriptive, as the directory review wants
  });

  it('show_plan returns a complete text answer plus the plan for the chart', async () => {
    const r = (await client.callTool({ name: 'show_plan', arguments: { plan: PLAN } })) as ToolResult;
    const text = textOf(r);
    expect(r.isError).toBeFalsy();
    expect(text).toContain('## Client deliverables');
    expect(text).toContain('| Appeal A | Sara 4d |');
    expect(text).toMatch(/starts Mon 5 Oct/);
    expect(text).toContain('Little 2006');
    const sc = r.structuredContent!;
    expect(sc.lens).toBe('planned');
    expect((sc.plan as { items: unknown[] }).items).toHaveLength(4);
    expect(typeof sc.createdAt).toBe('number');
    // clients that hand the model the structured result instead of the text (Claude Code) still get the dates
    expect(Object.keys(sc)[0]).toBe('summary');
    expect(sc.summary).toBe(text);
    // the link in the answer opens the same plan
    const url = /\((http[^)]+#p=[^)]+)\)/.exec(text)![1]!;
    expect(url.startsWith(`${base}/#p=`)).toBe(true);
    expect((decodeShareLink(url)!.plan as { items: unknown[] }).items).toHaveLength(4);
  });

  it('show_plan reports input problems precisely instead of failing', async () => {
    const r = (await client.callTool({
      name: 'show_plan',
      arguments: { plan: { start: '2026-10-05', items: [{ name: 'X', who: 'Ana', days: 2, deadline: 'next Friday' }] } },
    })) as ToolResult;
    const text = textOf(r);
    expect(r.isError).toBeFalsy();
    expect(text).toContain('items[0].deadline: "next Friday" is not a date');
    expect(text).toContain('added "Ana" as a person');
  });

  it('serves the widget as an MCP App resource with the widget boot config', async () => {
    const res = await client.readResource({ uri: UI_URI });
    const c = res.contents[0] as { mimeType: string; text: string };
    expect(c.mimeType).toBe('text/html;profile=mcp-app');
    expect(c.text).toContain('"mode":"widget"');
    expect(c.text).toContain(`"publicUrl":"${base}/"`);
  });

  it('what_if compares before and after with 1-based positions', async () => {
    const r = await client.callTool({ name: 'what_if', arguments: { plan: PLAN, changes: [{ op: 'move', item: 'Research B', to: 1 }] } });
    const text = textOf(r);
    expect(text).toContain('**Before:**');
    expect(text).toContain('**After:**');
    expect(text).toMatch(/\| Research B \| .* \| .* \| -\d+ working days \|/);
    expect(text).toContain('```json');
    expect(text.indexOf('"id":"research-b"')).toBeLessThan(text.indexOf('"id":"quick-fix"'));
  });

  it('what_if compares a whole alternative plan: work moved to someone else', async () => {
    const alternative = { ...PLAN, items: PLAN.items.map((it) => (it.name === 'Research B' ? { ...it, who: 'Martin' } : it)) };
    const r = (await client.callTool({ name: 'what_if', arguments: { plan: PLAN, alternative } })) as ToolResult;
    const text = textOf(r);
    expect(r.isError).toBeFalsy();
    expect(text).toContain('**Before:**');
    // Martin (half time) finishes Research B the same day Sara would have, but then starts Proposal C two days later
    expect(text).not.toMatch(/\| Research B \| /);
    expect(text).toMatch(/\| Proposal C \| 21 Oct \| 23 Oct \| \+2 working days \|/);
    const changed = JSON.parse(text.slice(text.lastIndexOf('```json') + 7, text.lastIndexOf('```')));
    expect(changed.items.find((x: { name: string }) => x.name === 'Research B').work[0].lane).toBe('martin');
  });

  it('what_if alternatives can split and cut items, keep the plan start, and take changes on top', async () => {
    const { start: _start, ...noStart } = PLAN;
    const alternative = {
      ...noStart,
      items: [
        ...PLAN.items.filter((it) => it.name !== 'Research B' && it.name !== 'Quick fix'),
        { name: 'Research B part 1', who: 'Sara', days: 2, deadline: '2026-10-16' },
        { name: 'Research B part 2', who: 'Martin', days: 3 },
      ],
    };
    const text = textOf(await client.callTool({ name: 'what_if', arguments: { plan: PLAN, alternative, changes: [{ op: 'setDeadline', item: 'Appeal A', date: '2026-10-30' }] } }));
    expect(text).toMatch(/\| Research B part 1 \| — \| .* \| new \|/);
    expect(text).toMatch(/\| Research B \| .* \| removed \|/);
    expect(text).toMatch(/\| Quick fix \| .* \| removed \|/);
    const changed = JSON.parse(text.slice(text.lastIndexOf('```json') + 7, text.lastIndexOf('```')));
    expect(changed.start).toBe('2026-10-05'); // not today
    expect(changed.items.find((x: { name: string }) => x.name === 'Appeal A').deadline).toBe('2026-10-30');
  });

  it('what_if needs changes or an alternative', async () => {
    const r = (await client.callTool({ name: 'what_if', arguments: { plan: PLAN } })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/give `changes`, an `alternative` plan, or both/);
  });

  it('what_if reports changes it could not apply', async () => {
    const text = textOf(await client.callTool({ name: 'what_if', arguments: { plan: PLAN, changes: [{ op: 'removeItem', item: 'Nope' }] } }));
    expect(text).toContain('removeItem: no item "Nope"');
    expect(text).toContain('No finish date changes');
  });

  it('find_options returns exact options with applicable changes', async () => {
    const text = textOf(await client.callTool({ name: 'find_options', arguments: { plan: PLAN } }));
    expect(text).toMatch(/Options \(best first\)|No single change/);
    if (text.includes('Options')) expect(text).toMatch(/Changes: `\[\{"op":/);
  });

  it('export_plan returns every text format', async () => {
    const get = async (format: string) => textOf(await client.callTool({ name: 'export_plan', arguments: { plan: PLAN, format } }));
    const json = await get('json');
    expect(json).toContain('client-deliverables.whenship.json');
    expect(JSON.parse(json.slice(json.indexOf('{'), json.lastIndexOf('}') + 1)).items).toHaveLength(4);
    expect(await get('csv')).toMatch(/Appeal A/);
    expect(await get('ics')).toContain('BEGIN:VCALENDAR');
    expect(await get('markdown')).toContain('## Client deliverables');
    expect(await get('link')).toMatch(/#p=/);
  });

  it('rejects unknown tools and malformed arguments as tool errors', async () => {
    const r = (await client.callTool({ name: 'what_if', arguments: { plan: PLAN, changes: [] } }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }))) as ToolResult;
    expect(r.isError).toBe(true);
  });

  it('has a planning prompt', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('plan');
    const p = await client.getPrompt({ name: 'plan', arguments: { notes: 'Sara: 3 days, due Friday' } });
    expect(JSON.stringify(p.messages)).toContain('Keep my estimates exactly');
  });
});

describe('web server', () => {
  it('serves the app with the web boot config', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const html = await r.text();
    expect(html).toContain('"mode":"web"');
    expect(html).not.toContain('<!--WHENSHIP_BOOT-->');
  });
  it('serves health, privacy and the offline download; 404s the rest', async () => {
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true, version: '1.0.0-test' });
    expect(await (await fetch(`${base}/privacy`)).text()).toContain('stores nothing');
    expect((await fetch(`${base}/whenship.html`)).headers.get('content-disposition')).toContain('whenship.html');
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
  it('shows a browser at /mcp how to add the connector; MCP clients still get the protocol', async () => {
    const page = await fetch(`${base}/mcp`, { headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(`<code>${base}/mcp</code>`);
    expect(html).toMatch(/Add custom connector/);
    expect(html).toContain('content="noindex"');
    expect((await fetch(`${base}/mcp`, { headers: { accept: 'text/event-stream' } })).status).toBe(405);
  });
  it('gives the website its own address in link-preview tags, a sitemap and robots rules; the widget gets none', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain(`<link rel="canonical" href="${base}/">`);
    expect(html).toContain(`<meta property="og:image" content="${base}/og.png">`);
    expect(await (await fetch(`${base}/robots.txt`)).text()).toContain(`Sitemap: ${base}/sitemap.xml`);
    expect(await (await fetch(`${base}/sitemap.xml`)).text()).toContain(`<loc>${base}/privacy</loc>`);
    expect((await fetch(`${base}/og.png`)).status).toBe(404); // this test server has no images
    expect((await fetch(`${base}/favicon.ico`)).status).toBe(404);
    const llms = await (await fetch(`${base}/llms.txt`)).text(); // the summary AI assistants read
    expect(llms).toMatch(/^# whenship\n\n> /);
    expect(llms).toContain(`\`${base}/mcp\``);
    const res = await client.readResource({ uri: UI_URI });
    expect((res.contents[0] as { text: string }).text).not.toContain('og:image');
  });
  it('serves the link-preview image and the icon, and escapes an address taken from request headers', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const icon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
    const other = createHttpServer({ html: HTML, version: '1.0.0-test', local: false, images: { og: png, icon } });
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const at = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    try {
      const img = await fetch(`${at}/og.png`);
      expect(img.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await img.arrayBuffer())).toEqual(png);
      for (const p of ['/icon.png', '/favicon.ico']) expect(Buffer.from(await (await fetch(`${at}${p}`)).arrayBuffer())).toEqual(icon);
      expect(await (await fetch(`${at}/`)).text()).toContain(`<link rel="icon" type="image/png" sizes="192x192" href="${at}/icon.png">`);
      const html = await (await fetch(`${at}/`, { headers: { 'x-forwarded-host': 'evil.example"><script>x()</script>' } })).text();
      expect(html).not.toContain('"><script>x()');
      expect(html).toContain('evil.example&quot;&gt;&lt;script&gt;');
    } finally {
      await new Promise((resolve) => other.close(resolve));
    }
  });
  it('guards the local MCP endpoint against DNS rebinding', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://evil.example' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(r.status).toBe(403);
  });
});

describe('compare()', () => {
  it('lists only items whose dates or deadline status change', () => {
    const before = plan(PLAN);
    const after = applyChanges(before, [{ op: 'setLane', lane: 'Sara', availability: 50 }]).plan;
    const text = compare(before, after);
    expect(text).toContain('| Quick fix |');
    expect(text).toMatch(/\+\d+ working days/);
  });

  it('says "1 working day", not "1 working days"', () => {
    const before = plan(PLAN);
    const after = applyChanges(before, [{ op: 'setEffort', item: 'Appeal A', lane: 'Sara', days: 3 }]).plan;
    const text = compare(before, after);
    expect(text).toMatch(/\| -1 working day \|/);
    expect(text).not.toMatch(/\b1 working days/);
  });
});

describe.skipIf(!existsSync('dist/whenship.mcpb'))('Claude Desktop extension (dist/whenship.mcpb)', () => {
  it('packs the current version, the server and a tool list that matches the connector', async () => {
    const files = unzipSync(readFileSync('dist/whenship.mcpb'));
    expect(Object.keys(files).sort()).toEqual(['LICENSE', 'icon.png', 'manifest.json', 'server/app.html', 'server/whenship.mjs']);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as { version: string; tools: { name: string; description: string }[] };
    expect(manifest.version).toBe((JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version);
    const { tools } = await client.listTools();
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
    expect(manifest.tools.find((t) => t.name === 'what_if')!.description).toMatch(/alternative plan/);
    expect(manifest).toMatchObject({ license: 'BSD-3-Clause', author: { name: 'Seyed Hamed Shams', url: 'https://hamedshams.com' } });
    expect(strFromU8(files['LICENSE']!)).toMatch(/^BSD 3-Clause License/);
  });
});

describe.skipIf(!existsSync('dist/cli.js'))('npx whenship (built CLI)', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8', timeout: 10_000 });

  it('prints its version and help, and refuses bad options with a clear message', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(run('--version').stdout.trim()).toBe(pkg.version);
    expect(run('-h').stdout).toMatch(/^whenship [\w.-]+: when will it ship, honestly\?[\s\S]*--stdio/);
    const unknown = run('--nope');
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toMatch(/^Unknown option: --nope/);
    expect(run('--port', 'many').stderr).toMatch(/--port must be a number/);
    expect(run('--public-url=example.com').stderr).toMatch(/--public-url must start with http/);
  });

  it('serves the website, its images and the connector over HTTP, as on a host', async () => {
    const proc = spawn(process.execPath, ['dist/cli.js', '--port', '0', '--host', '127.0.0.1', '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      let out = '';
      const at = await new Promise<string>((resolve, reject) => {
        proc.stdout.on('data', (d: Buffer) => {
          out += d.toString();
          const m = /App:\s+http:\/\/localhost:(\d+)\//.exec(out);
          if (m) resolve(`http://127.0.0.1:${m[1]}/`);
        });
        proc.on('exit', () => reject(new Error(`exited early: ${out}`)));
      });
      expect(out).toMatch(/^whenship [\d.]+\n/); // the banner goes to stdout, not stderr
      const html = await (await fetch(at)).text();
      expect(html).toContain(`<meta property="og:image" content="${at}og.png">`);
      expect(html).toContain('<meta name="author" content="Seyed Hamed Shams"');
      for (const path of ['og.png', 'icon.png', 'favicon.ico']) {
        const r = await fetch(`${at}${path}`);
        expect([path, r.status, r.headers.get('content-type')]).toEqual([path, 200, 'image/png']);
      }
      expect(await (await fetch(`${at}llms.txt`)).text()).toContain(`\`${at}mcp\``);
      const c = new Client({ name: 'test', version: '1.0.0' });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${at}mcp`)));
      try {
        expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual(['export_plan', 'find_options', 'show_plan', 'what_if']);
      } finally {
        await c.close();
      }
    } finally {
      proc.kill();
    }
  }, 20_000);

  it('the npm package ships what `npx whenship` needs, and nothing else', () => {
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', timeout: 60_000 });
    const files = (JSON.parse(r.stdout) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path).sort();
    expect(files).toEqual(['LICENSE', 'README.md', 'dist/app.html', 'dist/cli.js', 'dist/cli.js.LEGAL.txt', 'dist/icon.png', 'dist/og.png', 'dist/whenship.html', 'package.json']);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { bin: Record<string, string>; dependencies?: object; license: string; mcpName: string };
    expect(pkg.bin).toEqual({ whenship: 'dist/cli.js' });
    expect(readFileSync('dist/cli.js', 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/);
    expect(pkg.dependencies ?? {}).toEqual({}); // everything is bundled into the CLI
    expect(pkg.license).toBe('BSD-3-Clause');
    expect(pkg.mcpName).toBe('io.github.HamedShams/whenship'); // the MCP Registry checks the package claims this name
  }, 60_000);

  it('serves the same tools over stdio', async () => {
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/cli.js', '--stdio'] }));
    try {
      const { tools } = await c.listTools();
      expect(tools.map((t) => t.name)).toContain('show_plan');
      const r = await c.callTool({ name: 'show_plan', arguments: { plan: PLAN } });
      expect(textOf(r)).toContain('## Client deliverables');
      const res = await c.readResource({ uri: UI_URI });
      expect((res.contents[0] as { text: string }).text).toContain('https://whenship.app/');
    } finally {
      await c.close();
    }
  }, 20_000);
});

describe('the website page and the license', () => {
  const page = readFileSync('index.html', 'utf8');
  const meta = (attr: string, name: string) => new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`).exec(page)?.[1];

  it('carries the tags search engines and link previews read, and no keywords tag', () => {
    expect(page).toMatch(/<html lang="en">/);
    expect(page).toMatch(/<title>whenship: when will it ship, honestly\?<\/title>/);
    expect(meta('name', 'description')!.length).toBeLessThanOrEqual(160);
    expect([meta('name', 'author'), meta('name', 'robots'), meta('name', 'application-name')]).toEqual(['Seyed Hamed Shams', 'index, follow', 'whenship']);
    expect(page).toContain('<link rel="author" href="https://hamedshams.com" />');
    for (const p of ['og:type', 'og:site_name', 'og:locale', 'og:title', 'og:description', 'og:image:alt']) expect(meta('property', p), p).toBeTruthy();
    for (const n of ['twitter:card', 'twitter:title', 'twitter:description']) expect(meta('name', n), n).toBeTruthy();
    expect(page).not.toMatch(/name="keywords"/); // ignored by Google, a spam hint to Bing
    expect(page).toMatch(/<noscript>[\s\S]*\/mcp[\s\S]*BSD 3-Clause[\s\S]*<\/noscript>/); // what crawlers without JavaScript read
  });

  it('describes the app in valid structured data, with its author and license', () => {
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)![1]!);
    expect(ld).toMatchObject({
      '@type': 'WebApplication',
      name: 'whenship',
      isAccessibleForFree: true,
      author: { '@type': 'Person', name: 'Seyed Hamed Shams', url: 'https://hamedshams.com' },
      license: 'https://opensource.org/license/bsd-3-clause',
    });
  });

  it.skipIf(!existsSync('dist/app.html'))('keeps those tags in the built single-file app', () => {
    const built = readFileSync('dist/app.html', 'utf8');
    expect(built).toContain('<meta name="author" content="Seyed Hamed Shams" />');
    expect(built).toContain('"@type": "WebApplication"');
    expect(built).toContain('<!--WHENSHIP_BOOT-->');
  });

  it('is BSD 3-Clause everywhere, in the name of its author', () => {
    const license = readFileSync('LICENSE', 'utf8');
    expect(license).toMatch(/^BSD 3-Clause License\n\nCopyright \(c\) 2026, Seyed Hamed Shams \(https:\/\/hamedshams\.com\)\nAll rights reserved\.\n/);
    expect(license).toContain('Neither the name of the copyright holder nor the names of its');
    const plugin = JSON.parse(readFileSync('plugin/.claude-plugin/plugin.json', 'utf8')) as { license: string; author: { name: string } };
    expect([plugin.license, plugin.author.name]).toEqual(['BSD-3-Clause', 'Seyed Hamed Shams']);
    expect(readFileSync('README.md', 'utf8')).toMatch(/## License\n\n\[BSD 3-Clause\]\(LICENSE\)/);
  });
});
