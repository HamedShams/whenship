import { analyze } from '../engine/analysis';
import { formatDay, parseISO, toISO, weekdayIndex, monthName, dayParts } from '../engine/dates';
import { lensById, type LensId } from '../engine/lens';
import { headline } from '../engine/analysis';
import { describeWork } from '../engine/report';
import type { NormalizedPlan } from '../engine/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const BADGE_COLOR = { safe: '#2b8a3e', likely: '#2b8a3e', tight: '#e67700', late: '#c92a2a', unknown: '#868e96' } as const;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * A self-contained SVG of the plan, the way the chart reads on screen: title and headline; a list with the same columns
 * (#, item, effort, due, expected delivery); the timeline with month and day marks, off days, bars and deadline diamonds,
 * the late part of a bar hatched; a key at the bottom. Used for the image export and for PNG conversion in the browser.
 * Pure string output: works in Node and in the widget.
 */
/** `dayWidth` draws the chart at a fixed scale (the zoom on screen); without it the chart is fitted to ~1100 px. */
export function toSvg(plan: NormalizedPlan, lens: LensId = 'planned', opts: { dark?: boolean; dayWidth?: number; today?: string } = {}): string {
  const a = analyze(plan, lens);
  const l = lensById(lens);
  const c = opts.dark
    ? { bg: '#1a1b1e', fg: '#e9ecef', sub: '#adb5bd', grid: '#2c2e33', off: '#25262b', row: '#202125', head: '#9aa0a8' }
    : { bg: '#ffffff', fg: '#212529', sub: '#6c757d', grid: '#e9ecef', off: '#f5f6f8', row: '#fafbfc', head: '#6c757d' };
  const start = parseISO(plan.start)!;
  let last = start + 13;
  for (const r of a.current.items) if (r.endDate) last = Math.max(last, parseISO(r.endDate)!);
  for (const it of plan.items) if (it.deadline) last = Math.max(last, parseISO(it.deadline)!);
  last += 2;
  const nDays = last - start + 1;
  const dayW = opts.dayWidth ?? Math.max(4, Math.min(26, Math.floor(1100 / nDays)));
  // the list: # · item · effort · due · expected delivery
  const col = { n: 16, item: 38, effort: 222, due: 362, finish: 422 };
  const leftW = 500;
  const rowH = 30;
  const top = 122;
  const width = leftW + nDays * dayW + 24;
  const height = top + plan.items.length * rowH + 48;
  const year = dayParts(plan.start).year;
  const x = (day: number) => leftW + (day - start) * dayW;
  const today = opts.today ? parseISO(opts.today) : null;
  // zoomed out, weekend stripes are just noise: shade holidays only (as in the app)
  const isWork = (d: number) =>
    (dayW < 8 || plan.calendar.workdays.includes((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[weekdayIndex(d)]!)) &&
    !plan.calendar.holidays.some((h) => toISO(d) >= h.from && toISO(d) <= h.to);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, -apple-system, Segoe UI, Roboto, sans-serif">`);
  out.push(`<defs><pattern id="late" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" fill="rgba(201,42,42,.18)"/><rect width="2.5" height="6" fill="rgba(255,255,255,.35)"/></pattern></defs>`);
  out.push(`<rect width="100%" height="100%" fill="${c.bg}"/>`);
  out.push(`<text x="16" y="30" font-size="20" font-weight="700" fill="${c.fg}">${esc(plan.title)}</text>`);
  out.push(`<text x="16" y="54" font-size="13" fill="${c.sub}">${esc(headline(a))}${l.factor !== 1 ? esc(` · dates shown as ${l.label} (${l.short} the estimates)`) : ''}</text>`);
  // column titles, on the baseline of the day numbers
  const hy = top - 6;
  out.push(`<text x="${col.n}" y="${hy}" font-size="10.5" fill="${c.head}">#</text>`);
  out.push(`<text x="${col.item}" y="${hy}" font-size="10.5" fill="${c.head}">Item</text>`);
  out.push(`<text x="${col.effort}" y="${hy}" font-size="10.5" fill="${c.head}">Effort</text>`);
  out.push(`<text x="${col.due}" y="${hy}" font-size="10.5" fill="${c.head}">Due</text>`);
  out.push(`<text x="${col.finish}" y="${hy}" font-size="10.5" fill="${c.head}">Expected delivery</text>`);
  out.push(`<line x1="0" x2="${width}" y1="${top}" y2="${top}" stroke="${c.grid}"/>`);
  // month + day header, off days
  for (let d = start; d <= last; d++) {
    const p = dayParts(toISO(d));
    if (!isWork(d)) out.push(`<rect x="${x(d)}" y="${top - 18}" width="${dayW}" height="${plan.items.length * rowH + 18}" fill="${c.off}"/>`);
    if (p.day === 1 || d === start) out.push(`<text x="${x(d) + 2}" y="${top - 26}" font-size="11" font-weight="600" fill="${c.sub}">${monthName(p.month)}${p.year !== year ? ` ${p.year}` : ''}</text>`);
    if (dayW >= 14 || p.weekday === 0) out.push(`<text x="${x(d) + dayW / 2}" y="${hy}" font-size="9" text-anchor="middle" fill="${c.sub}">${p.day}</text>`);
  }
  plan.items.forEach((it, i) => {
    const y = top + i * rowH;
    const r = a.current.byId.get(it.id)!;
    const b = a.status.get(it.id);
    const ty = y + 19;
    if (i % 2) out.push(`<rect x="0" y="${y}" width="${leftW}" height="${rowH}" fill="${c.row}"/>`);
    out.push(`<line x1="0" x2="${width}" y1="${y + rowH}" y2="${y + rowH}" stroke="${c.grid}"/>`);
    out.push(`<text x="${col.n}" y="${ty}" font-size="12" fill="${c.sub}">${i + 1}</text>`);
    out.push(`<text x="${col.item}" y="${ty}" font-size="12.5" fill="${c.fg}"${it.done ? ' text-decoration="line-through" opacity=".6"' : ''}>${esc(cut(it.name, 28))}</text>`);
    out.push(`<text x="${col.effort}" y="${ty}" font-size="11.5" fill="${c.sub}">${esc(cut(it.work.length ? describeWork(plan, it.id) : '—', 22))}</text>`);
    out.push(`<text x="${col.due}" y="${ty}" font-size="11.5" fill="${c.sub}">${it.deadline ? esc(formatDay(it.deadline, year)) : '—'}</text>`);
    const finish = it.done ? 'done' : r.endDate ? formatDay(r.endDate, year) : r.status === 'empty' ? 'no effort' : '—';
    out.push(`<text x="${col.finish}" y="${ty}" font-size="11.5" font-weight="${b === 'late' ? 700 : 500}" fill="${it.done ? BADGE_COLOR.safe : b ? BADGE_COLOR[b] : c.sub}">${esc(finish)}</text>`);
    const due = it.deadline ? parseISO(it.deadline)! : null;
    for (const p of r.parts) {
      if (p.start === undefined || p.end === undefined) continue;
      const lane = plan.lanes.find((ln) => ln.id === p.lane);
      const s = parseISO(a.current.calendar.dateAt(p.start))!;
      const e = parseISO(a.current.calendar.dateAt(p.end))!;
      const k = r.parts.filter((q) => q.end !== undefined).indexOf(p);
      const n = r.parts.filter((q) => q.end !== undefined).length;
      const h = n > 1 ? Math.max(6, Math.floor((rowH - 10) / n)) : rowH - 10;
      const bx = x(s) + 1;
      const bw = (e - s + 1) * dayW - 2;
      out.push(`<rect x="${bx}" y="${y + 5 + k * h}" width="${bw}" height="${h - 1}" rx="4" fill="${lane?.color ?? '#4c6ef5'}" opacity="0.9"/>`);
      // the part of the work past the deadline, hatched (as on screen)
      if (due !== null && e > due) {
        const lx = Math.max(bx, x(due + 1));
        out.push(`<rect x="${lx}" y="${y + 5 + k * h}" width="${bx + bw - lx}" height="${h - 1}" rx="4" fill="url(#late)"/>`);
      }
    }
    const end = r.endDate;
    if (end && !it.done) {
      const ex = x(parseISO(end)!) + dayW + 6;
      out.push(`<text x="${ex}" y="${ty}" font-size="10.5" fill="${b === 'late' ? BADGE_COLOR.late : c.sub}">${esc(formatDay(end, year))}</text>`);
    }
    if (it.deadline) {
      const dx = x(parseISO(it.deadline)!) + dayW / 2;
      out.push(`<path d="M${dx} ${y + 6} l5 9 l-5 9 l-5 -9 z" fill="${b ? BADGE_COLOR[b] : c.sub}" stroke="${c.bg}" stroke-width="1.5"/>`);
    }
  });
  if (today !== null && today >= start && today <= last) {
    const tx = x(today) + dayW / 2;
    out.push(`<line x1="${tx}" x2="${tx}" y1="${top - 18}" y2="${top + plan.items.length * rowH}" stroke="#4f46e5" stroke-width="2" opacity=".6"/>`);
  }
  // the key
  const ky = height - 16;
  const diamond = (kx: number, fill: string) => `<path d="M${kx} ${ky - 9} l4 5 l-4 5 l-4 -5 z" fill="${fill}"/>`;
  out.push(diamond(22, BADGE_COLOR.safe), diamond(34, BADGE_COLOR.tight), diamond(46, BADGE_COLOR.late));
  out.push(`<text x="56" y="${ky}" font-size="10.5" fill="${c.sub}">deadline: on time, tight, late</text>`);
  out.push(`<rect x="220" y="${ky - 12}" width="18" height="10" rx="2" fill="url(#late)"/><text x="244" y="${ky}" font-size="10.5" fill="${c.sub}">past its deadline</text>`);
  if (today !== null) out.push(`<line x1="356" x2="356" y1="${ky - 12}" y2="${ky - 1}" stroke="#4f46e5" stroke-width="2" opacity=".7"/><text x="364" y="${ky}" font-size="10.5" fill="${c.sub}">today</text>`);
  out.push(`<text x="${width - 16}" y="${ky}" font-size="10.5" text-anchor="end" fill="${c.sub}">whenship · plan starts ${esc(formatDay(plan.start, year))}</text>`);
  out.push('</svg>');
  return out.join('');
}
