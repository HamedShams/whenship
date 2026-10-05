import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Analysis } from '../engine/analysis';
import { applyChanges, moveItem } from '../engine/changes';
import { dayParts, formatDay, monthName, parseISO, toISO, weekdayIndex } from '../engine/dates';
import { badgeLabel } from '../engine/analysis';
import { lensById, type Badge } from '../engine/lens';
import { schedule, type Schedule } from '../engine/schedule';
import type { NormalizedPlan, NormalizedWork } from '../engine/types';
import { Popover, useAnchor } from './Popover';
import { cx, DateButton, Icon } from './lib';

export const ROW = 44;
const BADGE_VAR: Record<Badge, string> = { safe: 'var(--ok)', likely: 'var(--ok)', tight: 'var(--warn)', late: 'var(--danger)', unknown: 'var(--fg3)' };
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface Props {
  plan: NormalizedPlan;
  analysis: Analysis;
  selected: string | null;
  highlight: Set<string> | null;
  today: string;
  onSelect: (id: string | null) => void;
  onCommit: (plan: NormalizedPlan, mergeKey?: string) => void;
  focusId: string | null;
  onFocused: () => void;
}

interface Drag {
  id: string;
  from: number;
  over: number;
  dy: number;
  startY: number;
}

export function Board({ plan, analysis, selected, highlight, today, onSelect, onCommit, focusId, onFocused }: Props) {
  const factor = lensById(analysis.lens).factor;
  const [drag, setDrag] = useState<Drag | null>(null);
  const editor = useAnchor<{ item: string; lane: string | null }>();

  // live preview while dragging: same engine, new order
  const preview = useMemo(() => (drag && drag.over !== drag.from ? schedule(moveItem(plan, drag.id, drag.over), { factor }) : null), [plan, drag?.id, drag?.over, drag?.from, factor]);
  const shown: Schedule = preview ?? analysis.current;
  const order = useMemo(() => (drag ? moveItem(plan, drag.id, drag.over).items : plan.items), [plan, drag?.id, drag?.over]);

  // timeline geometry (calendar days, so dates line up with real weeks)
  const geo = useMemo(() => {
    const start = parseISO(plan.start)!;
    let end = start + 20;
    const bump = (iso?: string) => {
      if (iso) end = Math.max(end, parseISO(iso)!);
    };
    for (const r of analysis.current.items) bump(r.endDate);
    for (const r of analysis.planned.items) bump(r.endDate);
    if (preview) for (const r of preview.items) bump(r.endDate);
    for (const it of plan.items) bump(it.deadline);
    const t = parseISO(today);
    if (t !== null && t > start && t < start + 400) end = Math.max(end, t);
    end = Math.min(end + 6, start + 1100);
    const span = end - start + 1;
    const ppd = span <= 70 ? 28 : span <= 140 ? 18 : span <= 300 ? 10 : 6;
    return { start, end, span, ppd, width: span * ppd };
  }, [plan, analysis, preview, today]);
  const x = (iso: string) => (parseISO(iso)! - geo.start) * geo.ppd;

  const offDays = useMemo(() => {
    const spans: { from: number; len: number }[] = [];
    const work = new Set(plan.calendar.workdays);
    const holidays = plan.calendar.holidays;
    for (let d = geo.start; d <= geo.end; d++) {
      const iso = toISO(d);
      const off = !work.has((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[weekdayIndex(d)]!) || holidays.some((h) => iso >= h.from && iso <= h.to);
      if (!off) continue;
      const last = spans[spans.length - 1];
      if (last && last.from + last.len === d) last.len++;
      else spans.push({ from: d, len: 1 });
    }
    return spans;
  }, [plan.calendar, geo.start, geo.end]);

  // keyboard focus for a freshly added item
  const nameRefs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (!focusId) return;
    const el = nameRefs.current.get(focusId);
    if (el) {
      el.focus();
      el.select();
      onFocused();
    }
  }, [focusId, order]);

  const laneOf = (id: string) => plan.lanes.find((l) => l.id === id);
  const commitChange = (changes: Parameters<typeof applyChanges>[1], key?: string) => onCommit(applyChanges(plan, changes).plan, key);

  // ── drag handlers ──
  const onDown = (e: PointerEvent, id: string, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, from: index, over: index, dy: 0, startY: e.clientY });
  };
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const over = Math.max(0, Math.min(plan.items.length - 1, Math.round(drag.from + dy / ROW)));
    if (over !== drag.over || dy !== drag.dy) setDrag({ ...drag, over, dy });
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.over !== drag.from) onCommit(moveItem(plan, drag.id, drag.over));
    setDrag(null);
  };
  const onKeyMove = (e: KeyboardEvent, id: string, index: number) => {
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
    if (to === null || to < 0 || to >= plan.items.length) return;
    e.preventDefault();
    onCommit(moveItem(plan, id, to));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-handle="${id}"]`)?.focus());
  };

  const topOf = (id: string, i: number) => (drag && drag.id === id ? drag.from * ROW + drag.dy : i * ROW);
  const year = dayParts(plan.start).year;
  const todayX = parseISO(today) !== null && parseISO(today)! >= geo.start && parseISO(today)! <= geo.end ? x(today) : null;

  const addItem = () => {
    const lane = plan.lanes[0];
    const name = 'New item';
    const base = lane ? plan : applyChanges(plan, [{ op: 'addLane', lane: { id: 'me', name: 'Me' } }]).plan;
    const next = { ...base, items: [...base.items, { id: '', name, work: [{ lane: (lane ?? base.lanes[0]!).id, days: 3, maxPeople: 1 }], dependsOn: [] }] };
    const clean = applyChanges(next as NormalizedPlan, []).plan;
    const id = clean.items[clean.items.length - 1]!.id;
    onCommit(clean);
    onSelect(id);
    requestAnimationFrame(() => {
      const el = nameRefs.current.get(id);
      el?.focus();
      el?.select();
    });
  };

  const height = order.length * ROW;

  return (
    <div class="board" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {/* list */}
      <div class="list" role="list" aria-label="Items in priority order">
        <div class="list-head" aria-hidden="true">
          <span />
          <span>#</span>
          <span>Item</span>
          <span>Who · effort</span>
          <span>Deadline</span>
          <span>Status</span>
        </div>
        <div class="rows" style={{ height: `${height}px` }}>
          {order.map((it, i) => {
            const r = shown.byId.get(it.id)!;
            const o = analysis.outlook.get(it.id);
            const isDragged = drag?.id === it.id;
            return (
              <div
                key={it.id}
                role="listitem"
                class={cx('row', selected === it.id && 'sel', isDragged && 'dragging', highlight && !highlight.has(it.id) && 'dim')}
                style={{ top: `${topOf(it.id, i)}px` }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('input, button, select')) return;
                  onSelect(selected === it.id ? null : it.id);
                }}
              >
                <button
                  class="handle"
                  data-handle={it.id}
                  aria-label={`Reorder ${it.name}. Drag, or use the arrow keys.`}
                  title="Drag to reprioritize (or use ↑/↓)"
                  onPointerDown={(e) => onDown(e as unknown as PointerEvent, it.id, plan.items.indexOf(it))}
                  onKeyDown={(e) => onKeyMove(e as unknown as KeyboardEvent, it.id, plan.items.indexOf(it))}
                >
                  <Icon.grip />
                </button>
                <span class="num">{i + 1}</span>
                <input
                  class="cell-input"
                  value={it.name}
                  aria-label="Item name"
                  ref={(el) => {
                    if (el) nameRefs.current.set(it.id, el);
                  }}
                  onInput={(e) => {
                    const name = (e.currentTarget as HTMLInputElement).value;
                    onCommit({ ...plan, items: plan.items.map((x) => (x.id === it.id ? { ...x, name } : x)) }, `name:${it.id}`);
                  }}
                  onFocus={() => onSelect(it.id)}
                />
                <div class="who">
                  {it.work.map((w) => (
                    <button
                      key={w.lane}
                      class="work-chip"
                      title={`${laneOf(w.lane)?.name}: ${w.days} working day${w.days === 1 ? '' : 's'}${w.after ? ` after ${laneOf(w.after)?.name}` : ''}`}
                      onClick={(e) => editor.open(e.currentTarget as HTMLElement, { item: it.id, lane: w.lane })}
                    >
                      <span class="dot" style={{ background: laneOf(w.lane)?.color }} />
                      {shortName(laneOf(w.lane)?.name ?? w.lane)} {fmtDays(w.days)}
                      {w.after ? <span title="hand-off">↪</span> : null}
                    </button>
                  ))}
                  <button class="add-chip" aria-label={`Add who works on ${it.name}`} onClick={(e) => editor.open(e.currentTarget as HTMLElement, { item: it.id, lane: null })}>
                    +
                  </button>
                </div>
                <div class="due-cell">
                  <DateButton
                    value={it.deadline}
                    label={`Deadline for ${it.name}`}
                    placeholder="+ date"
                    format={(d) => formatDay(d, year)}
                    onChange={(date) => commitChange([{ op: 'setDeadline', item: it.id, date }])}
                  />
                </div>
                <div class="status">
                  <StatusPill status={r.status} problem={r.problem} badge={o?.badge} chance={o?.chance} endDate={r.endDate} year={year} />
                </div>
              </div>
            );
          })}
        </div>
        <div class="add-row">
          <button class="btn small" onClick={addItem}>
            <Icon.plus /> Add item
          </button>
        </div>
      </div>

      {/* timeline */}
      <div class="timeline" style={{ width: `${geo.width}px`, minWidth: `${geo.width}px` }}>
        <div class="tl-head" aria-hidden="true">
          <div class="months">
            {Array.from({ length: geo.span }, (_, k) => geo.start + k)
              .filter((d) => d === geo.start || dayParts(toISO(d)).day === 1)
              .map((d) => {
                const p = dayParts(toISO(d));
                return (
                  <div key={d} class="month" style={{ left: `${(d - geo.start) * geo.ppd}px` }}>
                    {monthName(p.month)}
                    {p.year !== year ? ` ${p.year}` : ''}
                  </div>
                );
              })}
          </div>
          <div class="days">
            {geo.ppd >= 10 &&
              Array.from({ length: geo.span }, (_, k) => geo.start + k)
                .filter((d) => geo.ppd >= 18 || weekdayIndex(d) === 0)
                .map((d) => {
                  const p = dayParts(toISO(d));
                  return (
                    <div key={d} class="day" style={{ left: `${(d - geo.start) * geo.ppd}px`, width: `${geo.ppd}px` }}>
                      {geo.ppd >= 18 ? (
                        <>
                          {DOW[p.weekday]}
                          <br />
                          {p.day}
                        </>
                      ) : (
                        p.day
                      )}
                    </div>
                  );
                })}
          </div>
        </div>
        <div class="grid" style={{ height: `${height}px` }}>
          {offDays.map((s) => (
            <div key={s.from} class="offday" style={{ left: `${(s.from - geo.start) * geo.ppd}px`, width: `${s.len * geo.ppd}px` }} />
          ))}
          {todayX !== null && (
            <div class="today" style={{ left: `${todayX + geo.ppd / 2}px` }}>
              <span class="today-label">today</span>
            </div>
          )}
        </div>
        <div class="rows" style={{ height: `${height}px` }}>
          {order.map((it, i) => (
            <BarRow
              key={it.id}
              it={it}
              top={topOf(it.id, i)}
              shown={shown}
              base={analysis.current}
              planned={analysis.planned}
              analysis={analysis}
              lensActive={factor !== 1}
              x={x}
              ppd={geo.ppd}
              laneColor={(id) => laneOf(id)?.color ?? '#4c6ef5'}
              dragging={!!drag}
              dim={!!highlight && !highlight.has(it.id)}
              chain={!!highlight && highlight.has(it.id)}
              year={year}
              onClick={() => onSelect(selected === it.id ? null : it.id)}
            />
          ))}
        </div>
      </div>

      {editor.el && editor.key && (
        <WorkEditor
          anchor={editor.el}
          plan={plan}
          itemId={editor.key.item}
          laneId={editor.key.lane}
          onClose={editor.close}
          onCommit={onCommit}
        />
      )}
    </div>
  );
}

function BarRow(props: {
  it: NormalizedPlan['items'][number];
  top: number;
  shown: Schedule;
  base: Schedule;
  planned: Schedule;
  analysis: Analysis;
  lensActive: boolean;
  x: (iso: string) => number;
  ppd: number;
  laneColor: (id: string) => string;
  dragging: boolean;
  dim: boolean;
  chain: boolean;
  year: number;
  onClick: () => void;
}) {
  const { it, shown, x, ppd } = props;
  const r = shown.byId.get(it.id)!;
  const o = props.analysis.outlook.get(it.id);
  const parts = r.parts.filter((p) => p.start !== undefined && p.end !== undefined);
  const n = Math.max(1, parts.length);
  const inner = ROW - 14;
  const h = n > 1 ? Math.max(6, Math.floor(inner / n) - 1) : inner;
  const plannedR = props.planned.byId.get(it.id);
  const baseR = props.base.byId.get(it.id);
  const delta = props.dragging && baseR?.end !== undefined && r.end !== undefined ? r.end - baseR.end : 0;
  const endX = r.endDate ? x(r.endDate) + ppd : 0;
  const late = it.deadline && r.endDate && r.endDate > it.deadline;
  return (
    <div class={cx('bars', props.dim && 'dim')} style={{ top: `${props.top}px` }} onClick={props.onClick}>
      {props.lensActive && plannedR?.startDate && plannedR.endDate && (
        <div class="plan-ghost" title="Your estimate (as planned)" style={{ left: `${x(plannedR.startDate)}px`, width: `${x(plannedR.endDate) - x(plannedR.startDate) + ppd}px`, top: '5px', height: `${ROW - 10}px` }} />
      )}
      {parts.map((p, k) => {
        const s = props.shown.calendar.dateAt(p.start!);
        const e = props.shown.calendar.dateAt(p.end!);
        return (
          <div
            key={p.lane}
            class={cx('bar', props.chain && 'chain')}
            title={`${it.name}: ${formatDay(s, props.year)} → ${formatDay(e, props.year)}`}
            style={{ left: `${x(s) + 1}px`, width: `${Math.max(4, x(e) - x(s) + ppd - 2)}px`, top: `${7 + k * (h + 1)}px`, height: `${h}px`, background: props.laneColor(p.lane) }}
          />
        );
      })}
      {late && r.endDate && it.deadline && (
        <div class="late-tail" title="Past the deadline" style={{ left: `${x(it.deadline) + ppd}px`, width: `${Math.max(2, x(r.endDate) - x(it.deadline) - 1)}px`, top: '7px', height: `${inner}px` }} />
      )}
      {it.deadline && (
        <div class="deadline" title={`Deadline ${formatDay(it.deadline, props.year)}${o ? ` · ${badgeLabel(o.badge)}` : ''}`} style={{ left: `${x(it.deadline) + ppd / 2}px`, top: `${ROW / 2 - 7}px`, background: o ? BADGE_VAR[o.badge] : 'var(--fg3)' }} />
      )}
      {r.endDate && (
        <span class={cx('end-label', late && 'late')} style={{ left: `${endX + 8}px`, top: `${ROW / 2 - 8}px` }}>
          {formatDay(r.endDate, props.year)}
        </span>
      )}
      {delta !== 0 && r.endDate && (
        <span class={cx('delta', delta < 0 ? 'up' : 'down')} style={{ left: `${endX + 56}px`, top: `${ROW / 2 - 8}px` }}>
          {delta > 0 ? `+${delta}d` : `${delta}d`}
        </span>
      )}
      {r.status === 'empty' && <span class="empty-bar" style={{ left: '8px', top: `${ROW / 2 - 9}px` }}>add effort to schedule this</span>}
      {r.status === 'blocked' && <span class="empty-bar" style={{ left: '8px', top: `${ROW / 2 - 9}px`, color: 'var(--danger)' }}>⛔ {r.problem}</span>}
    </div>
  );
}

export function StatusPill(p: { status: string; problem?: string | undefined; badge?: Badge | undefined; chance?: number | undefined; endDate?: string | undefined; year: number }) {
  if (p.status === 'blocked') return <span class="pill blocked" title={p.problem}>blocked</span>;
  if (p.status === 'empty') return <span class="pill empty">no effort</span>;
  if (!p.badge) return <span class="sub" style={{ fontSize: '12px' }}>{p.endDate ? `done ${formatDay(p.endDate, p.year)}` : ''}</span>;
  const tip =
    p.badge === 'safe'
      ? 'On time even if work takes 2.7× as long'
      : p.badge === 'likely'
        ? 'On time if work takes the usual 1.6×, not at 2.7×'
        : p.badge === 'tight'
          ? 'On time only if everything goes to plan'
          : 'Late even if everything goes to plan';
  const pct = p.chance !== undefined ? ` · ~${Math.round(Math.min(0.99, p.chance) * 20) * 5}% chance` : '';
  return (
    <span class={`pill ${p.badge}`} title={tip + pct}>
      {badgeLabel(p.badge)}
    </span>
  );
}

function WorkEditor({ anchor, plan, itemId, laneId, onClose, onCommit }: { anchor: HTMLElement; plan: NormalizedPlan; itemId: string; laneId: string | null; onClose: () => void; onCommit: (p: NormalizedPlan, key?: string) => void }) {
  const it = plan.items.find((x) => x.id === itemId);
  if (!it) return null;
  const used = new Set(it.work.map((w) => w.lane));
  const free = plan.lanes.filter((l) => !used.has(l.id));
  const part: NormalizedWork | undefined = laneId ? it.work.find((w) => w.lane === laneId) : undefined;
  const lane = plan.lanes.find((l) => l.id === part?.lane);
  const setPart = (patch: Partial<NormalizedWork>, key?: string) => {
    const work = it.work.map((w) => (w.lane === part!.lane ? { ...w, ...patch } : w));
    onCommit(applyChanges({ ...plan, items: plan.items.map((x) => (x.id === it.id ? { ...x, work } : x)) }, []).plan, key);
  };
  if (!part) {
    // add a new part
    return (
      <Popover anchor={anchor} onClose={onClose} label="Add who works on this">
        <h4>Who else works on "{it.name}"?</h4>
        {free.length === 0 && <p class="note">Everyone already has a part. Add a person or team in the bar above.</p>}
        <div class="menu" style={{ padding: 0 }}>
          {free.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                const work = [...it.work, { lane: l.id, days: 1, maxPeople: 1 }];
                onCommit(applyChanges({ ...plan, items: plan.items.map((x) => (x.id === it.id ? { ...x, work } : x)) }, []).plan);
                onClose();
              }}
            >
              <span>
                <span class="dot" style={{ background: l.color, marginRight: '8px' }} />
                {l.name}
              </span>
              <small>+1 day</small>
            </button>
          ))}
        </div>
      </Popover>
    );
  }
  return (
    <Popover anchor={anchor} onClose={onClose} label={`Edit ${lane?.name}'s part`}>
      <h4>
        <span class="dot" style={{ background: lane?.color, marginRight: '6px' }} />
        {lane?.name} on "{it.name}"
      </h4>
      <div class="field-row">
        <label class="field">
          Effort (working days)
          <input type="number" min="0" step="0.5" value={part.days} onInput={(e) => setPart({ days: Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0) }, `days:${it.id}:${part.lane}`)} />
        </label>
        {lane?.kind === 'team' && (
          <label class="field">
            Max people at once
            <input type="number" min="1" step="1" value={part.maxPeople} onInput={(e) => setPart({ maxPeople: Math.max(1, Math.round(Number((e.currentTarget as HTMLInputElement).value) || 1)) }, `mp:${it.id}:${part.lane}`)} />
          </label>
        )}
      </div>
      {it.work.length > 1 && (
        <label class="field">
          Starts
          <select
            value={part.after ?? ''}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              setPart(v ? { after: v } : { after: undefined });
            }}
          >
            <option value="">in parallel with the others</option>
            {it.work
              .filter((w) => w.lane !== part.lane)
              .map((w) => (
                <option key={w.lane} value={w.lane}>
                  after {plan.lanes.find((l) => l.id === w.lane)?.name} is done (hand-off)
                </option>
              ))}
          </select>
        </label>
      )}
      <div class="actions">
        <button
          class="btn small ghost"
          onClick={() => {
            const work = it.work.filter((w) => w.lane !== part.lane).map((w) => (w.after === part.lane ? { ...w, after: undefined } : w));
            onCommit(applyChanges({ ...plan, items: plan.items.map((x) => (x.id === it.id ? { ...x, work } : x)) }, []).plan);
            onClose();
          }}
        >
          <Icon.trash /> Remove
        </button>
        <button class="btn small primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Popover>
  );
}

const shortName = (name: string) => (name.length > 10 ? name.slice(0, 9) + '…' : name);
export const fmtDays = (d: number) => `${Number.isInteger(d) ? d : d.toFixed(1)}d`;
