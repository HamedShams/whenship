import { formatDay, parseISO } from './dates';
import { deadlineOutlook, lensById, type Badge, type LensId, type Outlook } from './lens';
import { schedule, type ItemResult, type Schedule } from './schedule';
import { FEATURES, type Features } from './features';
import type { NormalizedPlan } from './types';

export interface Analysis {
  plan: NormalizedPlan;
  lens: LensId;
  /** Schedule with the user's own estimates (1×). */
  planned: Schedule;
  /** Schedule under the selected lens (same object as `planned` for "As planned"). */
  current: Schedule;
  /** How much slip each deadline survives (independent of the lens). */
  outlook: Map<string, Outlook>;
  /**
   * Deadline status as shown under the selected lens: "late" when this lens's dates miss the deadline, otherwise the
   * outlook badge. Under "As planned" it's the outlook badge.
   */
  status: Map<string, Badge>;
  /** Counts of `status`. */
  counts: Record<Badge, number>;
  /** Sum of `value` over dated items that are tight or late (0 while values are switched off). */
  valueAtRisk: number;
  dated: number;
}

export function analyze(plan: NormalizedPlan, lens: LensId = 'planned', features: Pick<Features, 'itemValue'> = FEATURES): Analysis {
  const planned = schedule(plan);
  const factor = lensById(lens).factor;
  const current = factor === 1 ? planned : schedule(plan, { factor });
  const outlook = deadlineOutlook(plan, planned);
  const status = new Map<string, Badge>();
  const counts: Record<Badge, number> = { safe: 0, likely: 0, tight: 0, late: 0, unknown: 0 };
  let valueAtRisk = 0;
  for (const it of plan.items) {
    const o = outlook.get(it.id);
    if (!o) continue;
    const b: Badge = o.badge !== 'unknown' && factor !== 1 && current.byId.get(it.id)?.late ? 'late' : o.badge;
    status.set(it.id, b);
    counts[b]++;
    if (features.itemValue && (b === 'tight' || b === 'late') && it.value) valueAtRisk += it.value;
  }
  return { plan, lens, planned, current, outlook, status, counts, valueAtRisk, dated: outlook.size };
}

/** The chain of items that sets an item's finish date (by default the last item to finish). */
export function criticalChain(s: Schedule, fromId?: string): string[] {
  let start: ItemResult | undefined = fromId ? s.byId.get(fromId) : undefined;
  if (!start) for (const r of s.items) if (r.end !== undefined && (!start || r.end > start.end!)) start = r;
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur = start;
  while (cur && !seen.has(cur.id)) {
    chain.push(cur.id);
    seen.add(cur.id);
    const next = cur.driver?.item;
    cur = next ? s.byId.get(next) : undefined;
  }
  return chain;
}

const laneName = (plan: NormalizedPlan, id?: string) => plan.lanes.find((l) => l.id === id)?.name ?? id ?? '';
const itemName = (s: Schedule, id?: string) => (id ? s.byId.get(id)?.name ?? id : '');
const round = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

/** Plain-words reasons for an item's dates: what it waited for, and who was busy with what. */
export function explain(s: Schedule, id: string): string[] {
  const r = s.byId.get(id);
  if (!r) return [];
  if (r.status === 'blocked') return [r.problem ?? "can't be scheduled"];
  if (r.status === 'empty') return ['no effort entered yet'];
  const lines: string[] = [];
  const year = parseISO(s.plan.start) !== null ? new Date(parseISO(s.plan.start)! * 86_400_000).getUTCFullYear() : undefined;
  for (const p of r.parts) {
    if (p.days <= 0) continue;
    const who = laneName(s.plan, p.lane);
    if (p.reason === 'dependency') lines.push(`${who} starts after "${itemName(s, p.reasonRef)}" is done`);
    if (p.reason === 'handoff') lines.push(`${who} starts after ${laneName(s.plan, p.reasonRef)}'s part (hand-off)`);
    if (p.reason === 'notBefore') {
      const nb = s.plan.items.find((it) => it.id === id)?.notBefore;
      lines.push(`${who} can't start before ${nb ? formatDay(nb, year) : 'its start date'} (waiting on something external)`);
    }
    const blockers = Object.entries(p.blockedBy).filter(([, v]) => v >= 0.25).sort((a, b) => b[1] - a[1]);
    if (blockers.length) {
      const total = blockers.reduce((t, [, v]) => t + v, 0);
      const list = blockers.slice(0, 3).map(([bid, v]) => `${itemName(s, bid)} ${round(v)}d`).join(', ');
      lines.push(`waits ~${round(total)} day${round(total) === '1' ? '' : 's'} for ${who} (busy with ${list}${blockers.length > 3 ? ', …' : ''})`);
    }
  }
  if (r.goesEarlyFor) lines.push(`goes ahead of its place in the list because "${itemName(s, r.goesEarlyFor)}" waits for it`);
  if (!lines.length) lines.push('starts as soon as the plan starts; nothing holds it back');
  // teams work on several items side by side: say how many of them this item gets
  const item = s.plan.items.find((x) => x.id === id);
  for (const w of item?.work ?? []) {
    const lane = s.plan.lanes.find((l) => l.id === w.lane);
    if (lane && lane.size > 1 && w.days > 0) {
      lines.push(`${lane.name} is a team of ${round(lane.size)}: ${w.maxPeople === 1 ? '1 person works' : `up to ${w.maxPeople} people work`} on this at a time, the others on other items`);
    }
  }
  if (r.deadline && r.slack !== undefined) {
    lines.push(r.slack < 0 ? `finishes ${-r.slack} working day${r.slack === -1 ? '' : 's'} after its deadline` : `has ${r.slack} working day${r.slack === 1 ? '' : 's'} of slack before its deadline`);
  }
  return lines;
}

export function badgeLabel(b: Badge): string {
  return { safe: 'safe', likely: 'likely on time', tight: 'tight', late: 'late', unknown: 'no date' }[b];
}

/** "~60%", rounded to 5; never claims certainty ("95%+", "under 5%"). */
export function chanceLabel(c: number): string {
  const p = Math.round(c * 20) * 5;
  return p >= 95 ? '95%+' : p <= 5 ? 'under 5%' : `~${p}%`;
}

/** Short badge text for narrow places (the item list). */
export function badgeShort(b: Badge): string {
  return { safe: 'safe', likely: 'likely', tight: 'tight', late: 'late', unknown: '—' }[b];
}

export function formatMoney(value: number, currency?: string): string {
  const sym = currency ?? '';
  const abs = Math.abs(value);
  const num = abs >= 1_000_000 ? `${round(value / 1_000_000)}M` : abs >= 1_000 ? `${round(value / 1_000)}k` : round(value);
  if (!sym) return num;
  return /^[A-Za-z]{3}$/.test(sym) ? `${num} ${sym.toUpperCase()}` : sym === '$' || sym === '£' ? `${sym}${num}` : `${num} ${sym}`;
}

/** One-sentence headline, e.g. "2 of 7 deadlines late even as planned · 3 tight · all done 12 Nov". */
export function headline(a: Analysis): string {
  const parts: string[] = [];
  const lens = lensById(a.lens);
  if (a.dated) {
    const one = a.dated === 1;
    if (lens.factor === 1) {
      if (a.counts.late) parts.push(one ? 'the deadline is late even as planned' : `${a.counts.late} of ${a.dated} deadlines late even as planned`);
      if (a.counts.tight) parts.push(one ? 'the deadline is tight (on time only if nothing slips)' : `${a.counts.tight} tight (on time only if nothing slips)`);
      if (!a.counts.late && !a.counts.tight) parts.push(one ? 'the deadline is on track' : `all ${a.dated} deadlines on track`);
    } else if (a.counts.late) {
      parts.push(one ? `the deadline is late if work takes ${lens.short} as long` : `${a.counts.late} of ${a.dated} deadlines late if work takes ${lens.short} as long`);
    } else {
      parts.push(one ? `the deadline holds even at ${lens.short}` : `all ${a.dated} deadlines on time even at ${lens.short}`);
    }
    if (a.valueAtRisk > 0) parts.push(`${formatMoney(a.valueAtRisk, a.plan.currency)} at risk`);
  }
  const year = parseISO(a.plan.start) !== null ? new Date(parseISO(a.plan.start)! * 86_400_000).getUTCFullYear() : undefined;
  if (a.planned.endDate) {
    parts.push(`all done ${formatDay(a.planned.endDate, year)}` + (lens.factor !== 1 && a.current.endDate ? ` (${lens.label} ${lens.short}: ${formatDay(a.current.endDate, year)})` : ''));
  }
  const blocked = a.planned.items.filter((r) => r.status === 'blocked').length;
  if (blocked) parts.push(`${blocked} item${blocked === 1 ? '' : 's'} can't be scheduled`);
  return parts.join(' · ') || 'Add items to see when they ship';
}
