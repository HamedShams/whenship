import { describe, expect, it } from 'vitest';
import { applyChanges, findInsights, renderReport, schedule } from '../../src/engine';
import { plan, rng } from '../helpers';

describe('insights', () => {
  it('finds the reorder that rescues a late deadline', () => {
    const p = plan({
      lanes: ['Sara'],
      items: [
        { name: 'Nice to have', who: 'Sara', days: 5 },
        { name: 'Urgent', who: 'Sara', days: 2, deadline: '2026-09-28', value: 50000 },
      ],
    });
    expect(schedule(p).byId.get('urgent')!.late).toBe(true);
    const tips = findInsights(p);
    expect(tips[0]).toMatchObject({ kind: 'reorder', title: 'Move "Urgent" to the top' });
    expect(tips[0]!.deltas.met).toBe(1);
    expect(tips[0]!.effect).toMatch(/1 more deadline met \(Urgent\)/);
    // applying it really fixes it
    expect(schedule(applyChanges(p, tips[0]!.changes).plan).byId.get('urgent')!.late).toBe(false);
  });

  it('suggests adding capacity for a squad and quantifies it', () => {
    const p = plan({
      lanes: [{ name: 'Backend', size: 2 }],
      items: [
        { name: 'Payments', work: [{ lane: 'Backend', days: 10, maxPeople: 2 }], deadline: '2026-10-02' },
        { name: 'Search', work: [{ lane: 'Backend', days: 6, maxPeople: 1 }], deadline: '2026-10-02' },
      ],
    });
    const tips = findInsights(p);
    const add = tips.find((t) => t.kind === 'add-person');
    expect(add).toBeDefined();
    expect(add!.title).toBe('+1 Backend');
    expect(add!.deltas.met).toBeGreaterThanOrEqual(1);
  });

  it('prefers free moves over hiring when both help equally', () => {
    const p = plan({
      lanes: ['Sara'],
      items: [
        { name: 'Undated', who: 'Sara', days: 4 },
        { name: 'Dated', who: 'Sara', days: 2, deadline: '2026-09-25' },
      ],
    });
    const kinds = findInsights(p).map((t) => t.kind);
    expect(kinds[0]).not.toBe('add-person');
    expect(kinds.indexOf('add-person')).toBeGreaterThan(0);
  });

  it('stays quiet when every deadline is safe', () => {
    const p = plan({ lanes: ['Sara'], items: [{ name: 'A', who: 'Sara', days: 1, deadline: '2026-12-01' }] });
    expect(findInsights(p)).toEqual([]);
  });

  it('never proposes something that loses deadlines overall', () => {
    const p = plan({
      lanes: ['Sara', 'Omar'],
      items: [
        { name: 'A', who: 'Sara', days: 3, deadline: '2026-09-29' },
        { name: 'B', who: 'Sara', days: 3, deadline: '2026-10-01' },
        { name: 'C', who: 'Omar', days: 2, deadline: '2026-09-25' },
        { name: 'D', who: 'Sara', days: 2, deadline: '2026-09-28' },
      ],
    });
    for (const t of findInsights(p, 'planned', 10)) expect(t.deltas.met).toBeGreaterThanOrEqual(0);
  });
});

describe('report', () => {
  it('is complete in text: headline, assumptions, table, reasons, options', () => {
    const p = plan({
      title: 'Grant season',
      currency: '€',
      calendar: { workdays: ['sat', 'sun', 'mon', 'tue', 'wed'] },
      lanes: ['Sara', { name: 'Omar', availability: 50 }],
      items: [
        { name: 'Appeal', who: 'Sara', days: 4, deadline: '2026-10-01', value: 20000 },
        { name: 'Research', work: [{ lane: 'Omar', days: 1 }, { lane: 'Sara', days: 5, after: 'Omar' }], deadline: '2026-10-04', value: 85000 },
      ],
    });
    const md = renderReport(p, { method: true });
    expect(md).toMatch(/^## Grant season/);
    expect(md).toMatch(/off on Thu & Fri/);
    expect(md).toMatch(/\| 2 \| Research \| Omar 1d \+ Sara 5d after Omar \|/);
    expect(md).toMatch(/What sets the end date:/);
    expect(md).toMatch(/Little 2006 \+ Flyvbjerg et al\. 2022/);
  });
});

describe('large plans', () => {
  // 200 items, 5 teams, 60% dated: the size limit for suggestions.
  const big = (n: number) => {
    const r = rng(7);
    const lanes = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, size: 1 + Math.floor(r() * 3), availability: 60 + Math.floor(r() * 40) }));
    const items = Array.from({ length: n }, (_, i) => ({
      name: `Item ${i}`,
      work: [{ lane: lanes[Math.floor(r() * 5)]!.name, days: 1 + Math.floor(r() * 8) }],
      ...(r() < 0.6 ? { deadline: `2026-${10 + Math.floor(r() * 3)}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}` } : {}),
    }));
    return plan({ start: '2026-10-05', lanes, items });
  };

  it('schedules and explains 200 items with many small blockers without crashing', () => {
    const p = big(200);
    const s = schedule(p);
    expect(s.items.every((r) => r.status === 'scheduled')).toBe(true);
    expect(s.items.filter((r) => r.driver?.kind === 'capacity').every((r) => typeof r.driver!.item === 'string')).toBe(true);
  });

  it('finds suggestions for 200 items fast enough for a live UI', () => {
    const p = big(200);
    const t0 = performance.now();
    const tips = findInsights(p);
    const ms = performance.now() - t0;
    expect(tips.length).toBeGreaterThan(0);
    for (const t of tips) expect(t.deltas.met).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(1500); // typically ~0.3 s on a laptop; generous for CI
  });
});
