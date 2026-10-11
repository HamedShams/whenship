import type { Analysis } from '../engine/analysis';
import { chanceLabel, explain } from '../engine/analysis';
import { applyChanges } from '../engine/changes';
import { dayParts, formatDay, formatDayLong } from '../engine/dates';
import { describeWork } from '../engine/report';
import type { NormalizedPlan } from '../engine/types';
import { Delivery } from './Board';
import { DateButton, Icon } from './lib';

/**
 * The item inspector: a compact card docked at the bottom right while an item is selected. Facts first (delivery,
 * deadline, who, dates), then why the dates are what they are, then the few settings that don't fit in the row.
 */
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
  const index = plan.items.indexOf(it);
  const r = analysis.current.byId.get(id)!;
  const o = analysis.outlook.get(id);
  const year = dayParts(plan.start).year;
  const why = explain(analysis.current, id);
  const patch = (p: Partial<typeof it>, key?: string) => onCommit(applyChanges({ ...plan, items: plan.items.map((x) => (x.id === id ? { ...x, ...p } : x)) }, []).plan, key);
  const nameOf = (ref: string) => plan.items.find((x) => x.id === ref)?.name ?? ref;
  const candidates = plan.items.filter((x) => x.id !== id && !it.dependsOn.includes(x.id));

  return (
    <aside class="details" aria-label={`Details for ${it.name}`}>
      <header class="insp-head">
        <span class="insp-num">#{index + 1}</span>
        <h3 title={it.name}>{it.name}</h3>
        <button class="icon-btn" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
          <Icon.close />
        </button>
      </header>

      <dl class="insp-facts">
        <dt>Delivery</dt>
        <dd>
          <Delivery status={r.status} problem={r.problem} badge={analysis.status.get(id)} base={o?.badge} chance={o?.chance} lens={analysis.lens} endDate={r.endDate} deadline={it.deadline} year={year} />
          {o?.chance !== undefined && <span class="sub"> {chanceLabel(o.chance)} chance on time</span>}
        </dd>
        <dt>Due</dt>
        <dd>{it.deadline ? formatDayLong(it.deadline, year) : <span class="sub">no deadline</span>}</dd>
        <dt>Who</dt>
        <dd>{it.work.length ? describeWork(plan, id) : <span class="sub">nobody yet</span>}</dd>
        {r.startDate && r.endDate && (
          <>
            <dt>Dates</dt>
            <dd>
              {formatDay(r.startDate, year)} → {formatDay(r.endDate, year)}
            </dd>
          </>
        )}
      </dl>

      <section class="insp-why">
        <h4>Why these dates</h4>
        <ul>
          {why.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section class="insp-fields">
        <div class="insp-row">
          <span class="k">Can't start before</span>
          <span class="date-field">
            <DateButton value={it.notBefore} label="Can't start before" placeholder="any time" format={(d) => formatDayLong(d, year)} onChange={(d) => patch({ notBefore: d ?? undefined })} />
            {it.notBefore && (
              <button class="icon-btn" aria-label="Clear the can't-start-before date" title="Clear" onClick={() => patch({ notBefore: undefined })}>
                <Icon.close />
              </button>
            )}
          </span>
        </div>
        <div class="insp-row">
          <span class="k">Starts after</span>
          <span class="deps">
            {it.dependsOn.map((dep) => (
              <span key={dep} class="dep-chip" title={nameOf(dep)}>
                <span>{nameOf(dep)}</span>
                <button aria-label={`Remove: starts after ${nameOf(dep)}`} onClick={() => patch({ dependsOn: it.dependsOn.filter((x) => x !== dep) })}>
                  <Icon.close />
                </button>
              </span>
            ))}
            {candidates.length > 0 && (
              <select
                class="add-dep"
                value=""
                aria-label="Add an item this one must wait for"
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  if (v) patch({ dependsOn: [...it.dependsOn, v] });
                }}
              >
                <option value="">{it.dependsOn.length ? '+ add' : 'nothing · + add'}</option>
                {candidates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
          </span>
        </div>
        <label class="insp-row">
          <span class="k">Note</span>
          <input value={it.note ?? ''} placeholder="Anything worth remembering" onInput={(e) => patch({ note: (e.currentTarget as HTMLInputElement).value || undefined }, `note:${id}`)} />
        </label>
      </section>
    </aside>
  );
}
