import { useEffect, useRef, useState } from 'preact/hooks';
import { applyChanges } from '../engine/changes';
import { formatDay, formatDayLong, dayParts } from '../engine/dates';
import { FEATURES } from '../engine/features';
import { PALETTE } from '../engine/validate';
import { WEEKDAYS, type NormalizedLane, type NormalizedPlan, type Weekday } from '../engine/types';
import { Popover, useAnchor } from './Popover';
import { DateButton, Icon } from './lib';

const LETTER: Record<Weekday, string> = { mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S' };
const NAME: Record<Weekday, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function Setup({ plan, onCommit }: { plan: NormalizedPlan; onCommit: (p: NormalizedPlan, key?: string) => void }) {
  const pop = useAnchor<string>();
  const year = dayParts(plan.start).year;
  const commit = (changes: Parameters<typeof applyChanges>[1], key?: string) => onCommit(applyChanges(plan, changes).plan, key);
  const toggleDay = (d: Weekday) => {
    const on = plan.calendar.workdays.includes(d);
    if (on && plan.calendar.workdays.length === 1) return;
    commit([{ op: 'setWorkdays', days: on ? plan.calendar.workdays.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || plan.calendar.workdays.includes(x)) }]);
  };
  const off = WEEKDAYS.filter((d) => !plan.calendar.workdays.includes(d));
  // New people get a fresh name and an unused colour, and their editor opens under their own chip once it renders.
  const peopleRef = useRef<HTMLDivElement>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const addLane = () => {
    const taken = new Set(plan.lanes.map((l) => l.name.trim().toLowerCase()));
    let n = plan.lanes.length + 1;
    while (taken.has(`person ${n}`)) n++;
    const used = new Set(plan.lanes.map((l) => l.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[plan.lanes.length % PALETTE.length]!;
    const next = applyChanges(plan, [{ op: 'addLane', lane: { id: '', name: `Person ${n}`, color } }]).plan;
    onCommit(next);
    setJustAdded(next.lanes[next.lanes.length - 1]!.id);
  };
  useEffect(() => {
    if (!justAdded) return;
    const chip = peopleRef.current?.querySelector<HTMLElement>(`[data-lane="${CSS.escape(justAdded)}"]`);
    if (chip) {
      pop.open(chip, justAdded);
      setJustAdded(null);
    }
  }, [justAdded, plan]);

  return (
    <div class="setup">
      <div class="setup-group">
        <span class="label">Start</span>
        <DateButton class="chip" value={plan.start} label="Plan start date" placeholder="" format={(d) => formatDayLong(d)} onChange={(d) => d && commit([{ op: 'setStart', date: d }])} />
      </div>
      <div class="setup-group" role="group" aria-label="Working days">
        <span class="label" title={off.length ? `Days off: ${off.map((d) => NAME[d]).join(', ')}` : 'Every day is a working day'}>Working days</span>
        {WEEKDAYS.map((d) => (
          <button key={d} class="daychip" aria-pressed={plan.calendar.workdays.includes(d)} title={`${NAME[d]}: ${plan.calendar.workdays.includes(d) ? 'working day' : 'day off'} (click to change)`} onClick={() => toggleDay(d)}>
            {LETTER[d]}
          </button>
        ))}
        <button class="chip" onClick={(e) => pop.open(e.currentTarget as HTMLElement, '__holidays')} title="Holidays and other days off for everyone">
          {plan.calendar.holidays.length ? `${plan.calendar.holidays.length} holiday${plan.calendar.holidays.length === 1 ? '' : 's'}` : '+ holidays'}
        </button>
      </div>
      <div class="setup-group" role="group" aria-label="People and teams" ref={peopleRef}>
        <span class="label">People</span>
        {plan.lanes.map((l) => (
          <button key={l.id} class="chip" data-lane={l.id} onClick={(e) => pop.open(e.currentTarget as HTMLElement, l.id)} title="Edit name, team size and availability">
            <span class="dot" style={{ background: l.color }} />
            {l.name}
            {l.kind === 'team' && <span class="muted">×{trim(l.size)}</span>}
            {l.availability !== 100 && <span class="muted">{trim(l.availability)}%</span>}
            {FEATURES.personDaysOff && l.daysOff.length > 0 && <span class="muted">· {l.daysOff.length} off</span>}
          </button>
        ))}
        <button class="add-chip" onClick={addLane} aria-label="Add a person or team">
          + person / team
        </button>
      </div>

      {pop.el && pop.key === '__holidays' && <Holidays anchor={pop.el} plan={plan} year={year} onClose={pop.close} onCommit={onCommit} />}
      {pop.el && pop.key && pop.key !== '__holidays' && (
        <LaneEditor anchor={pop.el} plan={plan} lane={plan.lanes.find((l) => l.id === pop.key)!} year={year} onClose={pop.close} onCommit={onCommit} />
      )}
    </div>
  );
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Holidays({ anchor, plan, year, onClose, onCommit }: { anchor: HTMLElement; plan: NormalizedPlan; year: number; onClose: () => void; onCommit: (p: NormalizedPlan) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const remove = (i: number) => onCommit({ ...plan, calendar: { ...plan.calendar, holidays: plan.calendar.holidays.filter((_, k) => k !== i) } });
  const add = () => {
    if (!from) return;
    onCommit(applyChanges(plan, [{ op: 'addHoliday', from, ...(to ? { to } : {}), ...(label ? { label } : {}) }]).plan);
    setFrom('');
    setTo('');
    setLabel('');
  };
  return (
    <Popover anchor={anchor} onClose={onClose} label="Holidays">
      <h4>Holidays (off for everyone)</h4>
      {plan.calendar.holidays.length === 0 && <p class="note">None yet. Public holidays, company off-sites, closures…</p>}
      {plan.calendar.holidays.map((h, i) => (
        <div key={`${h.from}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '13px', padding: '3px 0' }}>
          <span>
            {formatDay(h.from, year)}
            {h.to !== h.from ? ` – ${formatDay(h.to, year)}` : ''}
            {h.label ? <span class="sub"> · {h.label}</span> : null}
          </span>
          <button class="icon-btn" aria-label="Remove holiday" onClick={() => remove(i)}>
            <Icon.close />
          </button>
        </div>
      ))}
      <div class="field-row" style={{ marginTop: '8px' }}>
        <label class="field">
          From
          <input type="date" value={from} onInput={(e) => setFrom((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="field">
          To (optional)
          <input type="date" value={to} onInput={(e) => setTo((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      <label class="field">
        Label (optional)
        <input value={label} placeholder="e.g. Unity Day" onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
      </label>
      <div class="actions">
        <span />
        <button class="btn small primary" disabled={!from} onClick={add}>
          Add
        </button>
      </div>
    </Popover>
  );
}

function LaneEditor({ anchor, plan, lane, year, onClose, onCommit }: { anchor: HTMLElement; plan: NormalizedPlan; lane: NormalizedLane; year: number; onClose: () => void; onCommit: (p: NormalizedPlan, key?: string) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  if (!lane) return null;
  const set = (patch: Partial<NormalizedLane>, key?: string) =>
    onCommit(applyChanges({ ...plan, lanes: plan.lanes.map((l) => (l.id === lane.id ? { ...l, ...patch } : l)) }, []).plan, key);
  const usedBy = plan.items.filter((it) => it.work.some((w) => w.lane === lane.id)).length;
  return (
    <Popover anchor={anchor} onClose={onClose} label={`Edit ${lane.name}`}>
      <label class="field">
        Name
        <input value={lane.name} onInput={(e) => set({ name: (e.currentTarget as HTMLInputElement).value || lane.name }, `lname:${lane.id}`)} />
      </label>
      <div class="field-row">
        <label class="field">
          Kind
          <select value={lane.kind} onChange={(e) => set({ kind: (e.currentTarget as HTMLSelectElement).value as 'person' | 'team', ...((e.currentTarget as HTMLSelectElement).value === 'person' ? { size: 1 } : {}) })}>
            <option value="person">One person</option>
            <option value="team">A team / role</option>
          </select>
        </label>
        {lane.kind === 'team' && (
          <label class="field">
            People
            <input type="number" min="0" step="0.5" value={lane.size} onInput={(e) => set({ size: Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0) }, `size:${lane.id}`)} />
          </label>
        )}
      </div>
      <label class="field">
        Time for this plan: {trim(lane.availability)}%
        <input type="range" min="0" max="100" step="5" value={lane.availability} onInput={(e) => set({ availability: Number((e.currentTarget as HTMLInputElement).value) }, `avail:${lane.id}`)} />
        <span class="sub" style={{ fontSize: '11.5px' }}>The rest goes to meetings, support and other work.</span>
      </label>
      <div class="field">
        Colour
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {PALETTE.map((c) => (
            <button key={c} aria-label={`Colour ${c}`} onClick={() => set({ color: c })} style={{ width: '20px', height: '20px', borderRadius: '50%', border: c === lane.color ? '2px solid var(--fg)' : '1px solid var(--border2)', background: c, padding: 0 }} />
          ))}
        </div>
      </div>
      {FEATURES.personDaysOff && (
        <div class="field">
          Days off {lane.kind === 'team' ? '(whole team)' : ''}
          {lane.daysOff.map((d, i) => (
            <div key={`${d.from}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: 'var(--fg)' }}>
              <span>
                {formatDay(d.from, year)}
                {d.to !== d.from ? ` – ${formatDay(d.to, year)}` : ''}
              </span>
              <button class="icon-btn" aria-label="Remove days off" onClick={() => set({ daysOff: lane.daysOff.filter((_, k) => k !== i) })}>
                <Icon.close />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input type="date" value={from} aria-label="Days off from" onInput={(e) => setFrom((e.currentTarget as HTMLInputElement).value)} />
            <input type="date" value={to} aria-label="Days off to" onInput={(e) => setTo((e.currentTarget as HTMLInputElement).value)} />
            <button
              class="btn small"
              disabled={!from}
              onClick={() => {
                onCommit(applyChanges(plan, [{ op: 'addDaysOff', lane: lane.id, from, ...(to ? { to } : {}) }]).plan);
                setFrom('');
                setTo('');
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
      <div class="actions">
        <button
          class="btn small ghost"
          title={usedBy ? `Removes ${lane.name}'s parts from ${usedBy} item${usedBy === 1 ? '' : 's'}` : ''}
          onClick={() => {
            const next = {
              ...plan,
              lanes: plan.lanes.filter((l) => l.id !== lane.id),
              items: plan.items.map((it) => ({ ...it, work: it.work.filter((w) => w.lane !== lane.id).map((w) => (w.after === lane.id ? { ...w, after: undefined } : w)) })),
            };
            onCommit(applyChanges(next, []).plan);
            onClose();
          }}
        >
          <Icon.trash /> Remove {usedBy ? `(used by ${usedBy})` : ''}
        </button>
        <button class="btn small primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Popover>
  );
}
