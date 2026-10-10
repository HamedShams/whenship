import { FEATURES } from './features';
import { validatePlan } from './validate';
import type { DateSpan, ISODate, Lane, NormalizedPlan, Weekday } from './types';

/** Small, explicit edits. Shared by the UI (undoable actions), insights (suggestions) and the `what_if` tool. */
export type Change =
  | { op: 'move'; item: string; to: number }
  | { op: 'setEffort'; item: string; lane: string; days: number }
  | { op: 'setDeadline'; item: string; date: ISODate | null }
  | { op: 'setNotBefore'; item: string; date: ISODate | null }
  | { op: 'setLane'; lane: string; size?: number; availability?: number; name?: string }
  | { op: 'addLane'; lane: Lane }
  | { op: 'addDaysOff'; lane: string; from: ISODate; to?: ISODate; label?: string }
  | { op: 'setWorkdays'; days: Weekday[] }
  | { op: 'addHoliday'; from: ISODate; to?: ISODate; label?: string }
  | { op: 'removeItem'; item: string }
  | { op: 'setStart'; date: ISODate };

export interface ApplyResult {
  plan: NormalizedPlan;
  /** Changes that referenced something missing (reported, not fatal). */
  skipped: { change: Change; reason: string }[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function findItem(plan: NormalizedPlan, ref: string) {
  const key = ref.toLowerCase();
  return plan.items.findIndex((it) => it.id === ref || it.name.toLowerCase() === key);
}
function findLane(plan: NormalizedPlan, ref: string) {
  const key = ref.toLowerCase();
  return plan.lanes.find((l) => l.id === ref || l.name.toLowerCase() === key);
}

/** Applies changes in order to a copy of the plan, then re-validates so the result is always clean. */
export function applyChanges(base: NormalizedPlan, changes: Change[]): ApplyResult {
  const plan = clone(base);
  const skipped: ApplyResult['skipped'] = [];
  const skip = (change: Change, reason: string) => skipped.push({ change, reason });
  for (const c of changes) {
    switch (c.op) {
      case 'move': {
        const i = findItem(plan, c.item);
        if (i < 0) { skip(c, `no item "${c.item}"`); break; }
        const [it] = plan.items.splice(i, 1);
        const to = Math.max(0, Math.min(plan.items.length, Math.round(c.to)));
        plan.items.splice(to, 0, it!);
        break;
      }
      case 'setEffort': {
        const i = findItem(plan, c.item);
        const lane = findLane(plan, c.lane);
        if (i < 0 || !lane) { skip(c, i < 0 ? `no item "${c.item}"` : `no lane "${c.lane}"`); break; }
        const work = plan.items[i]!.work;
        const part = work.find((w) => w.lane === lane.id);
        if (c.days <= 0 && part) work.splice(work.indexOf(part), 1);
        else if (part) part.days = c.days;
        else if (c.days > 0) work.push({ lane: lane.id, days: c.days, maxPeople: 1 });
        break;
      }
      case 'setDeadline': {
        const i = findItem(plan, c.item);
        if (i < 0) { skip(c, `no item "${c.item}"`); break; }
        if (c.date) plan.items[i]!.deadline = c.date;
        else delete plan.items[i]!.deadline;
        break;
      }
      case 'setNotBefore': {
        const i = findItem(plan, c.item);
        if (i < 0) { skip(c, `no item "${c.item}"`); break; }
        if (c.date) plan.items[i]!.notBefore = c.date;
        else delete plan.items[i]!.notBefore;
        break;
      }
      case 'setLane': {
        const lane = findLane(plan, c.lane);
        if (!lane) { skip(c, `no lane "${c.lane}"`); break; }
        if (c.size !== undefined) {
          lane.size = c.size;
          if (lane.size > 1 && lane.kind === 'person') lane.kind = 'team';
        }
        if (c.availability !== undefined) lane.availability = c.availability;
        if (c.name) lane.name = c.name;
        break;
      }
      case 'addLane':
        plan.lanes.push(c.lane as NormalizedPlan['lanes'][number]);
        break;
      case 'addDaysOff': {
        if (!FEATURES.personDaysOff) { skip(c, 'days off per person are turned off for now (use a holiday)'); break; }
        const lane = findLane(plan, c.lane);
        if (!lane) { skip(c, `no lane "${c.lane}"`); break; }
        const span: DateSpan & { to: ISODate } = { from: c.from, to: c.to ?? c.from };
        if (c.label) span.label = c.label;
        lane.daysOff.push(span);
        break;
      }
      case 'setWorkdays':
        plan.calendar.workdays = c.days;
        break;
      case 'addHoliday': {
        const span: DateSpan & { to: ISODate } = { from: c.from, to: c.to ?? c.from };
        if (c.label) span.label = c.label;
        plan.calendar.holidays.push(span);
        break;
      }
      case 'removeItem': {
        const i = findItem(plan, c.item);
        if (i < 0) { skip(c, `no item "${c.item}"`); break; }
        const id = plan.items[i]!.id;
        plan.items.splice(i, 1);
        for (const it of plan.items) it.dependsOn = it.dependsOn.filter((d) => d !== id);
        break;
      }
      case 'setStart':
        plan.start = c.date;
        break;
    }
  }
  const { plan: clean } = validatePlan(plan, { today: base.start });
  return { plan: clean, skipped };
}

/** Moves one item to a new list position (the core drag interaction). */
export function moveItem(plan: NormalizedPlan, id: string, to: number): NormalizedPlan {
  const from = plan.items.findIndex((it) => it.id === id);
  if (from < 0 || from === to) return plan;
  const items = plan.items.slice();
  const [it] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, to)), 0, it!);
  return { ...plan, items };
}
