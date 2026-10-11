import { applyChanges, type Change } from './changes';
import { formatDay, parseISO } from './dates';
import { formatMoney } from './analysis';
import { LENSES, lensById, type LensId } from './lens';
import { schedule, type Schedule } from './schedule';
import { FEATURES, type Features } from './features';
import type { NormalizedPlan } from './types';

export type InsightKind = 'reorder' | 'defer' | 'availability' | 'add-person' | 'deadline';

export interface Insight {
  id: string;
  kind: InsightKind;
  /** Short imperative, e.g. `Move "Nimbus Finance" up to #2`. */
  title: string;
  /** What it changes, in plain words, e.g. "2 more deadlines met (A, B) · all done 10 days sooner". */
  effect: string;
  changes: Change[];
  deltas: { met: number; metAtNextLens: number; lateDays: number; valueLate: number; endDays: number };
  newlyMet: string[];
  newlyMissed: string[];
}

interface Metrics {
  met: Set<string>;
  metNext: number;
  lateDays: number;
  valueLate: number;
  end: number;
}

const COST: Record<InsightKind, number> = { reorder: 0, defer: 0, availability: 1, 'add-person': 2, deadline: 3 };

function measure(plan: NormalizedPlan, factor: number, nextFactor: number): Metrics {
  const s = schedule(plan, { factor });
  const next = nextFactor === factor ? s : schedule(plan, { factor: nextFactor });
  const met = new Set<string>();
  let lateDays = 0, valueLate = 0, metNext = 0;
  for (const it of plan.items) {
    if (!it.deadline) continue;
    const r = s.byId.get(it.id)!;
    if (r.end !== undefined && !r.late) met.add(it.id);
    else {
      lateDays += r.slack !== undefined ? -r.slack : 0;
      valueLate += it.value ?? 0;
    }
    const rn = next.byId.get(it.id)!;
    if (rn.end !== undefined && !rn.late) metNext++;
  }
  return { met, metNext, lateDays, valueLate, end: s.endIndex ?? 0 };
}

/**
 * Searches realistic changes that would meet more deadlines (or make the plan sturdier) and returns the best few.
 * Everything is a real re-plan through the same engine, so every number in a suggestion is exact.
 */
export function findInsights(plan: NormalizedPlan, lens: LensId = 'planned', limit = 3, features: Pick<Features, 'itemValue'> = FEATURES): Insight[] {
  if (plan.items.length === 0 || plan.items.length > 200) return [];
  const factor = lensById(lens).factor;
  const nextLens = LENSES[Math.min(LENSES.findIndex((l) => l.factor === factor) + 1, LENSES.length - 1)] ?? LENSES[0]!;
  const nextFactor = nextLens.factor;
  const base = measure(plan, factor, nextFactor);
  const baseSchedule: Schedule = schedule(plan, { factor });
  const nameOf = new Map(plan.items.map((it) => [it.id, it.name]));
  const year = new Date(parseISO(plan.start)! * 86_400_000).getUTCFullYear();
  const candidates: Omit<Insight, 'effect' | 'deltas' | 'newlyMet' | 'newlyMissed' | 'id'>[] = [];

  // capacity: one more person, or someone part-time going full-time
  for (const lane of plan.lanes) {
    const used = plan.items.some((it) => it.work.some((w) => w.lane === lane.id && w.days > 0));
    if (!used) continue;
    candidates.push({
      kind: 'add-person',
      title: lane.kind === 'team' ? `+1 ${lane.name}` : `A second person for ${lane.name}'s work`,
      changes: [{ op: 'setLane', lane: lane.id, size: lane.size + 1 }],
    });
    if (lane.availability < 100) {
      candidates.push({
        kind: 'availability',
        title: `${lane.name} at 100% instead of ${lane.availability}%`,
        changes: [{ op: 'setLane', lane: lane.id, availability: 100 }],
      });
    }
  }

  // reorder: the smallest move up that rescues a late dated item (or, if nothing is late, top priority for a fragile one)
  const lateIds = plan.items.filter((it) => it.deadline && !base.met.has(it.id)).map((it) => it.id);
  const rescuedAt = (id: string, pos: number) => {
    const r = schedule(applyChanges(plan, [{ op: 'move', item: id, to: pos }]).plan, { factor }).byId.get(id);
    return r?.end !== undefined && !r.late;
  };
  for (const id of lateIds.slice(0, 8)) {
    const idx = plan.items.findIndex((it) => it.id === id);
    if (idx === 0 || !rescuedAt(id, 0)) continue; // even first place doesn't save it: not a reordering problem
    // An item never finishes later when it moves up, so binary-search the lowest rank that still saves it.
    let lo = 0, hi = idx - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (rescuedAt(id, mid)) lo = mid;
      else hi = mid - 1;
    }
    candidates.push({ kind: 'reorder', title: lo === 0 ? `Move "${nameOf.get(id)}" to the top` : `Move "${nameOf.get(id)}" up to #${lo + 1}`, changes: [{ op: 'move', item: id, to: lo }] });
  }
  if (!lateIds.length) {
    for (const it of plan.items) {
      const i = plan.items.indexOf(it);
      if (i > 0 && it.deadline && (baseSchedule.byId.get(it.id)?.slack ?? 99) <= 2 && candidates.filter((c) => c.kind === 'reorder').length < 6) {
        candidates.push({ kind: 'reorder', title: `Move "${it.name}" to the top`, changes: [{ op: 'move', item: it.id, to: 0 }] });
      }
    }
  }

  // defer: undated work sitting in front of late deadlines (the biggest pieces first)
  const lastLate = Math.max(-1, ...lateIds.map((id) => plan.items.findIndex((it) => it.id === id)));
  const effort = (it: NormalizedPlan['items'][number]) => it.work.reduce((t, w) => t + w.days, 0);
  plan.items
    .filter((it, i) => i < lastLate && !it.deadline && effort(it) > 0)
    .sort((a, b) => effort(b) - effort(a))
    .slice(0, 6)
    .forEach((it) => candidates.push({ kind: 'defer', title: `Do "${it.name}" after the dated work`, changes: [{ op: 'move', item: it.id, to: plan.items.length - 1 }] }));
  // defer the lowest-value dated item that is in the way (only while values are switched on)
  const inTheWay = features.itemValue ? plan.items.filter((it, i) => i < lastLate && it.deadline && it.value !== undefined).sort((a, b) => (a.value ?? 0) - (b.value ?? 0)) : [];
  if (inTheWay[0]) {
    candidates.push({ kind: 'defer', title: `Postpone "${inTheWay[0].name}" (lowest value in the way)`, changes: [{ op: 'move', item: inTheWay[0].id, to: plan.items.length - 1 }] });
  }

  // negotiate: the date a late item would really need
  for (const id of lateIds.slice(0, 5)) {
    const r = baseSchedule.byId.get(id);
    if (!r?.endDate || r.slack === undefined) continue;
    candidates.push({
      kind: 'deadline',
      title: `Ask for ${-r.slack} more working day${r.slack === -1 ? '' : 's'} on "${r.name}" (until ${formatDay(r.endDate, year)})`,
      changes: [{ op: 'setDeadline', item: id, date: r.endDate }],
    });
  }

  // score every candidate with a real re-plan
  const scored: Insight[] = [];
  for (const c of candidates) {
    const m = measure(applyChanges(plan, c.changes).plan, factor, nextFactor);
    const newlyMet = [...m.met].filter((id) => !base.met.has(id));
    const newlyMissed = [...base.met].filter((id) => !m.met.has(id));
    const deltas = {
      met: m.met.size - base.met.size,
      metAtNextLens: m.metNext - base.metNext,
      lateDays: base.lateDays - m.lateDays,
      valueLate: features.itemValue ? base.valueLate - m.valueLate : 0,
      endDays: base.end - m.end,
    };
    const useful = deltas.met > 0 || (deltas.met === 0 && (deltas.metAtNextLens > 0 || (c.kind !== 'deadline' && (deltas.lateDays > 0 || deltas.endDays >= 3))));
    if (!useful || deltas.met < 0) continue;
    scored.push({ ...c, id: `${c.kind}:${JSON.stringify(c.changes)}`, deltas, newlyMet, newlyMissed, effect: describe(deltas, newlyMet, newlyMissed, nameOf, plan, nextLens.label, features.itemValue) });
  }
  scored.sort(
    (a, b) =>
      b.deltas.met - a.deltas.met ||
      COST[a.kind] - COST[b.kind] ||
      b.deltas.metAtNextLens - a.deltas.metAtNextLens ||
      b.deltas.valueLate - a.deltas.valueLate ||
      b.deltas.lateDays - a.deltas.lateDays ||
      b.deltas.endDays - a.deltas.endDays,
  );
  const picked: Insight[] = [];
  const perKind = new Map<InsightKind, number>();
  const touched = new Set<string>();
  for (const s of scored) {
    if (picked.length >= limit) break;
    const key = s.changes.map((ch) => ('item' in ch ? ch.item : 'lane' in ch ? String(ch.lane) : ch.op)).join();
    if (touched.has(key) || (perKind.get(s.kind) ?? 0) >= 2) continue;
    touched.add(key);
    perKind.set(s.kind, (perKind.get(s.kind) ?? 0) + 1);
    picked.push(s);
  }
  return picked;
}

function describe(
  d: Insight['deltas'],
  met: string[],
  missed: string[],
  names: Map<string, string>,
  plan: NormalizedPlan,
  nextLabel: string,
  withValue: boolean,
): string {
  const list = (ids: string[]) => ids.slice(0, 3).map((id) => names.get(id)).join(', ') + (ids.length > 3 ? ', …' : '');
  const parts: string[] = [];
  if (d.met > 0) parts.push(`${d.met} more deadline${d.met === 1 ? '' : 's'} met (${list(met)})`);
  if (missed.length) parts.push(`but ${list(missed)} slip${missed.length === 1 ? 's' : ''}`);
  if (d.met === 0 && d.metAtNextLens > 0) parts.push(`${d.metAtNextLens} more deadline${d.metAtNextLens === 1 ? ' survives' : 's survive'} the "${nextLabel}" lens`);
  if (withValue && d.valueLate > 0 && plan.items.some((it) => it.value)) parts.push(`${formatMoney(d.valueLate, plan.currency)} less at risk`);
  if (d.met <= 0 && d.lateDays > 0) parts.push(`${d.lateDays} fewer days late`);
  if (d.endDays > 0) parts.push(`all done ${d.endDays} working day${d.endDays === 1 ? '' : 's'} sooner`);
  return parts.join(' · ');
}
