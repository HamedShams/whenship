// @vitest-environment happy-dom
// The website shell: the home page, what it remembers, shared links, opening plans and downloads.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayLocal, validatePlan } from '../../src/engine';
import { shareUrl } from '../../src/io/format';
import { SAMPLES } from '../../src/io/samples';
import { VERSION } from '../../src/ui/config';
import { bootWeb } from '../../src/ui/web';

const PLAN_KEY = 'whenship:plan:v1';
const LENS_KEY = 'whenship:lens:v1';
const ZOOM_KEY = 'whenship:zoom:v1';
const today = todayLocal();

let root: HTMLElement;
const boot = () => {
  root = document.createElement('div');
  document.body.appendChild(root);
  act(() => bootWeb(root));
};
const unmount = () => act(() => render(null, root));
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const button = (label: string, within: ParentNode = document) => [...within.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label))!;
const lensOn = () => root.querySelector('.seg [aria-pressed="true"]')?.textContent;
const zoomOn = () => (root.querySelector('select.zoom-select') as HTMLSelectElement | null)?.value;
const INTRO_KEY = 'whenship:intro:v1';
/** A first visit: the home page, then the first example, opened as the visitor's own plan with the note that it is one. */
const bootExample = async (n = 0) => {
  boot();
  await act(() => (root.querySelectorAll('.lp-example')[n] as HTMLButtonElement).click());
  expect(root.querySelector('.intro:not(.leaving)')).not.toBeNull();
};
/** The intro strip folds away over a quarter second rather than vanishing with a jump. */
const folded = () => act(() => new Promise((r) => setTimeout(r, 450)));
const type = (el: HTMLTextAreaElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => {
  unmount();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('website', () => {
  it('a browser with no plan opens on the home page: what it is, a small real plan as the picture, and the ways in', async () => {
    boot();
    const page = root.querySelector('.landing')!;
    expect(root.querySelector('.board-wrap, .toolbar')).toBeNull(); // not the app yet
    expect(page.querySelector('h1')!.textContent).toBe('When will it ship, honestly?');
    expect(page.querySelector('.lp-lede')!.textContent).toMatch(/what-if Gantt for small teams/);
    // the picture is a plan the engine has worked out: a few rows, more than one person, one promise late, and the fix
    const sketch = page.querySelector('.lp-picture .sketch')!;
    expect(sketch.querySelectorAll('.sk-row')).toHaveLength(5);
    expect(new Set([...sketch.querySelectorAll<HTMLElement>('.sk-bar')].map((b) => b.style.background)).size).toBe(3);
    expect(sketch.querySelectorAll('.sk-date.late')).toHaveLength(1);
    expect(sketch.querySelectorAll('.sk-late')).toHaveLength(1);
    expect(sketch.querySelectorAll('.sk-due')).toHaveLength(5);
    expect(page.querySelector('.lp-option b')!.textContent).toBe('Move "Checkout" to the top');
    expect(page.querySelector('.lp-option')!.textContent).toMatch(/1 more deadline met/);
    // three examples, each with its own small picture; your own list or file; an empty plan
    expect([...page.querySelectorAll('.lp-example b')].map((b) => b.textContent)).toEqual(SAMPLES.map((x) => x.label));
    expect(page.querySelectorAll('.lp-example .sketch.compact')).toHaveLength(3);
    expect([...page.querySelectorAll('.lp-own .btn')].map((b) => b.textContent!.trim())).toEqual(['Paste a list', 'Open a file', 'Start from scratch']);
    expect([...page.querySelectorAll('.lp-cta .btn')].map((b) => b.textContent!.trim())).toEqual(['Try it with an example →', 'Paste your list']);
    // Claude, GitHub, and who made it
    const links = [...page.querySelectorAll<HTMLAnchorElement>('a')].map((x) => [x.textContent!.trim(), x.href]);
    expect(links).toContainEqual(['Add it to Claude', 'http://localhost:3000/mcp']);
    expect(links).toContainEqual(['Open GitHub', 'https://github.com/HamedShams/whenship']);
    expect(links).toContainEqual(['Privacy', 'http://localhost:3000/privacy']);
    expect(links).toContainEqual(['Hamed Shams', 'https://hamedshams.com/']);
    expect(page.querySelector('.lp-foot')!.textContent).toContain(`whenship ${VERSION}`);
    expect(localStorage.getItem(PLAN_KEY)).toBeNull(); // looking at the home page stores nothing
    await act(() => button('Try it with an example').click());
    expect((root.querySelector('.title-input') as HTMLInputElement).value).toBe('Client deliverables');
    expect(root.querySelector('.landing')).toBeNull();
  });

  it('an example opens as your own plan with a note that it is one; the note goes with the first change, for good', async () => {
    await bootExample(1);
    expect((root.querySelector('.title-input') as HTMLInputElement).value).toBe('Q4 roadmap');
    expect(root.querySelector('.footer')!.textContent).toMatch(/stored only in this browser/);
    expect(root.querySelector('.footer')!.textContent).toContain(`whenship ${VERSION}`);
    expect(root.querySelector<HTMLAnchorElement>('.footer .credit a')!.href).toBe('https://hamedshams.com/');
    // "More examples" opens the examples tab of the open dialog
    await act(() => button('More examples').click());
    expect(document.querySelectorAll('.dialog .sample')).toHaveLength(SAMPLES.length);
    await act(() => (document.querySelectorAll('.dialog .sample')[0] as HTMLButtonElement).click());
    expect((root.querySelector('.title-input') as HTMLInputElement).value).toBe('Client deliverables');
    expect(root.querySelectorAll('.list .row:not(.draft)')).toHaveLength(7);
    // loading a plan counts as an edit: the note is over, now and on later visits (the strip folds away first)
    expect(root.querySelector('.intro.leaving')).not.toBeNull();
    expect(localStorage.getItem(INTRO_KEY)).toBe('1');
    await folded();
    expect(root.querySelector('.intro')).toBeNull();
    await wait(300);
    unmount();
    boot(); // a later visit: straight into the plan kept in this browser
    expect(root.querySelector('.landing')).toBeNull();
    expect((root.querySelector('.title-input') as HTMLInputElement).value).toBe('Client deliverables');
    expect(root.querySelector('.intro')).toBeNull();
  });

  it('dismissing the note keeps the example and never shows the note again; with no plan left, a visit is the home page', async () => {
    await bootExample();
    await act(() => (root.querySelector('.intro-close') as HTMLButtonElement).click());
    expect(root.querySelector('.intro.leaving')).not.toBeNull();
    await folded();
    expect(root.querySelector('.intro')).toBeNull();
    expect(root.querySelectorAll('.list .row:not(.draft)')).toHaveLength(7);
    expect(localStorage.getItem(INTRO_KEY)).toBe('1');
    unmount();
    localStorage.removeItem(PLAN_KEY);
    boot();
    expect(root.querySelector('.landing')).not.toBeNull();
    await act(() => (root.querySelector('.lp-example') as HTMLButtonElement).click());
    expect(root.querySelectorAll('.list .row:not(.draft)')).toHaveLength(7);
    expect(root.querySelector('.intro')).toBeNull();
  });

  it('the logo goes home, where the plan in this browser is offered first; nothing is lost on the way', async () => {
    await bootExample();
    const name = root.querySelector('.list .row .cell-input') as HTMLInputElement;
    name.value = 'Quick fix for Acme and Co';
    await act(() => void name.dispatchEvent(new Event('input', { bubbles: true })));
    const logo = root.querySelector('button.brand') as HTMLButtonElement;
    expect(logo.getAttribute('aria-label')).toMatch(/home/);
    await act(() => logo.click());
    expect(root.querySelector('.landing')).not.toBeNull();
    const back = root.querySelector('.lp-cta .btn.primary') as HTMLButtonElement;
    expect(back.textContent).toMatch(/^Continue with "Client deliverables"/);
    await act(() => back.click());
    expect(root.querySelector('.landing')).toBeNull();
    expect((root.querySelector('.list .row .cell-input') as HTMLInputElement).value).toBe('Quick fix for Acme and Co');
    expect(root.querySelector('.intro')).toBeNull(); // it's the visitor's plan now, not an example
  });

  it('remembers the plan and the chosen lens, so a refresh looks the same', async () => {
    await bootExample();
    await act(() => button('Likely').click());
    await wait(300);
    expect(JSON.parse(localStorage.getItem(PLAN_KEY)!).title).toBe('Client deliverables');
    expect(localStorage.getItem(LENS_KEY)).toBe('likely');
    unmount();
    boot();
    expect((root.querySelector('.title-input') as HTMLInputElement).value).toBe('Client deliverables');
    expect(lensOn()).toBe('Likely1.6×');
    expect(text('.legend .k-lens')).toMatch(/bars show Likely/);
  });

  it('remembers the timeline zoom too, and a shared link opens with its own view', async () => {
    await bootExample();
    expect(zoomOn()).toBe('fit'); // the whole plan in the width at hand
    await act(() => {
      const sel = root.querySelector('select.zoom-select') as HTMLSelectElement;
      sel.value = 'week';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(300);
    expect(localStorage.getItem(ZOOM_KEY)).toBe('week');
    unmount();
    boot();
    expect(zoomOn()).toBe('week');
    unmount();
    const plan = validatePlan(SAMPLES[0]!.build(today), { today }).plan;
    const link = new URL(shareUrl('http://localhost:3000/', plan, 'likely', 'month'));
    history.replaceState(null, '', link.pathname + link.hash);
    boot();
    expect(zoomOn()).toBe('month');
    expect(lensOn()).toBe('Likely1.6×');
  });

  it('ignores a saved lens it does not know, and a saved plan it cannot read', () => {
    localStorage.setItem(PLAN_KEY, '{not json');
    localStorage.setItem(LENS_KEY, 'optimistic');
    boot();
    expect(root.querySelector('.landing')).not.toBeNull(); // the unreadable plan is ignored: a first visit
    localStorage.setItem(PLAN_KEY, JSON.stringify(SAMPLES[0]!.build(today)));
    unmount();
    boot();
    expect(root.querySelector('.landing')).toBeNull();
    expect(lensOn()).toBe('As planned1×');
  });

  it('opens a shared link with its plan and lens, then takes the link out of the address bar', () => {
    const plan = validatePlan(SAMPLES[1]!.build(today), { today }).plan;
    localStorage.setItem(LENS_KEY, 'likely'); // a link's own lens wins over the remembered one
    history.replaceState(null, '', new URL(shareUrl('http://localhost:3000/', plan, 'safe')).pathname + new URL(shareUrl('http://localhost:3000/', plan, 'safe')).hash);
    boot();
    expect(root.querySelector('.landing')).toBeNull(); // a link goes straight to its plan
    expect((root.querySelector('.title-input') as HTMLInputElement).value).toBe(plan.title);
    expect(lensOn()).toBe('Safe bet3.1×');
    expect(location.hash).toBe('');
    expect(text('.toast')).toMatch(/Opened from a shared link/);
  });

  it('pasting a list on the home page plans it; text without items says what to try', async () => {
    boot();
    await act(() => button('Paste a list').click());
    const dialog = document.querySelector('.dialog[aria-label="Open a plan"]')!;
    expect([...dialog.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Paste', 'Open a file']); // the examples are on the page itself
    const box = dialog.querySelector('textarea') as HTMLTextAreaElement;
    await act(() => type(box, 'Item,Days')); // a header row and nothing under it
    await act(() => button('Plan it', dialog).click());
    expect(text('.dialog .sub.err')).toMatch(/No items found/);
    expect(root.querySelector('.landing')).not.toBeNull();
    await act(() => type(box, 'Grant draft for Acme, 5d, due 7 Oct\nResearch for Brightside, 6d'));
    await act(() => button('Plan it', dialog).click());
    expect(document.querySelector('.dialog')).toBeNull();
    expect(root.querySelector('.landing')).toBeNull();
    expect(root.querySelector('.intro')).toBeNull(); // their own plan: no "this is an example" note
    expect([...root.querySelectorAll('.list .row:not(.draft) .cell-input')].map((i) => (i as HTMLInputElement).value)).toEqual(['Grant draft for Acme', 'Research for Brightside']);
  });

  it('"Start from scratch" gives one person and a first item, ready to rename; so does "Start empty" from an example', async () => {
    boot();
    await act(() => button('Start from scratch').click());
    await wait(0);
    const first = () => root.querySelector('.list .row:not(.draft) .cell-input') as HTMLInputElement;
    expect(first().value).toBe('First item');
    expect(document.activeElement).toBe(first());
    expect(root.querySelector('[data-lane="me"]')!.textContent).toMatch(/Me/);
    expect(root.querySelector('.intro')).toBeNull();
    unmount();
    localStorage.clear();
    await bootExample();
    await act(() => button('Start empty').click());
    await wait(0);
    expect(first().value).toBe('First item');
    expect(document.activeElement).toBe(first());
    expect(root.querySelector('[data-lane="me"]')!.textContent).toMatch(/Me/);
  });

  it('"Open" replaces the plan with pasted text (undoable), and Cancel leaves it alone', async () => {
    await bootExample();
    await act(() => button('Open').click());
    const dialog = document.querySelector('.dialog[aria-label="Open a plan"]')!;
    expect(dialog.querySelectorAll('[role="tab"]')).toHaveLength(3);
    await act(() => type(dialog.querySelector('textarea')!, '{"items": []}'));
    await act(() => button('Plan it', dialog).click());
    expect(dialog.querySelector('.sub.err')!.textContent).toMatch(/No items found/);
    await act(() => type(dialog.querySelector('textarea')!, 'Launch page, 3d'));
    await act(() => button('Plan it', dialog).click());
    expect(document.querySelector('.dialog')).toBeNull();
    expect(root.querySelectorAll('.list .row:not(.draft)')).toHaveLength(1);
    await act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true })));
    expect(root.querySelectorAll('.list .row:not(.draft)')).toHaveLength(7);
    await act(() => button('Open').click());
    await act(() => button('Cancel', document.querySelector('.dialog')!).click());
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('downloads exports as files and copies share links to this address', async () => {
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await bootExample();
    await act(() => button('Export').click());
    await act(() => button('CSV').click());
    await wait(0);
    expect(clicks).toEqual(['client-deliverables.csv']);
    expect(text('.toast')).toBe('Saved client-deliverables.csv');
    await act(() => button('Export').click());
    await act(() => (document.querySelector('.menu-link') as HTMLButtonElement).click());
    await wait(0);
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^http:\/\/localhost:3000\/#p=/));
  });

  it('shows the link to copy by hand when the clipboard is blocked', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('blocked')) }, configurable: true });
    await bootExample();
    await act(() => button('Export').click());
    await act(() => (document.querySelector('.menu-link') as HTMLButtonElement).click());
    await wait(0);
    const dialog = document.querySelector('.dialog[aria-label="Share link"]')!;
    expect((dialog.querySelector('textarea') as HTMLTextAreaElement).value).toMatch(/#p=/);
    await act(() => button('Done', dialog).click());
    expect(document.querySelector('.dialog')).toBeNull();
  });

  it('a tab left open across a release says so, with a way to reload; the same version says nothing', async () => {
    const served = { version: VERSION };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => served }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    await bootExample();
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await wait(0);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/healthz', { cache: 'no-store' });
    expect(document.querySelector('.update-note')).toBeNull();
    unmount();
    served.version = '99.0.0'; // the server has moved on
    boot();
    await act(async () => void window.dispatchEvent(new Event('focus')));
    await wait(0);
    expect(document.querySelector('.update-note')!.textContent).toMatch(/has been updated since this tab was opened/);
    expect(button('Reload', document.querySelector('.update-note')!)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

function text(sel: string) {
  return document.querySelector(sel)?.textContent ?? '';
}
