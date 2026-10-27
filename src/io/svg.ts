import { analyze } from '../engine/analysis';
import { formatDay, parseISO, toISO, weekdayIndex, monthName, dayParts } from '../engine/dates';
import { lensById, type LensId } from '../engine/lens';
import { headline } from '../engine/analysis';
import type { NormalizedPlan } from '../engine/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const BADGE_COLOR: Record<string, string> = { safe: '#2b8a3e', likely: '#2b8a3e', tight: '#e67700', late: '#c92a2a', unknown: '#868e96' };

/**
 * A self-contained SVG of the plan (title, headline, list and timeline). Used for the image export and for PNG
 * conversion in the browser. Pure string output: works in Node and in the widget.
 */
/** `dayWidth` draws the chart at a fixed scale (the zoom on screen); without it the chart is fitted to ~1100 px. */
export function toSvg(plan: NormalizedPlan, lens: LensId = 'planned', opts: { dark?: boolean; dayWidth?: number } = {}): string {
  const a = analyze(plan, lens);
  const l = lensById(lens);
  const c = opts.dark
    ? { bg: '#1a1b1e', fg: '#e9ecef', sub: '#adb5bd', grid: '#2c2e33', off: '#25262b', row: '#202125' }
    : { bg: '#ffffff', fg: '#212529', sub: '#6c757d', grid: '#e9ecef', off: '#f5f6f8', row: '#fafbfc' };
  const start = parseISO(plan.start)!;
  let last = start + 13;
  for (const r of a.current.items) if (r.endDate) last = Math.max(last, parseISO(r.endDate)!);
  for (const it of plan.items) if (it.deadline) last = Math.max(last, parseISO(it.deadline)!);
  last += 2;
  const nDays = last - start + 1;
  const dayW = opts.dayWidth ?? Math.max(4, Math.min(26, Math.floor(1100 / nDays)));
  const leftW = 300;
  const rowH = 30;
  const top = 96;
  const width = leftW + nDays * dayW + 24;
  const height = top + plan.items.length * rowH + 40;
  const year = dayParts(plan.start).year;
  const x = (day: number) => leftW + (day - start) * dayW;
  // zoomed out, weekend stripes are just noise: shade holidays only (as in the app)
  const isWork = (d: number) =>
    (dayW < 8 || plan.calendar.workdays.includes((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[weekdayIndex(d)]!)) &&
    !plan.calendar.holidays.some((h) => toISO(d) >= h.from && toISO(d) <= h.to);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, -apple-system, Segoe UI, Roboto, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="${c.bg}"/>`);
  out.push(`<text x="16" y="30" font-size="20" font-weight="700" fill="${c.fg}">${esc(plan.title)}</text>`);
  out.push(`<text x="16" y="54" font-size="13" fill="${c.sub}">${esc(headline(a))}${l.factor !== 1 ? esc(` · dates: ${l.label} ${l.short}`) : ''}</text>`);
  // month + day header
  for (let d = start; d <= last; d++) {
    const p = dayParts(toISO(d));
    if (!isWork(d)) out.push(`<rect x="${x(d)}" y="${top - 18}" width="${dayW}" height="${plan.items.length * rowH + 18}" fill="${c.off}"/>`);
    if (p.day === 1 || d === start) out.push(`<text x="${x(d) + 2}" y="${top - 26}" font-size="11" font-weight="600" fill="${c.sub}">${monthName(p.month)}${p.year !== year ? ` ${p.year}` : ''}</text>`);
    if (dayW >= 14 || p.weekday === 0) out.push(`<text x="${x(d) + dayW / 2}" y="${top - 6}" font-size="9" text-anchor="middle" fill="${c.sub}">${p.day}</text>`);
  }
  plan.items.forEach((it, i) => {
    const y = top + i * rowH;
    const r = a.current.byId.get(it.id)!;
    const b = a.status.get(it.id);
    if (i % 2) out.push(`<rect x="0" y="${y}" width="${leftW}" height="${rowH}" fill="${c.row}"/>`);
    out.push(`<line x1="0" x2="${width}" y1="${y + rowH}" y2="${y + rowH}" stroke="${c.grid}"/>`);
    out.push(`<text x="16" y="${y + 19}" font-size="12" fill="${c.sub}">${i + 1}</text>`);
    out.push(`<text x="38" y="${y + 19}" font-size="12.5" fill="${c.fg}">${esc(it.name.length > 30 ? it.name.slice(0, 29) + '…' : it.name)}</text>`);
    if (r.endDate) out.push(`<text x="${leftW - 12}" y="${y + 19}" font-size="11.5" text-anchor="end" fill="${b ? BADGE_COLOR[b] : c.sub}">${esc(formatDay(r.endDate, year))}</text>`);
    for (const p of r.parts) {
      if (p.start === undefined || p.end === undefined) continue;
      const lane = plan.lanes.find((ln) => ln.id === p.lane);
      const s = parseISO(a.current.calendar.dateAt(p.start))!;
      const e = parseISO(a.current.calendar.dateAt(p.end))!;
      const k = r.parts.filter((q) => q.end !== undefined).indexOf(p);
      const n = r.parts.filter((q) => q.end !== undefined).length;
      const h = n > 1 ? Math.max(6, Math.floor((rowH - 10) / n)) : rowH - 10;
      out.push(`<rect x="${x(s) + 1}" y="${y + 5 + k * h}" width="${(e - s + 1) * dayW - 2}" height="${h - 1}" rx="4" fill="${lane?.color ?? '#4c6ef5'}" opacity="0.9"/>`);
    }
    if (it.deadline) {
      const dx = x(parseISO(it.deadline)!) + dayW / 2;
      out.push(`<path d="M${dx} ${y + 6} l5 9 l-5 9 l-5 -9 z" fill="${b ? BADGE_COLOR[b] : c.sub}" stroke="${c.bg}" stroke-width="1.5"/>`);
    }
  });
  out.push(`<text x="16" y="${height - 14}" font-size="10.5" fill="${c.sub}">Made with whenship · ${esc(plan.start)} start · ◆ = deadline</text>`);
  out.push('</svg>');
  return out.join('');
}
