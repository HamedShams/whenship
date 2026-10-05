import type { LensId } from '../engine/lens';
import { renderReport } from '../engine/report';
import { slugify } from '../engine/validate';
import type { NormalizedPlan } from '../engine/types';
import { toJson, toYaml } from '../io/format';
import { toIcs } from '../io/ics';
import { toSvg } from '../io/svg';
import { toCsv } from '../io/table';
import { toXlsx } from '../io/xlsx';
import type { ExportKind } from './Header';
import { svgToPng } from './lib';

export interface ExportFile {
  name: string;
  mime: string;
  data: string | Uint8Array;
}

export async function buildExport(kind: ExportKind, plan: NormalizedPlan, lens: LensId, dark = false): Promise<ExportFile> {
  const base = slugify(plan.title) || 'plan';
  switch (kind) {
    case 'yaml':
      return { name: `${base}.whenship.yaml`, mime: 'application/yaml', data: toYaml(plan) };
    case 'json':
      return { name: `${base}.whenship.json`, mime: 'application/json', data: toJson(plan) };
    case 'xlsx':
      return { name: `${base}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: toXlsx(plan, lens) };
    case 'csv':
      return { name: `${base}.csv`, mime: 'text/csv', data: toCsv(plan, lens) };
    case 'ics':
      return { name: `${base}.ics`, mime: 'text/calendar', data: toIcs(plan, lens, new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')) };
    case 'svg':
      return { name: `${base}.svg`, mime: 'image/svg+xml', data: toSvg(plan, lens, { dark }) };
    case 'png':
      return { name: `${base}.png`, mime: 'image/png', data: await svgToPng(toSvg(plan, lens, { dark })) };
    case 'md':
      return { name: `${base}.md`, mime: 'text/markdown', data: `${renderReport(plan, { lens, method: true })}\n\n<details><summary>Plan file</summary>\n\n\`\`\`yaml\n${toYaml(plan)}\`\`\`\n\n</details>\n` };
  }
}
