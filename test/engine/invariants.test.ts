import { describe, expect, it } from 'vitest';
import { explain, schedule, validatePlan, type NormalizedPlan, type Schedule } from '../../src/engine';
import { rng } from '../helpers';

/**
 * Audit of the scheduler on random plans: hard rules that must hold for every plan, plus an independent reference
 * implementation (written from the rules, with its own calendar maths) that must produce exactly the same dates.
 */
const EPS = 1e-6;
const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function randomPlan(seed: number): NormalizedPlan {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const laneCount = 1 + Math.floor(r() * 4);
  const lanes = Array.from({ length: laneCount }, (_, k) => {
    const team = r() < 0.4;
    return { name: `L${k}`, kind: team ? 'team' : 'person', size: team ? pick([2, 3, 5]) : 1, availability: pick([100, 100, 80, 50]) };
  });
  const workdays = r() < 0.3 ? DOW.filter(() => r() < 0.75) : undefined;
  const at = (n: number) => new Date(Date.UTC(2026, 9, 5 + n)).toISOString().slice(0, 10);
  const holidays = r() < 0.4 ? Array.from({ length: 1 + Math.floor(r() * 2) }, () => ({ from: at(Math.floor(r() * 40)), to: at(Math.floor(r() * 40) + 2) })).filter((h) => h.from <= h.to) : [];
  const n = 1 + Math.floor(r() * 20);
  const items = Array.from({ length: n }, (_, i) => {
    const used = new Set<string>();
    const parts = Array.from({ length: r() < 0.35 ? 2 : 1 }, () => {
      let lane = pick(lanes).name;
      while (used.has(lane) && used.size < lanes.length) lane = pick(lanes).name;
      used.add(lane);
      const team = lanes.find((l) => l.name === lane)!.kind === 'team';
      return { lane, days: pick([0.5, 1, 2, 3, 5, 8, 13]), ...(team ? { maxPeople: pick([1, 1, 2, 3]) } : {}) };
    });
    const work = parts.filter((p, k) => parts.findIndex((q) => q.lane === p.lane) === k);
    if (work.length === 2 && r() < 0.4) Object.assign(work[1]!, { after: work[0]!.lane });
    return {
      name: `I${i}`,
      work,
      ...(r() < 0.5 ? { deadline: at(Math.floor(r() * 60)) } : {}),
      ...(r() < 0.15 ? { notBefore: at(Math.floor(r() * 25)) } : {}),
      ...(r() < 0.25 && n > 1 ? { dependsOn: [`I${Math.floor(r() * n)}`] } : {}),
    };
  });
  return validatePlan({ start: '2026-10-05', ...(workdays && workdays.length ? { calendar: { workdays, holidays } } : { calendar: { holidays } }), lanes, items }, { today: '2026-10-05' }).plan;
}

// ── the reference scheduler ─────────────────────────────────────────────────
interface RefPart {
  start?: number;
  end?: number;
}
function reference(plan: NormalizedPlan, factor: number): { parts: RefPart[][]; load: Map<string, number[]>; days: string[] } {
  // working days: weekdays in the plan's week, minus holidays (own date maths, no shared calendar code)
  const days: string[] = [];
  const holiday = (iso: string) => plan.calendar.holidays.some((h) => iso >= h.from && iso <= h.to);
  for (let t = Date.parse(`${plan.start}T00:00:00Z`); days.length < 4000; t += 86_400_000) {
    const date = new Date(t);
    const iso = date.toISOString().slice(0, 10);
    const dow = DOW[(date.getUTCDay() + 6) % 7]!;
    if (plan.calendar.workdays.includes(dow) && !holiday(iso)) days.push(iso);
  }
  const items = plan.items;
  const idx = new Map(items.map((it, i) => [it.id, i]));
  const empty = items.map((it) => it.work.every((w) => w.days * factor <= EPS));
  // an item's urgency is its own rank, or the rank of the most urgent item waiting for it (whichever comes first)
  const urgency = items.map((_, i) => i);
  for (let changed = true; changed; ) {
    changed = false;
    items.forEach((it, i) =>
      it.dependsOn.forEach((dep) => {
        const d = idx.get(dep)!;
        if (urgency[i]! < urgency[d]!) {
          urgency[d] = urgency[i]!;
          changed = true;
        }
      }),
    );
  }
  const order = items.map((_, i) => i).sort((a, b) => urgency[a]! - urgency[b]! || a - b);
  const left = items.map((it) => it.work.map((w) => w.days * factor));
  const parts: RefPart[][] = items.map((it) => it.work.map(() => ({})));
  const end: (number | undefined)[] = items.map(() => undefined);
  const load = new Map(plan.lanes.map((l) => [l.id, [] as number[]]));
  const lane = new Map(plan.lanes.map((l) => [l.id, l]));
  const notBefore = items.map((it) => (it.notBefore ? days.findIndex((x) => x >= it.notBefore!) : 0));
  for (let d = 0; d < 3000 && left.some((l, i) => !empty[i] && l.some((x) => x > EPS)); d++) {
    const free = new Map(plan.lanes.map((l) => [l.id, (l.size * l.availability) / 100]));
    for (const i of order) {
      const it = items[i]!;
      if (empty[i] || notBefore[i]! > d) continue;
      if (it.dependsOn.some((dep) => !empty[idx.get(dep)!] && !(end[idx.get(dep)!]! < d))) continue;
      it.work.forEach((w, j) => {
        if (left[i]![j]! <= EPS) return;
        if (w.after) {
          const k = it.work.findIndex((x) => x.lane === w.after);
          if (left[i]![k]! > EPS || !(parts[i]![k]!.end! < d)) return;
        }
        const ln = lane.get(w.lane)!;
        const take = Math.min((w.maxPeople * ln.availability) / 100, left[i]![j]!, free.get(w.lane)!);
        if (take <= EPS) return;
        free.set(w.lane, free.get(w.lane)! - take);
        left[i]![j] = left[i]![j]! - take;
        const arr = load.get(w.lane)!;
        arr[d] = (arr[d] ?? 0) + take;
        if (parts[i]![j]!.start === undefined) parts[i]![j]!.start = d;
        if (left[i]![j]! <= EPS) {
          left[i]![j] = 0;
          parts[i]![j]!.end = d;
          if (it.work.every((_, q) => left[i]![q]! <= EPS)) end[i] = d;
        }
      });
    }
  }
  return { parts, load, days };
}

function checkRules(plan: NormalizedPlan, s: Schedule, factor: number) {
  const idx = new Map(plan.items.map((it, i) => [it.id, i]));
  // 1. capacity: nobody works more than they have, and only on working days
  for (const l of plan.lanes) {
    (s.load.get(l.id) ?? []).forEach((used, d) => {
      expect(used).toBeLessThanOrEqual(s.calendar.capacity(l.id, d) + EPS);
      if (used > EPS) expect(s.calendar.isWorkingDay(s.calendar.dayAt(d))).toBe(true);
    });
  }
  // 2. all effort is done, exactly once
  for (const l of plan.lanes) {
    const done = (s.load.get(l.id) ?? []).reduce((t, x) => t + (x ?? 0), 0);
    const owed = plan.items.reduce((t, it, i) => t + (s.items[i]!.status === 'scheduled' ? it.work.filter((w) => w.lane === l.id).reduce((u, w) => u + w.days * factor, 0) : 0), 0);
    expect(done).toBeCloseTo(owed, 6);
  }
  plan.items.forEach((it, i) => {
    const r = s.items[i]!;
    if (r.status !== 'scheduled') return;
    const real = r.parts.map((p, j) => ({ p, w: it.work[j]! })).filter(({ p }) => p.days > EPS);
    for (const { p, w } of real) {
      // 3. order of events
      expect(p.start).toBeLessThanOrEqual(p.end!);
      if (it.notBefore) expect(s.calendar.dateAt(p.start!) >= it.notBefore).toBe(true);
      if (w.after) {
        const k = r.parts.find((q) => q.lane === w.after)!;
        if (k.days > EPS) expect(p.start!).toBeGreaterThan(k.end!);
      }
      for (const dep of it.dependsOn) {
        const dr = s.items[idx.get(dep)!]!;
        if (dr.status === 'scheduled') expect(p.start!).toBeGreaterThan(dr.end!);
      }
      // 4. nothing finishes faster than its people allow
      const lane = plan.lanes.find((l) => l.id === w.lane)!;
      expect((p.end! - p.start! + 1) * ((w.maxPeople * lane.availability) / 100) + EPS).toBeGreaterThanOrEqual(p.days);
    }
    // 5. the item spans its parts; dates and deadline flags agree with the indexes
    expect(r.start).toBe(Math.min(...real.map(({ p }) => p.start!)));
    expect(r.end).toBe(Math.max(...real.map(({ p }) => p.end!)));
    expect(r.startDate).toBe(s.calendar.dateAt(r.start!));
    expect(r.endDate).toBe(s.calendar.dateAt(r.end!));
    if (it.deadline) expect(r.late).toBe(r.endDate! > it.deadline);
  });
}

describe('scheduler audit on random plans', () => {
  const seeds = Array.from({ length: 400 }, (_, k) => k + 1);

  it('never breaks the rules (capacity, effort, order, dependencies, hand-offs, not-before, deadlines)', () => {
    for (const seed of seeds) {
      const plan = randomPlan(seed);
      for (const factor of [1, 1.6, 2.7]) checkRules(plan, schedule(plan, { factor }), factor);
    }
  });

  it('matches an independent reference implementation exactly', () => {
    for (const seed of seeds) {
      const plan = randomPlan(seed);
      for (const factor of [1, 2.7]) {
        const s = schedule(plan, { factor });
        const ref = reference(plan, factor);
        plan.items.forEach((it, i) => {
          const r = s.items[i]!;
          if (r.status !== 'scheduled') return;
          it.work.forEach((w, j) => {
            if (w.days * factor <= EPS) return;
            const ctx = `seed ${seed} ×${factor} ${it.name}/${w.lane}`;
            expect(r.parts[j]!.start, ctx).toBe(ref.parts[i]![j]!.start);
            expect(r.parts[j]!.end, ctx).toBe(ref.parts[i]![j]!.end);
            expect(s.calendar.dateAt(r.parts[j]!.end!), ctx).toBe(ref.days[ref.parts[i]![j]!.end!]);
          });
        });
      }
    }
  });

  it('later items never change the dates of anything that does not wait for them', () => {
    for (const seed of seeds) {
      const plan = randomPlan(seed);
      const last = plan.items.at(-1)!;
      if (plan.items.length < 2 || plan.items.some((it) => it.dependsOn.includes(last.id))) continue;
      const full = schedule(plan);
      const without = schedule({ ...plan, items: plan.items.slice(0, -1) });
      without.items.forEach((r) => {
        expect([r.startDate, r.endDate], `seed ${seed} ${r.name}`).toEqual([full.byId.get(r.id)!.startDate, full.byId.get(r.id)!.endDate]);
      });
    }
  });
});

describe('one person, one thing at a time', () => {
  it('a single person works through items one after another, with no gaps and no overlap beyond a hand-over day', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const items = Array.from({ length: 2 + Math.floor(r() * 8) }, (_, i) => ({ name: `T${i}`, who: 'Sara', days: [0.5, 1, 2, 3, 5, 8][Math.floor(r() * 6)]! }));
      const p = validatePlan({ start: '2026-10-05', lanes: [{ name: 'Sara', availability: r() < 0.5 ? 100 : 50 }], items }, { today: '2026-10-05' }).plan;
      const s = schedule(p, { factor: [1, 1.6, 2.7][seed % 3]! });
      for (let k = 1; k < s.items.length; k++) {
        const prev = s.items[k - 1]!;
        const next = s.items[k]!;
        expect(next.start!, `seed ${seed}`).toBeGreaterThanOrEqual(prev.end!); // never before the previous one is done…
        expect(next.start!, `seed ${seed}`).toBeLessThanOrEqual(prev.end! + 1); // …and no idle day in between
      }
    }
  });

  it('a team of 5 runs up to 5 one-person items side by side', () => {
    const p = validatePlan(
      { start: '2026-10-05', lanes: [{ name: 'Sara', kind: 'team', size: 5 }], items: Array.from({ length: 6 }, (_, i) => ({ name: `T${i}`, who: 'Sara', days: 3 })) },
      { today: '2026-10-05' },
    ).plan;
    const s = schedule(p);
    expect(s.items.map((r) => r.startDate)).toEqual(['2026-10-05', '2026-10-05', '2026-10-05', '2026-10-05', '2026-10-05', '2026-10-08']);
  });
});

describe('priorities and prerequisites', () => {
  it("a top item's prerequisite goes first, even when it's listed further down", () => {
    const p = validatePlan(
      {
        start: '2026-10-05',
        lanes: ['Sara'],
        items: [
          { name: 'Launch', who: 'Sara', days: 2, dependsOn: ['Contract'] },
          { name: 'Nice to have', who: 'Sara', days: 5 },
          { name: 'Contract', who: 'Sara', days: 1 },
        ],
      },
      { today: '2026-10-05' },
    ).plan;
    const s = schedule(p);
    // Contract (Mon) → Launch (Tue–Wed) → Nice to have (Thu…), instead of Launch waiting behind "Nice to have"
    expect(s.byId.get('contract')!.endDate).toBe('2026-10-05');
    expect([s.byId.get('launch')!.startDate, s.byId.get('launch')!.endDate]).toEqual(['2026-10-06', '2026-10-07']);
    expect(s.byId.get('nice-to-have')!.startDate).toBe('2026-10-08');
    expect(s.byId.get('contract')!.goesEarlyFor).toBe('launch');
    expect(explain(s, 'contract').join(' ')).toMatch(/goes ahead of its place in the list because "Launch" waits for it/);
  });
});
