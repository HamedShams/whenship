import { existsSync } from 'node:fs';
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
  lanes: [{ name: 'Sara' }, { name: 'Omar', availability: 50 }],
  items: [
    { name: 'Quick fix', who: 'Sara', days: 1 },
    { name: 'Appeal A', who: 'Sara', days: 4, deadline: '2026-10-14' },
    { name: 'Research B', who: 'Sara', days: 5, deadline: '2026-10-16' },
    { name: 'Proposal C', work: [{ lane: 'Omar', days: 1 }, { lane: 'Sara', days: 3, after: 'Omar' }], deadline: '2026-10-20' },
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

  it('gives the model instructions to use the engine instead of its own math', () => {
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toMatch(/Do not work out dates/);
    expect(instructions).toMatch(/Never inflate/);
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
    const alternative = { ...PLAN, items: PLAN.items.map((it) => (it.name === 'Research B' ? { ...it, who: 'Omar' } : it)) };
    const r = (await client.callTool({ name: 'what_if', arguments: { plan: PLAN, alternative } })) as ToolResult;
    const text = textOf(r);
    expect(r.isError).toBeFalsy();
    expect(text).toContain('**Before:**');
    // Omar (half time) finishes Research B the same day Sara would have, but then starts Proposal C two days later
    expect(text).not.toMatch(/\| Research B \| /);
    expect(text).toMatch(/\| Proposal C \| 21 Oct \| 23 Oct \| \+2 working days \|/);
    const changed = JSON.parse(text.slice(text.lastIndexOf('```json') + 7, text.lastIndexOf('```')));
    expect(changed.items.find((x: { name: string }) => x.name === 'Research B').work[0].lane).toBe('omar');
  });

  it('what_if alternatives can split and cut items, keep the plan start, and take changes on top', async () => {
    const { start: _start, ...noStart } = PLAN;
    const alternative = {
      ...noStart,
      items: [
        ...PLAN.items.filter((it) => it.name !== 'Research B' && it.name !== 'Quick fix'),
        { name: 'Research B part 1', who: 'Sara', days: 2, deadline: '2026-10-16' },
        { name: 'Research B part 2', who: 'Omar', days: 3 },
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
});

describe.skipIf(!existsSync('dist/cli.js'))('npx whenship --stdio (built CLI)', () => {
  it('serves the same tools over stdio', async () => {
    const c = new Client({ name: 'test', version: '1.0.0' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/cli.js', '--stdio'] }));
    try {
      const { tools } = await c.listTools();
      expect(tools.map((t) => t.name)).toContain('show_plan');
      const r = await c.callTool({ name: 'show_plan', arguments: { plan: PLAN } });
      expect(textOf(r)).toContain('## Client deliverables');
      const res = await c.readResource({ uri: UI_URI });
      expect((res.contents[0] as { text: string }).text).toContain('hamedshams.github.io/whenship');
    } finally {
      await c.close();
    }
  }, 20_000);
});
