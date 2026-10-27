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
    expect(root.querySelectorAll('.baseline').length).toBeGreaterThan(0); // the user's own estimate stays visible
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

describe('selection, dragging bars, lenses, colours and title', () => {
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

  it('three lenses with their multipliers, and a guide that is one table and one short note, nothing folded away', async () => {
    const { root } = mount();
    expect([...root.querySelectorAll('.seg:not(.small) button')].map((b) => b.textContent)).toEqual(['As planned1×', 'Likely1.6×', 'Safe bet3.1×']);
    await act(() => button(root, 'Likely').click());
    await act(() => (root.querySelector('[aria-label="How the forecast lenses work"]') as HTMLButtonElement).click());
    const pop = document.querySelector('.lens-pop')!;
    const rows = [...pop.querySelectorAll('.lens-table tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toEqual([
      ['As planned', '1×', 'exactly what you entered'],
      ['Likely', '1.6×', 'about half of projects are done by here'],
      ['Safe bet', '3.1×', 'about 9 in 10 are done by here: a date to promise'],
    ]);
    expect(pop.querySelector('tr.on')!.textContent).toMatch(/^Likely/); // the lens in use
    expect(pop.querySelectorAll('.badge-key .pill')).toHaveLength(4);
    expect(pop.querySelector('details')).toBeNull();
    const method = pop.querySelector('.note.method')!.textContent!;
    expect(method).toMatch(/Todd Little's 2006 .* Flyvbjerg et al\.'s 2022 .* track record beats it\. The "~x% chance" assumes/);
    expect(method.length).toBeLessThan(420); // about two-thirds of the old folded-away text
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

  it('the app and the plugin carry the version in package.json', async () => {
    const { VERSION } = await import('../../src/ui/config');
    const version = (f: string) => (JSON.parse(readFileSync(f, 'utf8')) as { version: string }).version;
    expect(VERSION).toBe(version('package.json'));
    expect(version('plugin/.claude-plugin/plugin.json')).toBe(version('package.json'));
  });
});

describe('clean drags, sticky headers, chart key, copy link and asking Claude', () => {
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

  it('a chart key explains the diamonds; with a lens on it explains the baseline and offers the way back', async () => {
    const { root } = mount();
    expect(text(root, '.chart-key')).toMatch(/deadline: on time, tight, late/);
    expect(root.querySelectorAll('.chart-key .k-diamond')).toHaveLength(3);
    expect(root.querySelector('.chart-key .k-lens')).toBeNull();
    expect(root.querySelectorAll('.baseline')).toHaveLength(0);
    await act(() => button(root, 'Safe bet').click());
    expect(text(root, '.chart-key .k-lens')).toMatch(/bars show Safe bet \(3\.1×\) · +your estimate \(as planned\)/);
    expect(root.querySelector('.chart-key .k-lens .k-baseline')).not.toBeNull();
    expect(root.querySelectorAll('.baseline').length).toBeGreaterThan(0);
    await act(() => button(root, 'Show as planned').click());
    expect(root.querySelectorAll('.baseline')).toHaveLength(0);
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

  it('popovers are only as wide as they need: the person editor keeps its note on one line', async () => {
    const { root } = mount();
    await act(() => (root.querySelector('[data-lane="sara"]') as HTMLButtonElement).click());
    const note = document.querySelector('.popover.lane-pop .one-line')!;
    expect(note.textContent).toBe('The rest goes to meetings, support, etc.');
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await act(() => button(root, '+ holidays').click());
    expect(document.querySelector('.popover.holiday-pop')).not.toBeNull();
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    // the who editor widens only when an item has both a team and a hand-off (two extra columns)
    await act(() => (root.querySelector('.row:nth-child(2) .who-cell') as HTMLButtonElement).click());
    expect(document.querySelector('.popover.who-pop')!.classList.contains('wide')).toBe(false);
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

describe('dragging feels like one piece', () => {
  const ptr = (type: string, el: EventTarget, y: number, x = 10) => {
    const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
    act(() => void el.dispatchEvent(e));
    return e;
  };
  const names = (root: Element) => [...root.querySelectorAll('.row:not(.draft) .cell-input')].map((i) => (i as HTMLInputElement).value);
  const shown = (root: Element) =>
    [...root.querySelectorAll('.list .row[data-item]')].sort((a, b) => parseFloat((a as HTMLElement).style.top) - parseFloat((b as HTMLElement).style.top)).map((r) => r.getAttribute('data-item'));

  it('the row and its bars follow the pointer together on every move, and the rows keep their DOM order until the drop', () => {
    const { root } = mount();
    const order = names(root);
    const row = root.querySelector('.list .row[data-item="revise-lumen-proposal"]') as HTMLElement;
    const bars = root.querySelector('.bars[data-item="revise-lumen-proposal"]') as HTMLElement;
    ptr('pointerdown', row.querySelector('.handle')!, 200);
    for (const dy of [7, 19, 33, 61, 70]) {
      ptr('pointermove', row, 200 - dy);
      expect(row.style.top).toBe(`${3 * 44 - dy}px`);
      expect(bars.style.top).toBe(row.style.top);
    }
    expect(row.classList.contains('dragging') && bars.classList.contains('dragging')).toBe(true);
    expect(names(root)).toEqual(order); // DOM untouched mid-drag
    expect(shown(root).indexOf('revise-lumen-proposal')).toBe(1); // but the others already make room
    ptr('pointerup', row, 130);
    expect(row.style.top).toBe('44px');
    expect(names(root)[1]).toBe('Revise Lumen proposal');
  });

  it('a drag let go outside the board still ends (and Escape-like cancels put the row back)', () => {
    const { root } = mount();
    const first = names(root)[0];
    const bar = root.querySelectorAll('.bars')[0]!;
    ptr('pointerdown', bar, 100);
    ptr('pointermove', document.body, 100 + 44 * 3);
    ptr('pointerup', document.body, 100 + 44 * 3);
    expect(root.querySelector('.board-wrap')!.classList.contains('is-dragging')).toBe(false);
    expect(names(root)[3]).toBe(first);
    // a cancelled drag (the browser takes the pointer away) changes nothing
    const now = names(root);
    ptr('pointerdown', root.querySelectorAll('.bars')[2]!, 100);
    ptr('pointermove', document.body, 100 + 44 * 2);
    act(() => void window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    expect(root.querySelector('.row.dragging')).toBeNull();
    expect(names(root)).toEqual(now);
  });

  it('hovering a bar lights up its row and shows the drag grip; hovering a row lights up its bars', () => {
    const { root } = mount();
    const bars = root.querySelector('.bars[data-item="appeal-for-kestrel"]')!;
    const row = root.querySelector('.row[data-item="appeal-for-kestrel"]')!;
    act(() => void bars.dispatchEvent(new PointerEvent('pointerenter')));
    expect(row.hasAttribute('data-hover') && bars.hasAttribute('data-hover')).toBe(true);
    const other = root.querySelector('.row[data-item="quick-fix-for-acme"]')!;
    act(() => void other.dispatchEvent(new PointerEvent('pointerenter')));
    expect(row.hasAttribute('data-hover')).toBe(false);
    expect(root.querySelector('.bars[data-item="quick-fix-for-acme"]')!.hasAttribute('data-hover')).toBe(true);
    act(() => void root.querySelector('.board-wrap')!.dispatchEvent(new PointerEvent('pointerleave')));
    expect(root.querySelectorAll('[data-hover]')).toHaveLength(0);
  });

  it('a drop moves focus to the board, so ⌘/Ctrl Z right after it undoes the move', () => {
    const { root } = mount();
    const first = names(root)[0];
    const bar = root.querySelectorAll('.bars')[0]!;
    ptr('pointerdown', bar, 100);
    ptr('pointermove', bar, 100 + 44);
    ptr('pointerup', bar, 100 + 44);
    expect(document.activeElement).toBe(root.querySelector('.board-wrap'));
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
    expect(names(root)[0]).toBe(first);
  });
});

describe('undo and redo', () => {
  const key = (init: KeyboardEventInit, target: EventTarget = window) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init })));
  const saturday = (root: Element) => root.querySelector('.daychip[title^="Saturday"]') as HTMLButtonElement;

  it('buttons and shortcuts (⌘Z, ⇧⌘Z, Ctrl Y) step through the history; disabled when there is nothing to do', async () => {
    const { root } = mount();
    const undo = root.querySelector('[aria-label="Undo"]') as HTMLButtonElement;
    const redo = root.querySelector('[aria-label="Redo"]') as HTMLButtonElement;
    expect(undo.disabled && redo.disabled).toBe(true);
    await act(() => saturday(root).click());
    expect(saturday(root).getAttribute('aria-pressed')).toBe('true');
    await key({ key: 'z', metaKey: true });
    expect(saturday(root).getAttribute('aria-pressed')).toBe('false');
    await key({ key: 'Z', metaKey: true, shiftKey: true });
    expect(saturday(root).getAttribute('aria-pressed')).toBe('true');
    await key({ key: 'z', ctrlKey: true });
    await key({ key: 'y', ctrlKey: true });
    expect(saturday(root).getAttribute('aria-pressed')).toBe('true');
    await act(() => undo.click());
    expect(undo.disabled).toBe(true);
    await act(() => redo.click());
    expect(redo.disabled).toBe(true);
  });

  it('typing is one undo step, and shortcuts inside a text field are left to the field', async () => {
    const { root } = mount();
    const name = root.querySelector('.row:not(.draft) .cell-input') as HTMLInputElement;
    const before = name.value;
    for (const v of ['Q', 'Qu', 'Qui']) {
      name.value = v;
      await act(() => void name.dispatchEvent(new Event('input', { bubbles: true })));
    }
    await key({ key: 'z', metaKey: true }, name); // the field's own undo, not the plan's
    expect((root.querySelector('.row:not(.draft) .cell-input') as HTMLInputElement).value).toBe('Qui');
    await act(() => (root.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click());
    expect((root.querySelector('.row:not(.draft) .cell-input') as HTMLInputElement).value).toBe(before);
  });
});

describe('the setup bar', () => {
  const field = (label: string) => [...document.querySelectorAll('.popover .field')].find((f) => f.textContent?.startsWith(label))!;
  const set = (el: HTMLInputElement | HTMLSelectElement, value: string, type = 'input') => {
    el.value = value;
    return act(() => void el.dispatchEvent(new Event(type, { bubbles: true })));
  };

  it('adds and removes holidays for everyone, and they move the dates', async () => {
    const { root } = mount();
    const end = () => text(root, '.headline');
    const before = end();
    await act(() => button(root, '+ holidays').click());
    const add = button(document.querySelector('.popover')!, 'Add');
    expect(add.disabled).toBe(true);
    await set(field('From').querySelector('input')!, '2026-10-06');
    await set(field('To').querySelector('input')!, '2026-10-08');
    await set(field('Label').querySelector('input')!, 'Retreat');
    await act(() => button(document.querySelector('.popover')!, 'Add').click());
    expect(document.querySelector('.popover')!.textContent).toMatch(/6 Oct – 8 Oct · Retreat/);
    expect(button(root, '1 holiday')).toBeDefined();
    expect(end()).not.toBe(before);
    await act(() => (document.querySelector('[aria-label="Remove holiday"]') as HTMLButtonElement).click());
    expect(document.querySelector('.popover')!.textContent).toMatch(/None yet/);
    expect(end()).toBe(before);
  });

  it('the last working day cannot be switched off', async () => {
    const { root } = mount();
    const chips = () => [...root.querySelectorAll('.daychip')] as HTMLButtonElement[];
    for (const c of chips()) if (c.getAttribute('aria-pressed') === 'true' && c.title.startsWith('Monday') === false) await act(() => c.click());
    expect(chips().filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.textContent)).toEqual(['Mo']);
    await act(() => chips()[0]!.click());
    expect(chips()[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('the person editor renames, makes a team, sets availability and colour, and removes a person from their items', async () => {
    const { root } = mount();
    await act(() => (root.querySelector('[data-lane="omar"]') as HTMLButtonElement).click());
    await set(field('Name').querySelector('input')!, 'Omar K');
    expect(root.querySelector('[data-lane="omar"]')!.textContent).toMatch(/Omar K/);
    await set(field('Kind').querySelector('select')!, 'team', 'change');
    await set(field('People').querySelector('input')!, '3');
    expect(root.querySelector('[data-lane="omar"]')!.textContent).toMatch(/×3/);
    await set(field('Time for this plan').querySelector('input')!, '80');
    expect(field('Time for this plan').textContent).toMatch(/^Time for this plan: 80%/);
    await act(() => (document.querySelector('[aria-label="Colour #7950f2"]') as HTMLButtonElement).click());
    expect((root.querySelector('[data-lane="omar"] .dot') as HTMLElement).style.background).toMatch(/#7950f2|rgb\(121, 80, 242\)/);
    await set(field('Kind').querySelector('select')!, 'person', 'change');
    expect(root.querySelector('[data-lane="omar"]')!.textContent).not.toMatch(/×/);
    const usedBy = button(document.querySelector('.popover')!, 'Remove');
    expect(usedBy.textContent).toMatch(/used by 2/);
    await act(() => usedBy.click());
    expect(root.querySelector('[data-lane="omar"]')).toBeNull();
    expect(document.querySelector('.popover')).toBeNull();
    expect(root.querySelectorAll('.row:not(.draft)')).toHaveLength(7);
    expect(root.querySelector('.who-cell[title*="Omar"]')).toBeNull(); // gone from every item it was on
  });
});

describe('export files', () => {
  it('builds every export with a file name from the plan title', async () => {
    vi.resetModules();
    vi.doMock('../../src/ui/lib', async (orig) => ({ ...(await orig<typeof import('../../src/ui/lib')>()), svgToPng: async () => new Uint8Array([137, 80, 78, 71]) }));
    const { buildExport } = await import('../../src/ui/exporters');
    const plan = sample();
    const files = await Promise.all((['json', 'yaml', 'xlsx', 'csv', 'ics', 'svg', 'png', 'md'] as const).map((k) => buildExport(k, plan, 'likely', true)));
    expect(files.map((f) => [f.name, f.mime])).toEqual([
      ['client-deliverables.whenship.json', 'application/json'],
      ['client-deliverables.whenship.yaml', 'application/yaml'],
      ['client-deliverables.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['client-deliverables.csv', 'text/csv'],
      ['client-deliverables.ics', 'text/calendar'],
      ['client-deliverables.svg', 'image/svg+xml'],
      ['client-deliverables.png', 'image/png'],
      ['client-deliverables.md', 'text/markdown'],
    ]);
    expect(JSON.parse(files[0]!.data as string).title).toBe('Client deliverables');
    expect(files[4]!.data).toMatch(/\(Likely 1\.6×\)/);
    expect(files[7]!.data).toMatch(/<summary>Plan file<\/summary>[\s\S]*"title": "Client deliverables"/);
    vi.doUnmock('../../src/ui/lib');
  });

  it('a failed export says so instead of failing silently', async () => {
    const { root } = mount({ save: vi.fn(async () => Promise.reject(new Error('disk full'))) });
    await act(() => button(root, 'Export').click());
    await act(() => button(document as unknown as Element, 'CSV').click());
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(text(root, '.toast')).toBe('Export failed: disk full');
  });

  it('where downloads are impossible, text files are shown to copy', async () => {
    const { root } = mount({ save: vi.fn(async () => false as const) });
    await act(() => button(root, 'Export').click());
    await act(() => button(document as unknown as Element, 'CSV').click());
    await act(() => new Promise((r) => setTimeout(r, 0)));
    const dialog = document.querySelector('.dialog[aria-label="client-deliverables.csv"]')!;
    expect((dialog.querySelector('textarea') as HTMLTextAreaElement).value).toMatch(/^Priority,Item/);
  });
});

describe('the who editor with teams and hand-offs', () => {
  const squads = () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const changes: { items: { name: string; work: { lane: string; days: number; maxPeople: number; after?: string }[] }[] }[] = [];
    const host: Host = { mode: 'web', save: vi.fn(async () => 'saved' as const), copy: vi.fn(async () => true), baseUrl: () => null, onChange: (p) => changes.push(p as never) };
    act(() => render(<App host={host} initialPlan={validatePlan(SAMPLES[1]!.build(today), { today }).plan} today={today} />, root));
    return { root, last: () => changes.at(-1)!.items.find((i) => i.name === 'Subscriptions MVP')! };
  };
  const set = (el: HTMLInputElement | HTMLSelectElement, value: string, type = 'input') => {
    el.value = value;
    return act(() => void el.dispatchEvent(new Event(type, { bubbles: true })));
  };

  it('widens for a team and a hand-off, and edits days, people at once, the hand-off and who is on it', async () => {
    const { root, last } = squads();
    const row = [...root.querySelectorAll('.list .row')].find((r) => (r.querySelector('.cell-input') as HTMLInputElement | null)?.value === 'Subscriptions MVP')!;
    await act(() => (row.querySelector('.who-cell') as HTMLButtonElement).click());
    const pop = document.querySelector('.popover.who-pop')!;
    expect(pop.classList.contains('wide')).toBe(true);
    expect([...pop.querySelectorAll('.who-head .col-h')].map((c) => c.textContent)).toEqual(['Days', 'At once', 'Starts']);
    await set(pop.querySelector('[aria-label="Back-end: working days"]') as HTMLInputElement, '12');
    await set(pop.querySelector('[aria-label="Back-end: people at once"]') as HTMLInputElement, '3');
    expect(last().work.find((w) => w.lane === 'back-end')).toMatchObject({ days: 12, maxPeople: 3 });
    await set(pop.querySelector('[aria-label="Front-end: starts"]') as HTMLSelectElement, '', 'change');
    expect(last().work.find((w) => w.lane === 'front-end')!.after).toBeUndefined();
    await set(pop.querySelector('[aria-label="Add a person or team to this item"]') as HTMLSelectElement, 'data', 'change');
    expect(last().work.map((w) => w.lane)).toEqual(['back-end', 'front-end', 'data']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Data: working days'); // ready to type the days
    await act(() => (pop.querySelector('[aria-label="Remove Back-end from this item"]') as HTMLButtonElement).click());
    expect(last().work.map((w) => w.lane)).toEqual(['front-end', 'data']);
    await act(() => button(pop as HTMLElement, 'Done').click());
    expect(document.querySelector('.who-pop')).toBeNull();
  });
});
