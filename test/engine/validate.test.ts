import { describe, expect, it } from 'vitest';
import { compactPlan, parseNumberish, validatePlan } from '../../src/engine';

describe('validatePlan', () => {
  it('fills sensible defaults', () => {
    const { plan, errors } = validatePlan({ items: [] }, { today: '2026-10-05' });
    expect(errors).toEqual([]);
    expect(plan.start).toBe('2026-10-05');
    expect(plan.calendar.workdays).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(plan.title).toBe('Untitled WhenShip');
  });

  it('accepts shorthand items and resolves lanes by name (any case)', () => {
    const { plan, errors, warnings } = validatePlan({
      start: '2026-09-24',
      lanes: [{ name: 'Sara' }, { name: 'Backend', size: 3, availability: '80%' }],
      items: [
        { name: 'Grant draft', who: 'sara', days: '5d' },
        { name: 'API', work: [{ lane: 'BACKEND', days: '2w', maxPeople: 2 }] },
      ],
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(plan.items[0]!.work).toEqual([{ lane: 'sara', days: 5, maxPeople: 1 }]);
    expect(plan.items[1]!.work).toEqual([{ lane: 'backend', days: 10, maxPeople: 2 }]);
    expect(plan.lanes[1]).toMatchObject({ kind: 'team', size: 3, availability: 80 });
  });

  it('creates missing people instead of failing, and says so', () => {
    const { plan, warnings } = validatePlan({ items: [{ name: 'X', work: [{ lane: 'Omar', days: 2 }] }] }, { today: '2026-10-05' });
    expect(plan.lanes.map((l) => l.name)).toEqual(['Omar']);
    expect(warnings[0]!.message).toMatch(/added "Omar"/);
  });

  it('makes ids unique and resolves dependencies by name, even forward', () => {
    const { plan } = validatePlan(
      {
        lanes: ['Me'],
        items: [
          { name: 'Launch', lane: 'Me', days: 1, dependsOn: ['Build'] },
          { name: 'Build', lane: 'Me', days: 3 },
          { name: 'Build', lane: 'Me', days: 1 },
        ],
      },
      { today: '2026-10-05' },
    );
    expect(plan.items.map((i) => i.id)).toEqual(['launch', 'build', 'build-2']);
    expect(plan.items[0]!.dependsOn).toEqual(['build']);
  });

  it('reports precise errors for unusable input', () => {
    const { errors, plan } = validatePlan(
      { start: 'tomorrow', lanes: ['Me'], items: [{ name: 'A', lane: 'Me', days: -2, deadline: 'next week' }] },
      { today: '2026-10-05' },
    );
    expect(errors.map((e) => e.path)).toEqual(['start', 'items[0].work[0].days', 'items[0].deadline']);
    expect(plan.items[0]!.work[0]!.days).toBe(0);
    expect(plan.items[0]!.deadline).toBeUndefined();
  });

  it('keeps hand-offs only when they point at another part of the same item', () => {
    const { plan, warnings } = validatePlan(
      {
        lanes: ['Sara', 'Omar'],
        items: [
          { name: 'Ok', work: [{ lane: 'Omar', days: 1 }, { lane: 'Sara', days: 5, after: 'Omar' }] },
          { name: 'Bad', work: [{ lane: 'Sara', days: 1, after: 'Omar' }] },
          { name: 'Loop', work: [{ lane: 'Sara', days: 1, after: 'Omar' }, { lane: 'Omar', days: 1, after: 'Sara' }] },
        ],
      },
      { today: '2026-10-05' },
    );
    expect(plan.items[0]!.work[1]!.after).toBe('omar');
    expect(plan.items[1]!.work[0]!.after).toBeUndefined();
    expect(plan.items[2]!.work.filter((w) => w.after).length).toBe(1);
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('parses working days and holidays loosely', () => {
    const { plan } = validatePlan(
      { calendar: { workdays: ['Sat', 'sunday', 'Mo', 'tu', 'Wed'], holidays: ['2026-10-03', { from: '2026-12-31', to: '2026-12-24', label: 'Break' }] }, items: [] },
      { today: '2026-10-05' },
    );
    expect(plan.calendar.workdays).toEqual(['mon', 'tue', 'wed', 'sat', 'sun']);
    expect(plan.calendar.holidays).toEqual([
      { from: '2026-10-03', to: '2026-10-03' },
      { from: '2026-12-24', to: '2026-12-31', label: 'Break' },
    ]);
  });

  it('compactPlan round-trips', () => {
    const { plan } = validatePlan(
      {
        title: 'Q4',
        start: '2026-09-24',
        calendar: { workdays: ['sat', 'sun', 'mon', 'tue', 'wed'] },
        lanes: [{ name: 'Sara', availability: 50 }, { name: 'Dev', size: 3 }],
        items: [{ name: 'A', work: [{ lane: 'Dev', days: 4, maxPeople: 2 }], deadline: '2026-10-07', value: 1000 }],
      },
      { today: '2026-10-05' },
    );
    const again = validatePlan(compactPlan(plan));
    expect(again.errors).toEqual([]);
    expect(again.warnings).toEqual([]);
    expect(again.plan).toEqual(plan);
  });
});

describe('parseNumberish', () => {
  it('reads efforts in days, weeks and hours', () => {
    expect(parseNumberish('5d')).toBe(5);
    expect(parseNumberish('2w')).toBe(10);
    expect(parseNumberish('[Pend] 6 Days')).toBe(6);
    expect(parseNumberish('2,5 days')).toBe(2.5);
    expect(parseNumberish('4h')).toBe(0.5);
  });
  it('reads money with thousands separators in either style', () => {
    expect(parseNumberish('€85,000', 'money')).toBe(85000);
    expect(parseNumberish('85.000 €', 'money')).toBe(85000);
    expect(parseNumberish('$1,234,567.50', 'money')).toBe(1234567.5);
    expect(parseNumberish('1.234.567,5', 'money')).toBe(1234567.5);
    expect(parseNumberish('100k', 'money')).toBe(100000);
    expect(parseNumberish('0,75', 'money')).toBe(0.75);
  });
});
