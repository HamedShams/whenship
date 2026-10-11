import { McpServer } from '@modelcontextprotocol/server';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import * as z from 'zod/v4';
import { analyze, headline } from '../engine/analysis';
import { FEATURES } from '../engine/features';
import { applyChanges, type Change } from '../engine/changes';
import { formatDay, todayLocal } from '../engine/dates';
import { findInsights } from '../engine/insights';
import { LENSES, METHOD_NOTE, type LensId } from '../engine/lens';
import { renderReport } from '../engine/report';
import { compactPlan, validatePlan, type ValidationResult } from '../engine/validate';
import type { Issue, NormalizedPlan } from '../engine/types';
import { shareUrl, toJson, toYaml } from '../io/format';
import { toIcs } from '../io/ics';
import { toCsv } from '../io/table';

export const UI_URI = 'ui://whenship/app.html';

export interface ServerOptions {
  /** The page served as the widget (dist/app.html). */
  html: string;
  /** Public address of the web app, used for share links and "Open in browser". */
  publicUrl: string;
  version: string;
  /** Fixed "today" for tests. */
  today?: () => string;
}

/** Shown to the model when it connects. Behavioural guidance lives here and in the skill, not in tool descriptions. */
export const INSTRUCTIONS = `whenship is a deterministic scheduling engine for small teams: people or teams, work items in priority order, effort in working days, optional deadlines.

For any question about when work will finish, whether deadlines hold, who is overloaded, or what to move, cut or add: put the work into a plan and call whenship. Do not work out dates, capacity or probabilities yourself; report the dates the tools return.

- show_plan: schedules a plan and shows the interactive chart. Start here.
- what_if: compares one or more changes against a plan (reorder, effort, deadline, people, holidays, working days).
- find_options: searches changes that meet more deadlines, with exact effects.
- export_plan: the plan as JSON (the save file), CSV, iCalendar, Markdown or a share link.

The user can edit the chart directly. Their latest edits arrive in your context as the current plan; use that plan (not an older one) for follow-up calls.

Effort is the user's own estimate. Never inflate it. Forecast lenses (likely 1.6×, safe bet 2.7×, worst case 3.9×) are a heuristic view, not a change to the plan: ${METHOD_NOTE}`;

// ── input schemas (descriptive, permissive: the engine validates and reports precise problems) ─────────────────
const isoDate = z.string().describe('Calendar date, YYYY-MM-DD');
const span = z.object({ from: isoDate, to: isoDate.optional(), label: z.string().optional() });
const weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

const laneSchema = z.object({
  id: z.string().optional().describe('Short id; defaults from the name'),
  name: z.string().describe('A person ("Sara") or a team/role ("Back-end")'),
  kind: z.enum(['person', 'team']).optional(),
  size: z.number().optional().describe('People in a team. Default 1'),
  availability: z.number().optional().describe('Percent of their working time available for this plan, 0-100. Default 100'),
  ...(FEATURES.personDaysOff ? { daysOff: z.array(span).optional().describe('Vacations or other days this lane is away') } : {}),
});

const workSchema = z.object({
  lane: z.string().describe('Lane id or name'),
  days: z.number().describe('Effort in working days of one person, exactly as the user estimated it'),
  maxPeople: z.number().optional().describe('Teams only: most people who can work on this at the same time. Default 1'),
  after: z.string().optional().describe('Lane of another part of this item that must finish first (a hand-off)'),
});

const itemSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  work: z.array(workSchema).optional().describe('Who does what. One entry per lane'),
  who: z.string().optional().describe('Shorthand for one lane instead of `work`'),
  days: z.number().optional().describe('Shorthand effort with `who`'),
  deadline: isoDate.optional(),
  ...(FEATURES.itemValue ? { value: z.number().optional().describe('Optional business value (money) at stake') } : {}),
  dependsOn: z.array(z.string()).optional().describe('Ids or names of items that must finish first'),
  notBefore: isoDate.optional().describe('Waiting on something external: cannot start before this date'),
  note: z.string().optional(),
});

const planSchema = z
  .object({
    title: z.string().optional(),
    start: isoDate.optional().describe('First day of work. Default today'),
    ...(FEATURES.itemValue ? { currency: z.string().optional().describe('For values, e.g. "€" or "USD"') } : {}),
    calendar: z
      .object({
        workdays: z.array(weekday).optional().describe('Default mon-fri'),
        holidays: z.array(span).optional(),
      })
      .optional(),
    lanes: z.array(laneSchema).optional(),
    items: z.array(itemSchema).describe('In priority order: earlier items get people first'),
  })
  .describe('A whenship plan. Pass the current plan (from the chart or the last tool result) unchanged unless the user asked for changes');

const lensSchema = z
  .enum(['planned', 'likely', 'safe', 'worst'])
  .optional()
  .describe('Which dates to show: planned = as estimated (default), likely 1.6×, safe 2.7×, worst 3.9×');

const changeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('move'), item: z.string(), to: z.number().describe('New 1-based position') }),
  z.object({ op: z.literal('setEffort'), item: z.string(), lane: z.string(), days: z.number() }),
  z.object({ op: z.literal('setDeadline'), item: z.string(), date: isoDate.nullable() }),
  z.object({ op: z.literal('setNotBefore'), item: z.string(), date: isoDate.nullable().describe('Waiting on something external until this date; null clears it') }),
  z.object({ op: z.literal('setLane'), lane: z.string(), size: z.number().optional(), availability: z.number().optional(), name: z.string().optional() }),
  z.object({ op: z.literal('addLane'), lane: laneSchema }),
  ...(FEATURES.personDaysOff ? [z.object({ op: z.literal('addDaysOff'), lane: z.string(), from: isoDate, to: isoDate.optional(), label: z.string().optional() })] : []),
  z.object({ op: z.literal('setWorkdays'), days: z.array(weekday) }),
  z.object({ op: z.literal('addHoliday'), from: isoDate, to: isoDate.optional(), label: z.string().optional() }),
  z.object({ op: z.literal('removeItem'), item: z.string() }),
  z.object({ op: z.literal('setStart'), date: isoDate }),
]);

type ExportFormat = 'yaml' | 'json' | 'csv' | 'ics' | 'markdown' | 'link';
const EXPORT_FORMATS = (['json', 'csv', 'ics', 'markdown', 'link'] as ExportFormat[]).concat(FEATURES.yamlExport ? ['yaml'] : []) as [ExportFormat, ...ExportFormat[]];

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

// ── helpers ────────────────────────────────────────────────────────────────
type TextContent = { type: 'text'; text: string };
const text = (t: string): TextContent => ({ type: 'text', text: t });

function issuesText(v: Pick<ValidationResult, 'errors' | 'warnings'>): string {
  const fmt = (i: Issue) => `- ${i.path ? `${i.path}: ` : ''}${i.message}`;
  const parts: string[] = [];
  if (v.errors.length) parts.push(`**Input problems (fixed or dropped):**\n${v.errors.slice(0, 20).map(fmt).join('\n')}`);
  if (v.warnings.length) parts.push(`**Notes:**\n${v.warnings.slice(0, 20).map(fmt).join('\n')}`);
  return parts.join('\n\n');
}

/** Changes use 1-based positions for people; the engine is 0-based. */
function toEngineChanges(changes: z.infer<typeof changeSchema>[]): Change[] {
  return changes.map((c) => (c.op === 'move' ? { ...c, to: Math.max(0, c.to - 1) } : (c as Change)));
}

/** Per-item before/after comparison for what-ifs. */
export function compare(before: NormalizedPlan, after: NormalizedPlan, lens: LensId = 'planned'): string {
  const a = analyze(before, lens);
  const b = analyze(after, lens);
  const year = Number(before.start.slice(0, 4));
  const lines: string[] = [];
  lines.push(`**Before:** ${headline(a)}.`);
  lines.push(`**After:** ${headline(b)}.`);
  lines.push('');
  lines.push('| Item | Finish before | Finish after | Change | Deadline |');
  lines.push('|---|---|---|---|---|');
  let changed = 0;
  for (const rb of b.current.items) {
    const ra = a.current.byId.get(rb.id);
    const fa = ra?.endDate;
    const fb = rb.endDate;
    const delta = ra?.end !== undefined && rb.end !== undefined ? rb.end - ra.end : undefined;
    if (ra && delta === 0 && ra.late === rb.late) continue;
    changed++;
    const dl = rb.deadline ? `${formatDay(rb.deadline, year)} ${rb.late ? '🔴 late' : '🟢 met'}${ra && ra.late !== rb.late ? (rb.late ? ' (was met)' : ' (was late)') : ''}` : '—';
    const d = !ra ? 'new' : delta === undefined ? '—' : delta === 0 ? 'same' : `${delta > 0 ? '+' : ''}${delta} working days`;
    lines.push(`| ${rb.name.replace(/\|/g, '/')} | ${fa ? formatDay(fa, year) : '—'} | ${fb ? formatDay(fb, year) : '—'} | ${d} | ${dl} |`);
  }
  for (const ra of a.current.items) if (!b.current.byId.has(ra.id)) lines.push(`| ${ra.name.replace(/\|/g, '/')} | ${ra.endDate ? formatDay(ra.endDate, year) : '—'} | removed | | |`), changed++;
  if (!changed) return `${lines[0]}\n${lines[1]}\n\nNo finish date changes.`;
  return lines.join('\n');
}

let seq = 0;

// ── server ─────────────────────────────────────────────────────────────────
export function createServer(opts: ServerOptions): McpServer {
  const today = opts.today ?? (() => todayLocal());
  const server = new McpServer({ name: 'whenship', title: 'whenship', version: opts.version }, { instructions: INSTRUCTIONS });
  const link = (plan: NormalizedPlan, lens?: LensId) => shareUrl(opts.publicUrl, plan, lens);

  registerAppResource(
    server,
    'whenship chart',
    UI_URI,
    {
      description: 'Interactive Gantt chart for a whenship plan',
      _meta: { ui: { prefersBorder: false, permissions: { clipboardWrite: {} } } },
    },
    async () => ({
      contents: [
        {
          uri: UI_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: opts.html,
          _meta: { ui: { prefersBorder: false, permissions: { clipboardWrite: {} } } },
        },
      ],
    }),
  );

  registerAppTool(
    server,
    'show_plan',
    {
      title: 'Show plan',
      description:
        'Schedules work for a small team and shows an interactive Gantt chart: finish dates per item, deadline risk ' +
        '(on time / tight / late, with a rough chance), what sets the end date, and the best options to meet more ' +
        'deadlines. Use for "when will this ship", "can we make these deadlines", prioritising several projects or ' +
        'clients, and capacity planning. Input: people or teams (lanes) and items in priority order with effort in ' +
        'working days. Returns a text summary plus the chart, which the user can edit directly (drag to reprioritise, ' +
        'change effort, deadlines, people and working days).',
      inputSchema: z.object({ plan: planSchema, lens: lensSchema }),
      annotations: { title: 'Show plan', ...READ_ONLY },
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async ({ plan: input, lens }) => {
      const v = validatePlan(input, { today: today() });
      const l: LensId = lens ?? 'planned';
      const report = renderReport(v.plan, { lens: l, method: true });
      const notes = issuesText(v);
      const body = [
        report,
        notes,
        `[Open this plan in the browser](${link(v.plan, l)}) (the whole plan is inside the link; nothing is stored on a server).`,
      ]
        .filter(Boolean)
        .join('\n\n');
      return {
        content: [text(body)],
        structuredContent: { plan: compactPlan(v.plan), lens: l, publicUrl: opts.publicUrl, createdAt: Date.now(), seq: ++seq },
      };
    },
  );

  server.registerTool(
    'what_if',
    {
      title: 'What if',
      description:
        'Compares a plan before and after one or more changes and reports which finish dates move and which deadlines ' +
        'are newly met or missed. Changes: move an item to a position, change effort, set or clear a deadline or a ' +
        "can't-start-before date, change a lane's people or availability, add a person or team, add a holiday, change working days, remove an " +
        'item, change the start date. Returns the comparison and the changed plan.',
      inputSchema: z.object({ plan: planSchema, changes: z.array(changeSchema).min(1), lens: lensSchema }),
      annotations: { title: 'What if', ...READ_ONLY },
    },
    async ({ plan: input, changes, lens }) => {
      const v = validatePlan(input, { today: today() });
      const r = applyChanges(v.plan, toEngineChanges(changes));
      const l: LensId = lens ?? 'planned';
      const parts = [compare(v.plan, r.plan, l)];
      if (r.skipped.length) parts.push(`**Skipped:**\n${r.skipped.map((s) => `- ${s.change.op}: ${s.reason}`).join('\n')}`);
      const notes = issuesText(v);
      if (notes) parts.push(notes);
      parts.push(`Changed plan (pass it to show_plan to update the chart):\n\`\`\`json\n${JSON.stringify(compactPlan(r.plan))}\n\`\`\``);
      return { content: [text(parts.join('\n\n'))] };
    },
  );

  server.registerTool(
    'find_options',
    {
      title: 'Find options',
      description:
        'Searches realistic changes that would meet more deadlines or make the plan sturdier: reordering, deferring ' +
        'undated work, more availability, one more person, or negotiating a deadline. Every option is re-planned ' +
        'exactly, and returned with its effect and the changes that would apply it (usable with what_if).',
      inputSchema: z.object({ plan: planSchema, lens: lensSchema, limit: z.number().int().min(1).max(8).optional() }),
      annotations: { title: 'Find options', ...READ_ONLY },
    },
    async ({ plan: input, lens, limit }) => {
      const v = validatePlan(input, { today: today() });
      const l: LensId = lens ?? 'planned';
      const found = findInsights(v.plan, l, limit ?? 4);
      const a = analyze(v.plan, l);
      if (!found.length) return { content: [text(`${capital(headline(a))}.\n\nNo single change found that meets more deadlines or makes the plan noticeably sturdier.`)] };
      const lines = [`${capital(headline(a))}.`, '', '**Options (best first):**'];
      found.forEach((s, i) => {
        const shown = s.changes.map((c) => (c.op === 'move' ? { ...c, to: c.to + 1 } : c));
        lines.push(`${i + 1}. **${s.title}** → ${s.effect}. Changes: \`${JSON.stringify(shown)}\``);
      });
      return { content: [text(lines.join('\n'))] };
    },
  );

  server.registerTool(
    'export_plan',
    {
      title: 'Export plan',
      description:
        'Returns the plan as a file: json (the whenship save file, re-openable on the website and in Claude), csv (one ' +
        'row per item with dates), ics (calendar with finish dates and deadlines), markdown (the report), or link (a ' +
        'share link with the whole plan inside it). Spreadsheet (XLSX) and image exports are in the chart’s Export menu.',
      inputSchema: z.object({ plan: planSchema, format: z.enum(EXPORT_FORMATS), lens: lensSchema }),
      annotations: { title: 'Export plan', ...READ_ONLY },
    },
    async ({ plan: input, format, lens }) => {
      const v = validatePlan(input, { today: today() });
      const l: LensId = lens ?? 'planned';
      const slug = v.plan.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan';
      const out: Record<ExportFormat, () => string> = {
        yaml: () => `Save as \`${slug}.whenship.yaml\`:\n\`\`\`yaml\n${toYaml(v.plan)}\`\`\``,
        json: () => `Save as \`${slug}.whenship.json\`:\n\`\`\`json\n${toJson(v.plan)}\`\`\``,
        csv: () => `\`\`\`csv\n${toCsv(v.plan, l)}\`\`\``,
        ics: () => `Save as \`${slug}.ics\`:\n\`\`\`\n${toIcs(v.plan, l, stamp())}\`\`\``,
        markdown: () => renderReport(v.plan, { lens: l, method: true }),
        link: () => link(v.plan, l),
      };
      return { content: [text(out[format]())] };
    },
  );

  server.registerPrompt(
    'plan',
    {
      title: 'Plan my work',
      description: 'Turn a list of work, people and deadlines into a whenship plan and chart.',
      argsSchema: z.object({ notes: z.string().describe('Your work, people and deadlines in any form: a list, a table, a few sentences') }),
    },
    ({ notes }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'Plan this with whenship. Turn it into lanes (people or teams, with availability if mentioned) and items in ' +
              'priority order with effort in working days and deadlines, then call show_plan. Keep my estimates exactly ' +
              `as given; ask only if effort or who-does-what is missing.\n\n${notes}`,
          },
        },
      ],
    }),
  );

  return server;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export const LENS_IDS = LENSES.map((l) => l.id);
