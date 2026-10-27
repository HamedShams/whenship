// FABLE edition: done items, forgiving input shapes, and measuring a proposed change.
import { describe, expect, it } from 'vitest';
import { analyze, applyChanges, assess, compactPlan, headline, renderReport, schedule, validatePlan } from '../../src/engine';
import { plan } from '../helpers';

describe('done items', () => {
  const base = () =>
    plan({
      lanes: [{ name: 'Sara' }],
      items: [
        { name: 'Research', who: 'Sara', days: 5, deadline: '2026-10-07' },
        { name: 'Draft', who: 'Sara', days: 3, dependsOn: ['Research'], deadline: '2026-10-09' },
      ],
    });

  it('take no time, free what waited for them, and drop out of the deadline count', () => {
    const before = schedule(base());
    expect(before.byId.get('draft')!.startDate).toBe('2026-10-01'); // after 5 days of research
    const done = applyChanges(base(), [{ op: 'setDone', item: 'Research', done: true }]).plan;
    expect(done.items[0]!.done).toBe(true);
    const after = schedule(done);
    expect(after.byId.get('research')!.status).toBe('done');
    expect(after.byId.get('draft')!.startDate).toBe('2026-09-24'); // starts at once
    const a = analyze(done);
    expect(a.dated).toBe(1); // the finished item's deadline is history
    expect(headline(a)).toMatch(/^the deadline is/);
    expect(renderReport(done)).toMatch(/\| 1 \| Research \| Sara 5d \| — \| — \| 7 Oct \| ✓ done \|/);
    expect(renderReport(done)).toMatch(/1 item is done and takes no more time/);
    // and back
    const undone = applyChanges(done, [{ op: 'setDone', item: 'Research', done: false }]).plan;
    expect(undone.items[0]!.done).toBeUndefined();
  });

  it('are read from "done", "completed" or a status word, and survive saving', () => {
    const v = validatePlan({ lanes: [{ name: 'Me' }], items: [{ name: 'A', who: 'Me', days: 1, done: true }, { name: 'B', who: 'Me', days: 1, status: 'Completed' }, { name: 'C', who: 'Me', days: 1 }] }, { today: '2026-09-24' });
    expect(v.plan.items.map((it) => it.done)).toEqual([true, true, undefined]);
    expect(JSON.stringify(compactPlan(v.plan))).toMatch(/"name":"A".*"done":true/);
  });
});

describe('forgiving input', () => {
  it('reads people/tasks as lanes/items and {lane: days} as work, and says so', () => {
    const v = validatePlan({ people: [{ name: 'Ava' }, { name: 'Ben' }], tasks: [{ name: 'Portal', effort: { Ava: 4, ben: 1 }, deadline: '2026-10-23' }] }, { today: '2026-10-16' });
    expect(v.errors).toEqual([]);
    expect(v.plan.lanes.map((l) => l.name)).toEqual(['Ava', 'Ben']);
    expect(v.plan.items[0]!.work).toEqual([
      { lane: 'ava', days: 4, maxPeople: 1 },
      { lane: 'ben', days: 1, maxPeople: 1 },
    ]);
    expect(v.warnings.map((w) => w.message)).toEqual(['read as `lanes`', 'read as `items`', 'read {lane: days} as who does what']);
  });
});

describe('assess()', () => {
  it('measures a proposed change exactly, and reports what could not be applied', () => {
    const p = plan({
      lanes: [{ name: 'Sara' }, { name: 'Omar', availability: 50 }],
      items: [
        { name: 'Quick fix', who: 'Sara', days: 3 },
        { name: 'Appeal', who: 'Sara', days: 4, deadline: '2026-09-30' },
      ],
    });
    const a = assess(p, [{ op: 'move', item: 'Appeal', to: 0 }]);
    expect(a.skipped).toEqual([]);
    expect(a.effect).toMatch(/^1 more deadline met \(Appeal\)/);
    expect(a.deltas.met).toBe(1);
    const b = assess(p, [{ op: 'setEffort', item: 'Nope', lane: 'Sara', days: 1 }]);
    expect(b.skipped).toEqual(['no item "Nope"']);
    const c = assess(p, [{ op: 'setEffort', item: 'Quick fix', lane: 'Sara', days: 6 }]);
    expect(c.effect).toMatch(/later|no deadline or end-date change/);
  });
});
