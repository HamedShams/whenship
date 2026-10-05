import { render } from 'preact';
import { App as McpApp, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { analyze, badgeLabel, headline, type Analysis } from '../engine/analysis';
import { dayParts, formatDay, parseISO, todayLocal } from '../engine/dates';
import { lensById, type LensId } from '../engine/lens';
import { renderReport } from '../engine/report';
import { compactPlan, validatePlan } from '../engine/validate';
import type { NormalizedPlan } from '../engine/types';
import { shareUrl, toYaml } from '../io/format';
import { App, type Host } from './App';
import { boot, FALLBACK_URL } from './config';
import { bytesToBase64, Icon, Logo } from './lib';

/**
 * The Claude widget (an MCP App). One engine, same UI as the website, plus:
 *  - every edit is pushed into Claude's context automatically (no "send to Claude" button);
 *  - only the newest chart in a conversation stays live (older ones collapse to a one-line stub);
 *  - exports go through the host's download API when it has one, else open the plan on the website.
 */
interface State {
  plan: NormalizedPlan | null;
  partial: NormalizedPlan | null;
  lens: LensId;
  version: number;
  superseded: boolean;
  displayMode: string;
  canFullscreen: boolean;
  publicUrl: string | null;
}

const today = todayLocal();
const state: State = { plan: null, partial: null, lens: 'planned', version: 0, superseded: false, displayMode: 'inline', canFullscreen: false, publicUrl: boot.publicUrl ?? null };
let rootEl: HTMLElement;
let app: McpApp;
let lastSynced = '';
let syncTimer: ReturnType<typeof setTimeout> | undefined;

// ── single live chart (supersession) ───────────────────────────────────────
let key: { createdAt: number; seq: number; id: string } | null = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('whenship-supersede') : null;
const younger = (a: NonNullable<typeof key>, b: NonNullable<typeof key>) => (a.createdAt !== b.createdAt ? a.createdAt > b.createdAt : a.seq !== b.seq ? a.seq > b.seq : a.id > b.id);
channel?.addEventListener('message', (ev: MessageEvent) => {
  const other = ev.data as { type: string; key: NonNullable<typeof key> };
  if (!key || !other?.key || other.type !== 'hello') return;
  if (younger(other.key, key)) {
    if (!state.superseded) {
      state.superseded = true;
      draw();
    }
  } else if (younger(key, other.key)) channel?.postMessage({ type: 'hello', key });
});
function announce() {
  if (key) channel?.postMessage({ type: 'hello', key });
}

// ── sync edits into Claude's context ───────────────────────────────────────
function contextFor(plan: NormalizedPlan, lens: LensId): string {
  return (
    'Current state of the whenship chart in this conversation. The user can edit it directly (drag to reorder, change ' +
    'effort, deadlines, people, working days), so this replaces any earlier version of the plan. Use these dates; do not ' +
    're-calculate them by hand.\n\n' +
    renderReport(plan, { lens, maxRows: 40, insights: false }) +
    `\n\nPlan file (pass this as \`plan\` to whenship tools for what-ifs):\n\`\`\`yaml\n${toYaml(plan)}\`\`\``
  );
}
function scheduleSync(plan: NormalizedPlan, lens: LensId) {
  if (state.superseded) return;
  const sig = JSON.stringify([compactPlan(plan), lens]);
  if (sig === lastSynced) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    lastSynced = sig;
    void app
      .updateModelContext({
        content: [{ type: 'text', text: contextFor(plan, lens) }],
        structuredContent: { plan: compactPlan(plan), lens },
      })
      .catch(() => undefined);
  }, 600);
}

// ── host adapter for the shared App ────────────────────────────────────────
const host: Host = {
  mode: 'widget',
  async save(file) {
    if (app.getHostCapabilities()?.downloadFile) {
      const resource =
        typeof file.data === 'string'
          ? { uri: `file:///${file.name}`, mimeType: file.mime, text: file.data }
          : { uri: `file:///${file.name}`, mimeType: file.mime, blob: bytesToBase64(file.data) };
      try {
        const res = await app.downloadFile({ contents: [{ type: 'resource', resource }] });
        return res?.isError ? false : 'saved';
      } catch {
        /* fall through */
      }
    }
    if (state.plan) {
      try {
        await app.openLink({ url: shareUrl(base(), state.plan, state.lens) });
        return 'opened';
      } catch {
        /* fall through */
      }
    }
    return false;
  },
  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
  baseUrl: () => base(),
  onChange(plan, lens) {
    state.plan = plan;
    state.lens = lens;
    scheduleSync(plan, lens);
  },
};
const base = () => state.publicUrl ?? FALLBACK_URL;

// ── views ──────────────────────────────────────────────────────────────────
function Card({ plan, lens }: { plan: NormalizedPlan; lens: LensId }) {
  const a: Analysis = analyze(plan, lens);
  const year = dayParts(plan.start).year;
  const text = headline(a);
  const risky = a.planned.items
    .map((r) => ({ r, o: a.outlook.get(r.id) }))
    .filter((x) => x.o && (x.o.badge === 'late' || x.o.badge === 'tight'))
    .slice(0, 4);
  const rows = a.current.items.slice(0, 8);
  const start = parseISO(plan.start)!;
  let end = start + 14;
  for (const r of a.current.items) if (r.endDate) end = Math.max(end, parseISO(r.endDate)!);
  const span = end - start + 1;
  const pct = (iso: string) => ((parseISO(iso)! - start) / span) * 100;
  const color = (lane: string) => plan.lanes.find((l) => l.id === lane)?.color ?? '#4c6ef5';
  return (
    <div class="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Logo size={20} />
        <h2>{plan.title}</h2>
      </div>
      <div style={{ fontSize: '14px', fontWeight: 600 }}>{text.charAt(0).toUpperCase() + text.slice(1)}</div>
      {risky.length > 0 && (
        <div class="risks">
          {risky.map(({ r, o }) => (
            <div key={r.id} class="risk">
              <span>{r.name}</span>
              <span class="sub">{r.endDate ? formatDay(r.endDate, year) : ''}{r.deadline ? ` · due ${formatDay(r.deadline, year)}` : ''}</span>
              <span class={`pill ${o!.badge}`}>{badgeLabel(o!.badge)}</span>
            </div>
          ))}
        </div>
      )}
      <div class="mini" aria-hidden="true">
        {rows.map((r) => (
          <div key={r.id} class="mini-row">
            <span class="mini-name" title={r.name}>{r.name}</span>
            <div class="mini-track">
              {r.parts
                .filter((p) => p.start !== undefined && p.end !== undefined)
                .map((p) => {
                  const s = a.current.calendar.dateAt(p.start!);
                  const e = a.current.calendar.dateAt(p.end!);
                  return <div key={p.lane} class="mini-bar" style={{ left: `${pct(s)}%`, width: `${Math.max(0.8, pct(e) - pct(s) + 100 / span)}%`, background: color(p.lane), opacity: 0.85 }} />;
                })}
              {r.deadline && <div class="mini-due" style={{ left: `${pct(r.deadline)}%` }} />}
            </div>
          </div>
        ))}
        {a.current.items.length > rows.length && <div class="mini-more sub">+{a.current.items.length - rows.length} more</div>}
      </div>
      <div class="buttons">
        <button class="btn primary" onClick={() => void openFull()}>
          <Icon.expand /> Open interactive chart
        </button>
        <button class="btn" onClick={() => void app.openLink({ url: shareUrl(base(), plan, lens) })}>
          <Icon.external /> Open in browser
        </button>
        {lensById(lens).factor !== 1 && <span class="sub">Dates: {lensById(lens).label} ({lensById(lens).short})</span>}
      </div>
    </div>
  );
}

async function openFull() {
  if (state.canFullscreen) {
    try {
      const res = await app.requestDisplayMode({ mode: 'fullscreen' });
      state.displayMode = res.mode;
      draw();
      return;
    } catch {
      /* fall back to inline editing */
    }
  }
  state.displayMode = 'inline-full';
  draw();
}

function draw() {
  if (state.superseded) {
    render(
      <div class="superseded">
        <Logo size={16} /> This plan was updated. The live chart is further down in the conversation.
      </div>,
      rootEl,
    );
    return;
  }
  const plan = state.plan ?? state.partial;
  if (!plan) {
    render(
      <div class="superseded">
        <Logo size={16} /> Planning…
      </div>,
      rootEl,
    );
    return;
  }
  if (state.displayMode === 'fullscreen' || state.displayMode === 'inline-full') {
    render(
      <App
        host={host}
        initialPlan={plan}
        initialLens={state.lens}
        today={today}
        externalPlan={plan}
        externalVersion={state.version}
        headerExtra={
          <button
            class="btn"
            title="Back to the summary card"
            onClick={async () => {
              if (state.displayMode === 'fullscreen') {
                try {
                  const res = await app.requestDisplayMode({ mode: 'inline' });
                  state.displayMode = res.mode;
                } catch {
                  state.displayMode = 'inline';
                }
              } else state.displayMode = 'inline';
              draw();
            }}
          >
            Done
          </button>
        }
      />,
      rootEl,
    );
    return;
  }
  render(<Card plan={plan} lens={state.lens} />, rootEl);
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.displayMode && state.displayMode !== 'inline-full') state.displayMode = ctx.displayMode;
  if (ctx.availableDisplayModes) state.canFullscreen = ctx.availableDisplayModes.includes('fullscreen');
}

export async function bootWidget(root: HTMLElement) {
  rootEl = root;
  document.body.classList.add('widget');
  app = new McpApp({ name: 'whenship', version: boot.version ?? '1.0.0' }, { availableDisplayModes: ['inline', 'fullscreen'] });

  app.addEventListener('toolinputpartial', (p) => {
    if (state.plan) return;
    const raw = (p.arguments as { plan?: unknown })?.plan;
    if (!raw) return;
    try {
      const v = validatePlan(raw, { today });
      if (v.plan.items.length) {
        state.partial = v.plan;
        draw();
      }
    } catch {
      /* partial JSON can be anything */
    }
  });
  app.addEventListener('toolinput', (p) => {
    const args = p.arguments as { plan?: unknown; lens?: LensId };
    if (args?.lens) state.lens = args.lens;
    if (args?.plan && !state.plan) {
      state.plan = validatePlan(args.plan, { today }).plan;
      state.version++;
      draw();
    }
  });
  app.addEventListener('toolresult', (r) => {
    const sc = r.structuredContent as { plan?: unknown; lens?: LensId; publicUrl?: string; createdAt?: number; seq?: number } | undefined;
    if (sc?.publicUrl) state.publicUrl = sc.publicUrl;
    if (sc?.lens) state.lens = sc.lens;
    if (sc?.plan) {
      state.plan = validatePlan(sc.plan, { today }).plan;
      lastSynced = JSON.stringify([compactPlan(state.plan), state.lens]);
      state.version++;
    }
    if (sc && Number.isFinite(sc.createdAt)) {
      const id = String(app.getHostContext()?.toolInfo?.id ?? Math.random());
      key = { createdAt: sc.createdAt!, seq: Number(sc.seq ?? 0), id };
      announce();
    }
    draw();
  });
  app.addEventListener('hostcontextchanged', (ctx) => {
    applyHost(ctx as McpUiHostContext);
    draw();
  });

  draw();
  await app.connect();
  applyHost(app.getHostContext());
  app.setupSizeChangedNotifications();
  draw();
}
