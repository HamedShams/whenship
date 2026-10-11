import { analyze, badgeLabel, criticalChain, explain, formatMoney, headline, type Analysis } from './analysis';
import { formatDay, formatDayLong, parseISO } from './dates';
import { findInsights, type Insight } from './insights';
import { LENSES, lensById, type LensId } from './lens';
import { FEATURES } from './features';
import type { NormalizedPlan } from './types';

const yearOf = (iso: string) => new Date(parseISO(iso)! * 86_400_000).getUTCFullYear();
const DAY_NAMES: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export function describeWorkdays(plan: NormalizedPlan): string {
  const off = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).filter((d) => !plan.calendar.workdays.includes(d));
  return off.length ? `off on ${off.map((d) => DAY_NAMES[d]).join(' & ')}` : 'every day is a working day';
}

/** Who-does-what, e.g. "Sara 5d + Omar 1d (after Omar)". */
export function describeWork(plan: NormalizedPlan, itemId: string): string {
  const it = plan.items.find((x) => x.id === itemId);
  if (!it || !it.work.length) return '—';
  return it.work
    .map((w) => {
      const lane = plan.lanes.find((l) => l.id === w.lane);
      const name = lane?.name ?? w.lane;
      const after = w.after ? ` after ${plan.lanes.find((l) => l.id === w.after)?.name ?? w.after}` : '';
      const ppl = w.maxPeople > 1 ? ` (≤${w.maxPeople} people)` : '';
      return `${name} ${trim(w.days)}d${ppl}${after}`;
    })
    .join(' + ');
}
const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export interface ReportOptions {
  lens?: LensId;
  insights?: Insight[] | false;
  maxRows?: number;
  /** Mention the method note (lens multipliers). */
  method?: boolean;
}

/**
 * The plan as Markdown: headline, assumptions, a table with finish dates and deadline status, what drives the end
 * date, and the best suggestions. Used as the tool answer (complete without the chart) and the Markdown export.
 */
export function renderReport(plan: NormalizedPlan, options: ReportOptions = {}): string {
  const a: Analysis = analyze(plan, options.lens ?? 'planned');
  const lens = lensById(a.lens);
  const year = yearOf(plan.start);
  const lines: string[] = [];
  lines.push(`## ${plan.title}`);
  lines.push('');
  lines.push(`**${capitalize(headline(a))}.**`);
  lines.push('');
  const holidays = plan.calendar.holidays.length ? `, ${plan.calendar.holidays.length} holiday${plan.calendar.holidays.length === 1 ? '' : 's'}` : '';
  const people = plan.lanes
    .map((l) => `${l.name}${l.kind === 'team' ? ` ×${trim(l.size)}` : ''}${l.availability !== 100 ? ` at ${trim(l.availability)}%` : ''}`)
    .join(', ');
  lines.push(`Assumptions: starts ${formatDayLong(plan.start, year)}; ${describeWorkdays(plan)}${holidays}; people: ${people || 'none yet'}.` + (lens.factor !== 1 ? ` Dates below use the **${lens.label} (${lens.short})** lens.` : ''));
  lines.push('');
  const rows = a.current.items.slice(0, options.maxRows ?? 60);
  const hasValue = FEATURES.itemValue && plan.items.some((it) => it.value !== undefined);
  lines.push(`| # | Item | Who | Start | Finish | Deadline | Status${hasValue ? ' | Value' : ''} |`);
  lines.push(`|---|---|---|---|---|---|---|${hasValue ? '---|' : ''}`);
  rows.forEach((r, i) => {
    const it = plan.items[i]!;
    const o = a.outlook.get(r.id);
    const b = a.status.get(r.id);
    const status =
      r.status === 'blocked' ? `⛔ ${r.problem}` : r.status === 'empty' ? 'no effort yet' : o && b ? statusText(b, o.chance, r.slack) : '—';
    const cells = [
      String(i + 1),
      it.name.replace(/\|/g, '/'),
      describeWork(plan, it.id),
      r.startDate ? formatDay(r.startDate, year) : '—',
      r.endDate ? formatDay(r.endDate, year) : '—',
      it.deadline ? formatDay(it.deadline, year) : '—',
      status,
    ];
    if (hasValue) cells.push(it.value !== undefined ? formatMoney(it.value, plan.currency) : '—');
    lines.push(`| ${cells.join(' | ')} |`);
  });
  if (a.current.items.length > rows.length) lines.push(`| … | ${a.current.items.length - rows.length} more | | | | | |${hasValue ? ' |' : ''}`);
  lines.push('');

  const chain = criticalChain(a.current);
  if (chain.length > 1) {
    const names = chain.map((id) => a.current.byId.get(id)!.name);
    lines.push(`**What sets the end date:** ${names.reverse().join(' → ')}.`);
    lines.push('');
  }
  const late = a.current.items.filter((r) => r.late);
  if (late.length) {
    lines.push('**Why the late items are late:**');
    for (const r of late.slice(0, 5)) lines.push(`- ${r.name}: ${explain(a.current, r.id).join('; ')}.`);
    lines.push('');
  }
  const insights = options.insights === false ? [] : options.insights ?? findInsights(plan, a.lens);
  if (insights.length) {
    lines.push('**Options that help:**');
    for (const s of insights) lines.push(`- ${s.title} → ${s.effect}.`);
    lines.push('');
  }
  const blocked = a.current.items.filter((r) => r.status === 'blocked');
  if (blocked.length) {
    lines.push('**Needs attention:**');
    for (const r of blocked) lines.push(`- ${r.name}: ${r.problem}.`);
    lines.push('');
  }
  if (options.method) {
    lines.push(
      `_Status uses forecast lenses: ${LENSES.map((l) => `${l.label} ${l.short}`).join(', ')}. "Safe" = on time even if work takes 2.7× as long; "tight" = on time only if everything goes to plan. The multipliers are a blended outside-view heuristic (Little 2006 + Flyvbjerg et al. 2022), not an industry standard._`,
    );
  }
  return lines.join('\n').trim();
}

export function statusText(badge: string, chance: number | undefined, slack: number | undefined): string {
  const icon = { safe: '🟢', likely: '🟢', tight: '🟠', late: '🔴', unknown: '⚪' }[badge] ?? '';
  const pct = chance !== undefined ? ` (~${Math.round(Math.min(0.99, chance) * 20) * 5}% chance)` : '';
  const slip = badge === 'late' && slack !== undefined ? `, ${-slack}d late` : '';
  return `${icon} ${badgeLabel(badge as never)}${slip}${pct}`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
