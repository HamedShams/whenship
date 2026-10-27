import { describe, expect, it } from 'vitest';
import { applyChanges, FEATURES, moveItem, schedule, validatePlan } from '../../src/engine';

const today = '2026-10-05';
const base = () =>
  validatePlan(
    {
      start: '2026-10-05',
      lanes: [{ name: 'Sara' }, { name: 'Omar', availability: 50 }],
      items: [
        { name: 'Alpha', who: 'Sara', days: 3, deadline: '2026-10-09' },
        { name: 'Beta', who: 'Omar', days: 2 },
        { name: 'Gamma', who: 'Sara', days: 4, dependsOn: ['Alpha'] },
      ],
    },
    { today },
  ).plan;

describe('changes (shared by the chart, the suggestions and what_if)', () => {
  it('move puts an item at a position, clamped to the list, and finds items by id or any-case name', () => {
    const p = base();
    expect(applyChanges(p, [{ op: 'move', item: 'gamma', to: 0 }]).plan.items.map((i) => i.name)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(applyChanges(p, [{ op: 'move', item: 'alpha', to: 99 }]).plan.items.map((i) => i.name)).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(applyChanges(p, [{ op: 'move', item: 'Beta', to: -3 }]).plan.items[0]!.name).toBe('Beta');
  });

  it('setEffort changes, adds and removes one lane’s part of an item', () => {
    const p = base();
    const more = applyChanges(p, [{ op: 'setEffort', item: 'Alpha', lane: 'sara', days: 5 }]).plan;
    expect(more.items[0]!.work).toEqual([{ lane: 'sara', days: 5, maxPeople: 1 }]);
    const added = applyChanges(p, [{ op: 'setEffort', item: 'Alpha', lane: 'Omar', days: 1 }]).plan;
    expect(added.items[0]!.work.map((w) => [w.lane, w.days])).toEqual([['sara', 3], ['omar', 1]]);
    const removed = applyChanges(added, [{ op: 'setEffort', item: 'Alpha', lane: 'omar', days: 0 }]).plan;
    expect(removed.items[0]!.work.map((w) => w.lane)).toEqual(['sara']);
    // zero days for someone who isn't on the item changes nothing
    expect(applyChanges(p, [{ op: 'setEffort', item: 'Beta', lane: 'sara', days: 0 }]).plan.items[1]!.work).toHaveLength(1);
  });

  it('setDeadline and setNotBefore set and clear dates', () => {
    const p = base();
    const set = applyChanges(p, [
      { op: 'setDeadline', item: 'Beta', date: '2026-10-20' },
      { op: 'setNotBefore', item: 'Beta', date: '2026-10-12' },
    ]).plan;
    expect(set.items[1]).toMatchObject({ deadline: '2026-10-20', notBefore: '2026-10-12' });
    expect(schedule(set).byId.get('beta')!.startDate).toBe('2026-10-12');
    const cleared = applyChanges(set, [
      { op: 'setDeadline', item: 'Beta', date: null },
      { op: 'setNotBefore', item: 'Beta', date: null },
    ]).plan;
    expect(cleared.items[1]!.deadline).toBeUndefined();
    expect(cleared.items[1]!.notBefore).toBeUndefined();
  });

  it('setLane renames, changes availability, and turns a person into a team when it grows', () => {
    const p = applyChanges(base(), [{ op: 'setLane', lane: 'Omar', availability: 100, name: 'Omar K' }]).plan;
    expect(p.lanes[1]).toMatchObject({ name: 'Omar K', availability: 100, kind: 'person' });
    const team = applyChanges(p, [{ op: 'setLane', lane: 'sara', size: 3 }]).plan;
    expect(team.lanes[0]).toMatchObject({ kind: 'team', size: 3 });
  });

  it('addLane, setWorkdays, addHoliday and setStart reshape the calendar and the people', () => {
    const p = applyChanges(base(), [
      { op: 'addLane', lane: { id: 'lea', name: 'Lea' } },
      { op: 'setWorkdays', days: ['sun', 'mon', 'tue', 'wed', 'thu'] },
      { op: 'addHoliday', from: '2026-10-06', label: 'Closed' },
      { op: 'addHoliday', from: '2026-10-12', to: '2026-10-13' },
      { op: 'setStart', date: '2026-10-04' },
    ]).plan;
    expect(p.lanes.map((l) => l.name)).toEqual(['Sara', 'Omar', 'Lea']);
    expect(p.calendar.workdays).toEqual(['mon', 'tue', 'wed', 'thu', 'sun']);
    expect(p.calendar.holidays).toEqual([
      { from: '2026-10-06', to: '2026-10-06', label: 'Closed' },
      { from: '2026-10-12', to: '2026-10-13' },
    ]);
    expect(p.start).toBe('2026-10-04');
  });

  it('removeItem drops the item and every dependency on it', () => {
    const p = applyChanges(base(), [{ op: 'removeItem', item: 'Alpha' }]).plan;
    expect(p.items.map((i) => i.name)).toEqual(['Beta', 'Gamma']);
    expect(p.items[1]!.dependsOn).toEqual([]);
  });

  it('reports what it could not apply, and applies the rest', () => {
    const r = applyChanges(base(), [
      { op: 'move', item: 'Nope', to: 0 },
      { op: 'setEffort', item: 'Alpha', lane: 'Nobody', days: 1 },
      { op: 'setEffort', item: 'Nope', lane: 'sara', days: 1 },
      { op: 'setDeadline', item: 'Nope', date: null },
      { op: 'setNotBefore', item: 'Nope', date: null },
      { op: 'setLane', lane: 'Nobody', size: 2 },
      { op: 'removeItem', item: 'Nope' },
      { op: 'setDeadline', item: 'Beta', date: '2026-10-30' },
    ]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['no item "Nope"', 'no lane "Nobody"', 'no item "Nope"', 'no item "Nope"', 'no item "Nope"', 'no lane "Nobody"', 'no item "Nope"']);
    expect(r.plan.items[1]!.deadline).toBe('2026-10-30');
  });

  it('days off per person stay switched off, and say why', () => {
    expect(FEATURES.personDaysOff).toBe(false);
    const r = applyChanges(base(), [{ op: 'addDaysOff', lane: 'sara', from: '2026-10-07' }]);
    expect(r.skipped[0]!.reason).toMatch(/turned off/);
    expect(r.plan.lanes[0]!.daysOff).toEqual([]);
  });

  it('never touches the plan it was given', () => {
    const p = base();
    const before = JSON.stringify(p);
    applyChanges(p, [{ op: 'removeItem', item: 'Alpha' }, { op: 'setStart', date: '2026-11-02' }]);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('moveItem reorders without re-validating, and returns the same plan when nothing moves', () => {
    const p = base();
    expect(moveItem(p, 'beta', 0).items.map((i) => i.id)).toEqual(['beta', 'alpha', 'gamma']);
    expect(moveItem(p, 'beta', 1)).toBe(p);
    expect(moveItem(p, 'missing', 0)).toBe(p);
    expect(moveItem(p, 'alpha', 9).items.map((i) => i.id)).toEqual(['beta', 'gamma', 'alpha']);
  });
});
