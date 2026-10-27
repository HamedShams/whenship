import { addDays } from '../engine/dates';
import { lensById, type LensId } from '../engine/lens';
import { describeWork } from '../engine/report';
import { schedule } from '../engine/schedule';
import type { NormalizedPlan } from '../engine/types';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 line folding: 75 octets max, continuation lines start with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(chunk);
      chunk = '';
      size = 0;
    }
    chunk += ch;
    size += n;
  }
  out.push(chunk);
  return out.join('\r\n ');
}

/**
 * One all-day event per item (start → finish under the chosen lens) plus one per deadline, so the dates of any lens can
 * live in a calendar app.
 */
export function toIcs(plan: NormalizedPlan, lens: LensId = 'planned', stamp = '20260101T000000Z'): string {
  const l = lensById(lens);
  const s = schedule(plan, { factor: l.factor });
  const suffix = l.factor === 1 ? '' : ` (${l.label} ${l.short})`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//whenship//planner//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(plan.title)}`];
  const uidBase = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'plan';
  for (const r of s.items) {
    const it = plan.items.find((x) => x.id === r.id)!;
    if (r.startDate && r.endDate) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uidBase}-${r.id}@whenship`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${r.startDate.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${addDays(r.endDate, 1).replace(/-/g, '')}`,
        `SUMMARY:${esc(`${it.name}${suffix}`)}`,
        `DESCRIPTION:${esc(`${describeWork(plan, it.id)}${it.deadline ? ` · deadline ${it.deadline}` : ''}${r.late ? ' · LATE' : ''}`)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      );
    }
    if (it.deadline) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uidBase}-${r.id}-deadline@whenship`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${it.deadline.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${addDays(it.deadline, 1).replace(/-/g, '')}`,
        `SUMMARY:${esc(`◆ Deadline: ${it.name}`)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
