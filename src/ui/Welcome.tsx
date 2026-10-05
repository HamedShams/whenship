import { useState } from 'preact/hooks';
import { parsePlanText } from '../io/format';
import { SAMPLES } from '../io/samples';
import { validatePlan } from '../engine/validate';
import type { NormalizedPlan } from '../engine/types';
import { Logo } from './lib';

export function Welcome({ today, onLoad, onBlank }: { today: string; onLoad: (p: NormalizedPlan, note?: string) => void; onBlank: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const plan = () => {
    const parsed = parsePlanText(text, today);
    if (!parsed.plan.items.length) {
      setError('Could not find any items in that text. Try one item per line, or a table with a header row.');
      return;
    }
    onLoad(parsed.plan, parsed.errors.length ? `${parsed.errors.length} value(s) could not be read and were skipped` : undefined);
  };
  return (
    <div class="welcome">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Logo size={40} />
        <h1>When will it ship, honestly?</h1>
      </div>
      <p class="lede">
        List what you've promised, who does it and roughly how long it takes. whenship draws the timeline, tells you which deadlines will slip, and lets you drag things around until the plan works. No sign-up: your plan stays on your device.
      </p>
      <div class="samples">
        {SAMPLES.map((s) => (
          <button key={s.id} class="sample" onClick={() => onLoad(validatePlan(s.build(today), { today }).plan)}>
            <b>{s.label}</b>
            <span>{s.blurb}</span>
          </button>
        ))}
      </div>
      <div class="paste-box">
        <label class="label" for="paste">
          …or paste your own list or table
        </label>
        <textarea
          id="paste"
          value={text}
          placeholder={'Grant draft for Acme, 5d, due 7 Oct\nAppeal for Northwind, 4 days, due Oct 2\nResearch for Brightside, 6d\n\n(Spreadsheet rows, CSV, a Markdown table or a saved .whenship.yaml all work.)'}
          onInput={(e) => {
            setText((e.currentTarget as HTMLTextAreaElement).value);
            setError('');
          }}
        />
        {error && <p class="sub" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button class="btn primary" disabled={!text.trim()} onClick={plan}>
            Plan it
          </button>
          <button class="btn" onClick={onBlank}>
            Start empty
          </button>
        </div>
      </div>
    </div>
  );
}

/** Paste or open a plan from inside the app. */
export function ImportDialog({ today, onLoad, onClose }: { today: string; onLoad: (p: NormalizedPlan, note?: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const go = (value: string) => {
    const parsed = parsePlanText(value, today);
    if (!parsed.plan.items.length) {
      setError('No items found. One item per line, a table with a header row, or a .whenship.yaml file.');
      return;
    }
    onLoad(parsed.plan, parsed.errors.length ? `${parsed.errors.length} value(s) skipped` : undefined);
    onClose();
  };
  return (
    <div class="dialog-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="dialog" role="dialog" aria-label="Open a plan">
        <h2>Open a plan</h2>
        <p class="note">Choose a saved plan file, or paste anything: a list, spreadsheet rows, CSV, a Markdown table, or a whenship link. This replaces the current plan (you can undo).</p>
        <input
          type="file"
          accept=".yaml,.yml,.json,.csv,.tsv,.txt,.md"
          onChange={async (e) => {
            const f = (e.currentTarget as HTMLInputElement).files?.[0];
            if (f) go(await f.text());
          }}
        />
        <textarea
          style={{ marginTop: '10px' }}
          value={text}
          placeholder="Paste here…"
          onInput={(e) => {
            setText((e.currentTarget as HTMLTextAreaElement).value);
            setError('');
          }}
        />
        {error && <p class="sub" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div class="actions">
          <button class="btn" onClick={onClose}>
            Cancel
          </button>
          <button class="btn primary" disabled={!text.trim()} onClick={() => go(text)}>
            Open
          </button>
        </div>
      </div>
    </div>
  );
}

export function TextDialog({ title, note, text, onClose }: { title: string; note: string; text: string; onClose: () => void }) {
  return (
    <div class="dialog-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="dialog" role="dialog" aria-label={title}>
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
