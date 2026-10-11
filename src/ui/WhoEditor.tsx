import { useEffect, useRef } from 'preact/hooks';
import { applyChanges } from '../engine/changes';
import type { NormalizedPlan, NormalizedWork } from '../engine/types';
import { Popover } from './Popover';
import { Icon } from './lib';

/** Two-letter badge for a person or team: "Sara" → "SA", "Back-end" → "BE", "Person 7" → "P7". */
export function initials(name: string): string {
  const words = name.trim().split(/[\s\-_]+/).filter(Boolean);
  if (!words.length) return '?';
  const digits = /\d+$/.exec(name.trim())?.[0];
  if (digits && words.length > 1) return (words[0]![0]! + digits).toUpperCase().slice(0, 3);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2)).toUpperCase();
}

export function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span class="avatar" style={{ background: color }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** Everyone who works on one item, in one place: effort, people at once, hand-offs, add and remove. */
export function WhoEditor({ anchor, plan, itemId, onClose, onCommit }: { anchor: HTMLElement; plan: NormalizedPlan; itemId: string; onClose: () => void; onCommit: (p: NormalizedPlan, key?: string) => void }) {
  const it = plan.items.find((x) => x.id === itemId);
  const lastAdded = useRef<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!lastAdded.current) return;
    const input = boxRef.current?.querySelector<HTMLInputElement>(`[data-days="${lastAdded.current}"]`);
    lastAdded.current = null;
    input?.focus({ preventScroll: true });
    input?.select();
  });
  if (!it) return null;
  const laneOf = (id: string) => plan.lanes.find((l) => l.id === id);
  const used = new Set(it.work.map((w) => w.lane));
  const free = plan.lanes.filter((l) => !used.has(l.id));
  const setWork = (work: NormalizedWork[], key?: string) =>
    onCommit(applyChanges({ ...plan, items: plan.items.map((x) => (x.id === it.id ? { ...x, work } : x)) }, []).plan, key);
  const setPart = (lane: string, patch: Partial<NormalizedWork>, key?: string) => setWork(it.work.map((w) => (w.lane === lane ? { ...w, ...patch } : w)), key);

  return (
    <Popover anchor={anchor} onClose={onClose} label={`Who works on ${it.name}`} className="who-pop">
      <div ref={boxRef}>
        <h4>Who works on "{it.name}"</h4>
        {it.work.length === 0 && <p class="note">{plan.lanes.length ? 'Nobody yet. Add a person or team below.' : 'Add a person or team in the bar above first.'}</p>}
        {it.work.map((w) => {
          const lane = laneOf(w.lane);
          const name = lane?.name ?? w.lane;
          return (
            <div class="part" key={w.lane}>
              <div class="part-head">
                <Avatar name={name} color={lane?.color ?? '#868e96'} />
                <b>{name}</b>
                <span class="spacer" />
                <button
                  class="icon-btn"
                  aria-label={`Remove ${name} from this item`}
                  title="Remove"
                  onClick={() => setWork(it.work.filter((x) => x.lane !== w.lane).map((x) => (x.after === w.lane ? { ...x, after: undefined } : x)))}
                >
                  <Icon.close />
                </button>
              </div>
              <div class="part-fields">
                <label class="field">
                  Working days
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={w.days}
                    data-days={w.lane}
                    onInput={(e) => setPart(w.lane, { days: Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0) }, `days:${it.id}:${w.lane}`)}
                  />
                </label>
                {lane?.kind === 'team' && (
                  <label class="field" title="Most people of this team who can work on it at the same time">
                    People at once
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={w.maxPeople}
                      onInput={(e) => setPart(w.lane, { maxPeople: Math.max(1, Math.round(Number((e.currentTarget as HTMLInputElement).value) || 1)) }, `mp:${it.id}:${w.lane}`)}
                    />
                  </label>
                )}
                {it.work.length > 1 && (
                  <label class="field">
                    Starts
                    <select value={w.after ?? ''} onChange={(e) => setPart(w.lane, { after: (e.currentTarget as HTMLSelectElement).value || undefined })}>
                      <option value="">right away</option>
                      {it.work
                        .filter((x) => x.lane !== w.lane)
                        .map((x) => (
                          <option key={x.lane} value={x.lane}>
                            after {laneOf(x.lane)?.name ?? x.lane}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          );
        })}
        <div class="actions">
          {free.length > 0 ? (
            <select
              class="add-who"
              value=""
              aria-label="Add a person or team to this item"
              onChange={(e) => {
                const lane = (e.currentTarget as HTMLSelectElement).value;
                if (!lane) return;
                lastAdded.current = lane;
                setWork([...it.work, { lane, days: 1, maxPeople: 1 }]);
              }}
            >
              <option value="">+ Add {it.work.length ? 'someone else' : 'a person or team'}…</option>
              {free.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          ) : (
            <span />
          )}
          <button class="btn small primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Popover>
  );
}
