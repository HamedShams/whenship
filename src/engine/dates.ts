import { WEEKDAYS, type ISODate, type Weekday } from './types';

/**
 * All date math works on "day numbers": whole days since 1970-01-01, computed in UTC.
 * Nothing here depends on the machine's time zone, so every user sees the same dates.
 */
const MS_PER_DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: unknown): value is ISODate {
  return typeof value === 'string' && parseISO(value) !== null;
}

/** `YYYY-MM-DD` → day number, or null when the string is not a real calendar date. */
export function parseISO(value: string): number | null {
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(ms / MS_PER_DAY);
}

export function toISO(day: number): ISODate {
  const dt = new Date(day * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday = 0 … Sunday = 6. Day 0 (1970-01-01) was a Thursday. */
export function weekdayIndex(day: number): number {
  return (((day + 3) % 7) + 7) % 7;
}

export function weekdayOf(day: number): Weekday {
  return WEEKDAYS[weekdayIndex(day)]!;
}

export function addDays(iso: ISODate, n: number): ISODate {
  const d = parseISO(iso);
  if (d === null) throw new Error(`Not a date: ${iso}`);
  return toISO(d + n);
}

/** Calendar days from a to b (b − a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  const da = parseISO(a), db = parseISO(b);
  if (da === null || db === null) throw new Error(`Not a date: ${da === null ? a : b}`);
  return db - da;
}

/** Today's date in the runtime's local calendar (the user's "today"). */
export function todayLocal(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "7 Oct" (or "7 Oct 2027" when the year differs from `refYear`). */
export function formatDay(iso: ISODate, refYear?: number): string {
  const d = parseISO(iso);
  if (d === null) return iso;
  const dt = new Date(d * MS_PER_DAY);
  const base = `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
  return refYear !== undefined && dt.getUTCFullYear() !== refYear ? `${base} ${dt.getUTCFullYear()}` : base;
}

/** "Wed 7 Oct". */
export function formatDayLong(iso: ISODate, refYear?: number): string {
  const d = parseISO(iso);
  if (d === null) return iso;
  return `${DOW[weekdayIndex(d)]} ${formatDay(iso, refYear)}`;
}

export function monthName(monthIndex: number): string {
  return MONTHS[monthIndex] ?? '';
}

export function dayParts(iso: ISODate): { year: number; month: number; day: number; weekday: number } {
  const d = parseISO(iso);
  if (d === null) throw new Error(`Not a date: ${iso}`);
  const dt = new Date(d * MS_PER_DAY);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth(), day: dt.getUTCDate(), weekday: weekdayIndex(d) };
}

/**
 * Parses the date formats people actually type: ISO, "7 Oct", "Oct 7", "7.10.2026", "07/10/2026" (day first),
 * "2026/10/07". Year-less dates resolve to the next occurrence on or after `ref` (minus a two-month grace,
 * so a deadline that just passed still reads as this year).
 */
export function parseLooseDate(input: string, ref: ISODate): ISODate | null {
  const s = input.trim().replace(/(st|nd|rd|th)\b/gi, '').replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  const iso = parseISO(s);
  if (iso !== null) return toISO(iso);
  const refDay = parseISO(ref) ?? 0;
  const refYear = new Date(refDay * MS_PER_DAY).getUTCFullYear();
  const make = (y: number | null, m: number, d: number): ISODate | null => {
    if (y !== null) {
      const full = y < 100 ? 2000 + y : y;
      const v = parseISO(`${full}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      return v === null ? null : toISO(v);
    }
    for (const yr of [refYear, refYear + 1]) {
      const v = parseISO(`${yr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      if (v !== null && v >= refDay - 60) return toISO(v);
    }
    return null;
  };
  const monthOf = (word: string): number | null => {
    const i = MONTHS.findIndex((m) => word.toLowerCase().startsWith(m.toLowerCase()));
    return i === -1 ? null : i + 1;
  };
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(s))) return make(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/.exec(s))) {
    let d = Number(m[1]), mo = Number(m[2]);
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // "10/27/2026" → month first
    return make(m[3] ? Number(m[3]) : null, mo, d);
  }
  if ((m = /^(\d{1,2}) ([A-Za-z]{3,})\.?(?: (\d{2,4}))?$/.exec(s))) {
    const mo = monthOf(m[2]!);
    return mo ? make(m[3] ? Number(m[3]) : null, mo, Number(m[1])) : null;
  }
  if ((m = /^([A-Za-z]{3,})\.? (\d{1,2})(?: (\d{2,4}))?$/.exec(s))) {
    const mo = monthOf(m[1]!);
    return mo ? make(m[3] ? Number(m[3]) : null, mo, Number(m[2])) : null;
  }
  return null;
}
