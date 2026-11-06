import { useEffect, useRef, useState } from 'preact/hooks';
import { badgeLabel, headline, type Analysis } from '../engine/analysis';
import type { Change } from '../engine/changes';
import type { Insight } from '../engine/insights';
import { toZoom, type Zoom } from '../io/view';
import { cx, Icon } from './lib';

const ZOOMS: [Zoom, string, string][] = [
  ['fit', 'Fit to width', 'The whole plan in the chart (it scrolls only when days would get too narrow)'],
  ['day', 'Days', 'A fixed day scale'],
  ['week', 'Weeks', 'A fixed week scale'],
  ['month', 'Months', 'A fixed month scale'],
];

/** The one sentence that is the plan's answer, its badges, and the chart controls. Sits right above the chart. */
export function Headline({ analysis, chainOn, onChain, zoom, onZoom }: { analysis: Analysis; chainOn: boolean; onChain: () => void; zoom: Zoom; onZoom: (z: Zoom) => void }) {
  const text = headline(analysis);
  const c = analysis.counts;
  return (
    <section class="summary" aria-live="polite">
      <div class="headline">
        <span class="headline-text">
          {text.charAt(0).toUpperCase() + text.slice(1)}
          {analysis.current.endDate && (
            <>
              {' · '}
              <button class={cx('link-btn chain-link', chainOn && 'on')} aria-pressed={chainOn} onClick={onChain} title="Highlight the chain of work and busy people that sets the end date">
                {chainOn ? 'hide the chain' : 'what sets the end date?'}
              </button>
            </>
          )}
        </span>
        <span class="counts">
          {(['late', 'tight', 'likely', 'safe'] as const).map((b) =>
            c[b] ? (
              <span key={b} class={`pill ${b}`}>
                {c[b]} {badgeLabel(b)}
              </span>
            ) : null,
          )}
        </span>
        <span class="spacer" />
        <label class="zoom" title={ZOOMS.find(([z]) => z === zoom)?.[2]}>
          <span class="label">Zoom</span>
          <select class="zoom-select" aria-label="Timeline zoom" value={zoom} onChange={(e) => onZoom(toZoom((e.currentTarget as HTMLSelectElement).value) ?? 'fit')}>
            {ZOOMS.map(([z, label]) => (
              <option key={z} value={z}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

/** One thing the user could do to the plan: the engine's own suggestions and the ones Claude proposed look the same. */
export interface Option {
  id: string;
  kind: Insight['kind'] | 'claude';
  title: string;
  effect: string;
  changes: Change[];
}

const KIND_LABEL: Record<Option['kind'], string> = {
  reorder: 'Reorder',
  defer: 'Defer',
  availability: 'More time',
  'add-person': 'More people',
  deadline: 'Negotiate',
  claude: "Claude's option",
};

/** Hovering (or focusing) a card for this long previews it on the chart; a quick pass over the rail changes nothing. */
const PREVIEW_DELAY = 280;

/** Never more than this many cards (they share the dock with the selected item): inside Claude, its ideas take the place of the engine's lowest-ranked ones. */
export const MAX_OPTIONS = 2;

/**
 * The options rail, under the chart so the timeline keeps the focus: at most three cards, each one exact re-plan.
 * Hover to see it as a ghost on the chart, click Apply to make it real (undo takes it back). Inside Claude, a button
 * in the title asks the chat for ideas the engine can't search; Claude's answers come back as cards, in place of the
 * engine's lowest-ranked ones.
 */
export function Options({
  options,
  pending,
  onApply,
  onPreview,
  onAskClaude,
}: {
  options: Option[];
  /** The plan is still settling (typing): applying would race the next re-plan. */
  pending: boolean;
  onApply: (o: Option) => void;
  /** Called with the option under the pointer (after a short delay) and with null when it leaves. */
  onPreview: (o: Option | null) => void;
  /** Set inside Claude: posts a request for more options to the chat. Resolves once it went through. */
  onAskClaude?: (() => Promise<boolean>) | undefined;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [asked, setAsked] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (asked !== 'sent' && asked !== 'failed') return;
    const t = setTimeout(() => setAsked('idle'), 8000);
    return () => clearTimeout(t);
  }, [asked]);
  const shown = options.slice(0, MAX_OPTIONS);
  const enter = (o: Option) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onPreview(o), PREVIEW_DELAY);
  };
  const leave = () => {
    clearTimeout(timer.current);
    onPreview(null);
  };
  const ask = async () => {
    if (!onAskClaude || asked === 'sending') return;
    setAsked('sending');
    setAsked((await onAskClaude()) ? 'sent' : 'failed');
  };
  return (
    <section class="options" aria-label="Options">
      <h3 class="options-title">
        Options
        <span class="sub">{shown.length ? 'hover one to see it on the chart, Apply to keep it' : 'nothing to fix: every deadline holds as planned'}</span>
        {onAskClaude && (
          <span class="ask-claude">
            <button
              class="btn small"
              disabled={asked === 'sending'}
              onClick={() => void ask()}
              title="Posts a request to the chat. Claude sees this chart as it is now and tries what this list can't: moving work between people, splitting or cutting items, combinations. Its ideas come back here as cards, checked by the engine."
            >
              <Icon.spark /> {asked === 'sending' ? 'Asking Claude…' : 'Ask Claude for better options'}
            </button>
            {asked === 'sent' && <span class="sub">Asked. Claude answers in the chat; its options appear here.</span>}
            {asked === 'failed' && <span class="sub err">Couldn't post to the chat. Ask Claude there in your own words.</span>}
          </span>
        )}
      </h3>
      {shown.length > 0 && (
        <div class="option-rail">
          {shown.map((o) => (
            <div
              key={o.id}
              class={cx('option', o.kind === 'claude' && 'from-claude')}
              tabIndex={0}
              onPointerEnter={() => enter(o)}
              onPointerLeave={leave}
              onFocus={() => onPreview(o)}
              onBlur={leave}
            >
              <span class="opt-kind">
                {o.kind === 'claude' ? <Icon.spark /> : null} {KIND_LABEL[o.kind]}
              </span>
              <b class="opt-title">{o.title}</b>
              <p class="opt-effect">{o.effect}</p>
              <button
                class="btn small"
                disabled={pending}
                onClick={() => {
                  leave();
                  onApply(o);
                }}
                title="Apply this change (you can undo it)"
              >
                Apply
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
