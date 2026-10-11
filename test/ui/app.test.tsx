// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type Host } from '../../src/ui/App';
import { validatePlan } from '../../src/engine';
import { SAMPLES } from '../../src/io/samples';

const today = '2026-10-05';
const sample = () => validatePlan(SAMPLES[0]!.build(today), { today }).plan;

function mount(host: Partial<Host> = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const changes: unknown[] = [];
  const h: Host = {
    mode: 'web',
    save: vi.fn(async () => 'saved' as const),
    copy: vi.fn(async () => true),
    baseUrl: () => 'https://example.test/',
    onChange: (plan) => changes.push(plan),
    ...host,
  };
  act(() => render(<App host={h} initialPlan={sample()} today={today} />, root));
  return { root, host: h, changes };
}
const text = (root: Element, sel: string) => root.querySelector(sel)?.textContent ?? '';
const button = (root: Element, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label))!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('app (web and widget share it)', () => {
  it('renders the plan: headline, rows, bars and status pills', () => {
    const { root, changes } = mount();
    expect(text(root, '.headline')).toMatch(/1 of 6 deadlines late even as planned/);
    expect(root.querySelectorAll('.row:not(.draft)')).toHaveLength(7);
    expect(root.querySelectorAll('.bar').length).toBeGreaterThanOrEqual(7);
    expect(text(root, '.row:nth-child(4) .status')).toBe('late');
    expect(changes).toHaveLength(1); // the host hears about the initial plan (the widget syncs it)
  });

  it('switching the lens re-dates the plan but never changes the input', async () => {
    const { root, changes } = mount();
    await act(() => button(root, 'Likely').click());
    expect(text(root, '.headline')).toMatch(/Likely 1\.6×: /);
    expect(root.querySelectorAll('.plan-ghost').length).toBeGreaterThan(0);
    expect(JSON.stringify(changes.at(-1))).toBe(JSON.stringify(changes[0]));
  });

  it('applying a suggestion changes the plan, and undo restores it', async () => {
    const { root, changes } = mount();
    await act(() => new Promise((r) => setTimeout(r, 250))); // insights settle
    const first = root.querySelector('.insight b')!.textContent!;
    expect(first).toMatch(/Quick fix for Acme/);
    await act(() => (root.querySelector('.insight button') as HTMLButtonElement).click());
    expect(text(root, '.headline')).toMatch(/^2 deadlines late|^4 tight|^\d+ tight|^1 of 6/);
    expect(changes.length).toBe(2);
    await act(() => (root.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click());
    expect(JSON.stringify(changes.at(-1))).toBe(JSON.stringify(changes[0]));
  });

  it('exports through the host and copies a link with the plan inside', async () => {
    const { root, host } = mount();
    await act(() => button(root, 'Export').click());
    await act(() => button(document.body, 'Save plan').click());
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(host.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'client-deliverables.whenship.json', mime: 'application/json' }));
    await act(() => button(root, 'Copy link').click());
    expect(host.copy).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/example\.test\/#p=/));
  });

  it('turning a working day off moves dates', async () => {
    const { root } = mount();
    const before = text(root, '.headline');
    await act(() => (root.querySelector('[title^="Friday"]') as HTMLButtonElement).click());
    expect(text(root, '.headline')).not.toBe(before);
    expect(root.querySelector('[title^="Friday"]')!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('people, deleting and the details pane', () => {
  it('a new person gets a fresh name and colour, and their editor opens', async () => {
    const { root } = mount();
    const add = () => act(() => (root.querySelector('[aria-label="Add a person or team"]') as HTMLButtonElement).click());
    await add();
    await act(() => new Promise((r) => setTimeout(r, 0)));
    // the editor that opened belongs to the new person
    expect(document.querySelector('.popover')?.getAttribute('aria-label')).toBe('Edit Person 3');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await add();
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const chips = [...root.querySelectorAll('[data-lane]')];
    const names = chips.map((c) => c.textContent!.replace(/\d+%$/, '').trim());
    expect(new Set(names).size).toBe(names.length);
    const colors = chips.map((c) => (c.querySelector('.dot') as HTMLElement).style.background);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('per-person days off are switched off in the person editor', async () => {
    const { root } = mount();
    await act(() => (root.querySelector('[data-lane="sara"]') as HTMLButtonElement).click());
    expect(document.querySelector('.popover')!.textContent).not.toMatch(/Days off/);
  });

  it('deleting an item asks first; Cancel keeps it, Delete removes it', async () => {
    const { root } = mount();
    const firstDelete = () => root.querySelector('.row .row-del') as HTMLButtonElement;
    await act(() => firstDelete().click());
    expect(document.querySelector('.dialog.confirm h2')!.textContent).toBe('Delete "Quick fix for Acme"?');
    await act(() => button(document.body, 'Cancel').click());
    expect(document.querySelector('.dialog.confirm')).toBeNull();
    expect(root.querySelectorAll('.row:not(.draft)')).toHaveLength(7);
    await act(() => firstDelete().click());
    await act(() => (document.querySelector('.dialog.confirm .btn.danger') as HTMLButtonElement).click());
    expect(root.querySelectorAll('.row:not(.draft)')).toHaveLength(6);
    expect(text(root, '.row')).not.toMatch(/Quick fix for Acme/);
  });

  it('the details pane has no move or delete buttons', async () => {
    const { root } = mount();
    await act(() => (root.querySelector('.row .status') as HTMLElement).click());
    const details = root.querySelector('.details')!;
    expect(details.textContent).toMatch(/Why these dates/);
    expect(details.textContent).not.toMatch(/Move to top|Move to bottom|Delete item/);
  });

  it('the export menu saves JSON and offers no YAML', async () => {
    const { root } = mount();
    await act(() => button(root, 'Export').click());
    const items = [...document.querySelectorAll('.menu button')].map((b) => b.textContent);
    expect(items.join('|')).not.toMatch(/yaml/i);
    expect(items[0]).toMatch(/^Save plan\.json/);
  });
});

describe('the item list', () => {
  const realRows = (root: Element) => [...root.querySelectorAll('.row:not(.draft)')];
  const names = (root: Element) => realRows(root).map((r) => (r.querySelector('.cell-input') as HTMLInputElement).value);
  const type = async (el: HTMLInputElement, value: string) => {
    el.value = value;
    await act(() => void el.dispatchEvent(new Event('input', { bubbles: true })));
  };

  it('typing into the empty row creates an item, and a fresh empty row appears below', async () => {
    const { root } = mount();
    const draft = root.querySelector('.row.draft .cell-input') as HTMLInputElement;
    expect(draft.placeholder).toBe('Add an item…');
    await type(draft, 'S');
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(names(root)).toHaveLength(8);
    expect(names(root).at(-1)).toBe('S');
    // the new item's input has focus, so typing simply continues there
    const created = realRows(root).at(-1)!.querySelector('.cell-input') as HTMLInputElement;
    expect(document.activeElement).toBe(created);
    await type(created, 'Ship it');
    expect(names(root).at(-1)).toBe('Ship it');
    expect((root.querySelector('.row.draft .cell-input') as HTMLInputElement).value).toBe('');
    // a new item has no invented effort
    expect(realRows(root).at(-1)!.querySelector('.who-empty')!.textContent).toBe('+ who');
  });

  it('picking a deadline in the empty row creates an item with that date', async () => {
    const { root } = mount();
    const date = root.querySelector('.row.draft input[type="date"]') as HTMLInputElement;
    date.value = '2026-11-02';
    await act(() => void date.dispatchEvent(new Event('change', { bubbles: true })));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(names(root).at(-1)).toBe('New item');
    expect(realRows(root).at(-1)!.querySelector('.due-cell')!.textContent).toBe('2 Nov');
  });

  it('one "who" editor shows everyone on an item; nothing gets hidden when there are several people', async () => {
    const { root } = mount();
    // "Revise Lumen proposal": Omar 1d, then Sara 3d
    const cell = realRows(root)[3]!.querySelector('.who-cell') as HTMLButtonElement;
    expect(cell.querySelectorAll('.avatar')).toHaveLength(2);
    expect(cell.getAttribute('aria-label')).toMatch(/Omar 1d \+ Sara 3d after Omar/);
    await act(() => cell.click());
    const pop = document.querySelector('.who-pop')!;
    expect([...pop.querySelectorAll('.part-head b')].map((b) => b.textContent)).toEqual(['Omar', 'Sara']);
    expect(pop.querySelector('select.add-who')).toBeNull(); // everyone already has a part
  });

  it('adding someone from the empty row: creates the item and opens its who editor', async () => {
    const { root } = mount();
    await act(() => (root.querySelector('.row.draft .who-cell') as HTMLButtonElement).click());
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const pop = document.querySelector('.who-pop')!;
    expect(pop.getAttribute('aria-label')).toBe('Who works on New item');
    const add = pop.querySelector('select.add-who') as HTMLSelectElement;
    add.value = 'omar';
    await act(() => void add.dispatchEvent(new Event('change', { bubbles: true })));
    const row = realRows(root).at(-1)!;
    expect(row.querySelector('.who-cell')!.textContent).toMatch(/Omar\s*1d/);
  });

  it('status pills follow the forecast lens', async () => {
    const { root } = mount();
    const pills = () => realRows(root).map((r) => r.querySelector('.status')!.textContent);
    const asPlanned = pills();
    await act(() => button(root, 'Worst case').click());
    const worst = pills();
    expect(worst.filter((t) => t === 'late').length).toBeGreaterThan(asPlanned.filter((t) => t === 'late').length);
    // the counts next to the headline agree with the pills
    expect(text(root, '.counts')).toMatch(new RegExp(`${worst.filter((t) => t === 'late').length} late`));
    await act(() => button(root, 'As planned').click());
    expect(pills()).toEqual(asPlanned);
  });

  it('values are gone from the details pane, and the toolbox holds the top bar and the setup row', async () => {
    const { root } = mount();
    await act(() => (root.querySelector('.row .status') as HTMLElement).click());
    expect(root.querySelector('.details')!.textContent).not.toMatch(/Value/);
    expect(root.querySelector('.toolbar > .topbar')).not.toBeNull();
    expect(root.querySelector('.toolbar > .setup')).not.toBeNull();
  });
});
