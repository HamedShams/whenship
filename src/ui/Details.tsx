import { applyChanges } from '../engine/changes';
import { dayParts, formatDay, formatDayLong } from '../engine/dates';
import type { Schedule } from '../engine/schedule';
import type { NormalizedItem, NormalizedPlan } from '../engine/types';
import { Avatar } from './WhoEditor';
import { cx, DateButton, Icon } from './lib';

/**
 * Why an item's date is what it is: a short list, opened from the date itself in the Expected delivery column (the
 * date is the question, this is the answer). Nothing else lives here.
 */
export function WhyDate({ lines, blocked }: { lines: string[]; blocked?: boolean }) {
  return (
    <div class="why">
      <h4>{blocked ? "Why it can't be scheduled" : 'Why this date'}</h4>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

const daysLabel = (d: number) => `${Number.isInteger(d) ? d : d.toFixed(1)} ${d === 1 ? 'day' : 'days'}`;

/**
 * An item's own settings, opened by clicking its name: the panel sits right under the row and is as wide as the list,
 * so it reads as the row opened up. It holds only what the row can't: everyone on the item by full name, what it has
 * to wait for (a date, other items), a note, and whether it's done. The row above already shows the dates.
 */
export function ItemPanel({
  plan,
  schedule,
  id,
  fullName,
  showWho,
  onCommit,
  onEditWho,
  onClose,
}: {
  plan: NormalizedPlan;
  /** The schedule on show (under the lens in use): where the item's start date comes from. */
  schedule: Schedule;
  id: string;
  /** The row can't show the whole name: repeat it in full on top. */
  fullName?: boolean;
  /** List who works on it (not needed when one person does everything and the row has the days). */
  showWho: boolean;
  onCommit: (p: NormalizedPlan, key?: string) => void;
  onEditWho: (anchor: HTMLElement) => void;
  onClose: () => void;
}) {
  const it = plan.items.find((x) => x.id === id);
  if (!it) return null;
  const r = schedule.byId.get(id);
  const year = dayParts(plan.start).year;
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
  const laneOf = (lane: string) => plan.lanes.find((l) => l.id === lane);
  const nameOf = (ref: string) => plan.items.find((x) => x.id === ref)?.name ?? ref;
  const candidates = plan.items.filter((x) => x.id !== id && !it.dependsOn.includes(x.id));

  return (
    <section class={cx('item-panel', it.done && 'is-done')} role="region" aria-label={`Settings for ${it.name}`}>
      {fullName && <p class="ip-name">{it.name}</p>}

      {showWho && (
        <div class="ip-row">
          <span class="ip-label">Who</span>
          <button class="ip-who" title="Change who works on it, and for how long" aria-label={`Who works on ${it.name}: change`} onClick={(e) => onEditWho(e.currentTarget as HTMLElement)}>
            {it.work.length ? (
              it.work.map((w) => {
                const lane = laneOf(w.lane);
                return (
                  <span key={w.lane} class="ip-person">
                    <Avatar name={lane?.name ?? w.lane} color={lane?.color ?? '#868e96'} />
                    <span class="ip-person-name">{lane?.name ?? w.lane}</span>
                    <span class="ip-days">{daysLabel(w.days)}</span>
                    {w.after && <span class="ip-after">after {laneOf(w.after)?.name ?? w.after}</span>}
                  </span>
                );
              })
            ) : (
              <span class="ip-empty">+ add who works on it</span>
            )}
          </button>
        </div>
      )}

      <div class="ip-row">
        <span class="ip-label">Can't start before</span>
        <span class="ip-control">
          <DateButton class="date-box" value={it.notBefore} label="Can't start before" placeholder="Any time" clearable format={(d) => formatDayLong(d, year)} onChange={(d) => patch({ notBefore: d ?? undefined })} />
          {r?.startDate && !it.done && <span class="ip-hint">starts {formatDay(r.startDate, year)}</span>}
        </span>
      </div>

      <div class="ip-row">
        <span class="ip-label">Starts after</span>
        <span class="ip-control ip-deps">
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
              class={cx('ip-select', it.dependsOn.length > 0 && 'more')}
              value=""
              aria-label="Add an item this one must wait for"
              onChange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                if (v) patch({ dependsOn: [...it.dependsOn, v] });
              }}
            >
              <option value="">{it.dependsOn.length ? '+ another item' : 'No other item'}</option>
              {candidates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </span>
      </div>

      <label class="ip-row">
        <span class="ip-label">Note</span>
        <input class="ip-input" value={it.note ?? ''} maxLength={500} placeholder="Anything worth remembering" onInput={(e) => setNote((e.currentTarget as HTMLInputElement).value)} />
      </label>

      <footer class="ip-foot">
        <button
          class={cx('btn', 'done-toggle', it.done && 'on')}
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
        {it.done && <span class="ip-hint">Done: it takes no more time</span>}
        <button class="btn ghost ip-close" title="Close (Esc)" onClick={onClose}>
          Close
        </button>
      </footer>
    </section>
  );
}
