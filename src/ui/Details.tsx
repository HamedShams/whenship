import type { Analysis } from '../engine/analysis';
import { chanceLabel, explain } from '../engine/analysis';
import { applyChanges } from '../engine/changes';
import { dayParts, formatDay, formatDayLong } from '../engine/dates';
import { describeWork } from '../engine/report';
import type { NormalizedItem, NormalizedPlan } from '../engine/types';
import { Delivery } from './Board';
import { cx, DateButton, Icon } from './lib';

/**
 * The selected item, in the dock's right-hand column: the name and the done control; one line of facts (delivery,
 * chance, due, who, start → finish); why the dates are what they are; and the few settings that don't fit in the row.
 */
export function ItemDetails({
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
  // The note is typed, so it's kept exactly as typed (re-validating on every keystroke would trim the space just pressed).
  const setNote = (v: string) =>
    onCommit(
      {
        ...plan,
        items: plan.items.map((x) => {
          if (x.id !== id) return x;
          const { note: _old, ...rest } = x;
          const next: NormalizedItem = rest;
          if (v) next.note = v.slice(0, 500);
          return next;
        }),
      },
      `note:${id}`,
    );
  const nameOf = (ref: string) => plan.items.find((x) => x.id === ref)?.name ?? ref;
  const candidates = plan.items.filter((x) => x.id !== id && !it.dependsOn.includes(x.id));
  const sep = <span class="sep">·</span>;

  return (
    <section class={cx('item-panel', it.done && 'is-done')} role="region" aria-label={`Details for ${it.name}`}>
      <header class="insp-head">
        <span class="insp-num">#{index + 1}</span>
        <h3 title={it.name}>{it.name}</h3>
        {it.done && (
          <span class="pill done" title="Finished: it takes no more time">
            done
          </span>
        )}
        <button
          class="btn small ghost done-toggle"
          aria-pressed={it.done ? 'true' : 'false'}
          title={it.done ? 'Put it back into the plan: it takes its days again' : 'Finished: it takes no more time, and anything waiting for it can start'}
          onClick={() => onCommit(applyChanges(plan, [{ op: 'setDone', item: id, done: !it.done }]).plan)}
        >
          {it.done ? (
            <>
              <Icon.undo /> Reopen
            </>
          ) : (
            <>
              <Icon.check /> Mark done
            </>
          )}
        </button>
        <button class="icon-btn" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
          <Icon.close />
        </button>
      </header>

      <p class="insp-meta">
        <span>
          <span class="k">Delivery</span>{' '}
          <Delivery status={r.status} problem={r.problem} badge={analysis.status.get(id)} base={o?.badge} chance={o?.chance} lens={analysis.lens} endDate={r.endDate} deadline={it.deadline} year={year} />
        </span>
        {o?.chance !== undefined && !it.done && (
          <>
            {sep}
            <span>{chanceLabel(o.chance)} chance on time</span>
          </>
        )}
        {sep}
        <span>
          <span class="k">Due</span> {it.deadline ? formatDayLong(it.deadline, year) : 'no deadline'}
        </span>
        {sep}
        <span>{it.work.length ? describeWork(plan, id) : 'nobody on it yet'}</span>
        {r.startDate && r.endDate && (
          <>
            {sep}
            <span>
              {formatDay(r.startDate, year)} → {formatDay(r.endDate, year)}
            </span>
          </>
        )}
      </p>

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
        <label class="insp-row note">
          <span class="k">Note</span>
          <input value={it.note ?? ''} placeholder="Anything worth remembering" onInput={(e) => setNote((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </section>
    </section>
  );
}
