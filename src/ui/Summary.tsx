import { badgeLabel, headline, type Analysis } from '../engine/analysis';
import type { Insight } from '../engine/insights';
import { cx, Icon } from './lib';

const KIND_LABEL: Record<Insight['kind'], string> = {
  reorder: 'Reorder',
  defer: 'Defer',
  availability: 'More time',
  'add-person': 'More people',
  deadline: 'Negotiate',
};

export function Summary({
  analysis,
  insights,
  pending,
  chainOn,
  onChain,
  onApply,
}: {
  analysis: Analysis;
  insights: Insight[];
  pending: boolean;
  chainOn: boolean;
  onChain: () => void;
  onApply: (s: Insight) => void;
}) {
  const text = headline(analysis);
  const c = analysis.counts;
  return (
    <section class="summary" aria-live="polite">
      <div class="headline">
        <span>{text.charAt(0).toUpperCase() + text.slice(1)}</span>
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
        {analysis.current.endDate && (
          <button class={cx('btn small', chainOn && 'primary')} onClick={onChain} title="Highlight the chain of work and busy people that sets the end date">
            <Icon.chain /> What sets the end date?
          </button>
        )}
      </div>
      {insights.length > 0 && (
        <div class="insights" aria-label="Suggestions">
          {insights.map((s) => (
            <div key={s.id} class="insight">
              <span class="kind">
                <Icon.spark /> {KIND_LABEL[s.kind]}
              </span>
              <b>{s.title}</b>
              <div class="insight-foot">
                <p>{s.effect}</p>
                <button class="btn small" disabled={pending} onClick={() => onApply(s)} title="Apply this change (you can undo it)">
                  Apply
                </button>
              </div>
            </div>
          ))}
          
        </div>
      )}
    </section>
  );
}
