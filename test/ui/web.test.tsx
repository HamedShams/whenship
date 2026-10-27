// @vitest-environment happy-dom
// The website shell: what it remembers, shared links, the welcome screen, opening plans and downloads.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayLocal, validatePlan } from '../../src/engine';
import { shareUrl } from '../../src/io/format';
import { SAMPLES } from '../../src/io/samples';
import { bootWeb } from '../../src/ui/web';

const PLAN_KEY = 'whenship:plan:v1';
const LENS_KEY = 'whenship:lens:v1';
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
  it('starts on the welcome screen, with samples and a paste box', () => {
    boot();
    expect(root.querySelector('.welcome')).not.toBeNull();
    expect(root.querySelectorAll('.sample')).toHaveLength(SAMPLES.length);
    expect(root.querySelector('.footer')!.textContent).toMatch(/stored only in this browser/);
  });

  it('remembers the plan and the chosen lens, so a refresh looks the same', async () => {
    boot();
    await act(() => (root.querySelector('.sample') as HTMLButtonElement).click());
    await act(() => button('Likely').click());
    await wait(300);
    expect(JSON.parse(localStorage.getItem(PLAN_KEY)!).title).toBe('Client deliverables');
    expect(localStorage.getItem(LENS_KEY)).toBe('likely');
    unmount();
    boot();
    expect((root.querySelector('.title-input') as HTMLInputElement).value).toBe('Client deliverables');
    expect(lensOn()).toBe('Likely1.6×');
    expect(text('.chart-key .k-lens')).toMatch(/bars show Likely/);
  });

  it('ignores a saved lens it does not know, and a saved plan it cannot read', () => {
    localStorage.setItem(PLAN_KEY, '{not json');
    localStorage.setItem(LENS_KEY, 'optimistic');
    boot();
    expect(root.querySelector('.welcome')).not.toBeNull();
    localStorage.setItem(PLAN_KEY, JSON.stringify(SAMPLES[0]!.build(today)));
    unmount();
    boot();
    expect(lensOn()).toBe('As planned1×');
  });

  it('opens a shared link with its plan and lens, then takes the link out of the address bar', () => {
    const plan = validatePlan(SAMPLES[1]!.build(today), { today }).plan;
    localStorage.setItem(LENS_KEY, 'likely'); // a link's own lens wins over the remembered one
    history.replaceState(null, '', new URL(shareUrl('http://localhost:3000/', plan, 'safe')).pathname + new URL(shareUrl('http://localhost:3000/', plan, 'safe')).hash);
    boot();
    expect((root.querySelector('.title-input') as HTMLInputElement).value).toBe(plan.title);
    expect(lensOn()).toBe('Safe bet3.1×');
    expect(location.hash).toBe('');
    expect(text('.toast')).toMatch(/Opened from a shared link/);
  });

  it('pasting a list plans it; text without items says what to try', async () => {
    boot();
    const box = root.querySelector('#paste') as HTMLTextAreaElement;
    await act(() => type(box, 'Item,Days')); // a header row and nothing under it
    await act(() => button('Plan it').click());
    expect(text('.welcome .sub')).toMatch(/Could not find any items/);
    await act(() => type(box, 'Grant draft for Acme, 5d, due 7 Oct\nResearch for Brightside, 6d'));
    await act(() => button('Plan it').click());
    expect([...root.querySelectorAll('.list .row:not(.draft) .cell-input')].map((i) => (i as HTMLInputElement).value)).toEqual(['Grant draft for Acme', 'Research for Brightside']);
  });

  it('"Start empty" gives one person and a first item, ready to rename', async () => {
    boot();
    await act(() => button('Start empty').click());
    await wait(0);
    const first = root.querySelector('.list .row:not(.draft) .cell-input') as HTMLInputElement;
    expect(first.value).toBe('First item');
    expect(document.activeElement).toBe(first);
    expect(root.querySelector('[data-lane="me"]')!.textContent).toMatch(/Me/);
  });

  it('"Open" replaces the plan with pasted text (undoable), and Cancel leaves it alone', async () => {
    boot();
    await act(() => (root.querySelector('.sample') as HTMLButtonElement).click());
    await act(() => button('Open').click());
    const dialog = document.querySelector('.dialog[aria-label="Open a plan"]')!;
    await act(() => type(dialog.querySelector('textarea')!, '{"items": []}'));
    await act(() => button('Open', dialog).click());
    expect(dialog.querySelector('.sub')!.textContent).toMatch(/No items found/);
    await act(() => type(dialog.querySelector('textarea')!, 'Launch page, 3d'));
    await act(() => button('Open', dialog).click());
    expect(document.querySelector('.dialog')).toBeNull();
    expect(root.querySelectorAll('.list .row:not(.draft)')).toHaveLength(1);
    await act(() => (root.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click());
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
    boot();
    await act(() => (root.querySelector('.sample') as HTMLButtonElement).click());
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
    boot();
    await act(() => (root.querySelector('.sample') as HTMLButtonElement).click());
    await act(() => button('Export').click());
    await act(() => (document.querySelector('.menu-link') as HTMLButtonElement).click());
    await wait(0);
    const dialog = document.querySelector('.dialog[aria-label="Share link"]')!;
    expect((dialog.querySelector('textarea') as HTMLTextAreaElement).value).toMatch(/#p=/);
    await act(() => button('Done', dialog).click());
    expect(document.querySelector('.dialog')).toBeNull();
  });
});

function text(sel: string) {
  return document.querySelector(sel)?.textContent ?? '';
}
