import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { schedule, validatePlan } from '../../src/engine';
import { decodeShareLink, encodeShareFragment, parsePlanText, shareUrl, toJson, toYaml } from '../../src/io/format';
import { parseTable, toCsv } from '../../src/io/table';
import { toIcs } from '../../src/io/ics';
import { toXlsx } from '../../src/io/xlsx';
import { toSvg } from '../../src/io/svg';
import { SAMPLES, nextMonday } from '../../src/io/samples';
import { plan } from '../helpers';

const sample = plan({
  title: 'Grant season',
  currency: '€',
  calendar: { workdays: ['sat', 'sun', 'mon', 'tue', 'wed'], holidays: [{ from: '2026-10-03', label: 'Unity Day' }] },
  lanes: ['Sara', { name: 'Omar', availability: 50 }],
  items: [
    { name: 'Appeal, with "quotes"', who: 'Sara', days: 4, deadline: '2026-10-01', value: 20000 },
    { name: 'Research', work: [{ lane: 'Omar', days: 1 }, { lane: 'Sara', days: 5, after: 'Omar' }], deadline: '2026-10-07', value: 85000, note: 'needs questionnaire' },
  ],
});

describe('save files and links', () => {
  it('YAML round-trips exactly and stays readable', () => {
    const yaml = toYaml(sample);
    expect(yaml).toMatch(/^# whenship plan/);
    expect(yaml).toMatch(/title: Grant season/);
    expect(yaml).not.toMatch(/maxPeople: 1/); // defaults are left out
    const back = parsePlanText(yaml, '2026-10-05');
    expect(back.format).toBe('yaml');
    expect(back.errors).toEqual([]);
    expect(back.plan).toEqual(sample);
  });

  it('JSON round-trips', () => {
    const back = parsePlanText(toJson(sample), '2026-10-05');
    expect(back.format).toBe('json');
    expect(back.plan).toEqual(sample);
  });

  it('share links carry the whole plan (and lens) in the URL fragment', () => {
    const url = shareUrl('https://example.org/app?x=1#old', sample, 'safe');
    expect(url.startsWith('https://example.org/app#p=')).toBe(true);
    expect(url).toMatch(/&l=safe$/);
    const decoded = decodeShareLink(url)!;
    expect(decoded.lens).toBe('safe');
    expect(validatePlan(decoded.plan).plan).toEqual(sample);
    expect(parsePlanText(url, '2026-10-05')).toMatchObject({ format: 'link', lens: 'safe' });
    expect(encodeShareFragment(sample).length).toBeLessThan(1200);
  });

  it('opens a Markdown export with a fenced YAML block', () => {
    const md = `# My plan\n\nSome notes\n\n\`\`\`yaml\n${toYaml(sample)}\`\`\`\n`;
    const back = parsePlanText(md, '2026-10-05');
    expect(back.format).toBe('markdown');
    expect(back.plan).toEqual(sample);
  });
});

describe('pasting tables and lists', () => {
  it('reads a real-world deadline sheet (headers, "[Pend] 6 Days", order column; values are ignored while switched off)', () => {
    const tsv = [
      'Value\tCase\tDeadline\tNext Deliverable\tEffort Needed\tTarget Deadline\tOrder',
      '100k €\tShop Atlas\t27 Oct\tAntrag Draft\t[Pend] 6 Days\t2 Nov\t5',
      '85k €\tNimbus Finance\t7 Oct\tMarket Research\t5 Days\t7 Oct\t2',
      '20k €\tVela Widerspruch\t2 Oct\tWiderspruch\t4 Days\t30 Sep\t1',
      '15k €\tInsure Pilot\t\tAntrag (AP + Anlage)\t1 Day\t25 Sep\t0',
    ].join('\n');
    const input = parseTable(tsv, '2026-09-23');
    const { plan: p, errors } = validatePlan({ start: '2026-09-24', ...input }, { today: '2026-09-23' });
    expect(errors).toEqual([]);
    expect(p.currency).toBeUndefined();
    expect(p.items.map((i) => [i.name, i.work[0]!.days, i.deadline ?? null, i.value])).toEqual([
      ['Insure Pilot', 1, null, undefined],
      ['Vela Widerspruch', 4, '2026-10-02', undefined],
      ['Nimbus Finance', 5, '2026-10-07', undefined],
      ['Shop Atlas', 6, '2026-10-27', undefined],
    ]);
    expect(p.items[3]!.note).toBe('Antrag Draft');
    expect(schedule(p).byId.get('nimbus-finance')!.endDate).toBe('2026-10-07');
  });

  it('reads CSV with quotes, Markdown tables and people with split effort', () => {
    const csv = 'Task,Owner,Effort,Due\n"Design, v2",Sara 3d + Omar 1d,,Oct 9\nShip,Sara,2d,2026-10-12';
    const p = validatePlan({ start: '2026-09-24', ...parseTable(csv, '2026-09-24') }).plan;
    expect(p.items[0]!.name).toBe('Design, v2');
    expect(p.items[0]!.work.map((w) => [w.lane, w.days])).toEqual([['sara', 3], ['omar', 1]]);
    const md = '| Item | Who | Days |\n|---|---|---|\n| A | Sara | 2 |\n| B | Omar | 1.5 |';
    expect(validatePlan(parseTable(md, '2026-09-24')).plan.items.map((i) => i.work[0]!.days)).toEqual([2, 1.5]);
  });

  it('reads a plain list', () => {
    const list = '- Landing page 3d\n- Billing 5 days due 30 Oct\n- Launch post';
    const p = validatePlan({ start: '2026-10-05', ...parseTable(list, '2026-10-05') }).plan;
    expect(p.items.map((i) => [i.name, i.work[0]!.days, i.deadline ?? null])).toEqual([
      ['Landing page', 3, null],
      ['Billing', 5, '2026-10-30'],
      ['Launch post', 0, null],
    ]);
  });
});

describe('exports', () => {
  it('CSV has one row per item with dates for every lens', () => {
    const csv = toCsv(sample);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Priority,Item,Who,Effort \(days\),Start,Finish,Deadline,Status/);
    expect(lines[1]).toMatch(/^1,"Appeal, with ""quotes""",Sara 4d,4,/);
  });

  it('ICS is valid RFC 5545 (CRLF, folded lines, all-day events)', () => {
    const ics = toIcs(sample, 'safe');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4); // 2 items + 2 deadlines
    expect(ics).toMatch(/SUMMARY:Appeal\\, with "quotes" \(Safe bet 3\.1×\)/);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
  });

  it('ICS folds long lines without splitting characters, and escapes what the format reserves', () => {
    const long = plan({
      title: 'Plan; with, commas',
      start: '2026-10-05',
      lanes: ['Sara'],
      items: [{ name: 'Überarbeitung des Förderantrags für die Stiftung Nordlicht; Teil 2, mit Anhängen\\Belegen', who: 'Sara', days: 3, deadline: '2026-10-06' }],
    });
    const ics = toIcs(long, 'planned', '20261005T080000Z');
    const lines = ics.split('\r\n');
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(lines.some((l) => l.startsWith(' '))).toBe(true); // folded
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('SUMMARY:Überarbeitung des Förderantrags für die Stiftung Nordlicht\\; Teil 2\\, mit Anhängen\\\\Belegen\r\n');
    expect(unfolded).toContain('X-WR-CALNAME:Plan\\; with\\, commas');
    expect(unfolded).toContain('DTSTAMP:20261005T080000Z');
    expect(unfolded).not.toMatch(/\(As planned/); // no lens suffix on your own dates
    expect(unfolded).toMatch(/DESCRIPTION:Sara 3d · deadline 2026-10-06 · LATE/); // 3 days from Mon 5 Oct end on Wed 7 Oct
    expect(unfolded).toContain('SUMMARY:◆ Deadline: Überarbeitung');
  });

  it('XLSX is a valid package with Plan, Gantt and Settings sheets', () => {
    const files = unzipSync(toXlsx(sample, 'likely'));
    expect(Object.keys(files).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml'].sort(),
    );
    const wb = strFromU8(files['xl/workbook.xml']!);
    expect(wb).toMatch(/name="Plan".*name="Gantt".*name="Settings"/);
    const plan1 = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(plan1).toMatch(/Appeal, with &quot;quotes&quot;/);
    expect(plan1).toMatch(/Likely \(1\.6×\)/);
    const gantt = strFromU8(files['xl/worksheets/sheet2.xml']!);
    expect(gantt).toMatch(/◆/);
    for (const f of Object.values(files)) {
      const text = strFromU8(f);
      expect(text.startsWith('<?xml')).toBe(true);
      expect((text.match(/</g) ?? []).length).toBe((text.match(/>/g) ?? []).length);
    }
  });

  it('SVG renders title, headline, bars and deadline markers', () => {
    const svg = toSvg(sample);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toMatch(/Grant season/);
    expect(svg).toMatch(/on track|late|tight/);
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThan(5);
    expect(svg).toMatch(/<path d="M/);
  });
});

describe('samples', () => {
  it('all validate cleanly and schedule without problems', () => {
    expect(nextMonday('2026-10-05')).toBe('2026-10-05');
    expect(nextMonday('2026-10-07')).toBe('2026-10-12');
    for (const s of SAMPLES) {
      const { plan: p, errors, warnings } = validatePlan(s.build('2026-10-07'));
      expect(errors, s.id).toEqual([]);
      expect(warnings, s.id).toEqual([]);
      const sch = schedule(p);
      expect(sch.items.every((r) => r.status === 'scheduled'), s.id).toBe(true);
    }
  });
});
