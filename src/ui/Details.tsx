import { applyChanges } from '../engine/changes';
import { dayParts, formatDay, formatDayLong } from '../engine/dates';
import type { Schedule } from '../engine/schedule';
import type { NormalizedItem, NormalizedPlan } from '../engine/types';
import { cx, DateButton, Icon } from './lib';

/**
 * Why an item's date is what it is: a short list, opened from the date itself in the Expected delivery column (the
 * date is the question, this is the answer). Nothing else lives here.
 */
export function WhyDate({ lines, blocked, onClose }: { lines: string[]; blocked?: boolean; onClose: () => void }) {
  return (
    <div class="why">
      <header class="why-head">
        <h4>{blocked ? "Why it can't be scheduled" : 'Why this date'}</h4>
        <button class="icon-btn why-close" aria-label="Close" data-tip="Close (Esc)" onClick={onClose}>
          <Icon.close />
        </button>
      </header>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

/** As long as a note may be when typed here (longer ones from a file or from Claude are kept and shown). */
export const NOTE_MAX = 120;

/**
 * An item's own settings, opened by clicking its name: the panel is docked under the row and is as wide as the list
 * from the name to the row's end, so it reads as the row opened up. It holds only what the row can't: what the item
 * has to wait for (a date, other items), a note, and whether it's finished. The row above already shows the dates and
 * who works on it.
 */
export function ItemPanel({
  plan,
  schedule,
  id,
  fullName,
  onCommit,
  onClose,
}: {
  plan: NormalizedPlan;
  /** The schedule on show (under the lens in use): where the item's start date comes from. */
  schedule: Schedule;
  id: string;
  /** The row can't show the whole name: repeat it in full on top. */
  fullName?: boolean;
  onCommit: (p: NormalizedPlan, key?: string) => void;
  onClose: () => void;
}) {
  const it = plan.items.find((x) => x.id === id);
  if (!it) return null;
  const r = schedule.byId.get(id);
  const year = dayParts(plan.start).year;
  const patch = (p: Partial<typeof it>, key?: string) => onCommit(applyChanges({ ...plan, items: plan.items.map((x) => (x.id === id ? { ...x, ...p } : x)) }, []).plan, key);
  // The note is typed, so it's kept exactly as typed (re-validating on every keystroke would trim the space just
  // pressed). One paragraph: a line break becomes a space, so it stays one cell in a sheet and one line in a summary.
  const setNote = (v: string) =>
    onCommit(
      {
        ...plan,
        items: plan.items.map((x) => {
          if (x.id !== id) return x;
          const { note: _old, ...rest } = x;
          const next: NormalizedItem = rest;
          const text = v.replace(/\s*\n\s*/g, ' ');
          if (text) next.note = text;
          return next;
        }),
      },
      `note:${id}`,
    );
  const nameOf = (ref: string) => plan.items.find((x) => x.id === ref)?.name ?? ref;
  const candidates = plan.items.filter((x) => x.id !== id && !it.dependsOn.includes(x.id));
  const note = it.note ?? '';

  return (
    <section class={cx('item-panel', it.done && 'is-done')} role="region" aria-label={`Settings for ${it.name}`}>
      {fullName && <p class="ip-name">{it.name}</p>}

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
            <span key={dep} class="dep-chip" data-tip={nameOf(dep)}>
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

      <label class="ip-row ip-note">
        <span class="ip-note-head">
          <span class="ip-label">Note</span>
          <span class={cx('ip-count', note.length > NOTE_MAX && 'over')} aria-hidden="true">
            {note.length}/{NOTE_MAX}
          </span>
        </span>
        <textarea
          class="ip-input"
          rows={2}
          wrap="soft"
          value={note}
          maxLength={NOTE_MAX}
          placeholder="Anything worth remembering"
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault(); // a note is one paragraph
          }}
          onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)}
        />
      </label>

      <footer class="ip-foot">
        <button
          class={cx('btn', 'done-toggle', it.done && 'on')}
          aria-pressed={it.done ? 'true' : 'false'}
          data-tip={it.done ? 'Put it back into the plan: it takes its days again' : 'Finished: it takes no more time, and anything waiting for it can start'}
          onClick={() => onCommit(applyChanges(plan, [{ op: 'setDone', item: id, done: !it.done }]).plan)}
        >
          {it.done ? (
            <>
              <Icon.undo /> Reopen
            </>
          ) : (
            <>
              <Icon.check /> Mark as done
            </>
          )}
        </button>
        {it.done && <span class="ip-hint">Finished: it takes no more time</span>}
        <button class="btn primary ip-close" onClick={onClose}>
          Done
        </button>
      </footer>
    </section>
  );
}
