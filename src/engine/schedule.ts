import { WorkCalendar } from './calendar';
import { LIMITS } from './validate';
import type { ISODate, NormalizedPlan } from './types';

const EPS = 1e-9;

export type Reason = 'start' | 'dependency' | 'handoff' | 'notBefore';

export interface PartResult {
  lane: string;
  /** Effort in person-days after the forecast multiplier. */
  days: number;
  /** Working-day index of the first and last day of work. */
  start?: number;
  end?: number;
  /** First working day this part was allowed to start, and why not earlier. */
  readyAt?: number;
  reason?: Reason;
  /** For `dependency`: the item waited for. For `handoff`: the lane of the part waited for. */
  reasonRef?: string;
  /** Person-days other items took from this lane while this part was ready but under-served. */
  blockedBy: Record<string, number>;
}

export type ItemStatus = 'scheduled' | 'empty' | 'blocked';

export interface Driver {
  kind: 'capacity' | 'dependency' | 'handoff' | 'notBefore' | 'start';
  /** The item that held this one back (capacity / dependency). */
  item?: string;
  lane?: string;
  /** Person-days of waiting caused (capacity). */
  days?: number;
}

export interface ItemResult {
  id: string;
  name: string;
  position: number;
  status: ItemStatus;
  problem?: string;
  start?: number;
  end?: number;
  startDate?: ISODate;
  endDate?: ISODate;
  parts: PartResult[];
  deadline?: ISODate;
  /** Last working day on or before the deadline. */
  deadlineIndex?: number;
  late?: boolean;
  /** Working days between finish and deadline (negative = late). */
  slack?: number;
  driver?: Driver;
}

export interface Schedule {
  plan: NormalizedPlan;
  factor: number;
  calendar: WorkCalendar;
  items: ItemResult[];
  byId: Map<string, ItemResult>;
  endIndex?: number;
  endDate?: ISODate;
  /** Person-days used per working day, per lane (up to `endIndex`). */
  load: Map<string, number[]>;
}

export interface ScheduleOptions {
  /** Every effort is multiplied by this (forecast lenses). Default 1. */
  factor?: number;
  /** Safety horizon in working days. */
  maxIndex?: number;
}

/**
 * Deterministic, day-by-day list scheduling in priority order.
 *
 * Each working day, items take people from their lanes in list order, up to their per-item cap and never more than
 * the work they have left; lower priorities backfill whatever is free. A part may start the working day after its
 * hand-off part, its dependencies and its not-before date allow. The loop cannot spin forever: impossible work is
 * detected up front and a horizon guards the rest.
 */
export function schedule(plan: NormalizedPlan, options: ScheduleOptions = {}): Schedule {
  const factor = options.factor ?? 1;
  const maxIndex = options.maxIndex ?? LIMITS.maxDays;
  const cal = new WorkCalendar(plan);
  const items = plan.items;
  const n = items.length;
  const laneById = new Map(plan.lanes.map((l) => [l.id, l]));
  const indexById = new Map(items.map((it, i) => [it.id, i]));

  const res: ItemResult[] = items.map((it, position) => {
    const r: ItemResult = {
      id: it.id,
      name: it.name,
      position,
      status: 'scheduled',
      parts: it.work.map((w) => ({ lane: w.lane, days: w.days * factor, blockedBy: {} })),
    };
    if (it.deadline) r.deadline = it.deadline;
    return r;
  });
  const remaining = res.map((r) => r.parts.map((p) => p.days));

  // ── things that can never be scheduled ──────────────────────────────────
  for (let i = 0; i < n; i++) {
    const r = res[i]!;
    if (r.parts.every((p) => p.days <= EPS)) {
      r.status = 'empty';
      continue;
    }
    for (const p of r.parts) {
      if (p.days > EPS && cal.laneIsDead(p.lane)) {
        r.status = 'blocked';
        r.problem = `${laneById.get(p.lane)?.name ?? p.lane} has no available time (0 people or 0 %)`;
      }
    }
  }
  markCycles(items.map((it) => it.dependsOn.map((d) => indexById.get(d)!).filter((x) => x !== undefined)), res);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < n; i++) {
      const r = res[i]!;
      if (r.status !== 'scheduled') continue;
      for (const dep of items[i]!.dependsOn) {
        const dr = res[indexById.get(dep)!];
        if (dr && dr.status === 'blocked') {
          r.status = 'blocked';
          r.problem = `waits for "${dr.name}", which can't be scheduled`;
          changed = true;
          break;
        }
      }
    }
  }
  const notBeforeIdx = items.map((it) => (it.notBefore ? cal.indexOnOrAfter(it.notBefore) : 0));
  const afterIdx = items.map((it) => it.work.map((w) => (w.after ? it.work.findIndex((x) => x.lane === w.after) : -1)));
  const load = new Map<string, number[]>(plan.lanes.map((l) => [l.id, []]));
  let active = 0;
  const partsLeft = res.map((r) => (r.status === 'scheduled' ? r.parts.filter((p) => p.days > EPS).length : 0));
  const itemEnd: (number | undefined)[] = new Array(n).fill(undefined);
  for (const left of partsLeft) active += left;

  // ── the day loop ────────────────────────────────────────────────────────
  const free = new Map<string, number>();
  const consumers = new Map<string, [number, number][]>();
  let d = 0;
  for (; active > 0 && d < maxIndex; d++) {
    for (const l of plan.lanes) free.set(l.id, cal.capacity(l.id, d));
    consumers.clear();
    for (let i = 0; i < n; i++) {
      const r = res[i]!;
      if (r.status !== 'scheduled' || notBeforeIdx[i]! > d) continue;
      let depsReady = true;
      for (const dep of items[i]!.dependsOn) {
        const di = indexById.get(dep)!;
        if (res[di]!.status === 'empty') continue;
        const de = itemEnd[di];
        if (de === undefined || de >= d) {
          depsReady = false;
          break;
        }
      }
      if (!depsReady) continue;
      const parts = items[i]!.work;
      for (let j = 0; j < parts.length; j++) {
        const rem = remaining[i]![j]!;
        if (rem <= EPS) continue;
        const k = afterIdx[i]![j]!;
        if (k >= 0) {
          const before = r.parts[k]!;
          if (before.days > EPS && (before.end === undefined || before.end >= d)) continue;
        }
        const pr = r.parts[j]!;
        if (pr.readyAt === undefined) pr.readyAt = d;
        const lane = laneById.get(pr.lane)!;
        const want = Math.min((parts[j]!.maxPeople * lane.availability) / 100, rem);
        const avail = free.get(pr.lane) ?? 0;
        const take = Math.min(want, avail);
        let list = consumers.get(pr.lane);
        if (want - take > EPS && list && list.length) {
          const deficit = want - take;
          const total = list.reduce((s, [, a]) => s + a, 0);
          for (const [ci, amount] of list) {
            const key = items[ci]!.id;
            pr.blockedBy[key] = (pr.blockedBy[key] ?? 0) + (deficit * amount) / total;
          }
        }
        if (take > EPS) {
          remaining[i]![j] = rem - take;
          free.set(pr.lane, avail - take);
          if (!list) consumers.set(pr.lane, (list = []));
          list.push([i, take]);
          const arr = load.get(pr.lane)!;
          arr[d] = (arr[d] ?? 0) + take;
          if (pr.start === undefined) pr.start = d;
          if (rem - take <= EPS) {
            remaining[i]![j] = 0;
            pr.end = d;
            active--;
            if (--partsLeft[i]! === 0) itemEnd[i] = d;
          }
        }
      }
    }
  }

  // ── wrap up ─────────────────────────────────────────────────────────────
  let endIndex: number | undefined;
  for (let i = 0; i < n; i++) {
    const r = res[i]!;
    if (r.status !== 'scheduled') continue;
    if (remaining[i]!.some((x) => x > EPS)) {
      r.status = 'blocked';
      r.problem = `doesn't finish within ${maxIndex} working days`;
      continue;
    }
    for (const p of r.parts) {
      if (p.days <= EPS) continue;
      if (p.start !== undefined && (r.start === undefined || p.start < r.start)) r.start = p.start;
      if (p.end !== undefined && (r.end === undefined || p.end > r.end)) r.end = p.end;
    }
    if (r.start !== undefined) r.startDate = cal.dateAt(r.start);
    if (r.end !== undefined) {
      r.endDate = cal.dateAt(r.end);
      if (endIndex === undefined || r.end > endIndex) endIndex = r.end;
    }
  }
  // second pass: every item's dates are known now, so explain what each part waited for
  for (let i = 0; i < n; i++) {
    if (res[i]!.status !== 'scheduled') continue;
    for (const p of res[i]!.parts) if (p.days > EPS) explainReady(p, i, items, res, notBeforeIdx[i]!, afterIdx[i]!, indexById);
  }
  for (const r of res) {
    if (r.deadline) {
      r.deadlineIndex = cal.indexOnOrBefore(r.deadline);
      if (r.end !== undefined) {
        r.late = r.end > r.deadlineIndex;
        r.slack = r.deadlineIndex - r.end;
      }
    }
    if (r.status === 'scheduled') r.driver = driverOf(r, res, indexById);
  }

  const out: Schedule = { plan, factor, calendar: cal, items: res, byId: new Map(res.map((r) => [r.id, r])), load };
  if (endIndex !== undefined) {
    out.endIndex = endIndex;
    out.endDate = cal.dateAt(endIndex);
  }
  return out;
}

function markCycles(graph: number[][], res: ItemResult[]): void {
  const state = new Array<number>(graph.length).fill(0); // 0 new, 1 on stack, 2 done
  const stack: number[] = [];
  const visit = (v: number): void => {
    state[v] = 1;
    stack.push(v);
    for (const w of graph[v]!) {
      if (state[w] === 1) {
        const cycle = stack.slice(stack.indexOf(w));
        const names = cycle.map((x) => `"${res[x]!.name}"`).join(' → ');
        for (const x of cycle) {
          res[x]!.status = 'blocked';
          res[x]!.problem = `circular dependency: ${names}`;
        }
      } else if (state[w] === 0) visit(w);
    }
    stack.pop();
    state[v] = 2;
  };
  for (let v = 0; v < graph.length; v++) if (state[v] === 0) visit(v);
}

function explainReady(
  p: PartResult,
  i: number,
  items: NormalizedPlan['items'],
  res: ItemResult[],
  notBefore: number,
  after: number[],
  indexById: Map<string, number>,
): void {
  if (p.readyAt === undefined) return;
  const j = res[i]!.parts.indexOf(p);
  const k = after[j]!;
  if (k >= 0 && res[i]!.parts[k]!.end !== undefined && res[i]!.parts[k]!.end! + 1 === p.readyAt) {
    p.reason = 'handoff';
    p.reasonRef = res[i]!.parts[k]!.lane;
    return;
  }
  let latest: ItemResult | undefined;
  for (const dep of items[i]!.dependsOn) {
    const dr = res[indexById.get(dep)!]!;
    if (dr.end !== undefined && (!latest || dr.end > latest.end!)) latest = dr;
  }
  if (latest && latest.end! + 1 === p.readyAt) {
    p.reason = 'dependency';
    p.reasonRef = latest.id;
    return;
  }
  p.reason = notBefore > 0 && notBefore === p.readyAt ? 'notBefore' : 'start';
}

/** What held this item's last part back the most: someone else using the lane, or a wait. */
function driverOf(r: ItemResult, res: ItemResult[], indexById: Map<string, number>): Driver | undefined {
  let part: PartResult | undefined;
  for (const p of r.parts) if (p.end !== undefined && (!part || p.end > part.end!)) part = p;
  if (!part) return undefined;
  for (let guard = 0; guard < 20; guard++) {
    const entries = Object.entries(part.blockedBy);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    if (total >= 0.25) {
      // The blocker that finished last is the one this part waited for directly; following those gives a real chain.
      const endOf = (id: string) => res[indexById.get(id) ?? -1]?.end ?? -1;
      // Ignore crumbs, unless crumbs are all there is (many small items can add up to a real wait).
      const strong = entries.filter(([, v]) => v >= 0.25);
      const [top] = (strong.length ? strong : entries).sort((a, b) => endOf(b[0]) - endOf(a[0]) || b[1] - a[1]);
      return { kind: 'capacity', item: top![0], lane: part.lane, days: Math.round(total * 10) / 10 };
    }
    if (part.reason === 'handoff') {
      const prev = r.parts.find((x) => x.lane === part!.reasonRef);
      if (!prev || prev === part) return { kind: 'handoff', lane: part.reasonRef! };
      part = prev; // keep looking at what delayed the part we handed off from
      continue;
    }
    if (part.reason === 'dependency') return { kind: 'dependency', item: part.reasonRef! };
    if (part.reason === 'notBefore') return { kind: 'notBefore' };
    return { kind: 'start' };
  }
  return { kind: 'start' };
}
