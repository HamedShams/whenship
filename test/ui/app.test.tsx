// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type Host } from '../../src/ui/App';
import { autoZoom } from '../../src/ui/Board';
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
  it('renders the plan: headline, rows, bars and delivery dates coloured by status', () => {
    const { root, changes } = mount();
    expect(text(root, '.headline')).toMatch(/1 of 6 deadlines late even as planned/);
    expect(root.querySelectorAll('.row:not(.draft)')).toHaveLength(7);
    expect(root.querySelectorAll('.bar').length).toBeGreaterThanOrEqual(7);
    // "Revise Lumen proposal" is late: its delivery date shows in a red pill
    const late = root.querySelector('.row:nth-child(4) .status .pill.delivery')!;
    expect(late.classList.contains('late')).toBe(true);
    expect(late.textContent).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
    // an item without a deadline shows its plain delivery date
    expect(root.querySelector('.row:nth-child(1) .status .pill')).toBeNull();
    expect(text(root, '.row:nth-child(1) .status')).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
    expect([...root.querySelectorAll('.list-head span')].map((x) => x.textContent)).toEqual(['#', 'Item', 'Who', 'Deadline', 'Expected delivery', '']);
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
    await act(() => button(root, 'Export').click());
    await act(() => (document.querySelector('.menu .menu-link') as HTMLButtonElement).click());
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
    expect([...pop.querySelectorAll('.who-person')].map((b) => b.textContent)).toEqual(['OMOmar', 'SASara']);
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
    const pills = () => realRows(root).map((r) => [...(r.querySelector('.status .pill')?.classList ?? [])].find((c) => ['safe', 'likely', 'tight', 'late'].includes(c)) ?? '');
    const asPlanned = pills();
    await act(() => button(root, 'Safe bet').click());
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

describe('timeline details', () => {
  it("marks today in the header without borrowing the today line's style", () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const today = '2026-10-12';
    const p = validatePlan(SAMPLES[0]!.build(today), { today }).plan; // the sample starts today (a Monday)
    const host: Host = { mode: 'web', save: async () => 'saved', copy: async () => true, baseUrl: () => null };
    act(() => render(<App host={host} initialPlan={p} today={today} />, root));
    expect(root.querySelector('.day.is-today .dnum')!.textContent).toBe('12');
    expect(root.querySelector('.day.today')).toBeNull();
    expect(root.querySelectorAll('.today')).toHaveLength(1); // just the vertical line
  });

  it('keeps the finish-date label clear of a deadline right after the bar', async () => {
    const { root } = mount();
    // "Quick fix for Acme" finishes on the plan's first day; a deadline the next day puts the diamond right there
    const row = root.querySelector('.row:not(.draft) input[type="date"]') as HTMLInputElement;
    row.value = '2026-10-06';
    await act(() => void row.dispatchEvent(new Event('change', { bubbles: true })));
    const bars = root.querySelector('.bars')!;
    const diamond = parseFloat((bars.querySelector('.deadline') as HTMLElement).style.left);
    const label = parseFloat((bars.querySelector('.end-label') as HTMLElement).style.left);
    expect(label).toBeGreaterThan(diamond + 6);
  });

  it('the who editor lists everyone on one line each, with a column only where it applies', async () => {
    const { root } = mount();
    const cell = [...root.querySelectorAll('.row:not(.draft) .who-cell')][0] as HTMLButtonElement;
    await act(() => cell.click());
    const pop = document.querySelector('.who-pop')!;
    expect([...pop.querySelectorAll('.col-h')].map((h) => h.textContent)).toEqual(['Days']); // one person: no "Starts", no team column
    const add = pop.querySelector('select.add-who') as HTMLSelectElement;
    add.value = 'omar';
    await act(() => void add.dispatchEvent(new Event('change', { bubbles: true })));
    expect([...document.querySelectorAll('.who-pop .col-h')].map((h) => h.textContent)).toEqual(['Days', 'Starts']);
    expect(document.querySelectorAll('.who-pop .who-person')).toHaveLength(2);
  });

  it("the can't-start-before date can be cleared, and shows nothing when empty", async () => {
    const { root } = mount();
    const last = [...root.querySelectorAll('.row:not(.draft)')].at(-1)!; // "Research for Helix" waits for the client
    await act(() => (last.querySelector('.status') as HTMLElement).click());
    const field = () => root.querySelector('.details .date-field')!;
    expect(field().textContent).toMatch(/\w{3} \d+ \w{3}/);
    await act(() => (field().querySelector('[aria-label^="Clear"]') as HTMLButtonElement).click());
    expect(field().textContent).toBe('any time');
  });
});

describe('the item inspector and day chips', () => {
  it('shows the facts, why, and compact settings; dependencies are chips you can add and remove', async () => {
    const { root } = mount();
    const rows = [...root.querySelectorAll('.row:not(.draft)')];
    await act(() => (rows[2]!.querySelector('.status') as HTMLElement).click()); // Research for Brightside
    const insp = () => root.querySelector('.details')!;
    expect(insp().querySelector('h3')!.textContent).toBe('Research for Brightside');
    expect([...insp().querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Expected delivery', 'Deadline', 'Who', 'Dates']);
    expect(insp().querySelector('select[multiple]')).toBeNull();
    const add = insp().querySelector('select.add-dep') as HTMLSelectElement;
    add.value = 'quick-fix-for-acme';
    await act(() => void add.dispatchEvent(new Event('change', { bubbles: true })));
    expect(insp().querySelector('.dep-chip')!.textContent).toMatch(/Quick fix for Acme/);
    await act(() => (insp().querySelector('.dep-chip button') as HTMLButtonElement).click());
    expect(insp().querySelector('.dep-chip')).toBeNull();
    await act(() => (insp().querySelector('[aria-label="Close details"]') as HTMLButtonElement).click());
    expect(root.querySelector('.details')).toBeNull();
  });

  it('working-day chips show two letters', () => {
    const { root } = mount();
    expect([...root.querySelectorAll('.daychip')].map((b) => b.textContent)).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
  });

  it('who editor: one bordered row per person under a header row', async () => {
    const { root } = mount();
    await act(() => ([...root.querySelectorAll('.row:not(.draft) .who-cell')][3] as HTMLButtonElement).click());
    expect(document.querySelectorAll('.who-pop .who-row:not(.who-head)')).toHaveLength(2);
    expect(document.querySelectorAll('.who-pop .who-head')).toHaveLength(1);
  });
});

describe('dates in another year, and the plan name', () => {
  it('shows another year as a small raised "’27" on the same line, in both date columns', async () => {
    const { root } = mount();
    const row = root.querySelectorAll('.row:not(.draft)')[1]!; // Appeal for Northwind
    const date = row.querySelector('input[type="date"]') as HTMLInputElement;
    date.value = '2027-01-14';
    await act(() => void date.dispatchEvent(new Event('change', { bubbles: true })));
    const due = row.querySelector('.due-cell .date-y')!;
    expect(due.textContent).toBe('14 Jan’27');
    expect(due.querySelector('.yr')!.textContent).toBe('’27');
    expect(due.getAttribute('title')).toBe('14 Jan 2027');
    expect(row.querySelector('.due-cell small')).toBeNull(); // no second line
  });

  it('the plan name reads as an editable document title, apart from the app name', async () => {
    const { root } = mount();
    const input = root.querySelector('.doc-title input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Plan name');
    expect(root.querySelector('.brand')!.textContent).toBe(''); // just the logo: no app name next to the plan name
    expect(text(root, '.doc-caption')).toBe('Plan · saved in this browser');
    input.value = 'Q4 client work';
    await act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
    expect((root.querySelector('.doc-title input') as HTMLInputElement).value).toBe('Q4 client work');
  });
});

describe('timeline zoom and header scale', () => {
  it('picks the zoom from the plan length', () => {
    expect(autoZoom(40)).toBe('day');
    expect(autoZoom(120)).toBe('week');
    expect(autoZoom(400)).toBe('month');
  });

  it('always shows a scale: days when zoomed in, week starts when zoomed out', async () => {
    const { root } = mount();
    const seg = (label: string) => [...root.querySelectorAll('.seg.small button')].find((b) => b.textContent === label) as HTMLButtonElement;
    // the sample plan is a few weeks long: days
    expect(seg('Days').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.ticks .day .dow').length).toBeGreaterThan(20);
    for (const label of ['Weeks', 'Months']) {
      await act(() => seg(label).click());
      const weeks = [...root.querySelectorAll('.ticks .wk')];
      expect(weeks.length, label).toBeGreaterThan(3);
      expect(weeks.every((w) => /^\d{1,2}$/.test(w.textContent!)), label).toBe(true);
      expect(root.querySelectorAll('.months .month').length, label).toBeGreaterThan(0);
    }
    await act(() => seg('Days').click());
    expect(root.querySelectorAll('.ticks .wk')).toHaveLength(0);
  });

  it('a long plan zooms out on its own and still labels the weeks', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const today = '2026-10-05';
    const p = validatePlan({ start: today, lanes: [{ name: 'Sara' }], items: [{ name: 'Big', who: 'Sara', days: 200 }] }, { today }).plan;
    const host: Host = { mode: 'web', save: async () => 'saved', copy: async () => true, baseUrl: () => null };
    act(() => render(<App host={host} initialPlan={p} today={today} />, root));
    expect(root.querySelector('.seg.small [aria-pressed="true"]')!.textContent).toBe('Months');
    expect(root.querySelectorAll('.ticks .wk').length).toBeGreaterThan(20);
    expect(root.querySelector('.tick-today')!.textContent).toBe('5');
  });
});

describe('v1.3: selection, dragging bars, lenses, colours and title', () => {
  const ptr = (type: string, el: Element, y: number, x = 10) =>
    act(() => void el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 })));

  it('selecting an item highlights only that item; the chain shows only on request', async () => {
    const { root } = mount();
    const bars = () => [...root.querySelectorAll('.bars')];
    await ptr('pointerdown', bars()[4]!, 100);
    await ptr('pointerup', bars()[4]!, 100);
    expect(root.querySelectorAll('.bars.sel')).toHaveLength(1);
    expect(root.querySelectorAll('.bar.chain')).toHaveLength(0);
    expect(root.querySelectorAll('.bars.dim')).toHaveLength(0);
    // pick another one: the first is no longer selected
    await ptr('pointerdown', bars()[1]!, 100);
    await ptr('pointerup', bars()[1]!, 100);
    expect(root.querySelectorAll('.bars.sel')).toHaveLength(1);
    expect(bars()[1]!.classList.contains('sel')).toBe(true);
    // "What sets the end date?" shows the chain of the selected item
    await act(() => button(root, 'What sets the end date?').click());
    expect(root.querySelectorAll('.bar.chain').length).toBeGreaterThan(0);
  });

  it('dragging a bar up or down reprioritises it, like the handle', async () => {
    const { root } = mount();
    const names = () => [...root.querySelectorAll('.row:not(.draft) .cell-input')].map((i) => (i as HTMLInputElement).value);
    const first = names()[0];
    const bar = root.querySelectorAll('.bars')[0]!;
    await ptr('pointerdown', bar, 100);
    await ptr('pointermove', bar, 100 + 44 * 2 + 3);
    await ptr('pointerup', bar, 100 + 44 * 2 + 3);
    expect(names()[2]).toBe(first);
    expect(root.querySelectorAll('.bars.sel')).toHaveLength(0); // a drag isn't a click
  });

  it('three lenses with their multipliers, and a compact guide', async () => {
    const { root } = mount();
    expect([...root.querySelectorAll('.seg:not(.small) button')].map((b) => b.textContent)).toEqual(['As planned1×', 'Likely1.6×', 'Safe bet3.1×']);
    await act(() => (root.querySelector('[aria-label="How the forecast lenses work"]') as HTMLButtonElement).click());
    const pop = document.querySelector('.lens-pop')!;
    expect(pop.querySelectorAll('.lens-row')).toHaveLength(3);
    expect(pop.querySelectorAll('.badge-key .pill')).toHaveLength(4);
    expect(pop.textContent).not.toMatch(/2\.7|3\.9|Worst/);
  });

  it('eight lane colours, without grey and the blue close to the app colour', async () => {
    const { root } = mount();
    await act(() => (root.querySelector('[data-lane="sara"]') as HTMLButtonElement).click());
    const swatches = [...document.querySelectorAll('.popover [aria-label^="Colour #"]')].map((b) => b.getAttribute('aria-label')!.slice(7));
    expect(swatches).toHaveLength(8);
    expect(swatches).not.toContain('#868e96');
    expect(swatches).not.toContain('#4c6ef5');
  });

  it('a nameless plan is "Untitled WhenShip"', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const host: Host = { mode: 'web', save: async () => 'saved', copy: async () => true, baseUrl: () => null };
    const p = validatePlan({ lanes: [{ name: 'Me' }], items: [{ name: 'A', who: 'Me', days: 1 }] }, { today: '2026-10-05' }).plan;
    act(() => render(<App host={host} initialPlan={p} today="2026-10-05" />, root));
    const input = root.querySelector('.doc-title input') as HTMLInputElement;
    expect(input.value).toBe('Untitled WhenShip');
    input.value = '';
    await act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
    expect((root.querySelector('.doc-title input') as HTMLInputElement).value).toBe(''); // you can clear it while typing…
    await act(() => void root.querySelector('.doc-title input')!.dispatchEvent(new FocusEvent('blur')));
    expect((root.querySelector('.doc-title input') as HTMLInputElement).value).toBe('Untitled WhenShip'); // …and it comes back if left empty
  });

  it('the app version matches package.json', async () => {
    const { VERSION } = await import('../../src/ui/config');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
    expect(pkg.version).toBe('1.3.1');
  });
});

describe('v1.3.1: dragging cleanly, sticky headers, chart key, copy link and asking Claude', () => {
  const ptr = (type: string, el: Element, y: number, x = 10) => {
    const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
    act(() => void el.dispatchEvent(e));
    return e;
  };

  it('pressing a bar never starts a text selection, and a drag leaves no hover handles or focus behind', () => {
    const { root } = mount();
    const name = root.querySelectorAll('.row:not(.draft) .cell-input')[1] as HTMLInputElement;
    name.focus();
    window.getSelection()?.selectAllChildren(root);
    const bar = root.querySelectorAll('.bars')[3]!;
    expect(ptr('pointerdown', bar, 300).defaultPrevented).toBe(true);
    ptr('pointermove', bar, 300 - 44 * 3);
    const wrap = root.querySelector('.board-wrap')!;
    expect(wrap.classList.contains('is-dragging')).toBe(true);
    const dragged = root.querySelector('.row.dragging')!;
    expect(dragged.classList.contains('by-bar')).toBe(true); // shows its number, not a grip
    expect(document.activeElement).not.toBe(name);
    expect(window.getSelection()?.toString() ?? '').toBe('');
    ptr('pointerup', bar, 300 - 44 * 3);
    expect(wrap.classList.contains('is-dragging')).toBe(false);
    expect(root.querySelector('.row.dragging')).toBeNull();
  });

  it('the column titles and calendar scale sit outside the scrolling board, so they can stick to the page', () => {
    const { root } = mount();
    const head = root.querySelector('.board-wrap > .board-head')!;
    expect(head.querySelector('.list-head')).not.toBeNull();
    expect(head.querySelector('.tl-clip > .tl-head .months')).not.toBeNull();
    expect(root.querySelector('.board .list-head, .board .tl-head')).toBeNull();
    // the header and the item card both read the toolbar's height
    expect((root.querySelector('.app') as HTMLElement).style.getPropertyValue('--toolbar-h')).toMatch(/^\d+px$/);
  });

  it('a chart key explains the diamonds; with a lens on it explains the dashed outlines and offers the way back', async () => {
    const { root } = mount();
    expect(text(root, '.chart-key')).toMatch(/deadline: on time, tight, late/);
    expect(root.querySelectorAll('.chart-key .k-diamond')).toHaveLength(3);
    expect(root.querySelector('.chart-key .k-lens')).toBeNull();
    expect(root.querySelectorAll('.plan-ghost')).toHaveLength(0);
    await act(() => button(root, 'Safe bet').click());
    expect(text(root, '.chart-key .k-lens')).toMatch(/your estimate · bars show Safe bet \(3\.1×\)/);
    expect(root.querySelectorAll('.plan-ghost').length).toBeGreaterThan(0);
    await act(() => button(root, 'Show as planned').click());
    expect(root.querySelectorAll('.plan-ghost')).toHaveLength(0);
    expect(root.querySelector('.seg [aria-pressed="true"]')!.textContent).toBe('As planned1×');
  });

  it('copy link lives in the export menu only, marked with a link icon', async () => {
    const { root } = mount();
    expect([...root.querySelectorAll('.topbar > button')].map((b) => b.textContent?.trim())).not.toContain('Copy link');
    await act(() => button(root, 'Export').click());
    const link = document.querySelector('.menu .menu-link')!;
    expect(link.textContent!.trim()).toMatch(/^Copy link/);
    expect(link.querySelector('svg')).not.toBeNull();
  });

  it('the person editor is a narrower popover', async () => {
    const { root } = mount();
    await act(() => (root.querySelector('[data-lane="sara"]') as HTMLButtonElement).click());
    expect(document.querySelector('.popover.lane-pop')).not.toBeNull();
  });

  it('"Ask Claude for better options" appears only where the chat can be asked, and sends the current plan', async () => {
    const { root } = mount();
    expect(root.querySelector('.insight.ask')).toBeNull(); // the website has no chat
    document.body.innerHTML = '';
    const askClaude = vi.fn(async () => true);
    const asked = mount({ mode: 'widget', canAskClaude: () => true, askClaude });
    await act(() => button(asked.root, 'Safe bet').click());
    const card = asked.root.querySelector('.insight.ask')!;
    expect(card.textContent).toMatch(/Ask Claude for better options/);
    await act(() => (card.querySelector('button') as HTMLButtonElement).click());
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(askClaude).toHaveBeenCalledWith(expect.objectContaining({ title: 'Client deliverables' }), 'safe');
    expect(text(asked.root, '.toast')).toMatch(/answer appears in the chat/);
  });
});
