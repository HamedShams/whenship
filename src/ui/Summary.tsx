import { useEffect, useRef, useState } from 'preact/hooks';
import { badgeLabel, headline, type Analysis } from '../engine/analysis';
import type { Change } from '../engine/changes';
import type { Insight } from '../engine/insights';
import type { Zoom } from '../io/view';
import { cx, Icon } from './lib';

const ZOOMS: [Zoom, string, string][] = [
  ['fit', 'Fit', 'Fit the whole plan into the chart (it scrolls only when days would get too narrow)'],
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
        <span class="headline-text">{text.charAt(0).toUpperCase() + text.slice(1)}</span>
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
        <div class="seg small" role="group" aria-label="Timeline zoom">
          {ZOOMS.map(([z, label, tip]) => (
            <button key={z} aria-pressed={zoom === z} onClick={() => onZoom(z)} title={tip}>
              {label}
            </button>
          ))}
        </div>
        {analysis.current.endDate && (
          <button class={cx('btn small', chainOn && 'primary')} onClick={onChain} title="Highlight the chain of work and busy people that sets the end date">
            <Icon.chain /> What sets the end date?
          </button>
        )}
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

/**
 * The options rail, under the chart so the timeline keeps the focus. Each card is one exact re-plan: hover to see
 * it as a ghost on the chart, click Apply to make it real (undo takes it back). Inside Claude, a last card asks the
 * chat for ideas the engine can't search; Claude's answers come back as cards of their own.
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
    const t = setTimeout(() => setAsked('idle'), 6000);
    return () => clearTimeout(t);
  }, [asked]);
  if (!options.length && !onAskClaude) return null;
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
        Options <span class="sub">hover one to preview it on the chart, Apply to keep it</span>
      </h3>
      <div class="option-rail">
        {options.map((o) => (
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
        {onAskClaude && (
          <div class="option ask">
            <span class="opt-kind">
              <Icon.spark /> Ask Claude
            </span>
            <b class="opt-title">Better options?</b>
            <p class="opt-effect">
              {asked === 'sent'
                ? 'Asked. Claude answers in the chat, and its options appear here as cards.'
                : asked === 'failed'
                  ? "Couldn't post to the chat. Ask Claude there in your own words."
                  : 'Claude can try what this list can’t: moving work between people, splitting or cutting items, combinations. Each idea is checked by the engine.'}
            </p>
            <button class="btn small primary" disabled={asked === 'sending'} onClick={() => void ask()} title="Posts the request to the chat; Claude sees this chart as it is now">
              {asked === 'sending' ? 'Asking…' : 'Ask Claude'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
