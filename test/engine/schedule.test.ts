import { describe, expect, it } from 'vitest';
import { criticalChain, explain, schedule, validatePlan } from '../../src/engine';
import { plan } from '../helpers';

const dates = (p: ReturnType<typeof plan>) => schedule(p).items.map((r) => [r.startDate, r.endDate]);

describe('scheduler: one person, a queue of work', () => {
  // Thu 24 Sep 2026, Mon–Fri. The reference small-team case (anonymised).
  const queue = plan({
    lanes: [{ name: 'Sara' }],
    items: [
      { name: 'Insurance app', who: 'Sara', days: 1 },
      { name: 'Appeal A', who: 'Sara', days: 4, deadline: '2026-10-02' },
      { name: 'Finance research', who: 'Sara', days: 5, deadline: '2026-10-07' },
      { name: 'Revise B', who: 'Sara', days: 4, deadline: '2026-10-07' },
    ],
  });

  it('works through the list in order, skipping weekends', () => {
    expect(dates(queue)).toEqual([
      ['2026-09-24', '2026-09-24'],
      ['2026-09-25', '2026-09-30'],
      ['2026-10-01', '2026-10-07'],
      ['2026-10-08', '2026-10-13'],
    ]);
  });

  it('flags deadlines with exact slack', () => {
    const s = schedule(queue);
    expect(s.items.map((r) => [r.late ?? null, r.slack ?? null])).toEqual([
      [null, null],
      [false, 2],
      [false, 0],
      [true, -4],
    ]);
    expect(s.endDate).toBe('2026-10-13');
  });

  it('explains why something is late, naming who was busy with what', () => {
    const s = schedule(queue);
    const why = explain(s, 'revise-b').join(' | ');
    expect(why).toMatch(/waits ~10 days for Sara \(busy with Finance research 5d, Appeal A 4d, Insurance app 1d\)/);
    expect(why).toMatch(/finishes 4 working days after its deadline/);
    expect(s.byId.get('revise-b')!.driver).toMatchObject({ kind: 'capacity', item: 'finance-research', lane: 'sara' });
  });

  it('builds the chain from whoever finished last before each item could start', () => {
    const p = plan({ lanes: [{ name: 'Sara' }], items: [{ name: 'R', who: 'Sara', days: 5 }, { name: 'Q', who: 'Sara', days: 1 }, { name: 'A', who: 'Sara', days: 4 }] });
    expect(criticalChain(schedule(p), 'a')).toEqual(['a', 'q', 'r']);
    expect(criticalChain(schedule(p))).toEqual(['a', 'q', 'r']);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(schedule(queue).items)).toBe(JSON.stringify(schedule(queue).items));
  });
});

describe('scheduler: capacity, teams and parallel caps', () => {
  it('part-time people take longer', () => {
    const p = plan({ lanes: [{ name: 'Omar', availability: 50 }], items: [{ name: 'A', who: 'Omar', days: 5 }] });
    expect(dates(p)).toEqual([['2026-09-24', '2026-10-07']]); // 10 working days
  });

  it('caps people per item and lets lower priorities backfill', () => {
    const p = plan({
      lanes: [{ name: 'Backend', size: 3 }],
      items: [
        { name: 'Big', work: [{ lane: 'Backend', days: 6, maxPeople: 2 }] },
        { name: 'Small', work: [{ lane: 'Backend', days: 2 }] },
      ],
    });
    const s = schedule(p);
    expect(s.byId.get('big')!.end).toBe(2); // 3 days with 2 people
    expect(s.byId.get('small')!.end).toBe(1); // the third person backfills from day one
  });

  it('never gives an item more people than the work it has left (old bug #15)', () => {
    const p = plan({
      lanes: [{ name: 'Dev', size: 2 }],
      items: [
        { name: 'Tiny', work: [{ lane: 'Dev', days: 0.5, maxPeople: 2 }] },
        { name: 'Next', work: [{ lane: 'Dev', days: 1, maxPeople: 2 }] },
      ],
    });
    const s = schedule(p);
    expect(s.byId.get('tiny')!.end).toBe(0);
    expect(s.byId.get('next')!.end).toBe(0); // the old engine wasted a person-day here and finished a day later
  });

  it('runs parts of one item in parallel, and hand-offs in sequence', () => {
    const p = plan({
      lanes: ['Sara', 'Omar'],
      items: [
        { name: 'Parallel', work: [{ lane: 'Sara', days: 3 }, { lane: 'Omar', days: 1 }] },
        { name: 'Handoff', work: [{ lane: 'Omar', days: 1 }, { lane: 'Sara', days: 2, after: 'Omar' }] },
      ],
    });
    const s = schedule(p);
    expect(s.byId.get('parallel')).toMatchObject({ start: 0, end: 2 });
    const h = s.byId.get('handoff')!;
    expect(h.parts.find((x) => x.lane === 'omar')).toMatchObject({ start: 1, end: 1 });
    expect(h.parts.find((x) => x.lane === 'sara')).toMatchObject({ start: 3, end: 4, reason: 'handoff', reasonRef: 'omar' });
  });

  it('respects dependencies (including on lower-priority items) and not-before dates', () => {
    const p = plan({
      lanes: ['Sara', 'Omar'],
      items: [
        { name: 'Launch', who: 'Sara', days: 1, dependsOn: ['Build'] },
        { name: 'Build', who: 'Omar', days: 3 },
        { name: 'Client reply', who: 'Sara', days: 1, notBefore: '2026-10-01' },
      ],
    });
    const s = schedule(p);
    expect(s.byId.get('build')!.endDate).toBe('2026-09-28');
    expect(s.byId.get('launch')!).toMatchObject({ startDate: '2026-09-29', endDate: '2026-09-29' });
    expect(s.byId.get('launch')!.parts[0]).toMatchObject({ reason: 'dependency', reasonRef: 'build' });
    expect(s.byId.get('client-reply')!).toMatchObject({ startDate: '2026-10-01' });
    expect(s.byId.get('client-reply')!.parts[0]!.reason).toBe('notBefore');
  });
});

describe('scheduler: calendars', () => {
  it('honours custom weekends (e.g. Thu & Fri off) and a weekend start date (old bug)', () => {
    const p = plan({
      start: '2026-09-25', // a Friday, which is off here
      calendar: { workdays: ['sat', 'sun', 'mon', 'tue', 'wed'] },
      lanes: ['Me'],
      items: [{ name: 'A', who: 'Me', days: 6 }],
    });
    expect(dates(p)).toEqual([['2026-09-26', '2026-10-03']]); // Sat → Sat, skipping Thu/Fri
  });

  it('skips holidays', () => {
    const p = plan({
      calendar: { holidays: [{ from: '2026-09-28', label: 'Holiday' }] },
      lanes: [{ name: 'Sara' }],
      items: [{ name: 'A', who: 'Sara', days: 3 }],
    });
    // Thu 24, Fri 25, (Mon 28 holiday), Tue 29
    expect(dates(p)).toEqual([['2026-09-24', '2026-09-29']]);
  });

  it('skips personal days off when that feature is switched on', () => {
    const input = {
      start: '2026-09-24',
      calendar: { holidays: [{ from: '2026-09-28', label: 'Holiday' }] },
      lanes: [{ name: 'Sara', daysOff: [{ from: '2026-09-29', to: '2026-09-30' }] }],
      items: [{ name: 'A', who: 'Sara', days: 3 }],
    };
    const on = validatePlan(input, { today: '2026-09-24', features: { personDaysOff: true } });
    // Thu 24, Fri 25, (Mon 28 holiday), (Tue 29 + Wed 30 off), Thu 1 Oct
    expect(dates(on.plan)).toEqual([['2026-09-24', '2026-10-01']]);
    // switched off (the default): ignored, with a note
    const off = validatePlan(input, { today: '2026-09-24' });
    expect(off.plan.lanes[0]!.daysOff).toEqual([]);
    expect(off.warnings.map((w) => w.message).join()).toMatch(/days off per person are turned off/);
  });

  it('plans far beyond the old 240-day horizon', () => {
    const p = plan({ lanes: ['Me'], items: [{ name: 'Huge', who: 'Me', days: 400 }] });
    const s = schedule(p);
    expect(s.byId.get('huge')!.end).toBe(399);
    expect(s.byId.get('huge')!.endDate).toBe('2028-04-05'); // 80 weeks of Mon–Fri from Thu 24 Sep 2026
  });
});

describe('scheduler: impossible input never hangs', () => {
  it('blocks work for a lane with zero people or 0 % (old freeze bug)', () => {
    const p = plan({
      lanes: [{ name: 'Frontend', size: 0 }, { name: 'Design', availability: 0 }, 'Sara'],
      items: [
        { name: 'UI', who: 'Frontend', days: 2 },
        { name: 'Logo', who: 'Design', days: 1 },
        { name: 'Copy', who: 'Sara', days: 1 },
      ],
    });
    const s = schedule(p);
    expect(s.byId.get('ui')!).toMatchObject({ status: 'blocked' });
    expect(s.byId.get('ui')!.problem).toMatch(/Frontend has no available time/);
    expect(s.byId.get('logo')!.status).toBe('blocked');
    expect(s.byId.get('copy')!).toMatchObject({ status: 'scheduled', end: 0 });
  });

  it('treats zero-effort items as empty instead of drawing a giant bar (old bug)', () => {
    const p = plan({ lanes: ['Sara'], items: [{ name: 'New item', who: 'Sara', days: 0 }, { name: 'Real', who: 'Sara', days: 2 }] });
    const s = schedule(p);
    expect(s.byId.get('new-item')!).toMatchObject({ status: 'empty' });
    expect(s.byId.get('new-item')!.start).toBeUndefined();
    expect(s.byId.get('real')!).toMatchObject({ start: 0, end: 1 });
  });

  it('detects circular dependencies and anything waiting on them', () => {
    const p = plan({
      lanes: ['Me'],
      items: [
        { name: 'A', who: 'Me', days: 1, dependsOn: ['B'] },
        { name: 'B', who: 'Me', days: 1, dependsOn: ['A'] },
        { name: 'C', who: 'Me', days: 1, dependsOn: ['A'] },
        { name: 'D', who: 'Me', days: 1 },
      ],
    });
    const s = schedule(p);
    expect(s.byId.get('a')!.problem).toMatch(/circular/);
    expect(s.byId.get('b')!.status).toBe('blocked');
    expect(s.byId.get('c')!.problem).toMatch(/waits for "A"/);
    expect(s.byId.get('d')!).toMatchObject({ status: 'scheduled', end: 0 });
  });

  it('scales every effort with a forecast factor', () => {
    const p = plan({ lanes: ['Me'], items: [{ name: 'A', who: 'Me', days: 5 }] });
    expect(schedule(p, { factor: 1.6 }).byId.get('a')!.end).toBe(7); // 8 days
    expect(schedule(p, { factor: 2.7 }).byId.get('a')!.end).toBe(13); // 13.5 days
  });
});
