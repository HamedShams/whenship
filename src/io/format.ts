import YAML from 'yaml';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { compactPlan, validatePlan, type ValidationResult } from '../engine/validate';
import type { LensId } from '../engine/lens';
import type { NormalizedPlan } from '../engine/types';
import { parseTable } from './table';

export const FILE_HEADER =
  '# whenship plan: open it at whenship (web), drop it into Claude, or edit it by hand.\n' +
  '# Items are in priority order. Effort is in working days per person or team.\n';

/** The canonical save file: readable, diff-able YAML. */
export function toYaml(plan: NormalizedPlan): string {
  return FILE_HEADER + YAML.stringify(compactPlan(plan), { lineWidth: 0 });
}

export function toJson(plan: NormalizedPlan): string {
  return JSON.stringify(compactPlan(plan), null, 2) + '\n';
}

export interface ParsedText extends ValidationResult {
  format: 'yaml' | 'json' | 'link' | 'table' | 'markdown';
  lens?: LensId;
}

/**
 * Opens anything a user might paste or drop: a .whenship.yaml / JSON file, a share link, a Markdown export with a
 * fenced YAML block, or a plain table / CSV / list of work.
 */
export function parsePlanText(text: string, today: string): ParsedText {
  const trimmed = text.trim();
  const link = decodeShareLink(trimmed);
  if (link) return { ...validatePlan(link.plan, { today }), format: 'link', ...(link.lens ? { lens: link.lens } : {}) };
  const fenced = /```(?:ya?ml|json)?\s*\n([\s\S]*?)```/i.exec(trimmed);
  const body = fenced ? fenced[1]! : trimmed;
  if (/^\s*[{[]/.test(body) || /(^|\n)\s*(items|lanes)\s*:/.test(body)) {
    try {
      const data: unknown = YAML.parse(body);
      if (data && typeof data === 'object') {
        return { ...validatePlan(data, { today }), format: fenced ? 'markdown' : /^\s*[{[]/.test(body) ? 'json' : 'yaml' };
      }
    } catch {
      /* not YAML: fall through to table parsing */
    }
  }
  return { ...validatePlan(parseTable(trimmed, today), { today }), format: 'table' };
}

// ── share links ───────────────────────────────────────────────────────────
/** `#p=<compressed plan>[&l=<lens>]`, appended to the app URL. The fragment never reaches a server. */
export function encodeShareFragment(plan: NormalizedPlan, lens?: LensId): string {
  const data = compressToEncodedURIComponent(JSON.stringify(compactPlan(plan)));
  return `p=${data}${lens && lens !== 'planned' ? `&l=${lens}` : ''}`;
}

export function shareUrl(base: string, plan: NormalizedPlan, lens?: LensId): string {
  return `${base.replace(/[#?].*$/, '')}#${encodeShareFragment(plan, lens)}`;
}

export function decodeShareLink(text: string): { plan: unknown; lens?: LensId } | null {
  const m = /(?:^|[#&])p=([A-Za-z0-9+\-_$]+)(?:&l=([a-z]+))?/.exec(text.trim());
  if (!m) return null;
  try {
    const json = decompressFromEncodedURIComponent(m[1]!);
    if (!json) return null;
    const plan: unknown = JSON.parse(json);
    const lens = m[2] as LensId | undefined;
    return lens ? { plan, lens } : { plan };
  } catch {
    return null;
  }
}
