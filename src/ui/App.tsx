import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { analyze, criticalChain, type Analysis } from '../engine/analysis';
import { applyChanges, type Change } from '../engine/changes';
import { assess, findInsights, type Insight } from '../engine/insights';
import type { LensId } from '../engine/lens';
import type { NormalizedPlan } from '../engine/types';
import { DEFAULT_TITLE } from '../engine/validate';
import { shareUrl } from '../io/format';
import type { Zoom } from '../io/view';
import { Board, Legend } from './Board';
import { ItemDetails } from './Details';
import { buildExport, type ExportFile } from './exporters';
import { Header, type ExportKind } from './Header';
import { Setup } from './Setup';
import { usePlanHistory } from './state';
import { Headline, MAX_OPTIONS, Options, type Option } from './Summary';
import { EmptyState, IntroStrip, OpenDialog, TextDialog, type OpenTab } from './Welcome';
import { useDebounced } from './lib';

/** What differs between the website, the offline file and the Claude widget. */
export interface Host {
  mode: 'web' | 'widget';
  /**
   * Save a file for the user. 'saved' = downloaded; 'opened' = handed over to the website (which can export);
   * false = not possible (the app then shows text content for manual copy).
   */
  save(file: ExportFile): Promise<'saved' | 'opened' | false>;
  /** Copy text; resolve false if the clipboard is unavailable (the app then shows it for manual copy). */
  copy(text: string): Promise<boolean>;
  /** Base URL for share links (null when there's no web address, e.g. a local file). */
  baseUrl(): string | null;
  /** Called after every change of the plan or the view (the widget syncs the plan into Claude's context). */
  onChange?(plan: NormalizedPlan, lens: LensId, analysis: Analysis, zoom: Zoom | null): void;
  /** Whether the chat can be asked from the chart (the widget, in hosts that accept messages). */
  canAskClaude?(): boolean;
  /** Ask Claude in the chat for better options than the built-in suggestions; resolve false if it didn't go through. */
  askClaude?(plan: NormalizedPlan, lens: LensId): Promise<boolean>;
}

/** An option Claude proposed through `show_plan` (`suggestions`). Its effect is re-measured against the current plan. */
export interface ClaudeOption {
  title: string;
  changes: Change[];
}

export interface AppProps {
  host: Host;
  initialPlan: NormalizedPlan;
  initialLens?: LensId;
  /** The timeline zoom to start with; unset is `fit`. */
  initialZoom?: Zoom | null;
  today: string;
  /** Replace the plan from outside (e.g. Claude sent an update). Changing `externalVersion` triggers it. */
  externalPlan?: NormalizedPlan | null;
  externalVersion?: number;
  headerExtra?: ComponentChildren;
  footer?: ComponentChildren;
  notice?: string | null;
  /** First visit: the plan is an example, shown with a strip that says so until the first edit (or a dismissal). */
  intro?: boolean;
  onIntroDone?: () => void;
  /** Options Claude proposed; shown next to the engine's suggestions. */
  claudeOptions?: ClaudeOption[];
  /** One line under the plan name (where it lives, or whether Claude has the latest edits). */
  caption?: string;
}

/** How long the intro strip takes to fold away (matches the stylesheet). */
const INTRO_EXIT_MS = 260;

export function App(props: AppProps) {
  const { host, today } = props;
  const h = usePlanHistory(props.initialPlan);
  const { plan } = h;
  const [lens, setLens] = useState<LensId>(props.initialLens ?? 'planned');
  const [selected, setSelected] = useState<string | null>(null);
  const [chainOn, setChainOn] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: 'open'; tab: OpenTab } | { kind: 'text'; title: string; note: string; text: string }>(null);
  const [toast, setToast] = useState<string | null>(props.notice ?? null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // the intro strip: shown on a first visit, collapses (then goes) after the first edit or a dismissal
  const [intro, setIntro] = useState<'on' | 'leaving' | 'off'>(props.intro ? 'on' : 'off');
  const [previewOpt, setPreviewOpt] = useState<Option | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // The board's header sticks right under the toolbar, and anchored popovers stay clear of it: both read its height.
  useLayoutEffect(() => {
    const bar = toolbarRef.current;
    const root = appRef.current;
    if (!bar || !root) return;
    const measure = () => root.style.setProperty('--toolbar-h', `${bar.offsetHeight}px`);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (props.externalPlan) h.reset(props.externalPlan);
  }, [props.externalVersion]);

  // The first edit ends the intro: the example became the user's plan. The strip folds away rather than vanishing,
  // so the chart doesn't jump under the pointer right after a drop.
  const endIntro = useCallback(() => {
    setIntro((state) => {
      if (state !== 'on') return state;
      props.onIntroDone?.();
      setTimeout(() => setIntro('off'), INTRO_EXIT_MS);
      return 'leaving';
    });
  }, [props.onIntroDone]);
  const commit = useCallback(
    (next: NormalizedPlan, key?: string) => {
      h.commit(next, key);
      if (next !== plan) endIntro();
    },
    [h.commit, plan, endIntro],
  );

  const analysis = useMemo(() => analyze(plan, lens), [plan, lens]);
  const [zoom, setZoom] = useState<Zoom>(props.initialZoom ?? 'fit');
  const settled = useDebounced(plan, 180);
  const insights: Insight[] = useMemo(() => findInsights(settled, lens), [settled, lens]);
  const pending = settled !== plan;
  // One rail of at most three cards: Claude's options (measured against the plan as it is now) take the place of the
  // engine's lowest-ranked suggestions, so the rail never grows.
  const options = useMemo<Option[]>(() => {
    const own: Option[] = insights.map((s) => ({ id: s.id, kind: s.kind, title: s.title, effect: s.effect, changes: s.changes }));
    const fromClaude: Option[] = (props.claudeOptions ?? []).flatMap((c, i) => {
      const a = assess(settled, c.changes, lens);
      if (a.skipped.length) return []; // it no longer applies (the item or person is gone)
      return [{ id: `claude:${i}:${JSON.stringify(c.changes)}`, kind: 'claude', title: c.title, effect: a.effect, changes: c.changes }];
    });
    return [...fromClaude, ...own].slice(0, MAX_OPTIONS);
  }, [insights, props.claudeOptions, settled, lens]);
  // the option under the pointer, re-planned, drawn as a ghost on the chart
  const previewPlan = useMemo(() => (previewOpt ? applyChanges(plan, previewOpt.changes).plan : null), [previewOpt, plan]);

  useEffect(() => {
    host.onChange?.(plan, lens, analysis, zoom === 'fit' ? null : zoom);
  }, [plan, lens, zoom]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
      if (appRef.current?.closest('[hidden]')) return; // the widget is showing its card instead
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && (key === 'z' || (key === 'y' && !e.metaKey))) {
        e.preventDefault();
        if (e.shiftKey || key === 'y') h.redo();
        else h.undo();
      }
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h.undo, h.redo]);

  // The chain of work behind a date is shown only on request ("What sets the end date?"): for the selected item if
  // there is one, otherwise for the last item to finish. Selecting an item on its own highlights just that item.
  const highlight = useMemo(() => {
    if (!chainOn) return null;
    const from = selected && analysis.current.byId.get(selected)?.end !== undefined ? selected : undefined;
    return new Set(criticalChain(analysis.current, from));
  }, [selected, chainOn, analysis]);

  const doExport = useCallback(
    async (kind: ExportKind) => {
      try {
        const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
        const file = await buildExport(kind, plan, lens, !!dark, zoom);
        const ok = await host.save(file);
        if (ok === 'saved') setToast(`Saved ${file.name}`);
        else if (ok === 'opened') setToast('Opened this plan in whenship in your browser: export it from there');
        else if (typeof file.data === 'string') setDialog({ kind: 'text', title: file.name, note: "Downloads aren't available here, so here is the file's content: select all and copy.", text: file.data });
        else setToast('Downloads are not available here. Use "Open in whenship" or Copy link.');
      } catch (err) {
        setToast(`Export failed: ${(err as Error).message}`);
      }
    },
    [plan, lens, zoom, host],
  );

  const copyLink = useCallback(async () => {
    const base = host.baseUrl();
    const url = shareUrl(base ?? 'https://whenship.app/', plan, lens, zoom);
    const ok = await host.copy(url);
    if (ok) setToast('Link copied: the whole plan is inside it, nothing was uploaded');
    else setDialog({ kind: 'text', title: 'Share link', note: 'Copy this link. The whole plan travels inside it (after the #), so nothing is uploaded anywhere.', text: url });
  }, [plan, lens, zoom, host]);

  // In Claude, one click from the chart asks for ideas beyond the built-in suggestions (reassigning, splitting, combinations).
  const canAsk = !!host.askClaude && !!host.canAskClaude?.();
  const askClaude = useCallback(async () => {
    const ok = await host.askClaude!(plan, lens);
    if (ok) setToast('Asked Claude: its answer appears in the chat, and its options here');
    return ok;
  }, [plan, lens, host]);

  const loadPlan = (p: NormalizedPlan, note?: string) => {
    commit(p);
    setSelected(null);
    if (note) setToast(note);
  };

  // A fresh plan of the user's own: one person and a first item, ready to rename. The calendar is kept.
  const startBlank = () => {
    const base = applyChanges({ ...plan, title: DEFAULT_TITLE, lanes: [], items: [] }, [{ op: 'addLane', lane: { id: 'me', name: 'Me' } }]).plan;
    const withItem = applyChanges({ ...base, items: [{ id: '', name: 'First item', work: [{ lane: 'me', days: 3, maxPeople: 1 }], dependsOn: [] }] }, []).plan;
    commit(withItem);
    setSelected(null);
    setFocusId(withItem.items[0]!.id);
  };

  const openDialog = (tab: OpenTab) => setDialog({ kind: 'open', tab });
  const empty = plan.items.length === 0;

  return (
    <div class="app" ref={appRef}>
      <div class="toolbar" ref={toolbarRef}>
        <Header
          plan={plan}
          lens={lens}
          onLens={setLens}
          onTitle={(t) => commit({ ...plan, title: t }, 'title')}
          canUndo={h.canUndo}
          canRedo={h.canRedo}
          onUndo={h.undo}
          onRedo={h.redo}
          onExport={doExport}
          onCopyLink={copyLink}
          onOpen={() => openDialog('paste')}
          extra={props.headerExtra}
          empty={empty}
          caption={props.caption ?? (host.mode === 'widget' ? 'Plan · your edits reach Claude automatically' : 'Plan · saved in this browser')}
        />
        {!empty && <Setup plan={plan} onCommit={commit} />}
      </div>
      {intro !== 'off' && !empty && <IntroStrip onOpen={openDialog} onBlank={startBlank} onDismiss={endIntro} leaving={intro === 'leaving'} />}
      {empty ? (
        <EmptyState onOpen={openDialog} onBlank={startBlank} />
      ) : (
        <>
          <Headline analysis={analysis} chainOn={chainOn} onChain={() => setChainOn((v) => !v)} zoom={zoom} onZoom={setZoom} />
          <Board
            plan={plan}
            analysis={analysis}
            selected={selected}
            highlight={highlight}
            today={today}
            onSelect={setSelected}
            onCommit={commit}
            focusId={focusId}
            onFocused={() => setFocusId(null)}
            zoom={zoom}
            preview={previewPlan}
          />
          {selected && <ItemDetails plan={plan} analysis={analysis} id={selected} onCommit={commit} onClose={() => setSelected(null)} />}
          <Options
            options={options}
            pending={pending}
            onPreview={setPreviewOpt}
            onApply={(o) => {
              setPreviewOpt(null);
              commit(applyChanges(plan, o.changes).plan);
              setToast(`Applied: ${o.title}. Undo with ⌘/Ctrl Z`);
            }}
            onAskClaude={canAsk ? askClaude : undefined}
          />
          <Legend lens={lens} onPlanned={() => setLens('planned')} tipsOpen={intro !== 'off'} />
        </>
      )}
      {props.footer}
      {dialog?.kind === 'open' && <OpenDialog today={today} tab={dialog.tab} onLoad={loadPlan} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'text' && <TextDialog title={dialog.title} note={dialog.note} text={dialog.text} onClose={() => setDialog(null)} />}
      {toast && (
        <div class="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
