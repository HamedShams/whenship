// @vitest-environment happy-dom
// FABLE edition: the options rail with previews, details in place, dragging edges and diamonds, done items, fit zoom.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type Host } from '../../src/ui/App';
import { pixelsPerDay } from '../../src/ui/Board';
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
  act(() => render(<App host={h} initialPlan={sample()} today={today} {...extra} />, root));
  return { root, changes };
}
const settle = () => act(() => new Promise((r) => setTimeout(r, 250)));
const ptr = (type: string, el: EventTarget, x: number, y = 20) => {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
  act(() => void el.dispatchEvent(e));
  return e;
};
const names = (root: Element) => [...root.querySelectorAll('.row:not(.draft) .cell-input')].map((i) => (i as HTMLInputElement).value);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the options rail', () => {
  it('sits under the chart; hovering a card previews it as a ghost on the chart, leaving clears it', async () => {
    const { root } = mount();
    await settle();
    expect(root.querySelector('.board-wrap + .options')).not.toBeNull();
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
});

describe('details in place', () => {
  it('opens under the selected row and pushes the rows below it down, in the list and the timeline alike', async () => {
    const { root } = mount();
    const rows = [...root.querySelectorAll('.list .row:not(.draft)')] as HTMLElement[];
    const barsOf = (id: string) => root.querySelector(`.bars[data-item="${id}"]`) as HTMLElement;
    await act(() => (rows[2]!.querySelector('.status') as HTMLElement).click());
    const slot = root.querySelector('.list .row-details-slot') as HTMLElement;
    expect(slot.style.top).toBe(`${3 * 44}px`);
    expect(slot.querySelector('.row-details h3')!.textContent).toBe('Research for Brightside');
    const gap = parseFloat((root.querySelector('.details-gap') as HTMLElement).style.height);
    expect(gap).toBeGreaterThan(100);
    expect(rows[3]!.style.top).toBe(`${3 * 44 + gap}px`);
    expect(barsOf(rows[3]!.dataset.item!).style.top).toBe(rows[3]!.style.top);
    expect(rows[1]!.style.top).toBe(`${1 * 44}px`); // rows above stay put
    expect(root.querySelector('aside.details')).toBeNull(); // nothing floats over the chart
    await act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(root.querySelector('.row-details')).toBeNull();
    expect(rows[3]!.style.top).toBe(`${3 * 44}px`);
  });

  it('marks an item done from its details: it leaves the schedule, and comes back', async () => {
    const { root } = mount();
    const rows = () => [...root.querySelectorAll('.list .row:not(.draft)')] as HTMLElement[];
    await act(() => (rows()[0]!.querySelector('.status') as HTMLElement).click());
    await act(() => ([...root.querySelectorAll('.row-details button')].find((b) => b.textContent?.includes('Mark done')) as HTMLButtonElement).click());
    expect(rows()[0]!.classList.contains('done')).toBe(true);
    expect(rows()[0]!.querySelector('.pill.done')!.textContent).toBe('done');
    expect(root.querySelector('.bars.done .done-bar')).not.toBeNull();
    await act(() => ([...root.querySelectorAll('.row-details button')].find((b) => b.textContent?.trim() === 'Done') as HTMLButtonElement).click());
    expect(rows()[0]!.classList.contains('done')).toBe(false);
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
});

describe('fit zoom', () => {
  it('sizes days to the width at hand, within readable bounds, and falls back to a scale by plan length', () => {
    expect(fitPpd(30, 1300)).toBe(26); // never wider than the day scale
    expect(fitPpd(100, 1300)).toBe(13);
    expect(fitPpd(400, 1300)).toBe(6); // never narrower than this: beyond it the chart scrolls
    expect(pixelsPerDay('fit', 100, 0)).toBe(10); // unknown width: the week scale a 100-day plan reads best at
    expect(pixelsPerDay('month', 100, 1300)).toBe(4);
  });
});
