import { FEATURES, type Features } from './features';
import { isISODate, parseISO, todayLocal, toISO } from './dates';
import {
  WEEKDAYS,
  type DateSpan,
  type ISODate,
  type Issue,
  type NormalizedItem,
  type NormalizedLane,
  type NormalizedPlan,
  type NormalizedWork,
  type Weekday,
} from './types';

export const LIMITS = { items: 500, lanes: 50, partsPerItem: 20, maxDays: 10_000 } as const;
/** The name of a plan nobody has named yet. */
export const DEFAULT_TITLE = 'Untitled WhenShip';
export const DEFAULT_WORKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
/** Eight lane colours: distinct from each other, from the app's indigo, and from grey (used for "nobody"). */
export const PALETTE = ['#12b886', '#f59f00', '#e64980', '#7950f2', '#15aabf', '#fd7e14', '#82c91e', '#be4bdb'];

export interface ValidationResult {
  plan: NormalizedPlan;
  /** Input that could not be used (and was dropped). */
  errors: Issue[];
  /** Input that was auto-corrected or filled in. */
  warnings: Issue[];
}

export interface ValidateOptions {
  /** Used when the plan has no start date. Defaults to today's local date. */
  today?: ISODate;
  /** Override product switches (tests). */
  features?: Partial<Features>;
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Thousands vs decimal separators: "85,000" and "85.000" → 85000; "1,234.5" and "1.234,5" → 1234.5; "2,5" → 2.5.
 */
function normalizeSeparators(s: string): string {
  return s.replace(/\d[\d.,]*\d/g, (num) => {
    const commas = (num.match(/,/g) ?? []).length;
    const dots = (num.match(/\./g) ?? []).length;
    if (commas && dots) return num.lastIndexOf(',') > num.lastIndexOf('.') ? num.replace(/\./g, '').replace(',', '.') : num.replace(/,/g, '');
    const sep = commas ? ',' : dots ? '.' : '';
    if (!sep) return num;
    const groups = num.split(sep);
    const thousands = groups.length > 2 || (groups[1]!.length === 3 && groups[0]!.length <= 3 && groups[0] !== '0');
    return thousands ? groups.join('') : groups.join('.');
  });
}

/** Accepts numbers and strings like "5", "5d", "2.5 days", "2w", "[Pend] 6 Days", "100k", "1.2m". */
export function parseNumberish(value: unknown, unit: 'days' | 'money' = 'days'): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const s = normalizeSeparators(value.toLowerCase());
  const m = /(-?\d+(?:\.\d+)?)\s*(k|m|w|wk|wks|weeks?|d|days?|h|hrs?|hours?)?\b/.exec(s);
  if (!m) return null;
  let n = Number(m[1]);
  const u = m[2] ?? '';
  if (unit === 'money') {
    if (u === 'k') n *= 1_000;
    if (u === 'm') n *= 1_000_000;
  } else {
    if (u.startsWith('w')) n *= 5;
    if (u.startsWith('h')) n /= 8;
  }
  return Number.isFinite(n) ? n : null;
}

export function parseWeekday(value: unknown): Weekday | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().slice(0, 3);
  const alias: Record<string, Weekday> = { mo: 'mon', tu: 'tue', we: 'wed', th: 'thu', fr: 'fri', sa: 'sat', su: 'sun' };
  if ((WEEKDAYS as readonly string[]).includes(key)) return key as Weekday;
  return alias[key.slice(0, 2)] ?? null;
}

function spanList(raw: unknown, path: string, errors: Issue[]): (DateSpan & { to: ISODate })[] {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: (DateSpan & { to: ISODate })[] = [];
  list.forEach((entry, i) => {
    const p = `${path}[${i}]`;
    const obj = typeof entry === 'string' ? { from: entry } : entry;
    if (!isObj(obj) || !isISODate(obj.from)) {
      errors.push({ path: p, message: 'needs a date like 2026-10-03 (or {from, to})' });
      return;
    }
    let from = String(obj.from), to = isISODate(obj.to) ? String(obj.to) : from;
    if (parseISO(to)! < parseISO(from)!) [from, to] = [to, from];
    const span: DateSpan & { to: ISODate } = { from, to };
    if (typeof obj.label === 'string' && obj.label.trim()) span.label = obj.label.trim();
    out.push(span);
  });
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

function uniqueId(base: string, taken: Set<string>, fallback: string): string {
  let id = slugify(base) || fallback;
  if (taken.has(id)) {
    let n = 2;
    while (taken.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  taken.add(id);
  return id;
}

/**
 * Turns whatever a person or an assistant wrote into a clean plan.
 * It is forgiving (fills defaults, resolves lane names, accepts `{lane, days}` shorthand on items) and reports
 * every fix as a warning and every unusable piece as an error, with a precise path.
 */
export function validatePlan(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const features: Features = { ...FEATURES, ...options.features };
  const raw: Loose = isObj(input) ? input : {};
  if (!isObj(input)) errors.push({ path: '', message: 'a plan must be an object with lanes and items' });

  // ── basics ──────────────────────────────────────────────────────────────
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 120) : DEFAULT_TITLE;
  let start: ISODate;
  if (isISODate(raw.start)) start = toISO(parseISO(String(raw.start))!);
  else {
    start = options.today ?? todayLocal();
    if (raw.start !== undefined) errors.push({ path: 'start', message: `"${String(raw.start)}" is not a date; using ${start}` });
  }
  const currency = features.itemValue && typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency.trim().slice(0, 8) : undefined;
  let valuesIgnored = false;

  // ── calendar ────────────────────────────────────────────────────────────
  const cal = isObj(raw.calendar) ? raw.calendar : {};
  let workdays: Weekday[] = DEFAULT_WORKDAYS;
  const rawWorkdays = cal.workdays ?? raw.workdays;
  if (Array.isArray(rawWorkdays)) {
    const parsed = [...new Set(rawWorkdays.map(parseWeekday).filter((d): d is Weekday => d !== null))];
    if (parsed.length === 0) errors.push({ path: 'calendar.workdays', message: 'needs at least one working day; using Mon–Fri' });
    else workdays = WEEKDAYS.filter((d) => parsed.includes(d));
  }
  const holidays = spanList(cal.holidays ?? raw.holidays, 'calendar.holidays', errors);

  // ── lanes ───────────────────────────────────────────────────────────────
  const laneIds = new Set<string>();
  const lanes: NormalizedLane[] = [];
  const laneByKey = new Map<string, NormalizedLane>();
  const registerLane = (lane: NormalizedLane) => {
    lanes.push(lane);
    laneByKey.set(lane.id.toLowerCase(), lane);
    laneByKey.set(lane.name.toLowerCase(), lane);
    laneByKey.set(slugify(lane.name), lane);
  };
  const rawLanes = Array.isArray(raw.lanes) ? raw.lanes : [];
  if (raw.lanes !== undefined && !Array.isArray(raw.lanes)) errors.push({ path: 'lanes', message: 'must be a list' });
  rawLanes.slice(0, LIMITS.lanes).forEach((entry, i) => {
    const p = `lanes[${i}]`;
    const obj: Loose = typeof entry === 'string' ? { name: entry } : isObj(entry) ? entry : {};
    if (!isObj(entry) && typeof entry !== 'string') {
      errors.push({ path: p, message: 'must be an object like {"name": "Sara"}' });
      return;
    }
    const name = (typeof obj.name === 'string' && obj.name.trim()) || (typeof obj.id === 'string' && obj.id.trim()) || `Lane ${i + 1}`;
    const id = uniqueId(typeof obj.id === 'string' && obj.id.trim() ? obj.id : name, laneIds, `lane-${i + 1}`);
    let size = parseNumberish(obj.size ?? obj.people ?? obj.headcount ?? obj.fte, 'days');
    if (size === null) size = 1;
    if (size < 0) {
      errors.push({ path: `${p}.size`, message: 'cannot be negative; using 0' });
      size = 0;
    }
    let availability = parseNumberish(obj.availability ?? obj.capacity, 'days');
    if (availability === null) availability = 100;
    if (availability > 0 && availability <= 1 && (obj.availability ?? obj.capacity) !== undefined && !String(obj.availability ?? obj.capacity).includes('%')) {
      availability = availability * 100; // 0.8 → 80 %
      warnings.push({ path: `${p}.availability`, message: `read as ${availability}%` });
    }
    if (availability < 0 || availability > 100) {
      warnings.push({ path: `${p}.availability`, message: 'must be between 0 and 100 %' });
      availability = Math.min(100, Math.max(0, availability));
    }
    const kind = obj.kind === 'person' || obj.kind === 'team' ? obj.kind : size > 1 ? 'team' : 'person';
    const color = typeof obj.color === 'string' && /^#[0-9a-f]{6}$/i.test(obj.color) ? obj.color : PALETTE[i % PALETTE.length]!;
    let daysOff: NormalizedLane['daysOff'] = [];
    if (features.personDaysOff) daysOff = spanList(obj.daysOff, `${p}.daysOff`, errors);
    else if (Array.isArray(obj.daysOff) && obj.daysOff.length) {
      warnings.push({ path: `${p}.daysOff`, message: 'days off per person are turned off for now; ignored (holidays for everyone still work)' });
    }
    registerLane({ id, name: name.slice(0, 60), kind, size, availability, daysOff, color });
  });
  if (rawLanes.length > LIMITS.lanes) errors.push({ path: 'lanes', message: `only the first ${LIMITS.lanes} lanes are used` });

  const resolveLane = (ref: unknown, path: string, create: boolean): NormalizedLane | null => {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    const key = ref.trim().toLowerCase();
    const hit = laneByKey.get(key) ?? laneByKey.get(slugify(ref));
    if (hit) return hit;
    if (!create || lanes.length >= LIMITS.lanes) return null;
    const lane: NormalizedLane = {
      id: uniqueId(ref, laneIds, `lane-${lanes.length + 1}`),
      name: ref.trim().slice(0, 60),
      kind: 'person',
      size: 1,
      availability: 100,
      daysOff: [],
      color: PALETTE[lanes.length % PALETTE.length]!,
    };
    registerLane(lane);
    warnings.push({ path, message: `added "${lane.name}" as a person (not in lanes)` });
    return lane;
  };

  // ── items ───────────────────────────────────────────────────────────────
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  if (raw.items !== undefined && !Array.isArray(raw.items)) errors.push({ path: 'items', message: 'must be a list' });
  if (rawItems.length > LIMITS.items) errors.push({ path: 'items', message: `only the first ${LIMITS.items} items are used` });
  const itemIds = new Set<string>();
  const items: NormalizedItem[] = [];
  const pendingDeps: { item: NormalizedItem; refs: unknown[]; path: string }[] = [];

  rawItems.slice(0, LIMITS.items).forEach((entry, i) => {
    const p = `items[${i}]`;
    if (!isObj(entry)) {
      errors.push({ path: p, message: 'must be an object like {"name": "…", "work": [{"lane": "…", "days": 3}]}' });
      return;
    }
    const name = (typeof entry.name === 'string' && entry.name.trim()) || (typeof entry.title === 'string' && entry.title.trim()) || `Item ${i + 1}`;
    const id = uniqueId(typeof entry.id === 'string' && entry.id.trim() ? entry.id : name, itemIds, `item-${i + 1}`);
    if (typeof entry.id === 'string' && entry.id.trim() && slugify(entry.id) !== id) warnings.push({ path: `${p}.id`, message: `renamed to "${id}" (ids must be unique)` });

    // work: full form, or shorthand {lane|who|owner, days|effort}
    let rawWork: unknown[] = Array.isArray(entry.work) ? entry.work : [];
    if (!Array.isArray(entry.work)) {
      const who = entry.lane ?? entry.who ?? entry.owner ?? entry.assignee;
      const days = entry.days ?? entry.effort ?? entry.estimate;
      if (who !== undefined || days !== undefined) rawWork = [{ lane: who ?? (lanes[0]?.id ?? 'Me'), days: days ?? 0 }];
    }
    const work: NormalizedWork[] = [];
    rawWork.slice(0, LIMITS.partsPerItem).forEach((w, j) => {
      const wp = `${p}.work[${j}]`;
      if (!isObj(w)) {
        errors.push({ path: wp, message: 'must be {"lane": "…", "days": number}' });
        return;
      }
      const ref = w.lane ?? w.who ?? w.owner;
      const lane =
        ref !== undefined && ref !== null && ref !== ''
          ? resolveLane(ref, `${wp}.lane`, true)
          : lanes.length === 1
            ? lanes[0]!
            : lanes.length === 0
              ? resolveLane('Me', `${wp}.lane`, true)
              : null;
      if (!lane) {
        errors.push({ path: `${wp}.lane`, message: `unknown lane "${String(w.lane ?? '')}"` });
        return;
      }
      let days = parseNumberish(w.days ?? w.effort ?? w.estimate, 'days');
      if (days === null) {
        errors.push({ path: `${wp}.days`, message: 'needs a number of working days' });
        days = 0;
      }
      if (days < 0) {
        errors.push({ path: `${wp}.days`, message: 'cannot be negative; using 0' });
        days = 0;
      }
      if (days > LIMITS.maxDays) {
        errors.push({ path: `${wp}.days`, message: `capped at ${LIMITS.maxDays}` });
        days = LIMITS.maxDays;
      }
      let maxPeople = parseNumberish(w.maxPeople ?? w.parallel ?? w.maxParallel, 'days') ?? 1;
      if (maxPeople < 1) maxPeople = 1;
      const part: NormalizedWork = { lane: lane.id, days, maxPeople };
      if (w.after !== undefined) {
        const afterLane = resolveLane(w.after, `${wp}.after`, false);
        if (afterLane) part.after = afterLane.id;
        else warnings.push({ path: `${wp}.after`, message: `ignored: no lane "${String(w.after)}"` });
      }
      const existing = work.find((x) => x.lane === part.lane);
      if (existing) {
        existing.days += part.days; // two parts for the same lane → one part
        warnings.push({ path: wp, message: `merged with the other ${lane.name} part` });
      } else work.push(part);
    });
    // hand-offs must point at another part of this item, without cycles
    for (const part of work) {
      if (part.after && (part.after === part.lane || !work.some((x) => x.lane === part.after))) {
        warnings.push({ path: `${p}.work`, message: `hand-off after "${part.after}" ignored (no such part in this item)` });
        delete part.after;
      }
    }
    for (const part of work) {
      const seen = new Set<string>([part.lane]);
      let cur = part.after;
      while (cur) {
        if (seen.has(cur)) {
          warnings.push({ path: `${p}.work`, message: 'circular hand-off ignored' });
          delete part.after;
          break;
        }
        seen.add(cur);
        cur = work.find((x) => x.lane === cur)?.after;
      }
    }

    const item: NormalizedItem = { id, name: name.slice(0, 120), work, dependsOn: [] };
    for (const key of ['deadline', 'notBefore'] as const) {
      const v = entry[key] ?? (key === 'deadline' ? entry.due ?? entry.dueDate : entry.blockedUntil);
      if (v === undefined || v === null || v === '') continue;
      if (isISODate(v)) item[key] = toISO(parseISO(String(v))!);
      else errors.push({ path: `${p}.${key}`, message: `"${String(v)}" is not a date like 2026-10-07` });
    }
    if (!features.itemValue) {
      if (entry.value !== undefined && entry.value !== null && entry.value !== '') valuesIgnored = true;
    } else {
      const value = parseNumberish(entry.value, 'money');
      if (value !== null && value >= 0) item.value = value;
      else if (entry.value !== undefined && entry.value !== null && entry.value !== '') errors.push({ path: `${p}.value`, message: 'must be a number' });
    }
    if (typeof entry.note === 'string' && entry.note.trim()) item.note = entry.note.trim().slice(0, 500);
    const deps = entry.dependsOn ?? entry.after ?? entry.depends;
    if (deps !== undefined) pendingDeps.push({ item, refs: Array.isArray(deps) ? deps : [deps], path: `${p}.dependsOn` });
    items.push(item);
  });

  // dependencies may point forward, so resolve them once every item exists
  const itemByKey = new Map<string, NormalizedItem>();
  for (const it of items) itemByKey.set(it.id, it);
  for (const it of items) if (!itemByKey.has(it.name.toLowerCase())) itemByKey.set(it.name.toLowerCase(), it); // first item with a name wins
  for (const { item, refs, path } of pendingDeps) {
    for (const ref of refs) {
      const hit = typeof ref === 'string' ? itemByKey.get(ref) ?? itemByKey.get(ref.toLowerCase()) ?? itemByKey.get(slugify(ref)) : undefined;
      if (!hit) warnings.push({ path, message: `ignored: no item "${String(ref)}"` });
      else if (hit === item) warnings.push({ path, message: 'an item cannot depend on itself' });
      else if (!item.dependsOn.includes(hit.id)) item.dependsOn.push(hit.id);
    }
  }

  if (valuesIgnored) warnings.push({ path: 'items', message: 'values (money at stake) are turned off for now; ignored' });
  const plan: NormalizedPlan = { version: 1, title, start, calendar: { workdays, holidays }, lanes, items };
  if (currency) plan.currency = currency;
  return { plan, errors, warnings };
}

/** Strips defaults so saved files and links stay small and readable. Inverse of `validatePlan`. */
export function compactPlan(plan: NormalizedPlan): Record<string, unknown> {
  const out: Record<string, unknown> = { version: 1, title: plan.title, start: plan.start };
  if (plan.currency) out.currency = plan.currency;
  const sameDays = plan.calendar.workdays.join() === DEFAULT_WORKDAYS.join();
  if (!sameDays || plan.calendar.holidays.length) {
    const cal: Record<string, unknown> = {};
    if (!sameDays) cal.workdays = plan.calendar.workdays;
    if (plan.calendar.holidays.length) cal.holidays = plan.calendar.holidays.map(compactSpan);
    out.calendar = cal;
  }
  out.lanes = plan.lanes.map((l, i) => {
    const lane: Record<string, unknown> = { id: l.id, name: l.name };
    if (l.kind !== (l.size > 1 ? 'team' : 'person')) lane.kind = l.kind;
    if (l.size !== 1) lane.size = l.size;
    if (l.availability !== 100) lane.availability = l.availability;
    if (l.daysOff.length) lane.daysOff = l.daysOff.map(compactSpan);
    if (l.color !== PALETTE[i % PALETTE.length]) lane.color = l.color;
    return lane;
  });
  out.items = plan.items.map((it) => {
    const item: Record<string, unknown> = { id: it.id, name: it.name };
    item.work = it.work.map((w) => {
      const part: Record<string, unknown> = { lane: w.lane, days: w.days };
      if (w.maxPeople !== 1) part.maxPeople = w.maxPeople;
      if (w.after) part.after = w.after;
      return part;
    });
    if (it.deadline) item.deadline = it.deadline;
    if (it.value !== undefined) item.value = it.value;
    if (it.dependsOn.length) item.dependsOn = it.dependsOn;
    if (it.notBefore) item.notBefore = it.notBefore;
    if (it.note) item.note = it.note;
    return item;
  });
  return out;
}

function compactSpan(s: DateSpan & { to: ISODate }): DateSpan {
  const span: DateSpan = { from: s.from };
  if (s.to !== s.from) span.to = s.to;
  if (s.label) span.label = s.label;
  return span;
}
