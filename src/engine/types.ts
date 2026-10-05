/** ISO calendar date, `YYYY-MM-DD`. Dates are plain calendar days: no times, no time zones. */
export type ISODate = string;

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** An inclusive span of calendar days (a holiday, a vacation…). `to` defaults to `from`. */
export interface DateSpan {
  from: ISODate;
  to?: ISODate;
  label?: string;
}

/**
 * A lane is "who does the work": one person, or a team/role pool with several people.
 * Capacity per working day = size × availability / 100 (in person-days).
 */
export interface Lane {
  id: string;
  name: string;
  kind?: 'person' | 'team';
  /** People in this lane (1 for a person). Fractions are fine for part-time teams. */
  size?: number;
  /** Share of each person's working time available for this plan, 0–100. */
  availability?: number;
  daysOff?: DateSpan[];
  color?: string;
}

/** A piece of an item done by one lane: effort in working days of one person. */
export interface Work {
  lane: string;
  days: number;
  /** Most people of this lane who can work on it at once (teams only). Default 1. */
  maxPeople?: number;
  /** Lane id of another part of the same item that must finish first (a hand-off). */
  after?: string;
}

export interface Item {
  id: string;
  name: string;
  work: Work[];
  deadline?: ISODate;
  /** Optional business value, used to rank what is at risk. */
  value?: number;
  /** Ids of items that must finish before this one starts. */
  dependsOn?: string[];
  /** Waiting on something external: cannot start before this date. */
  notBefore?: ISODate;
  note?: string;
}

export interface Calendar {
  workdays?: Weekday[];
  holidays?: DateSpan[];
}

/** A plan as users and assistants write it. Order of `items` is the priority order. */
export interface Plan {
  version?: 1;
  title?: string;
  start?: ISODate;
  currency?: string;
  calendar?: Calendar;
  lanes: Lane[];
  items: Item[];
}

/** A plan after validation: every default filled in, ids unique, references checked. */
export interface NormalizedLane extends Lane {
  kind: 'person' | 'team';
  size: number;
  availability: number;
  daysOff: (DateSpan & { to: ISODate })[];
  color: string;
}
export interface NormalizedWork extends Work {
  maxPeople: number;
}
export interface NormalizedItem extends Item {
  work: NormalizedWork[];
  dependsOn: string[];
}
export interface NormalizedPlan {
  version: 1;
  title: string;
  start: ISODate;
  currency?: string;
  calendar: { workdays: Weekday[]; holidays: (DateSpan & { to: ISODate })[] };
  lanes: NormalizedLane[];
  items: NormalizedItem[];
}

export interface Issue {
  /** Where the problem is, e.g. `items[2].work[0].days`. */
  path: string;
  message: string;
}

/**
 * What people and assistants may write: everything optional, shorthand allowed (`{name, who, days}` items,
 * lane names as strings, "5d" / "2w" efforts, …). `validatePlan()` turns it into a `NormalizedPlan`.
 */
export type PlanInput = { [key: string]: unknown; lanes?: unknown[]; items?: unknown[] };
