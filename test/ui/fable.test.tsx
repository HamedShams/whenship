// @vitest-environment happy-dom
// FABLE edition: the options rail with previews, the docked details, dragging edges and diamonds, done items, fit zoom,
// a steady chart while dragging, and effort as a number for one-person plans.
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type Host } from '../../src/ui/App';
import { monthLabel, pixelsPerDay, ROW } from '../../src/ui/Board';
import { validatePlan } from '../../src/engine';
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
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
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
    expect(root.querySelector('.board-wrap + .options, .board-wrap + .details-dock + .options')).not.toBeNull();
    const card = root.querySelector('.option')!;
    expect(card.textContent).toMatch(/Quick fix for Acme/);
    act(() => void card.dispatchEvent(new PointerEvent('pointerenter')));
    expect(root.querySelector('.bar.ghost')).toBeNull(); // not yet: a quick pass over the rail changes nothing
    await act(() => new Promise((r) => setTimeout(r, 320)));
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
    const { root } = mount({
      claudeOptions: [
        { title: 'Appeal first', changes: [{ op: 'move', item: 'Appeal for Northwind', to: 0 }] },
        { title: 'A later Kestrel date', changes: [{ op: 'setDeadline', item: 'Appeal for Kestrel', date: '2026-12-01' }] },
      ],
    });
    await settle();
    const kinds = [...root.querySelectorAll('.option .opt-kind')].map((k) => k.textContent!.trim());
    expect(root.querySelectorAll('.option')).toHaveLength(3);
    expect(kinds.slice(0, 2)).toEqual(["Claude's option", "Claude's option"]);
    expect(kinds[2]).not.toBe("Claude's option"); // the engine's best one stays
  });
});

describe('the details dock', () => {
  it('opens under the chart when a row is clicked; no row moves and nothing covers the chart; Esc closes it', async () => {
    const { root } = mount();
    const r = rows(root);
    const barsOf = (id: string) => root.querySelector(`.bars[data-item="${id}"]`) as HTMLElement;
    await act(() => (r[2]!.querySelector('.status') as HTMLElement).click());
    const dock = root.querySelector('.board-wrap + .details-dock')!;
    expect(dock.querySelector('h3')!.textContent).toBe('Research for Brightside');
    expect(dock.querySelector('.dock-body')!.children).toHaveLength(2); // why · settings, side by side; the facts are one line above
    expect(dock.querySelector('.insp-meta')!.textContent).toMatch(/Finish.*chance on time.*Due .*Sara 5d.*→/);
    const css = readFileSync('src/ui/styles.css', 'utf8');
    expect(css).toMatch(/\n\.details-dock \{ position: sticky; bottom: var\(--safe-bottom, 0px\); z-index: 25;/); // sticks to the window's bottom while the chart is in view
    expect(r[3]!.style.top).toBe(`${3 * ROW}px`); // the rows below stay where they were
    expect(barsOf(r[3]!.dataset.item!).style.top).toBe(r[3]!.style.top);
    expect((root.querySelector('.row.sel') as HTMLElement).dataset.item).toBe('research-for-brightside');
    expect((root.querySelector('.bars.sel') as HTMLElement).dataset.item).toBe('research-for-brightside');
    expect(root.querySelector('aside.details, .row-details-slot, .details-gap')).toBeNull();
    await act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(root.querySelector('.details-dock')).toBeNull();
  });

  it('marks an item done from its details: it leaves the schedule, and comes back', async () => {
    const { root } = mount();
    await act(() => (rows(root)[0]!.querySelector('.status') as HTMLElement).click());
    await act(() => ([...root.querySelectorAll('.details-dock button')].find((b) => b.textContent?.includes('Mark done')) as HTMLButtonElement).click());
    expect(rows(root)[0]!.classList.contains('done')).toBe(true);
    expect(rows(root)[0]!.querySelector('.pill.done')!.textContent).toBe('done');
    expect(root.querySelector('.bars.done .done-bar')).not.toBeNull();
    // the state is a badge, the way back is a button that says what it does
    expect(root.querySelector('.details-dock .insp-head .pill.done')!.textContent).toBe('done');
    const reopen = [...root.querySelectorAll('.details-dock button')].find((b) => b.textContent?.includes('Reopen')) as HTMLButtonElement;
    expect(reopen.getAttribute('aria-pressed')).toBe('true');
    await act(() => reopen.click());
    expect(rows(root)[0]!.classList.contains('done')).toBe(false);
    expect(root.querySelector('.details-dock .insp-head .pill.done')).toBeNull();
  });
});

describe('dragging a bar edge and a deadline diamond', () => {
  it("dragging a bar's right edge changes that part's effort, half a day at a time, and the row shows it", async () => {
    const { root, changes } = mount();
    const edge = root.querySelector('.bars[data-item="appeal-for-northwind"] .bar-edge')!;
    const e = ptr('pointerdown', edge, 300);
    expect(e.defaultPrevented).toBe(true);
    expect(root.querySelector('.board-wrap')!.classList.contains('is-resizing')).toBe(true);
    ptr('pointermove', document.body, 300 + 26 * 7); // a calendar week to the right ≈ 5 working days
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
    expect([...root.querySelectorAll('.list-head span')].map((x) => x.textContent)).toEqual(['#', 'Item', 'Effort', 'Due', 'Finish', '']);
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
    expect(block).toBe('input, select, textarea, .cell-input, .title-input, .days-cell input, .date-btn input { font-size: 16px;');
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
    expect(months.every((m) => parseFloat(m.style.width) >= 34)).toBe(true);
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
