import type { Analysis } from '../engine/analysis';
import { explain } from '../engine/analysis';
import { applyChanges } from '../engine/changes';
import { dayParts, formatDayLong } from '../engine/dates';
import { describeWork } from '../engine/report';
import type { NormalizedPlan } from '../engine/types';
import { Icon } from './lib';

export function Details({
  plan,
  analysis,
  id,
  onCommit,
  onClose,
}: {
  plan: NormalizedPlan;
  analysis: Analysis;
  id: string;
  onCommit: (p: NormalizedPlan, key?: string) => void;
  onClose: () => void;
}) {
  const it = plan.items.find((x) => x.id === id);
  if (!it) return null;
  const r = analysis.current.byId.get(id)!;
  const o = analysis.outlook.get(id);
  const year = dayParts(plan.start).year;
  const why = explain(analysis.current, id);
  const patch = (p: Partial<typeof it>, key?: string) => onCommit(applyChanges({ ...plan, items: plan.items.map((x) => (x.id === id ? { ...x, ...p } : x)) }, []).plan, key);
  return (
    <section class="details" aria-label={`Details for ${it.name}`}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>{it.name}</h3>
          <button class="icon-btn" aria-label="Close details" onClick={onClose}>
            <Icon.close />
          </button>
        </div>
        <p class="sub" style={{ margin: '0 0 8px' }}>
          {describeWork(plan, id)}
          {r.startDate && r.endDate ? ` · ${formatDayLong(r.startDate, year)} → ${formatDayLong(r.endDate, year)}` : ''}
          {o?.chance !== undefined ? ` · ~${Math.round(Math.min(0.99, o.chance) * 20) * 5}% chance on time` : ''}
        </p>
        <h3 style={{ fontSize: '13px' }}>Why these dates</h3>
        <ul>
          {why.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div>
        <div class="field-row">
          <label class="field">
            Can't start before
            <input type="date" value={it.notBefore ?? ''} onChange={(e) => patch({ notBefore: (e.currentTarget as HTMLInputElement).value || undefined })} />
          </label>
        </div>
        <label class="field">
          Starts after (dependencies)
          <select
            multiple
            size={Math.min(5, Math.max(2, plan.items.length - 1))}
            onChange={(e) => patch({ dependsOn: [...(e.currentTarget as HTMLSelectElement).selectedOptions].map((op) => op.value) })}
          >
            {plan.items
              .filter((x) => x.id !== id)
              .map((x) => (
                <option key={x.id} value={x.id} selected={it.dependsOn.includes(x.id)}>
                  {x.name}
                </option>
              ))}
          </select>
        </label>
        <label class="field">
          Note
          <input value={it.note ?? ''} placeholder="e.g. waiting for the client's questionnaire" onInput={(e) => patch({ note: (e.currentTarget as HTMLInputElement).value || undefined }, `note:${id}`)} />
        </label>
      </div>
    </section>
  );
}
