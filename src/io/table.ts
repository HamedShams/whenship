import { analyze } from '../engine/analysis';
import { parseLooseDate } from '../engine/dates';
import { lensById, P90, type LensId } from '../engine/lens';
import { describeWork } from '../engine/report';
import { schedule } from '../engine/schedule';
import { FEATURES } from '../engine/features';
import { parseNumberish } from '../engine/validate';
import type { NormalizedPlan, PlanInput } from '../engine/types';

// ── import: tables, CSV, TSV, Markdown, plain lists ─────────────────────────
const SYNONYMS: Record<string, string[]> = {
  name: ['name', 'item', 'task', 'project', 'case', 'title', 'deliverable', 'feature', 'epic', 'work', 'what'],
  who: ['who', 'owner', 'assignee', 'person', 'people', 'team', 'lane', 'responsible', 'by'],
  days: ['effort', 'days', 'estimate', 'duration', 'effort needed', 'effort (days)', 'est', 'size', 'work days', 'mandays', 'person days'],
  deadline: ['deadline', 'due', 'due date', 'target', 'target deadline', 'target date', 'date', 'by date', 'ship by'],
  value: ['value', 'amount', 'budget', 'revenue', 'worth', 'price', 'deal'],
  order: ['order', 'priority', 'rank', '#', 'prio', 'no', 'nr'],
  note: ['note', 'notes', 'comment', 'comments', 'next deliverable', 'status'],
};

function classify(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z0-9#()\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!h) return null;
  for (const [field, words] of Object.entries(SYNONYMS)) if (words.includes(h)) return field;
  for (const [field, words] of Object.entries(SYNONYMS)) if (words.some((w) => w.length > 2 && h.includes(w))) return field;
  return null;
}

function splitRow(line: string, sep: string): string[] {
  if (sep === '|') return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === sep && !quoted) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Splits "Sara 3d + Omar 1d", "Sara & Omar", "Backend" into lane/day pairs. */
function parseWho(who: string, days: number | null): { lane: string; days: number }[] {
  const parts = who.split(/\s*(?:\+|&|,|;|\band\b|\/)\s*/i).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return [];
  const parsed = parts.map((p) => {
    const m = /^(.*?)\s*[:(]?\s*(\d+(?:[.,]\d+)?)\s*(d|days?|w|weeks?|h|hours?)?\)?$/i.exec(p);
    return m && m[1] ? { lane: m[1].trim(), days: parseNumberish(`${m[2]}${m[3] ?? 'd'}`, 'days') } : { lane: p, days: null };
  });
  if (parsed.every((p) => p.days === null)) {
    // one effort shared by everyone listed: the first person does it, others help 0 → give it all to the first
    return parsed.map((p, i) => ({ lane: p.lane, days: i === 0 ? days ?? 0 : 0 })).filter((p, i) => i === 0 || p.days > 0);
  }
  return parsed.map((p) => ({ lane: p.lane, days: p.days ?? 0 }));
}

/**
 * Turns a pasted table (CSV / TSV / semicolons / Markdown) or a plain list into plan input. Columns are recognised
 * by common header names; rows are sorted by an order/priority column when there is one.
 */
export function parseTable(text: string, today: string): PlanInput {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() && !/^\s*\|?\s*:?-{2,}/.test(l));
  if (!lines.length) return { items: [] };
  const first = lines[0]!;
  const sep = first.includes('\t') ? '\t' : first.includes('|') ? '|' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : first.includes(',') ? ',' : '';
  if (!sep) return { items: lines.map((l, i) => listLine(l, i, today)) };

  const header = splitRow(first, sep).map(classify);
  const hasHeader = header.filter(Boolean).length >= 2 && header.includes('name');
  const cols = hasHeader ? header : ['name', 'who', 'days', 'deadline', 'value'];
  const rows = (hasHeader ? lines.slice(1) : lines).map((l) => splitRow(l, sep));
  const items = rows
    .map((cells, i) => {
      const get = (field: string) => {
        const idx = cols.indexOf(field);
        return idx >= 0 ? (cells[idx] ?? '').trim() : '';
      };
      const name = get('name');
      if (!name) return null;
      const days = parseNumberish(get('days'), 'days');
      const whoText = get('who');
      const work = whoText ? parseWho(whoText, days) : [{ lane: 'Me', days: days ?? 0 }];
      const item: Record<string, unknown> = { name, work };
      const deadline = parseLooseDate(get('deadline'), today);
      if (deadline) item.deadline = deadline;
      if (FEATURES.itemValue) {
        const value = parseNumberish(get('value'), 'money');
        if (value !== null) item.value = value;
      }
      const note = get('note');
      if (note) item.note = note;
      const order = parseNumberish(get('order'), 'days');
      return { item, order: order ?? Number.MAX_SAFE_INTEGER, i };
    })
    .filter((x): x is { item: Record<string, unknown>; order: number; i: number } => x !== null)
    .sort((a, b) => a.order - b.order || a.i - b.i);
  const currency = !FEATURES.itemValue ? undefined : /€/.test(text) ? '€' : /\$/.test(text) ? '$' : /£/.test(text) ? '£' : undefined;
  return { ...(currency ? { currency } : {}), items: items.map((x) => x.item) };
}

function listLine(line: string, i: number, today: string): Record<string, unknown> {
  let rest = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
  const item: Record<string, unknown> = {};
  const due = /\b(?:due|by|deadline|until)\s*:?\s*([^,;()]+?)\s*(?:[,;)]|$)/i.exec(rest);
  if (due) {
    const d = parseLooseDate(due[1]!, today);
    if (d) {
      item.deadline = d;
      rest = rest.replace(due[0], ' ');
    }
  }
  const eff = /(\d+(?:[.,]\d+)?)\s*(d|days?|w|weeks?)\b/i.exec(rest);
  const days = eff ? parseNumberish(eff[0], 'days') : null;
  if (eff) rest = rest.replace(eff[0], ' ');
  item.name = rest.replace(/[\s,;:–—-]+$/, '').replace(/^[\s,;:–—-]+/, '').replace(/\s{2,}/g, ' ').trim() || `Item ${i + 1}`;
  item.work = [{ lane: 'Me', days: days ?? 0 }];
  return item;
}

// ── export: CSV ─────────────────────────────────────────────────────────────
const csvCell = (v: string | number | undefined) => {
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per item with the dates for every lens, so the CSV is useful without the app. */
export function toCsv(plan: NormalizedPlan, lens: LensId = 'planned'): string {
  const a = analyze(plan, lens);
  const likely = schedule(plan, { factor: 1.6 });
  const safe = schedule(plan, { factor: P90 });
  const header = ['Priority', 'Item', 'Who', 'Effort (days)', 'Start', 'Finish', 'Deadline', 'Status', 'Chance on time', 'Likely finish (1.6x)', 'Safe bet finish (3.1x)', ...(FEATURES.itemValue ? ['Value'] : []), 'Note'];
  const rows = plan.items.map((it, i) => {
    const r = a.planned.byId.get(it.id)!;
    const o = a.outlook.get(it.id); // the CSV lists as-planned dates, so its status is the as-planned one
    const status = r.status === 'blocked' ? `blocked: ${r.problem}` : r.status === 'empty' ? 'no effort' : o ? o.badge : '';
    return [
      i + 1,
      it.name,
      describeWork(plan, it.id),
      it.work.reduce((s, w) => s + w.days, 0),
      r.startDate,
      r.endDate,
      it.deadline,
      status,
      o?.chance !== undefined ? `${Math.round(o.chance * 100)}%` : '',
      likely.byId.get(it.id)!.endDate,
      safe.byId.get(it.id)!.endDate,
      ...(FEATURES.itemValue ? [it.value] : []),
      it.note,
    ].map(csvCell);
  });
  void lensById;
  return [header.map(csvCell), ...rows].map((r) => r.join(',')).join('\r\n') + '\r\n';
}
