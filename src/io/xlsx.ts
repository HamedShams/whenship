import { FEATURES } from '../engine/features';
import { strToU8, zipSync } from 'fflate';
import { analyze } from '../engine/analysis';
import { parseISO, toISO, weekdayIndex } from '../engine/dates';
import { lensById, LENSES, METHOD_NOTE, type LensId } from '../engine/lens';
import { describeWork, describeWorkdays } from '../engine/report';
import { schedule } from '../engine/schedule';
import type { NormalizedPlan } from '../engine/types';

/**
 * A small, dependency-light XLSX writer: a "Plan" sheet (table with dates for every lens), a "Gantt" sheet (a
 * coloured day-by-day grid that recreates the chart in Excel) and a "Settings" sheet.
 */

type Cell = { v: string | number; s?: number; t?: 'date' };
type Row = (Cell | null)[];

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
/** Excel serial date (days since 1899-12-30). */
const serial = (iso: string) => parseISO(iso)! + 25569;

interface Styles {
  xml: string;
  header: number;
  date: number;
  bold: number;
  wrap: number;
  weekend: number;
  late: number;
  deadline: number;
  lane: Map<string, number>;
  laneLate: number;
}

function buildStyles(colors: string[]): Styles {
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const solid = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb.replace('#', '').toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`;
  const fillIdx = (rgb: string) => fills.push(solid(rgb)) - 1;
  const headerFill = fillIdx('#E9ECEF');
  const weekendFill = fillIdx('#F1F3F5');
  const lateFill = fillIdx('#FFC9C9');
  const deadlineFill = fillIdx('#FFE066');
  const laneFills = colors.map(fillIdx);
  const xfs: string[] = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', // 0 default
    `<xf numFmtId="0" fontId="1" fillId="${headerFill}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`, // 1 header
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>', // 2 date
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>', // 3 bold
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>', // 4 wrap
    `<xf numFmtId="0" fontId="0" fillId="${weekendFill}" borderId="0" xfId="0" applyFill="1"/>`, // 5 weekend
    `<xf numFmtId="0" fontId="2" fillId="${lateFill}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`, // 6 late
    `<xf numFmtId="0" fontId="1" fillId="${deadlineFill}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>`, // 7 deadline
  ];
  const lane = new Map<string, number>();
  laneFills.forEach((f, i) => {
    lane.set(colors[i]!, xfs.length);
    xfs.push(`<xf numFmtId="0" fontId="0" fillId="${f}" borderId="0" xfId="0" applyFill="1"/>`);
  });
  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="ddd d mmm yyyy"/></numFmts>' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFC92A2A"/><name val="Calibri"/></font></fonts>' +
    `<fills count="${fills.length}">${fills.join('')}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
  return { xml: stylesXml, header: 1, date: 2, bold: 3, wrap: 4, weekend: 5, late: 6, deadline: 7, lane, laneLate: 6 };
}

function sheetXml(rows: Row[], opts: { widths?: number[]; freeze?: { row: number; col: number } } = {}): string {
  const cols = opts.widths?.length ? `<cols>${opts.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const pane = opts.freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${opts.freeze.col}" ySplit="${opts.freeze.row}" topLeftCell="${colName(opts.freeze.col)}${opts.freeze.row + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((c, ci) => {
          if (!c) return '';
          const ref = `${colName(ci)}${r + 1}`;
          const s = c.s ? ` s="${c.s}"` : '';
          if (typeof c.v === 'number') return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(c.v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `${pane}${cols}<sheetData>${body}</sheetData></worksheet>`
  );
}

export function toXlsx(plan: NormalizedPlan, lens: LensId = 'planned'): Uint8Array {
  const a = analyze(plan, lens);
  const l = lensById(lens);
  const likely = schedule(plan, { factor: 1.6 });
  const safe = schedule(plan, { factor: 2.7 });
  const st = buildStyles([...new Set(plan.lanes.map((x) => x.color))]);
  const H = (v: string): Cell => ({ v, s: st.header });
  const D = (iso?: string): Cell | null => (iso ? { v: serial(iso), s: st.date } : null);
  const T = (v: string | number | undefined, s?: number): Cell | null => (v === undefined || v === '' ? null : s ? { v, s } : { v });

  // Plan sheet
  const planRows: Row[] = [
    [{ v: plan.title, s: st.bold }],
    [{ v: `Start ${plan.start} · ${describeWorkdays(plan)} · dates shown: ${l.label} (${l.short})` }],
    [],
    ['Priority', 'Item', 'Who', 'Effort (days)', 'Start', 'Finish', 'Deadline', 'Status', 'Chance on time', 'Likely finish (1.6×)', 'Safe finish (2.7×)', ...(FEATURES.itemValue ? ['Value'] : []), 'Note'].map(H),
  ];
  plan.items.forEach((it, i) => {
    const r = a.current.byId.get(it.id)!;
    const o = a.outlook.get(it.id);
    const b = a.status.get(it.id);
    const status = r.status === 'blocked' ? `blocked: ${r.problem}` : r.status === 'empty' ? 'no effort' : b ?? '';
    planRows.push([
      T(i + 1),
      T(it.name),
      T(describeWork(plan, it.id)),
      T(it.work.reduce((s, w) => s + w.days, 0)),
      D(r.startDate),
      D(r.endDate),
      D(it.deadline),
      status ? { v: status, ...(status === 'late' ? { s: st.late } : {}) } : null,
      o?.chance !== undefined ? T(`${Math.round(o.chance * 100)}%`) : null,
      D(likely.byId.get(it.id)!.endDate),
      D(safe.byId.get(it.id)!.endDate),
      ...(FEATURES.itemValue ? [T(it.value)] : []),
      T(it.note),
    ]);
  });

  // Gantt sheet: one column per calendar day from the start to the last finish/deadline (+ a few days)
  const start = parseISO(plan.start)!;
  let last = start + 14;
  for (const r of a.current.items) if (r.endDate) last = Math.max(last, parseISO(r.endDate)!);
  for (const it of plan.items) if (it.deadline) last = Math.max(last, parseISO(it.deadline)!);
  last = Math.min(last + 3, start + 730);
  const days: number[] = [];
  for (let d = start; d <= last; d++) days.push(d);
  const isWork = (d: number) => plan.calendar.workdays.includes((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[weekdayIndex(d)]!) && !plan.calendar.holidays.some((h) => toISO(d) >= h.from && toISO(d) <= h.to);
  const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const ganttRows: Row[] = [
    [H('Item'), H('Who'), ...days.map((d) => ({ v: toISO(d).slice(5), s: st.header }) as Cell)],
    [H(''), H(''), ...days.map((d) => ({ v: DOW[weekdayIndex(d)]!, s: isWork(d) ? st.header : st.weekend }) as Cell)],
  ];
  for (const it of plan.items) {
    const r = a.current.byId.get(it.id)!;
    const laneColor = plan.lanes.find((x) => x.id === it.work[0]?.lane)?.color ?? '#4c6ef5';
    const row: Row = [{ v: it.name, s: st.bold }, { v: describeWork(plan, it.id) }];
    const s0 = r.startDate ? parseISO(r.startDate)! : null;
    const e0 = r.endDate ? parseISO(r.endDate)! : null;
    const dl = it.deadline ? parseISO(it.deadline)! : null;
    for (const d of days) {
      if (dl !== null && d === dl) row.push({ v: '◆', s: st.deadline });
      else if (s0 !== null && e0 !== null && d >= s0 && d <= e0) row.push({ v: '', s: dl !== null && d > dl ? st.laneLate : st.lane.get(laneColor) ?? st.lane.values().next().value! });
      else row.push(isWork(d) ? null : { v: '', s: st.weekend });
    }
    ganttRows.push(row);
  }

  // Settings sheet
  const settings: Row[] = [
    [{ v: 'Settings', s: st.bold }],
    [H('Start'), D(plan.start)],
    [H('Working days'), T(plan.calendar.workdays.join(', '))],
    [H('Holidays'), T(plan.calendar.holidays.map((h) => (h.to !== h.from ? `${h.from}…${h.to}` : h.from) + (h.label ? ` (${h.label})` : '')).join('; ') || '—')],
    [],
    ['Person / team', 'People', 'Availability %', 'Days off'].map(H),
    ...plan.lanes.map((ln) => [T(ln.name), T(ln.size), T(ln.availability), T(ln.daysOff.map((d) => (d.to !== d.from ? `${d.from}…${d.to}` : d.from)).join('; '))] as Row),
    [],
    [{ v: 'Forecast lenses', s: st.bold }],
    ...LENSES.map((x) => [T(x.label), T(x.short), T(x.blurb)] as Row),
    [{ v: METHOD_NOTE, s: st.wrap }],
  ];

  const sheets = [
    { name: 'Plan', xml: sheetXml(planRows, { widths: [9, 34, 30, 12, 18, 18, 18, 12, 14, 20, 20, 12, 30], freeze: { row: 4, col: 2 } }) },
    { name: 'Gantt', xml: sheetXml(ganttRows, { widths: [30, 24, ...days.map(() => 3.2)], freeze: { row: 2, col: 2 } }) },
    { name: 'Settings', xml: sheetXml(settings, { widths: [22, 14, 60, 40] }) },
  ];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    ),
    'docProps/core.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        `<dc:title>${xml(plan.title)}</dc:title><dc:creator>whenship</dc:creator></cp:coreProperties>`,
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(st.xml),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml)));
  return zipSync(files, { level: 6 });
}
