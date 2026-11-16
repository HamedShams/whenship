// @vitest-environment happy-dom
// The chart as people work in it: the options rail with previews, the dock, what a row opens (why its date, its
// settings), dragging rows, bar edges and diamonds, done items, fit zoom, the calendar, and effort as a number for
// one-person plans.
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type Host } from '../../src/ui/App';
import { autoScrollSpeed, monthLabel, pixelsPerDay, ROW } from '../../src/ui/Board';
import { validatePlan } from '../../src/engine';
import { dayParts, todayLocal } from '../../src/engine/dates';
import { fitPpd } from '../../src/io/view';
import { SAMPLES } from '../../src/io/samples';

const today = '2026-10-05';
const sample = () => validatePlan(SAMPLES[0]!.build(today), { today }).plan;

function mount(extra: Partial<Parameters<typeof App>[0]> = {}, host: Partial<Host> = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const changes: unknown[] = [];
  const h: Host = { mode: 'web', save: vi.fn(async () => 'saved' as const), copy: vi.fn(async () => true), baseUrl: () => 'https://example.test/', onChange: (plan) => changes.push(plan), ...host };
  act(() => render(<App host={h} initialPlan={extra.initialPlan ?? sample()} today={today} {...extra} />, root));
  return { root, changes };
}
const settle = () => act(() => new Promise((r) => setTimeout(r, 250)));
const ptr = (type: string, el: EventTarget, x: number, y = 20) => {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1 });
  act(() => void el.dispatchEvent(e));
  return e;
};
const names = (root: Element) => [...root.querySelectorAll('.row:not(.draft) .cell-input')].map((i) => (i as HTMLInputElement).value);
const rows = (root: Element) => [...root.querySelectorAll('.list .row:not(.draft)')] as HTMLElement[];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the options rail', () => {
  it('sits under the chart; hovering a card previews it as a ghost on the chart, leaving clears it', async () => {
    const { root } = mount();
    await settle();
    expect(root.querySelector('.board-wrap + .dock .options')).not.toBeNull(); // in the dock, right under the chart
    const card = root.querySelector('.option')!;
    expect(card.textContent).toMatch(/Quick fix for Acme/);
    act(() => void card.dispatchEvent(new PointerEvent('pointerenter')));
    expect(root.querySelector('.bar.ghost')).toBeNull(); // not yet: a quick pass over the rail changes nothing
    await act(() => new Promise((r) => setTimeout(r, 450)));
    expect(root.querySelector('.board-wrap')!.classList.contains('has-ghost')).toBe(true);
    expect(root.querySelectorAll('.bar.ghost').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.ghost-delta').length).toBeGreaterThan(0); // the dates that would move
    act(() => void card.dispatchEvent(new PointerEvent('pointerleave')));
    expect(root.querySelector('.bar.ghost')).toBeNull();
    expect(root.querySelector('.board-wrap')!.classList.contains('has-ghost')).toBe(false);
  });

  it("shows Claude's options as cards of their own, measured against the plan as it is now, and drops ones that no longer apply", async () => {
    const { root } = mount({ claudeOptions: [{ title: 'Put the appeal first', changes: [{ op: 'move', item: 'Appeal for Northwind', to: 0 }] }, { title: 'Stale', changes: [{ op: 'removeItem', item: 'Gone' }] }] });
    await settle();
    const cards = [...root.querySelectorAll('.option.from-claude')];
    expect(cards).toHaveLength(1);
    expect(cards[0]!.querySelector('.opt-kind')!.textContent).toMatch(/Claude's option/);
    expect(cards[0]!.querySelector('.opt-title')!.textContent).toBe('Put the appeal first');
    expect(cards[0]!.querySelector('.opt-effect')!.textContent).not.toBe('');
    await act(() => (cards[0]!.querySelector('button') as HTMLButtonElement).click());
    expect(names(root)[0]).toBe('Appeal for Northwind');
  });

  it("never shows more than three cards: Claude's take the place of the engine's lowest-ranked ones", async () => {
    const { root } = mount({ claudeOptions: [{ title: 'Appeal first', changes: [{ op: 'move', item: 'Appeal for Northwind', to: 0 }] }] });
    await settle();
    const kinds = () => [...document.querySelectorAll('.option .opt-kind')].map((k) => k.textContent!.trim());
    expect(root.querySelectorAll('.option')).toHaveLength(3);
    expect(kinds().map((k) => k === "Claude's option")).toEqual([true, false, false]); // Claude's first, then the engine's best two
    document.body.innerHTML = '';
    mount({
      claudeOptions: [
        { title: 'Appeal first', changes: [{ op: 'move', item: 'Appeal for Northwind', to: 0 }] },
        { title: 'A later Kestrel date', changes: [{ op: 'setDeadline', item: 'Appeal for Kestrel', date: '2026-12-01' }] },
      ],
    });
    await settle();
    expect(kinds().map((k) => k === "Claude's option")).toEqual([true, true, false]);
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\n\.dock \.option-rail \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/); // three small columns side by side
    expect(css).toMatch(/@media \(max-width: 800px\) \{[^}]*\}\s*\.dock \.option-rail \{ grid-template-columns: repeat\(2,[^@]*\.dock \.option:nth-child\(n \+ 3\) \{ display: none; \}/); // two on tablets and inside Claude
  });
});

describe('the dock holds the options; a row answers for itself', () => {
  it("holds the options only; a row's date opens why it lands there, its name opens its settings; no row moves; Esc closes them", async () => {
    const { root } = mount();
    const dock = root.querySelector('.board-wrap + .dock')!;
    expect(dock.querySelector('.dock-options .options')).not.toBeNull();
    expect(dock.querySelector('.options-title .options-hint')!.textContent).toMatch(/Click a date under Expected delivery/);
    const r = rows(root);
    const barsOf = (id: string) => root.querySelector(`.bars[data-item="${id}"]`) as HTMLElement;
    // a click on the row selects it, and that is all: nothing opens on every click
    await act(() => (r[2]!.querySelector('.handle')!.parentElement as HTMLElement).click());
    expect((root.querySelector('.row.sel') as HTMLElement).dataset.item).toBe('research-for-brightside');
    expect(document.querySelector('.item-panel, .why')).toBeNull();
    // the date is the question; the note it opens is the answer, and only the answer
    const cell = r[2]!.querySelector('button.status') as HTMLButtonElement;
    expect(cell.getAttribute('aria-expanded')).toBe('false');
    await act(() => cell.click());
    expect(cell.getAttribute('aria-expanded')).toBe('true');
    const why = root.querySelector('.popover.why-pop .why')!;
    expect(why.querySelector('h4')!.textContent).toBe('Why this date');
    expect(why.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(why.querySelector('input, select, button')).toBeNull(); // no settings in it
    expect(document.querySelector('.item-panel')).toBeNull();
    await act(() => cell.click()); // the same date again closes it
    expect(document.querySelector('.why')).toBeNull();
    await act(() => cell.click());
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.why')).toBeNull();
    // the name opens the item's own settings, under its row
    const name = r[2]!.querySelector('.cell-input') as HTMLInputElement;
    expect([name.getAttribute('aria-haspopup'), name.getAttribute('aria-expanded')]).toEqual(['dialog', 'false']);
    await act(() => name.click());
    expect(name.getAttribute('aria-expanded')).toBe('true');
    const panel = root.querySelector('.popover.item-pop .item-panel')!;
    expect(dock.querySelector('.item-panel')).toBeNull(); // not in the dock
    expect([...panel.querySelectorAll('.ip-label')].map((l) => l.textContent)).toEqual(['Who', "Can't start before", 'Starts after', 'Note']);
    expect(panel.textContent).not.toMatch(/Delivery|chance on time|Deadline|Why this date/); // the row above has the dates
    expect(panel.querySelector('.ip-who')!.textContent).toMatch(/Sara\s*5 days/); // everyone on it, by full name
    expect(panel.querySelector('.ip-control .ip-hint')!.textContent).toMatch(/^starts \d+ \w{3}/); // what the setting leads to
    expect(panel.querySelector('.ip-name')).toBeNull(); // the row shows the whole name: it isn't repeated
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\n\.dock \{ position: sticky; bottom: var\(--safe-bottom, 0px\); z-index: 25;/); // sticks to the window's bottom while the chart is in view
    expect(r[3]!.style.top).toBe(`${3 * ROW}px`); // the rows below stay where they were
    expect(barsOf(r[3]!.dataset.item!).style.top).toBe(r[3]!.style.top);
    expect((root.querySelector('.bars.sel') as HTMLElement).dataset.item).toBe('research-for-brightside');
    expect(root.querySelector('aside.details, .row-details-slot, .details-gap, .dock-item')).toBeNull();
    await act(() => name.click()); // a second click in the name is a click in a text field: the settings stay
    expect(document.querySelector('.item-panel')).not.toBeNull();
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.item-panel')).toBeNull();
  });

  it('a name too long for its row is repeated in full on top of the settings; Enter in the name closes them and moves on', async () => {
    const { root } = mount();
    const name = rows(root)[2]!.querySelector('.cell-input') as HTMLInputElement;
    Object.defineProperty(name, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(name, 'clientWidth', { value: 120, configurable: true });
    await act(() => name.click());
    expect(root.querySelector('.item-panel .ip-name')!.textContent).toBe('Research for Brightside');
    await act(() => void name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(root.querySelector('.item-panel')).toBeNull();
  });

  it('the settings are as wide as the list from the name to the end of the row, and sit right under the row', async () => {
    const { root } = mount();
    const row = rows(root)[1]!;
    const name = row.querySelector('.cell-input') as HTMLInputElement;
    const rect = (el: Element, r: Partial<DOMRect>) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r as DOMRect);
    rect(row, { top: 200, bottom: 244, left: 0, right: 484 });
    rect(name, { top: 207, bottom: 237, left: 37, right: 190 });
    rect(row.querySelector('.row-del')!, { top: 211, bottom: 233, left: 455, right: 477 });
    await act(() => name.click());
    const pop = root.querySelector('.popover.item-pop') as HTMLElement;
    expect(pop.style.width).toBe('440px'); // 477 − 37: from the name's left edge to the delete button's right edge
    expect(pop.style.left).toBe('37px');
    expect(pop.style.top).toBe('245px'); // a pixel under the row
  });

  it('a date with nothing to explain opens nothing: an item with no effort yet, a finished one', async () => {
    const { root } = mount();
    const draft = root.querySelector('.row.draft .cell-input') as HTMLInputElement;
    draft.value = 'Later';
    await act(() => void draft.dispatchEvent(new Event('input', { bubbles: true })));
    const added = rows(root).at(-1)!;
    expect(added.querySelector('.status .pill.empty')).not.toBeNull();
    expect(added.querySelector('button.status')).toBeNull(); // "no effort" says it all
    await act(() => (rows(root)[0]!.querySelector('.cell-input') as HTMLInputElement).click());
    await act(() => (root.querySelector('.item-panel .done-toggle') as HTMLButtonElement).click());
    expect(rows(root)[0]!.querySelector('.status .pill.done')).not.toBeNull();
    expect(rows(root)[0]!.querySelector('button.status')).toBeNull();
  });

  it('everyone on an item is listed by name in its settings, and a click there opens the editor on top; one person alone is not listed', async () => {
    const { root } = mount();
    await act(() => (root.querySelector('.row[data-item="revise-lumen-proposal"] .cell-input') as HTMLInputElement).click());
    const who = root.querySelector('.item-panel .ip-who') as HTMLButtonElement;
    expect([...who.querySelectorAll('.ip-person')].map((x) => x.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['MAMartin1 day', 'SASara3 daysafter Martin']);
    await act(() => who.click());
    const pops = [...root.querySelectorAll('.popover')];
    expect(pops.map((x) => x.classList.contains('who-pop'))).toEqual([false, true]); // the editor comes after the settings in the page: on top
    await act(() => void (root.querySelector('.who-pop') as HTMLElement).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(root.querySelector('.item-panel')).not.toBeNull(); // a press in the editor is not a press outside the settings
    const solo = mount({ initialPlan: validatePlan({ title: 'Mine', start: '2026-11-02', lanes: [{ name: 'Me' }], items: [{ name: 'One', who: 'Me', days: 2 }] }, { today }).plan });
    await act(() => (solo.root.querySelector('.row .cell-input') as HTMLInputElement).click());
    expect([...solo.root.querySelectorAll('.item-panel .ip-label')].map((l) => l.textContent)).toEqual(["Can't start before", 'Starts after', 'Note']);
  });

  it('the note keeps its spaces as typed (it is not re-validated on every keystroke), and what is typed never looks like the placeholder', async () => {
    const { root, changes } = mount();
    await act(() => (rows(root)[0]!.querySelector('.cell-input') as HTMLInputElement).click());
    const note = root.querySelector('.item-panel .ip-input') as HTMLInputElement;
    note.value = 'call Acme ';
    await act(() => void note.dispatchEvent(new Event('input', { bubbles: true })));
    expect(note.value).toBe('call Acme ');
    expect((changes.at(-1) as { items: { note?: string }[] }).items[0]!.note).toBe('call Acme ');
    note.value = '';
    await act(() => void note.dispatchEvent(new Event('input', { bubbles: true })));
    expect((changes.at(-1) as { items: { note?: string }[] }).items[0]!.note).toBeUndefined();
    // typed text takes the text colour; a placeholder is always the quiet grey. The field carries no class that another
    // rule colours (a `.note` class once turned what was typed grey too).
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\.ip-input, \.ip-select \{[^}]*color: var\(--fg\);/);
    expect(css).toMatch(/input::placeholder, textarea::placeholder \{ color: var\(--fg3\); opacity: 1; \}/);
    expect(note.closest('.note')).toBeNull();
  });

  it('marks an item done from its settings: it leaves the schedule, and comes back', async () => {
    const { root } = mount();
    await act(() => (rows(root)[0]!.querySelector('.cell-input') as HTMLInputElement).click());
    const toggle = () => root.querySelector('.item-panel .done-toggle') as HTMLButtonElement;
    expect([toggle().textContent!.trim(), toggle().getAttribute('aria-pressed')]).toEqual(['Mark done', 'false']);
    await act(() => toggle().click());
    expect(rows(root)[0]!.classList.contains('done')).toBe(true);
    expect(rows(root)[0]!.querySelector('.pill.done')!.textContent).toBe('done');
    expect(root.querySelector('.bars.done .done-bar')).not.toBeNull();
    // the state is said in words, and the way back is a button that says what it does
    expect(root.querySelector('.item-panel .ip-foot .ip-hint')!.textContent).toBe('Done: it takes no more time');
    expect([toggle().textContent!.trim(), toggle().getAttribute('aria-pressed'), toggle().classList.contains('on')]).toEqual(['Reopen', 'true', true]);
    await act(() => toggle().click());
    expect(rows(root)[0]!.classList.contains('done')).toBe(false);
    expect(root.querySelector('.item-panel .ip-foot .ip-hint')).toBeNull();
  });
});

describe('dragging a bar edge and a deadline diamond', () => {
  it("dragging a bar's right edge changes that part's effort, half a day at a time, and the row shows it", async () => {
    const { root, changes } = mount();
    const edge = root.querySelector('.bars[data-item="appeal-for-northwind"] .bar-edge')!;
    const e = ptr('pointerdown', edge, 300);
    expect(e.defaultPrevented).toBe(true);
    expect(root.querySelector('.board-wrap')!.classList.contains('is-resizing')).toBe(false); // not until it moves sideways
    ptr('pointermove', document.body, 300 + 26 * 7); // a calendar week to the right ≈ 5 working days
    expect(root.querySelector('.board-wrap')!.classList.contains('is-resizing')).toBe(true);
    expect(root.querySelector('.bar.resizing .bar-days')!.textContent).toBe('9d');
    expect(root.querySelector('.row[data-item="appeal-for-northwind"] .who-days')!.textContent).toBe('9d'); // the row follows the live edit
    ptr('pointerup', document.body, 300 + 26 * 7);
    expect(root.querySelector('.board-wrap')!.classList.contains('is-resizing')).toBe(false);
    const last = changes.at(-1) as { items: { id: string; work: { days: number }[] }[] };
    expect(last.items.find((i) => i.id === 'appeal-for-northwind')!.work[0]!.days).toBe(9);
    // a press on the edge without movement changes nothing, and never starts a reorder
    ptr('pointerdown', edge, 300);
    ptr('pointerup', document.body, 300);
    expect(root.querySelector('.row.dragging')).toBeNull();
    expect(changes).toHaveLength(2);
  });

  it('while resizing, the bar itself follows the pointer; the plan re-plans in half-day steps; effort stops at a person-year', () => {
    const { root } = mount();
    const bar = () => root.querySelector('.bars[data-item="appeal-for-northwind"] .bar') as HTMLElement;
    const width0 = parseFloat(bar().style.width);
    ptr('pointerdown', bar().querySelector('.bar-edge')!, 300);
    ptr('pointermove', document.body, 305); // under a quarter of a day: the plan is unchanged, the bar is 5 px longer
    expect(parseFloat(bar().style.width)).toBe(width0 + 5);
    expect(root.querySelector('.bar.resizing .bar-days')!.textContent).toBe('4d');
    ptr('pointermove', document.body, 300 + 26 * 7 * 60); // a year and more
    expect(root.querySelector('.bar.resizing .bar-days')!.textContent).toBe('250d'); // the cap: longer work is several items
    ptr('pointerup', document.body, 300 + 26 * 7 * 60);
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\.board-wrap\.is-resizing \.bar,[^\n]*transition: none/); // nothing eases while the pointer leads
  });

  it('the scale stays put while a bar is resized past the end of the plan: the chart only gets wider', () => {
    const { root } = mount();
    const head = () => parseFloat((root.querySelector('.tl-head') as HTMLElement).style.width);
    const weekend = () => parseFloat((root.querySelector('.offday') as HTMLElement).style.width);
    const before = head();
    expect(weekend()).toBe(2 * 26); // the day scale (26 px) while the width is unknown
    const edge = root.querySelector('.bars[data-item="appeal-for-northwind"] .bar-edge')!;
    ptr('pointerdown', edge, 300);
    ptr('pointermove', document.body, 300 + 26 * 7 * 12); // twelve weeks longer: well past the plan's end
    expect(root.querySelector('.bar.resizing .bar-days')!.textContent).toBe('64d');
    expect(weekend()).toBe(2 * 26); // days did not shrink under the pointer
    expect(head()).toBeGreaterThan(before); // the chart grew instead
    ptr('pointerup', document.body, 300 + 26 * 7 * 12);
  });

  it('dragging a deadline diamond moves the deadline a day per day of movement', async () => {
    const { root, changes } = mount();
    const diamond = root.querySelector('.bars[data-item="appeal-for-northwind"] .deadline')!;
    ptr('pointerdown', diamond, 100);
    ptr('pointermove', document.body, 100 + 26 * 3);
    ptr('pointerup', document.body, 100 + 26 * 3);
    const last = changes.at(-1) as { items: { id: string; deadline?: string }[] };
    expect(last.items.find((i) => i.id === 'appeal-for-northwind')!.deadline).toBe('2026-10-17'); // was the 14th
    expect(root.querySelector('.row[data-item="appeal-for-northwind"] .due-cell')!.textContent).toBe('17 Oct');
  });

  it("a sideways pull on a bar's body is neither a reorder nor a click; an up-or-down pull reorders", () => {
    const { root, changes } = mount();
    const bar = root.querySelector('.bars[data-item="appeal-for-northwind"] .bar')!;
    ptr('pointerdown', bar, 100, 60);
    ptr('pointermove', document.body, 140, 62); // mostly sideways
    expect(root.querySelector('.row.dragging')).toBeNull();
    ptr('pointermove', document.body, 140, 120); // even a later downward move: the gesture was given up
    expect(root.querySelector('.row.dragging')).toBeNull();
    ptr('pointerup', document.body, 140, 120);
    expect(root.querySelector('.row.sel')).toBeNull();
    expect(changes).toHaveLength(1);
    ptr('pointerdown', bar, 100, 60);
    ptr('pointermove', document.body, 103, 110); // down, with a little drift
    expect((root.querySelector('.row.dragging') as HTMLElement).dataset.item).toBe('appeal-for-northwind');
    ptr('pointerup', document.body, 103, 110);
    expect(names(root)[2]).toBe('Appeal for Northwind');
  });
});

describe('a drag is always the row that was pressed, and always ends', () => {
  const handle = (root: Element, i: number) => rows(root)[i]!.querySelector('[data-handle]')!;

  it('a dragged row stays inside the list: it stops at the first place and at the last, with its bars', () => {
    const { root } = mount();
    const n = rows(root).length;
    const id = rows(root)[2]!.dataset.item!;
    const tops = () => [...root.querySelectorAll<HTMLElement>(`[data-item="${id}"]`)].map((el) => el.style.top);
    ptr('pointerdown', handle(root, 2), 10, 300);
    ptr('pointermove', document.body, 10, 300 - 9 * ROW); // far above the list: under the chart's header, were it to follow
    expect(tops()).toEqual(['0px', '0px']); // the row and its bars
    expect(root.querySelector('.row.dragging .handle')!.getAttribute('aria-label')).toMatch(/^#1 /);
    ptr('pointermove', document.body, 10, 300 + 30 * ROW); // far below it
    expect(tops()).toEqual([`${(n - 1) * ROW}px`, `${(n - 1) * ROW}px`]);
    ptr('pointerup', document.body, 10, 300 + 30 * ROW);
    expect(names(root).at(-1)).toBe('Research for Brightside');
  });

  it('the page scrolls to keep the dragged row whole, wherever the pointer is', async () => {
    const { root } = mount();
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const rect = (el: Element, r: Partial<DOMRect>) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r as DOMRect);
    rect(root.querySelector('.board-head')!, { top: 40, bottom: 100 });
    rect(root.querySelector('.list .rows')!, { top: 88, bottom: 600 }); // the first row is 12 px under the header
    const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    ptr('pointerdown', handle(root, 1), 10, 400);
    ptr('pointermove', document.body, 10, 400 - ROW); // into the first place, with the pointer far from any edge
    await frame();
    await frame();
    expect(scrollBy).toHaveBeenCalledWith({ top: -12, behavior: 'instant' }); // just what is hidden, no more
    ptr('pointerup', document.body, 10, 400 - ROW);
    scrollBy.mockRestore();
  });

  it('a move with no button down ends a drag whose release was missed: the row is dropped where it stood', () => {
    const { root } = mount();
    ptr('pointerdown', handle(root, 0), 10, 300);
    ptr('pointermove', document.body, 10, 300 + 2 * ROW);
    expect(root.querySelector('.row.dragging')).not.toBeNull();
    // the mouse was let go outside the window; it comes back with no button held
    act(() => void document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 600, buttons: 0, pointerId: 1 })));
    expect(root.querySelector('.dragging')).toBeNull();
    expect(names(root).slice(0, 3)).toEqual(['Appeal for Northwind', 'Research for Brightside', 'Quick fix for Acme']);
    act(() => void document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 100, buttons: 0, pointerId: 1 })));
    expect(names(root)[2]).toBe('Quick fix for Acme'); // and it follows the pointer no further
  });

  it('a press while a drag is still in progress ends that drag and grabs nothing new', () => {
    const { root } = mount();
    ptr('pointerdown', handle(root, 0), 10, 300);
    ptr('pointermove', document.body, 10, 300 + ROW);
    ptr('pointerdown', handle(root, 4), 10, 300 + 4 * ROW); // no release came in between
    expect(root.querySelector('.dragging')).toBeNull();
    expect(names(root).slice(0, 2)).toEqual(['Appeal for Northwind', 'Quick fix for Acme']);
    ptr('pointermove', document.body, 10, 300 + 6 * ROW);
    expect(root.querySelector('.dragging')).toBeNull();
    ptr('pointerup', document.body, 10, 300 + 6 * ROW);
    // the list is in the plan's order again: every row sits in its own place
    expect(rows(root).map((r) => r.style.top)).toEqual(rows(root).map((_, i) => `${i * ROW}px`));
  });

  it("a press on a bar's edge that goes up or down reorders the item (a short bar is mostly edge); without moving it is a click", async () => {
    const { root, changes } = mount();
    const edge = () => root.querySelector('.bars[data-item="appeal-for-northwind"] .bar-edge')!;
    ptr('pointerdown', edge(), 300, 60);
    ptr('pointermove', document.body, 301, 60 + 2 * ROW); // straight down
    expect((root.querySelector('.row.dragging') as HTMLElement).dataset.item).toBe('appeal-for-northwind');
    expect(root.querySelector('.board-wrap')!.classList.contains('is-resizing')).toBe(false);
    ptr('pointerup', document.body, 301, 60 + 2 * ROW);
    expect(names(root)[3]).toBe('Appeal for Northwind');
    const effort = (changes.at(-1) as { items: { id: string; work: { days: number }[] }[] }).items.find((x) => x.id === 'appeal-for-northwind')!.work[0]!.days;
    expect(effort).toBe(4); // moved, not resized
    ptr('pointerdown', edge(), 300, 60);
    ptr('pointerup', document.body, 300, 60);
    expect((root.querySelector('.row.sel') as HTMLElement).dataset.item).toBe('appeal-for-northwind');
  });
});

describe('fit zoom', () => {
  it('sizes days to the width at hand, within readable bounds, and falls back to a scale by plan length', () => {
    expect(fitPpd(30, 1300)).toBe(26); // never wider than the day scale
    expect(fitPpd(100, 1300)).toBe(13);
    expect(fitPpd(400, 1300)).toBe(3.2); // tenths of a pixel, so no strip of the width goes unused
    expect(fitPpd(1100, 1300)).toBe(1.1);
    expect(fitPpd(1100, 500)).toBe(1); // fit means fit: a day can be a pixel wide; only past that does the chart scroll
    expect(pixelsPerDay('fit', 100, 0)).toBe(10); // unknown width: the week scale a 100-day plan reads best at
    expect(pixelsPerDay('month', 100, 1300)).toBe(4);
  });

  it('draws without transitions until the width is known, so the first fitted render is not an animation', () => {
    const { root } = mount();
    expect(root.querySelector('.board-wrap')!.classList.contains('unmeasured')).toBe(true); // happy-dom has no layout
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\.board-wrap\.unmeasured \.bar[^\n]*transition: none/);
    expect(css).toMatch(/\nhtml \{ scrollbar-gutter: stable; \}/); // a page scrollbar coming and going must not re-fit the chart
  });
});

describe('effort for one person', () => {
  const solo = () => validatePlan({ start: today, lanes: ['Me'], items: [{ name: 'Draft', who: 'Me', days: 3, deadline: '2026-10-09' }, { name: 'Review' }] }, { today }).plan;
  const type = async (el: HTMLInputElement, v: string) => {
    el.value = v;
    await act(() => void el.dispatchEvent(new Event('input', { bubbles: true })));
  };

  it('is a number typed straight into the row, no "who" step; the header says Effort', async () => {
    const { root, changes } = mount({ initialPlan: solo() });
    expect([...root.querySelectorAll('.list-head span')].map((x) => x.textContent)).toEqual(['#', 'Item', 'Effort', 'Expected delivery', 'Deadline', '']);
    expect(root.querySelector('.who-cell')).toBeNull();
    const cell = (i: number) => rows(root)[i]!.querySelector('.days-cell input') as HTMLInputElement;
    expect(cell(0).value).toBe('3');
    expect(cell(1).value).toBe(''); // no effort yet: an empty field, not "+ who"
    await type(cell(1), '2');
    expect(root.querySelector('.bars[data-item="review"] .bar')).not.toBeNull(); // scheduled for the one person
    await type(cell(0), '4.5');
    expect(root.querySelector('.bars[data-item="draft"] .bar')).not.toBeNull();
    expect([...rows(root)].map((r) => r.querySelector('.days-cell .unit')!.textContent!.trim())).toEqual(['days', 'days']);
    const last = changes.at(-1) as { items: { id: string; work: { lane: string; days: number }[] }[] };
    expect(last.items.map((i) => i.work[0]?.days)).toEqual([4.5, 2]);
    expect(last.items[1]!.work[0]!.lane).toBe('me');
    // the empty row takes a number too: it becomes an item for that person
    await type(root.querySelector('.row.draft .days-cell input') as HTMLInputElement, '1');
    expect(rows(root)).toHaveLength(3);
    expect((rows(root)[2]!.querySelector('.days-cell input') as HTMLInputElement).value).toBe('1');
    expect(rows(root)[2]!.querySelector('.days-cell .unit')!.textContent!.trim()).toBe('day'); // one day, not "1 days"
  });

  it('gives way to the who cell as soon as a second person or a team is in the plan', async () => {
    const plan = validatePlan({ start: today, lanes: ['Me', 'Kim'], items: [{ name: 'Draft', who: 'Me', days: 3 }] }, { today }).plan;
    const { root } = mount({ initialPlan: plan });
    expect(root.querySelector('.days-cell')).toBeNull();
    expect(rows(root)[0]!.querySelector('.who-cell')!.textContent).toMatch(/Me\s*3d/);
    const team = validatePlan({ start: today, lanes: [{ name: 'Devs', size: 3 }], items: [{ name: 'Draft', who: 'Devs', days: 3 }] }, { today }).plan;
    document.body.innerHTML = '';
    expect(mount({ initialPlan: team }).root.querySelector('.days-cell')).toBeNull(); // a team needs "at once" too: the editor
  });
});

describe('phones', () => {
  it('keeps every field at 16px on iOS, so focusing one never zooms the page', () => {
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const block = /@supports \(-webkit-touch-callout: none\) \{([^}]*)\}/.exec(css)![1]!.replace(/\s+/g, ' ').trim();
    expect(block).toBe('input, select, textarea, .cell-input, .title-input, .days-cell input, .date-btn input, .ip-input, .ip-select { font-size: 16px;');
    expect(css).toMatch(/button, input, select, textarea \{[^}]*touch-action: manipulation/); // no double-tap zoom delay on controls
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/maximum-scale|user-scalable/); // pinch zoom stays available
  });
});

describe('hand-offs in the who editor', () => {
  const openWho = async (root: Element, name: string) => {
    const row = rows(root).find((r) => (r.querySelector('.cell-input') as HTMLInputElement).value === name)!;
    await act(() => (row.querySelector('.who-cell') as HTMLButtonElement).click());
    return document.querySelector('.popover.who-pop')!;
  };
  const choose = (pop: Element, who: string, after: string) =>
    act(() => {
      const sel = pop.querySelector(`select[aria-label="${who}: starts"]`) as HTMLSelectElement;
      sel.value = after;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  const afters = (plan: { items: { id: string; work: { lane: string; after?: string }[] }[] }, id: string) => Object.fromEntries(plan.items.find((i) => i.id === id)!.work.map((w) => [w.lane, w.after ?? '']));

  it('the newest choice wins: "Martin after Sara" frees Sara, who waited for Martin', async () => {
    const { root, changes } = mount();
    const pop = await openWho(root, 'Revise Lumen proposal'); // Martin 1d, then Sara 3d after Martin
    expect((pop.querySelector('select[aria-label="Sara: starts"]') as HTMLSelectElement).value).toBe('martin');
    await choose(pop, 'Martin', 'sara');
    expect(afters(changes.at(-1) as never, 'revise-lumen-proposal')).toEqual({ martin: 'sara', sara: '' });
    expect((document.querySelector('select[aria-label="Sara: starts"]') as HTMLSelectElement).value).toBe('');
    expect((document.querySelector('select[aria-label="Martin: starts"]') as HTMLSelectElement).value).toBe('sara');
  });

  it('with three people, the link that would close the loop is the one that goes', async () => {
    const plan = validatePlan(
      { start: today, lanes: ['Ana', 'Ben', 'Cy'], items: [{ name: 'Relay', work: [{ lane: 'Ana', days: 2 }, { lane: 'Ben', days: 2, after: 'Ana' }, { lane: 'Cy', days: 2, after: 'Ben' }] }] },
      { today },
    ).plan;
    const { root, changes } = mount({ initialPlan: plan });
    const pop = await openWho(root, 'Relay');
    await choose(pop, 'Ana', 'cy'); // Ana after Cy, while Cy waits for Ben, who waits for Ana
    expect(afters(changes.at(-1) as never, 'relay')).toEqual({ ana: 'cy', ben: '', cy: 'ben' }); // Ben starts right away; the others keep their choice
  });

  it("a team's people-at-once column says what it is and never exceeds the team", async () => {
    const squads = validatePlan(SAMPLES[1]!.build(today), { today }).plan;
    const { root, changes } = mount({ initialPlan: squads });
    const pop = await openWho(root, 'Subscriptions MVP'); // Back-end is a team of 3; Front-end a team of 2
    expect([...pop.querySelectorAll('.who-head .col-h')].map((c) => c.textContent)).toEqual(['Days', 'People', 'Starts']);
    expect([...pop.querySelectorAll('.at-once .of')].map((e) => e.textContent)).toEqual(['of 3', 'of 2']);
    const input = pop.querySelector('[aria-label="Back-end: people at once"]') as HTMLInputElement;
    expect(input.getAttribute('max')).toBe('3');
    input.value = '7';
    await act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
    const last = changes.at(-1) as { items: { id: string; work: { lane: string; maxPeople: number }[] }[] };
    expect(last.items.find((i) => i.id === 'subscriptions-mvp')!.work.find((w) => w.lane === 'back-end')!.maxPeople).toBe(3);
  });
});

describe('the chart leaves room for the last finish label, and the tips fold away', () => {
  it('a month too narrow for its name keeps its initial, so a year at a pixel a day still reads', () => {
    const long = validatePlan({ start: today, lanes: ['Sara'], items: [{ name: 'Big', who: 'Sara', days: 240 }] }, { today }).plan;
    const { root } = mount({ initialPlan: long, initialZoom: 'month' }); // 4 px a day: ~120 px months, full names
    expect([...root.querySelectorAll('.months .month')].slice(0, 2).map((m) => m.textContent)).toEqual(['Oct', 'Nov']);
    const months = [...root.querySelectorAll('.months .month')] as HTMLElement[];
    expect(months.slice(0, 6).every((m) => parseFloat(m.style.width) >= 34)).toBe(true); // (the last block can be a sliver: the calendar ends mid-month)
  });

  it('the calendar runs on past the last day by the label room (scale and timeline are one width), so the last date never scrolls', () => {
    const { root } = mount();
    const w = (sel: string) => parseFloat((root.querySelector(sel) as HTMLElement).style.width);
    expect(w('.timeline')).toBe(w('.tl-head'));
    const last = [...root.querySelectorAll('.months .month')].at(-1) as HTMLElement;
    expect(parseFloat(last.style.left) + parseFloat(last.style.width)).toBe(w('.tl-head')); // the month blocks fill the width
  });

  it('names the year where it changes (January), not on every month of it', () => {
    const long = validatePlan({ start: '2026-11-09', lanes: ['Sara'], items: [{ name: 'Big', who: 'Sara', days: 120 }] }, { today: '2026-11-09' }).plan;
    const { root } = mount({ initialPlan: long, initialZoom: 'month' });
    expect([...root.querySelectorAll('.months .month')].slice(0, 5).map((m) => m.textContent)).toEqual(['Nov', 'Dec', 'Jan 2027', 'Feb', 'Mar']);
  });

  it('month blocks label themselves for the width they have', () => {
    expect(monthLabel(120, 'Jan', 2027)).toBe('Jan 2027');
    expect(monthLabel(60, 'Jan', 2027)).toBe('Jan ’27');
    expect(monthLabel(30, 'Jan', 2027)).toBe('’27'); // after a December, the year says more than the name
    expect(monthLabel(30, 'Nov', null)).toBe('Nov');
    expect(monthLabel(20, 'Nov', null)).toBe('N');
    expect(monthLabel(8, 'Nov', null)).toBe('');
  });

  it('shows the tips on a first visit and hides them behind "Tips" otherwise', async () => {
    const { root } = mount();
    expect(root.querySelector('.legend-tips')).toBeNull();
    await act(() => ([...root.querySelectorAll('.legend button')].find((b) => b.textContent === 'Tips') as HTMLButtonElement).click());
    expect(root.querySelector('.legend-tips')!.textContent).toMatch(/hover an option to preview it/);
    document.body.innerHTML = '';
    const first = mount({ intro: true });
    expect(first.root.querySelector('.legend-tips')).not.toBeNull();
    expect([...first.root.querySelectorAll('.legend button')].map((b) => b.textContent)).toContain('Hide tips');
  });
});

describe('Enter in effort, the who cell, the item cap, the export menu, the image', () => {
  const solo = () => validatePlan({ start: today, lanes: ['Me'], items: [{ name: 'Draft', who: 'Me', days: 3 }, { name: 'Review', who: 'Me', days: 2 }] }, { today }).plan;

  it('Enter in an effort cell goes to the next row, then to the empty row, like Enter in a name', async () => {
    const { root } = mount({ initialPlan: solo() });
    const cells = () => [...root.querySelectorAll('.row .days-cell input')] as HTMLInputElement[];
    cells()[0]!.focus();
    await act(() => void cells()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(document.activeElement).toBe(cells()[1]);
    await act(() => void cells()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(document.activeElement).toBe(root.querySelector('.row.draft .days-cell input'));
  });

  it("the who cell always shows everyone's avatar, the name for one person, and the days as a pill", () => {
    const { root } = mount();
    const cell = (id: string) => root.querySelector(`.row[data-item="${id}"] .who-cell`)!;
    const one = cell('appeal-for-northwind');
    expect(one.querySelectorAll('.avatar')).toHaveLength(1);
    expect(one.querySelector('.who-name')!.textContent).toBe('Sara');
    expect(one.querySelector('.who-days')!.textContent).toBe('4d');
    const two = cell('revise-lumen-proposal'); // Martin 1d, then Sara 3d
    expect(two.querySelectorAll('.who-people.who-stack .avatar')).toHaveLength(2); // both, always
    expect(two.querySelector('.who-name')).toBeNull();
    expect(two.querySelector('.who-handoff')).not.toBeNull();
    expect(two.querySelector('.who-days')!.textContent).toBe('4d'); // everyone's days together
    expect(two.getAttribute('title')).toMatch(/Martin 1d \+ Sara 3d after Martin/); // the whole story on hover
  });

  it('a plan holds 40 items: the empty row then says so, and nothing more is created', async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ name: `Item ${i + 1}`, who: 'Me', days: 1 }));
    const { root } = mount({ initialPlan: validatePlan({ start: today, lanes: ['Me'], items }, { today }).plan });
    expect(rows(root)).toHaveLength(40);
    expect(root.querySelector('.row.draft.full .full-note')!.textContent).toMatch(/This plan is full \(40 items\)/);
    expect(root.querySelector('.row.draft .cell-input')).toBeNull();
    const v = validatePlan({ lanes: ['Me'], items: [...items, { name: 'One more', who: 'Me', days: 1 }] }, { today });
    expect(v.plan.items).toHaveLength(40);
    expect(v.errors.map((e) => e.message)).toEqual(['only the first 40 items are used: bigger work is several plans']);
  });

  it('the image export carries the list columns, the key and the today line', async () => {
    const { buildExport } = await import('../../src/ui/exporters');
    const svg = (await buildExport('svg', sample(), 'planned', false, 'fit', today)).data as string;
    for (const t of ['>Item<', '>Effort<', '>Expected delivery<', '>Deadline<', 'deadline: on time, tight, late', 'past its deadline', '>today<', 'Sara 1d']) expect(svg, t).toContain(t);
    expect(svg).toMatch(/<pattern id="late"/); // the part of a bar past its deadline is hatched, as on screen
    expect(svg).toMatch(/stroke="#4f46e5" stroke-width="2"/); // the today line
  });
});

describe('the calendar, scrolling while dragging, dates on demand, the column order', () => {
  const dueBtn = (root: Element, id: string) => root.querySelector(`.row[data-item="${id}"] .due-cell .date-btn`) as HTMLElement;
  const day = (pop: Element, n: string) => [...pop.querySelectorAll('.cal-day')].find((b) => b.textContent === n && !b.classList.contains('out')) as HTMLButtonElement;

  it('a deadline opens our own calendar: pick a day, type one, clear it; a click elsewhere closes it', async () => {
    const { root, changes } = mount();
    const id = 'appeal-for-northwind'; // due 14 Oct
    const deadline = () => (changes.at(-1) as { items: { id: string; deadline?: string }[] }).items.find((i) => i.id === id)!.deadline;
    await act(() => dueBtn(root, id).click());
    let pop = document.querySelector('.popover.date-pop')!;
    expect(pop.querySelectorAll('.cal-day')).toHaveLength(42);
    expect(pop.querySelector('.cal-head b')!.textContent).toBe('Oct 2026');
    expect(pop.querySelector('.cal-day.sel')!.textContent).toBe('14');
    expect(document.activeElement).toBe(pop.querySelector('.cal-day.sel')); // the chosen day has the focus: arrows move from it
    expect(root.querySelector('.row.sel')).toBeNull(); // opening it doesn't select the row
    await act(() => day(pop, '20').click());
    expect(deadline()).toBe('2026-10-20');
    expect(document.querySelector('.popover.date-pop')).toBeNull(); // picked: closed
    // a click anywhere else closes it (the chart included)
    await act(() => dueBtn(root, id).click());
    expect(document.querySelector('.popover.date-pop')).not.toBeNull();
    await act(() => void root.querySelector('.timeline')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(document.querySelector('.popover.date-pop')).toBeNull();
    // typed
    await act(() => dueBtn(root, id).click());
    pop = document.querySelector('.popover.date-pop')!;
    const text = pop.querySelector('.cal-text') as HTMLInputElement;
    text.value = 'not a date';
    await act(() => void text.dispatchEvent(new Event('input', { bubbles: true })));
    await act(() => void pop.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(text.classList.contains('bad')).toBe(true);
    text.value = '7 Nov';
    await act(() => void text.dispatchEvent(new Event('input', { bubbles: true })));
    await act(() => void pop.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(deadline()).toBe('2026-11-07');
    // next month, and clearing
    await act(() => dueBtn(root, id).click());
    pop = document.querySelector('.popover.date-pop')!;
    await act(() => (pop.querySelector('[aria-label="Next month"]') as HTMLButtonElement).click());
    expect(pop.querySelector('.cal-head b')!.textContent).toBe('Dec 2026');
    await act(() => ([...pop.querySelectorAll('button')].find((b) => b.textContent === 'Clear') as HTMLButtonElement).click());
    expect(deadline()).toBeUndefined();
    expect(dueBtn(root, id).textContent).toBe('+ date');
  });

  it('the page scrolls while a row is dragged near an edge, only while rows are out of sight that way', async () => {
    expect(autoScrollSpeed(300, 100, 700)).toBe(0); // clear of both edges
    expect(autoScrollSpeed(130, 100, 700)).toBeLessThan(0);
    expect(autoScrollSpeed(101, 100, 700)).toBe(-22); // fastest at the edge
    expect(autoScrollSpeed(690, 100, 700)).toBeGreaterThan(0);
    const { root } = mount();
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const rect = (el: Element, r: Partial<DOMRect>) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r as DOMRect);
    rect(root.querySelector('.board-head')!, { top: 40, bottom: 100 });
    const rowsRect = rect(root.querySelector('.list .rows')!, { top: -200, bottom: 600 });
    const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    ptr('pointerdown', root.querySelector('.row [data-handle]')!, 10, 300);
    ptr('pointermove', document.body, 10, 120); // under the chart's header: rows above are out of sight
    await frame();
    await frame();
    expect(scrollBy).toHaveBeenCalled();
    expect(scrollBy.mock.calls[0]).toEqual([{ top: -22, behavior: 'instant' }]); // at once, whatever the page's scroll behaviour
    scrollBy.mockClear();
    rowsRect.mockReturnValue({ top: 100, bottom: 600 } as DOMRect); // the first row is in view now: nothing left to reveal
    await frame();
    await frame();
    expect(scrollBy).not.toHaveBeenCalled();
    ptr('pointerup', document.body, 10, 120);
    scrollBy.mockRestore();
  });

  it('the finish date beside a bar says "ends", and shows on demand; the columns put the result next to the effort', () => {
    const { root } = mount();
    const tag = root.querySelector('.bars[data-item="appeal-for-northwind"] .end-tag')!;
    expect(tag.textContent).toBe('ends 9 Oct');
    expect(tag.classList.contains('live')).toBe(false);
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\n\.end-tag \{[^}]*opacity: 0;/);
    expect(css).toMatch(/\n\.bars\[data-hover\] \.end-tag, \.bars\.sel \.end-tag, \.bars\.dragging \.end-tag, \.end-tag\.live \{ opacity: 1; \}/);
    // a date that is changing (a live resize) shows its tag with the difference
    const edge = root.querySelector('.bars[data-item="appeal-for-northwind"] .bar-edge')!;
    ptr('pointerdown', edge, 300);
    ptr('pointermove', document.body, 300 + 26 * 7);
    expect(root.querySelector('.bars[data-item="appeal-for-northwind"] .end-tag.live .delta')!.textContent).toMatch(/^\+\d+d$/);
    ptr('pointerup', document.body, 300 + 26 * 7);
    // Effort → Expected delivery → Deadline
    const cells = [...rows(root)[1]!.children].map((c) => c.className.split(' ')[0]);
    expect(cells.indexOf('status')).toBe(cells.indexOf('who-cell') + 1);
    expect(cells.indexOf('due-cell')).toBe(cells.indexOf('status') + 1);
  });
});

describe('quiet notes, grid lines, readable labels, the calendar everywhere', () => {
  it('typing a note (or the plan name) re-checks nothing: the Apply buttons stay live; an effort change does pause them', async () => {
    const { root } = mount();
    await settle();
    const apply = () => root.querySelector('.option .btn') as HTMLButtonElement;
    expect(apply().disabled).toBe(false);
    await act(() => (rows(root)[0]!.querySelector('.cell-input') as HTMLInputElement).click());
    const note = root.querySelector('.item-panel .ip-input') as HTMLInputElement;
    note.value = 'call them';
    await act(() => void note.dispatchEvent(new Event('input', { bubbles: true })));
    expect(apply().disabled).toBe(false); // a note changes no date
    const title = root.querySelector('.title-input') as HTMLInputElement;
    title.value = 'Renamed';
    await act(() => void title.dispatchEvent(new Event('input', { bubbles: true })));
    expect(apply().disabled).toBe(false);
    const edge = root.querySelector('.bars[data-item="appeal-for-northwind"] .bar-edge')!;
    ptr('pointerdown', edge, 300);
    ptr('pointermove', document.body, 300 + 26 * 7);
    ptr('pointerup', document.body, 300 + 26 * 7);
    expect(apply().disabled).toBe(true); // the plan changed: suggestions are being re-measured
    await settle();
    expect(apply().disabled).toBe(false);
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\ninput::placeholder, textarea::placeholder \{ color: var\(--fg3\); opacity: 1; \}/); // a placeholder never looks typed
  });

  it('every third row carries a line across the list and the chart', () => {
    const { root } = mount(); // 7 items
    expect([...root.querySelectorAll('.timeline .hline')].map((l) => (l as HTMLElement).style.top)).toEqual([`${3 * ROW - 1}px`, `${6 * ROW - 1}px`]);
    expect(rows(root).map((r) => r.classList.contains('g3'))).toEqual([false, false, true, false, false, true, false]);
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\n\.row\.g3 \{ border-bottom-color: var\(--border2\); \}/);
  });

  it('the date label stays readable: past a deadline diamond within its width, above the diamond and the today line, clear of a bar being resized', () => {
    const { root } = mount();
    const left = (el: Element | null) => parseFloat((el as HTMLElement).style.left);
    // Northwind ends 9 Oct, due 14 Oct: the diamond is clear of the label's stretch, so the label sits right after the bar
    const bars = root.querySelector('.bars[data-item="appeal-for-northwind"]')!;
    expect(left(bars.querySelector('.end-tag'))).toBeLessThan(left(bars.querySelector('.deadline')) - 96);
    // due 12 Oct instead: the diamond would sit under the label's text, so the label goes past it
    const due = root.querySelector('.row[data-item="appeal-for-northwind"] .due-cell input[type="date"]') as HTMLInputElement;
    due.value = '2026-10-12';
    act(() => void due.dispatchEvent(new Event('change', { bubbles: true })));
    expect(left(bars.querySelector('.end-tag'))).toBe(left(bars.querySelector('.deadline')) + 10);
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\n\.end-tag \{[^}]*z-index: 4;[^}]*background: color-mix\(in srgb, var\(--bg\) 86%, transparent\);/);
    // resizing: the bar follows the pointer ahead of the half-day plan; the label keeps clear of the drawn bar
    const bar = () => root.querySelector('.bars[data-item="quick-fix-for-acme"] .bar') as HTMLElement;
    ptr('pointerdown', bar().querySelector('.bar-edge')!, 300);
    ptr('pointermove', document.body, 300 + 11); // not yet half a day more: the plan hasn't moved, the bar has
    const barRight = left(bar()) + parseFloat(bar().style.width);
    expect(left(root.querySelector('.bars[data-item="quick-fix-for-acme"] .end-tag'))).toBeGreaterThanOrEqual(barRight + 8);
    ptr('pointerup', document.body, 300 + 11);
  });

  it('a row dropped under the chart header is shown whole at once (a page still gliding would put the next press on the wrong row)', async () => {
    const { root } = mount();
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const rect = (el: Element, r: Partial<DOMRect>) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r as DOMRect);
    rect(root.querySelector('.board-head')!, { top: 40, bottom: 100 });
    rect(root.querySelector('.list .rows')!, { top: 100, bottom: 600 });
    const row = rows(root)[2]!;
    rect(row, { top: 78, bottom: 122 }); // its top 22 px under the header when it lands
    ptr('pointerdown', row.querySelector('[data-handle]')!, 10, 300);
    ptr('pointermove', document.body, 10, 300 - 2 * ROW);
    ptr('pointerup', document.body, 10, 300 - 2 * ROW);
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 78 - 100, behavior: 'instant' });
    scrollBy.mockRestore();
  });

  it("the calendar marks today with its own class, never scrolls, and serves the holidays editor too; Escape closes only the calendar", async () => {
    const { root } = mount();
    await act(() => (root.querySelector('.row.draft .due-cell .date-btn') as HTMLElement).click()); // no date yet: it opens on this month
    let cal = document.querySelector('.popover.date-pop') as HTMLElement;
    expect(cal.querySelector('.cal-day.is-today')!.textContent).toBe(String(dayParts(todayLocal()).day));
    expect(cal.querySelector('.today')).toBeNull(); // ".today" is the chart's today line: on a calendar cell it drew a stray line and number
    expect(cal.style.maxHeight).toBe('none'); // it moves to fit; it never scrolls inside
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.popover.date-pop')).toBeNull();
    // holidays: the same calendar, without Clear; picking a day keeps the editor open
    await act(() => ([...root.querySelectorAll('.setup .chip')].find((b) => b.textContent === '+ holidays') as HTMLButtonElement).click());
    const editor = document.querySelector('.popover.holiday-pop')!;
    expect(editor.querySelector('input[type="date"]')!.closest('.date-btn.date-box')).not.toBeNull();
    await act(() => (editor.querySelector('.date-btn') as HTMLElement).click());
    cal = document.querySelector('.popover.date-pop') as HTMLElement;
    expect([...cal.querySelectorAll('button')].some((b) => b.textContent === 'Clear')).toBe(false);
    const twelve = [...cal.querySelectorAll('.cal-day')].find((b) => b.textContent === '12' && !b.classList.contains('out')) as HTMLButtonElement;
    await act(() => void twelve.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); // a press inside the calendar is not a press outside the editor
    expect(document.querySelector('.popover.holiday-pop')).not.toBeNull();
    await act(() => twelve.click());
    expect(document.querySelector('.popover.date-pop')).toBeNull();
    expect(document.querySelector('.popover.holiday-pop .date-btn')!.textContent).toMatch(/^12 [A-Z][a-z]{2}/);
    // with the calendar open again, Escape closes it and leaves the editor
    await act(() => (document.querySelector('.popover.holiday-pop .date-btn') as HTMLElement).click());
    await act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.popover.date-pop')).toBeNull();
    expect(document.querySelector('.popover.holiday-pop')).not.toBeNull();
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\n\.date-pop \{ width: 218px;/); // about a seventh smaller than it was
  });
});
