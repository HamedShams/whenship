import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { analyze, criticalChain, type Analysis } from '../engine/analysis';
import { applyChanges } from '../engine/changes';
import { findInsights, type Insight } from '../engine/insights';
import type { LensId } from '../engine/lens';
import type { NormalizedPlan } from '../engine/types';
import { shareUrl } from '../io/format';
import { autoZoom, Board, timelineSpan, type Zoom } from './Board';
import { Details } from './Details';
import { buildExport, type ExportFile } from './exporters';
import { Header, type ExportKind } from './Header';
import { Setup } from './Setup';
import { usePlanHistory } from './state';
import { Summary } from './Summary';
import { ImportDialog, TextDialog, Welcome } from './Welcome';
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
  /** Called after every change (the widget syncs it into Claude's context). */
  onChange?(plan: NormalizedPlan, lens: LensId, analysis: Analysis): void;
}

export interface AppProps {
  host: Host;
  initialPlan: NormalizedPlan;
  initialLens?: LensId;
  today: string;
  /** Replace the plan from outside (e.g. Claude sent an update). Changing `externalVersion` triggers it. */
  externalPlan?: NormalizedPlan | null;
  externalVersion?: number;
  headerExtra?: ComponentChildren;
  footer?: ComponentChildren;
  notice?: string | null;
}

export function App(props: AppProps) {
  const { host, today } = props;
  const h = usePlanHistory(props.initialPlan);
  const { plan } = h;
  const [lens, setLens] = useState<LensId>(props.initialLens ?? 'planned');
  const [selected, setSelected] = useState<string | null>(null);
  const [chainOn, setChainOn] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: 'import' } | { kind: 'text'; title: string; note: string; text: string }>(null);
  const [toast, setToast] = useState<string | null>(props.notice ?? null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (props.externalPlan) h.reset(props.externalPlan);
  }, [props.externalVersion]);

  const analysis = useMemo(() => analyze(plan, lens), [plan, lens]);
  // timeline zoom: picked from the plan's length until the user chooses one
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const zoomShown: Zoom = useMemo(() => zoom ?? autoZoom(timelineSpan(plan, analysis, today).span), [zoom, plan, analysis, today]);
  const settled = useDebounced(plan, 180);
  const insights: Insight[] = useMemo(() => findInsights(settled, lens), [settled, lens]);
  const pending = settled !== plan;

  useEffect(() => {
    host.onChange?.(plan, lens, analysis);
  }, [plan, lens]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) h.redo();
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
        const file = await buildExport(kind, plan, lens, !!dark);
        const ok = await host.save(file);
        if (ok === 'saved') setToast(`Saved ${file.name}`);
        else if (ok === 'opened') setToast('Opened this plan in whenship in your browser: export it from there');
        else if (typeof file.data === 'string') setDialog({ kind: 'text', title: file.name, note: "Downloads aren't available here, so here is the file's content: select all and copy.", text: file.data });
        else setToast('Downloads are not available here. Use "Open in whenship" or Copy link.');
      } catch (err) {
        setToast(`Export failed: ${(err as Error).message}`);
      }
    },
    [plan, lens, host],
  );

  const copyLink = useCallback(async () => {
    const base = host.baseUrl();
    const url = shareUrl(base ?? 'https://whenship.app/', plan, lens);
    const ok = await host.copy(url);
    if (ok) setToast('Link copied: the whole plan is inside it, nothing was uploaded');
    else setDialog({ kind: 'text', title: 'Share link', note: 'Copy this link. The whole plan travels inside it (after the #), so nothing is uploaded anywhere.', text: url });
  }, [plan, lens, host]);

  const loadPlan = (p: NormalizedPlan, note?: string) => {
    h.commit(p);
    setSelected(null);
    if (note) setToast(note);
  };

  const startBlank = () => {
    const p = applyChanges(plan, [{ op: 'addLane', lane: { id: 'me', name: 'Me' } }]).plan;
    const withItem = applyChanges({ ...p, items: [{ id: '', name: 'First item', work: [{ lane: p.lanes[0]!.id, days: 3, maxPeople: 1 }], dependsOn: [] }] }, []).plan;
    h.commit(withItem);
    setFocusId(withItem.items[0]!.id);
  };

  const empty = plan.items.length === 0;

  return (
    <div class="app">
      <div class="toolbar">
        <Header
          plan={plan}
          lens={lens}
          onLens={setLens}
          onTitle={(t) => h.commit({ ...plan, title: t }, 'title')}
          canUndo={h.canUndo}
          canRedo={h.canRedo}
          onUndo={h.undo}
          onRedo={h.redo}
          onExport={doExport}
          onCopyLink={copyLink}
          onOpen={() => setDialog({ kind: 'import' })}
          extra={props.headerExtra}
          empty={plan.items.length === 0}
          caption={host.mode === 'widget' ? 'Plan · your edits reach Claude automatically' : 'Plan · saved in this browser'}
        />
        {!empty && <Setup plan={plan} onCommit={h.commit} />}
      </div>
      {empty ? (
        <Welcome today={today} onLoad={loadPlan} onBlank={startBlank} />
      ) : (
        <>
          <Summary
            analysis={analysis}
            insights={insights}
            pending={pending}
            chainOn={chainOn}
            zoom={zoomShown}
            onZoom={setZoom}
            onChain={() => setChainOn((v) => !v)}
            onApply={(s) => {
              h.commit(applyChanges(plan, s.changes).plan);
              setToast(`Applied: ${s.title}. Undo with ⌘/Ctrl Z`);
            }}
          />
          <Board
            plan={plan}
            analysis={analysis}
            selected={selected}
            highlight={highlight}
            today={today}
            onSelect={setSelected}
            onCommit={h.commit}
            focusId={focusId}
            onFocused={() => setFocusId(null)}
            zoom={zoomShown}
          />
          {selected && plan.items.some((x) => x.id === selected) && (
            <Details plan={plan} analysis={analysis} id={selected} onCommit={h.commit} onClose={() => setSelected(null)} />
          )}
          <p class="hint">Drag ⠿ to reprioritize · click any value to edit · click a row to see why it lands when it does.</p>
        </>
      )}
      {props.footer}
      {dialog?.kind === 'import' && <ImportDialog today={today} onLoad={loadPlan} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'text' && <TextDialog title={dialog.title} note={dialog.note} text={dialog.text} onClose={() => setDialog(null)} />}
      {toast && (
        <div class="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
