import { parseISO, toISO, weekdayOf } from './dates';
import type { ISODate, NormalizedLane, NormalizedPlan } from './types';

/**
 * Maps working days to a dense index (0 = first working day on or after the plan start) and answers
 * "how many person-days does this lane have on working day i".
 */
export class WorkCalendar {
  readonly startDay: number;
  private readonly workdays: Set<string>;
  private readonly holidays: Set<number>;
  private readonly days: number[] = [];
  private readonly laneOff: Map<string, Set<number>>;
  private readonly laneRate: Map<string, number>;

  constructor(plan: NormalizedPlan) {
    this.workdays = new Set(plan.calendar.workdays);
    this.holidays = expandSpans(plan.calendar.holidays);
    this.startDay = parseISO(plan.start)!;
    this.laneOff = new Map(plan.lanes.map((l) => [l.id, expandSpans(l.daysOff)]));
    this.laneRate = new Map(plan.lanes.map((l) => [l.id, laneDailyCapacity(l)]));
  }

  isWorkingDay(day: number): boolean {
    return this.workdays.has(weekdayOf(day)) && !this.holidays.has(day);
  }

  /** Day number of working day `index`. Grows lazily. */
  dayAt(index: number): number {
    if (this.workdays.size === 0) throw new Error('no working days');
    let d = this.days.length ? this.days[this.days.length - 1]! + 1 : this.startDay;
    while (this.days.length <= index) {
      if (this.isWorkingDay(d)) this.days.push(d);
      d++;
    }
    return this.days[index]!;
  }

  dateAt(index: number): ISODate {
    return toISO(this.dayAt(index));
  }

  /** Index of the first working day on or after `iso` (0 if before the start). */
  indexOnOrAfter(iso: ISODate): number {
    const target = parseISO(iso)!;
    if (target <= this.startDay) return 0;
    let lo = 0;
    while (this.dayAt(lo) < target) lo = lo === 0 ? 1 : lo * 2;
    let hi = lo;
    lo = Math.floor(lo / 2);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.dayAt(mid) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Index of the last working day on or before `iso` (−1 if that is before the first working day). */
  indexOnOrBefore(iso: ISODate): number {
    const target = parseISO(iso)!;
    const i = this.indexOnOrAfter(iso);
    return this.dayAt(i) === target ? i : i - 1;
  }

  /** Person-days the lane can give on working day `index`. */
  capacity(laneId: string, index: number): number {
    const off = this.laneOff.get(laneId);
    if (off && off.size && off.has(this.dayAt(index))) return 0;
    return this.laneRate.get(laneId) ?? 0;
  }

  /** True when the lane will never have time again after `index` (so waiting is pointless). */
  laneIsDead(laneId: string): boolean {
    return (this.laneRate.get(laneId) ?? 0) <= 0;
  }

  /** Last day any lane is off (after it, capacity is constant). */
  get lastSpecialDay(): number {
    let max = this.startDay;
    for (const s of this.laneOff.values()) for (const d of s) if (d > max) max = d;
    return max;
  }
}

export function laneDailyCapacity(lane: NormalizedLane): number {
  return (lane.size * lane.availability) / 100;
}

function expandSpans(spans: { from: ISODate; to: ISODate }[]): Set<number> {
  const out = new Set<number>();
  for (const s of spans) {
    const a = parseISO(s.from), b = parseISO(s.to);
    if (a === null || b === null) continue;
    for (let d = a; d <= b && d - a < 3660; d++) out.add(d);
  }
  return out;
}
