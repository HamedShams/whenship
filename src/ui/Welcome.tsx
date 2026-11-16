import { useState } from 'preact/hooks';
import { parsePlanText } from '../io/format';
import { SAMPLES } from '../io/samples';
import { validatePlan } from '../engine/validate';
import type { NormalizedPlan } from '../engine/types';
import { cx, Icon } from './lib';

export type OpenTab = 'paste' | 'examples' | 'file';

/**
 * Bringing a plan in: paste anything, pick an example, or open a file. One dialog for the first visit's intro strip,
 * the Open button and the empty state.
 */
export function OpenDialog({ today, onLoad, onClose, tab: initial = 'paste' }: { today: string; onLoad: (p: NormalizedPlan, note?: string) => void; onClose: () => void; tab?: OpenTab }) {
  const [tab, setTab] = useState<OpenTab>(initial);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const go = (value: string) => {
    const parsed = parsePlanText(value, today);
    if (!parsed.plan.items.length) {
      setError('No items found. Try one item per line ("Grant draft for Acme, 5d, due 7 Oct"), a table with a header row, or a saved whenship .json plan.');
      return;
    }
    onLoad(parsed.plan, parsed.errors.length ? `${parsed.errors.length} value(s) could not be read and were skipped` : undefined);
    onClose();
  };
  const tabs: [OpenTab, string][] = [
    ['paste', 'Paste'],
    ['examples', 'Examples'],
    ['file', 'Open a file'],
  ];
  return (
    <div class="dialog-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="dialog open-dialog" role="dialog" aria-label="Open a plan">
        <div class="dialog-head">
          <h2>Bring your plan in</h2>
          <button class="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon.close />
          </button>
        </div>
        <div class="seg" role="tablist" aria-label="How to bring a plan in">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'paste' && (
          <div class="paste-box">
            <p class="note">One item per line, spreadsheet rows, CSV, a Markdown table, a whenship link or a saved plan. Who, days and due dates are picked up when they're there; the rest you can fill in on the chart.</p>
            <textarea
              value={text}
              autoFocus
              placeholder={'Grant draft for Acme, 5d, due 7 Oct\nAppeal for Northwind, Martin 4 days, due Oct 2\nResearch for Brightside, 6d'}
              onInput={(e) => {
                setText((e.currentTarget as HTMLTextAreaElement).value);
                setError('');
              }}
            />
            {error && <p class="sub err">{error}</p>}
            <div class="actions">
              <button class="btn" onClick={onClose}>
                Cancel
              </button>
              <button class="btn primary" disabled={!text.trim()} onClick={() => go(text)}>
                Plan it
              </button>
            </div>
          </div>
        )}
        {tab === 'examples' && (
          <div class="samples">
            {SAMPLES.map((s) => (
              <button
                key={s.id}
                class="sample"
                onClick={() => {
                  onLoad(validatePlan(s.build(today), { today }).plan, `Loaded the example "${s.label}"`);
                  onClose();
                }}
              >
                <b>{s.label}</b>
                <span>{s.blurb}</span>
              </button>
            ))}
          </div>
        )}
        {tab === 'file' && (
          <div class="paste-box">
            <p class="note">A saved whenship plan (.json), or any text file with a list or a table. It replaces the current plan; undo brings it back.</p>
            <input
              type="file"
              accept=".json,.csv,.tsv,.txt,.md,.yaml,.yml"
              onChange={async (e) => {
                const f = (e.currentTarget as HTMLInputElement).files?.[0];
                if (f) go(await f.text());
              }}
            />
            {error && <p class="sub err">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The first visit opens on an example plan, so the chart itself is the welcome. This strip above it says so, and
 * offers the three ways out. It goes away on the first edit, or when dismissed, and never comes back.
 */
export function IntroStrip({ onOpen, onBlank, onDismiss, leaving }: { onOpen: (tab: OpenTab) => void; onBlank: () => void; onDismiss: () => void; leaving?: boolean }) {
  return (
    <div class={cx('intro', leaving && 'leaving')} role="note" aria-hidden={leaving ? 'true' : undefined}>
      <span class="intro-text">
        <b>This is an example plan.</b> Drag a row to reprioritise, click any value to change it, or start your own:
      </span>
      <span class="intro-actions">
        <button class="btn small" onClick={() => onOpen('paste')}>
          <Icon.paste /> Paste a list
        </button>
        <button class="btn small" onClick={onBlank}>
          Start empty
        </button>
        <button class="btn small ghost" onClick={() => onOpen('examples')}>
          More examples
        </button>
      </span>
      <button class="icon-btn intro-close" aria-label="Dismiss" title="Keep this example and hide this note" onClick={onDismiss}>
        <Icon.close />
      </button>
    </div>
  );
}

/** No items at all (the plan was emptied): a small prompt in the chart's place, not a landing page. */
export function EmptyState({ onOpen, onBlank }: { onOpen: (tab: OpenTab) => void; onBlank: () => void }) {
  return (
    <div class="empty-state">
      <p class="empty-lede">Nothing planned yet.</p>
      <div class="intro-actions">
        <button class="btn primary" onClick={() => onOpen('paste')}>
          <Icon.paste /> Paste a list
        </button>
        <button class="btn" onClick={onBlank}>
          Start with one item
        </button>
        <button class="btn ghost" onClick={() => onOpen('examples')}>
          Load an example
        </button>
      </div>
    </div>
  );
}

export function TextDialog({ title, note, text, onClose }: { title: string; note: string; text: string; onClose: () => void }) {
  return (
    <div class="dialog-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={cx('dialog')} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <p class="note">{note}</p>
        <textarea readOnly value={text} onFocus={(e) => (e.currentTarget as HTMLTextAreaElement).select()} />
        <div class="actions">
          <button class="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
