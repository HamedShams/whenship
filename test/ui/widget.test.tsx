// @vitest-environment happy-dom
// The Claude widget end to end: the real widget code talks MCP Apps to a real host bridge over an in-memory transport.
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactPlan, todayLocal, validatePlan } from '../../src/engine';
import { SAMPLES } from '../../src/io/samples';

const today = todayLocal();
const input = () => SAMPLES[0]!.build(today);

interface Options {
  /** The host accepts chat messages (needed for "Ask Claude"). */
  message?: boolean;
  /** The host can download files. */
  download?: boolean;
  ctx?: Record<string, unknown>;
  /** Give this widget the cross-chart channel (each real chart is its own iframe; here they share one page). */
  channel?: boolean;
}

const tick = (ms = 0) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function until(check: () => unknown, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await tick(10);
  }
}
const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label));
const saturday = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.daychip[title^="Saturday"]')!;

/** Starts a fresh widget (a fresh module, as each chart is its own iframe) inside a test host. */
async function start(o: Options = {}) {
  vi.resetModules();
  if (!o.channel) vi.stubGlobal('BroadcastChannel', undefined);
  const { bootWidget } = await import('../../src/ui/widget');
  vi.unstubAllGlobals();
  const [hostSide, appSide] = InMemoryTransport.createLinkedPair();
  const log = { events: [] as string[], context: [] as any[], messages: [] as any[], downloads: [] as any[], links: [] as string[], modes: [] as string[] };
  const ctx = { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], userAgent: 'Claude test host', ...o.ctx };
  const caps = { openLinks: {}, updateModelContext: { text: {} }, ...(o.download === false ? {} : { downloadFile: {} }), ...(o.message ? { message: { text: {} } } : {}) };
  const bridge = new AppBridge(null, { name: 'test host', version: '1' }, caps as never, { hostContext: ctx as never });
  bridge.onupdatemodelcontext = async (p) => (log.events.push('context'), log.context.push(p), {});
  bridge.onmessage = async (p) => (log.events.push('message'), log.messages.push(p), {});
  bridge.ondownloadfile = async (p) => (log.downloads.push(p), {});
  bridge.onopenlink = async (p) => (log.links.push(p.url), {});
  bridge.onrequestdisplaymode = async ({ mode }) => {
    log.modes.push(mode);
    bridge.setHostContext({ ...ctx, displayMode: mode } as never);
    return { mode };
  };
  bridge.onsizechange = () => undefined;
  const ready = new Promise<void>((r) => (bridge.oninitialized = () => r()));
  await bridge.connect(hostSide);
  const root = document.createElement('div');
  document.body.appendChild(root);
  const booted = bootWidget(root, appSide);
  await ready;
  await booted;
  return { root, bridge, log };
}
type Host = Awaited<ReturnType<typeof start>>;

/** What Claude's show_plan call sends: the arguments, then the result with the plan for the chart. */
async function show(h: Host, extra: { lens?: string; createdAt?: number; seq?: number } = {}) {
  const plan = validatePlan(input(), { today }).plan;
  await h.bridge.sendToolInput({ arguments: { plan: input(), ...(extra.lens ? { lens: extra.lens } : {}) } });
  await h.bridge.sendToolResult({
    content: [{ type: 'text', text: 'summary' }],
    structuredContent: { plan: compactPlan(plan), lens: extra.lens ?? 'planned', publicUrl: 'https://whenship.example/', createdAt: extra.createdAt ?? Date.now(), seq: extra.seq ?? 1 },
  } as never);
  await until(() => h.root.querySelector('.card'));
}
async function openFull(h: Host) {
  await act(() => button(h.root, 'Open interactive chart')!.click());
  await until(() => h.root.querySelector('.app') && !h.root.querySelector('.card'));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Claude widget (MCP App)', () => {
  it('draws the plan while Claude is still writing it, then a summary card', async () => {
    const h = await start();
    expect(h.root.textContent).toMatch(/Planning…/);
    const partial = input();
    await h.bridge.sendToolInputPartial({ arguments: { plan: { ...partial, items: partial.items!.slice(0, 2) } } });
    await until(() => h.root.querySelectorAll('.mini-row').length === 2);
    await show(h);
    expect(h.root.querySelector('.card h2')!.textContent).toBe('Client deliverables');
    expect(h.root.querySelectorAll('.mini-row')).toHaveLength(7);
    expect(h.root.querySelectorAll('.risk').length).toBeGreaterThan(0);
  });

  it('opens the full chart in fullscreen and keeps the strip under Claude’s message box clear', async () => {
    const h = await start();
    await show(h);
    expect(document.documentElement.style.getPropertyValue('--safe-bottom')).toBe('0px');
    await openFull(h);
    expect(h.log.modes).toEqual(['fullscreen']);
    expect(h.root.querySelector('.app')!.closest('[hidden]')).toBeNull();
    await until(() => document.documentElement.style.getPropertyValue('--safe-bottom') === '120px');
  });

  it('uses the safe area a host reports, and no allowance outside Claude', async () => {
    const claude = await start({ ctx: { safeAreaInsets: { top: 0, right: 0, bottom: 200, left: 0 } } });
    await show(claude);
    await openFull(claude);
    await until(() => document.documentElement.style.getPropertyValue('--safe-bottom') === '200px');
    document.body.innerHTML = '';
    const other = await start({ ctx: { userAgent: 'Another host 1.0' } });
    await show(other);
    await openFull(other);
    await until(() => document.documentElement.style.getPropertyValue('--safe-bottom') === '0px');
  });

  it('sends every edit into Claude’s context on its own, with no send button', async () => {
    const h = await start();
    await show(h);
    await openFull(h);
    expect(h.log.context).toHaveLength(0); // the plan Claude sent is already known
    await act(() => saturday(h.root).click());
    await until(() => h.log.context.length === 1);
    const sent = h.log.context[0];
    expect(sent.content[0].text).toMatch(/^Current state of the whenship chart/);
    expect(sent.content[0].text).toContain('```json');
    expect(sent.structuredContent.plan.calendar.workdays).toContain('sat');
    expect(sent.structuredContent.lens).toBe('planned');
  });

  it('"Ask Claude for better options" syncs the chart first, then posts the request to the chat', async () => {
    const h = await start({ message: true });
    await show(h);
    await openFull(h);
    await act(() => saturday(h.root).click()); // an edit that hasn't been synced yet
    const ask = h.root.querySelector('.insight.ask')!;
    await act(() => (ask.querySelector('button') as HTMLButtonElement).click());
    await until(() => h.log.messages.length === 1);
    expect(h.log.events).toEqual(['context', 'message']);
    expect(h.log.context[0].structuredContent.plan.calendar.workdays).toContain('sat');
    expect(h.log.messages[0]).toMatchObject({ role: 'user' });
    expect(h.log.messages[0].content[0].text).toMatch(/moving work between people.*what_if/s);
    await until(() => h.root.querySelector('.toast')?.textContent?.includes('Asked Claude'));
  });

  it('offers "Ask Claude" only where the host accepts messages', async () => {
    const h = await start();
    await show(h);
    await openFull(h);
    expect(h.root.querySelector('.insight.ask')).toBeNull();
  });

  it('saves files through the host, or hands the plan to the website when the host cannot download', async () => {
    const h = await start();
    await show(h);
    await openFull(h);
    await act(() => button(h.root, 'Export')!.click());
    await act(() => button(document, 'Save plan')!.click());
    await until(() => h.log.downloads.length === 1);
    const file = h.log.downloads[0].contents[0].resource;
    expect(file.uri).toBe('file:///client-deliverables.whenship.json');
    expect(JSON.parse(file.text).items).toHaveLength(7);
    document.body.innerHTML = '';

    const plain = await start({ download: false });
    await show(plain);
    await openFull(plain);
    await act(() => button(plain.root, 'Export')!.click());
    await act(() => button(document, 'Excel')!.click());
    await until(() => plain.log.links.length === 1);
    expect(plain.log.links[0]).toMatch(/^https:\/\/whenship\.example\/#p=/);
    await until(() => plain.root.querySelector('.toast')?.textContent?.includes('Opened this plan in whenship'));
  });

  it('"Done" goes back to the card; reopening keeps the edits and the undo history', async () => {
    const h = await start();
    await show(h);
    await openFull(h);
    await act(() => saturday(h.root).click());
    await act(() => button(h.root, 'Done')!.click());
    await until(() => h.root.querySelector('.card'));
    expect(h.log.modes).toEqual(['fullscreen', 'inline']);
    // ⌘Z while only the card shows changes nothing behind it
    await act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true })));
    await openFull(h);
    const sat = saturday(h.root);
    expect(sat.getAttribute('aria-pressed')).toBe('true');
    await act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true })));
    expect(saturday(h.root).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the lens Claude asked for, reading old lens names too', async () => {
    const h = await start();
    await show(h, { lens: 'worst' });
    expect(h.root.querySelector('.card')!.textContent).toMatch(/Dates: Safe bet \(3\.1×\)/);
  });

  it('"Open in browser" opens the plan on the website, inside the link, with the zoom picked in the chart', async () => {
    const h = await start();
    await show(h);
    await act(() => button(h.root, 'Open in browser')!.click());
    await until(() => h.log.links.length === 1);
    expect(h.log.links[0]).toMatch(/^https:\/\/whenship\.example\/#p=[^&]+$/);
    await openFull(h);
    await act(() => button(h.root, 'Weeks')!.click());
    await act(() => button(h.root, 'Done')!.click());
    await until(() => h.root.querySelector('.card'));
    await act(() => button(h.root, 'Open in browser')!.click());
    await until(() => h.log.links.length === 2);
    expect(h.log.links[1]).toMatch(/&z=week$/);
  });

  it.runIf(typeof BroadcastChannel !== 'undefined')('a newer chart in the conversation collapses the older one, which stops syncing', async () => {
    const older = await start({ channel: true });
    await show(older, { createdAt: 1000, seq: 1 });
    const newer = await start({ channel: true });
    await show(newer, { createdAt: 2000, seq: 2 });
    await until(() => older.root.textContent?.includes('The live chart is further down'));
    expect(newer.root.querySelector('.card')).not.toBeNull();
    // the old chart no longer tells Claude about edits; the new one does
    await openFull(newer);
    await act(() => saturday(newer.root).click());
    await until(() => newer.log.context.length === 1);
    expect(older.log.context).toHaveLength(0);
  });
});
