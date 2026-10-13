import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Analysis } from '../engine/analysis';
import { applyChanges, moveItem } from '../engine/changes';
import { dayParts, formatDay, monthName, parseISO, toISO, weekdayIndex } from '../engine/dates';
import { badgeLabel, chanceLabel } from '../engine/analysis';
import { lensById, type Badge, type LensId } from '../engine/lens';
import { describeWork } from '../engine/report';
import { schedule, type Schedule } from '../engine/schedule';
import type { NormalizedPlan, NormalizedWork } from '../engine/types';
import { useAnchor } from './Popover';
import { Avatar, WhoEditor } from './WhoEditor';
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
  /** How much of the calendar each day gets (see `autoZoom`). */
  zoom: Zoom;
}

export type Zoom = 'day' | 'week' | 'month';
/** Pixels per calendar day for each zoom level. */
export const ZOOM_PPD: Record<Zoom, number> = { day: 26, week: 10, month: 4 };

/** The calendar days the chart covers: plan start → the last finish or deadline, plus a few days. */
export function timelineSpan(plan: NormalizedPlan, analysis: Analysis, today: string, extra?: Schedule | null) {
  const start = parseISO(plan.start)!;
  let end = start + 20;
  const bump = (iso?: string) => {
    if (iso) end = Math.max(end, parseISO(iso)!);
  };
  for (const r of analysis.current.items) bump(r.endDate);
  for (const r of analysis.planned.items) bump(r.endDate);
  if (extra) for (const r of extra.items) bump(r.endDate);
  for (const it of plan.items) bump(it.deadline);
  const t = parseISO(today);
  if (t !== null && t > start && t < start + 400) end = Math.max(end, t);
  end = Math.min(end + 6, start + 1100);
  return { start, end, span: end - start + 1 };
}

/** Days for short plans, weeks for a few months, months beyond that. */
export function autoZoom(span: number): Zoom {
  return span <= 75 ? 'day' : span <= 260 ? 'week' : 'month';
}

interface Drag {
  id: string;
  from: number;
  over: number;
  dy: number;
  startY: number;
}

export function Board({ plan, analysis, selected, highlight, today, onSelect, onCommit, focusId, onFocused, zoom }: Props) {
  const factor = lensById(analysis.lens).factor;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const who = useAnchor<string>();
  const [draft, setDraft] = useState('');
  const draftRef = useRef<HTMLInputElement>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; mode: 'end' | 'select' } | null>(null);
  const [openWhoFor, setOpenWhoFor] = useState<string | null>(null);

  // live preview while dragging: same engine, new order
  const preview = useMemo(() => (drag && drag.over !== drag.from ? schedule(moveItem(plan, drag.id, drag.over), { factor }) : null), [plan, drag?.id, drag?.over, drag?.from, factor]);
  const shown: Schedule = preview ?? analysis.current;
  const order = useMemo(() => (drag ? moveItem(plan, drag.id, drag.over).items : plan.items), [plan, drag?.id, drag?.over]);

  // timeline geometry (calendar days, so dates line up with real weeks)
  const geo = useMemo(() => {
    const { start, end, span } = timelineSpan(plan, analysis, today, preview);
    const ppd = ZOOM_PPD[zoom];
    return { start, end, span, ppd, width: span * ppd };
  }, [plan, analysis, preview, today, zoom]);
  const x = (iso: string) => (parseISO(iso)! - geo.start) * geo.ppd;

  const offDays = useMemo(() => {
    const spans: { from: number; len: number }[] = [];
    const work = new Set(plan.calendar.workdays);
    const holidays = plan.calendar.holidays;
    for (let d = geo.start; d <= geo.end; d++) {
      const iso = toISO(d);
      // zoomed out, weekend stripes are just noise: shade holidays only
      const weekend = !work.has((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[weekdayIndex(d)]!);
      const off = (weekend && geo.ppd >= 8) || holidays.some((h) => iso >= h.from && iso <= h.to);
      if (!off) continue;
      const last = spans[spans.length - 1];
      if (last && last.from + last.len === d) last.len++;
      else spans.push({ from: d, len: 1 });
    }
    return spans;
  }, [plan.calendar, geo.start, geo.end, geo.ppd]);

  // header scale: month blocks on top; under them every day (zoomed in) or every week start (zoomed out)
  const scale = useMemo(() => {
    const planYear = dayParts(plan.start).year;
    const months: { left: number; width: number; label: string }[] = [];
    for (let d = geo.start; d <= geo.end; ) {
      const p = dayParts(toISO(d));
      const next = Math.min(geo.end + 1, Date.UTC(p.year, p.month + 1, 1) / 86_400_000);
      months.push({ left: (d - geo.start) * geo.ppd, width: (next - d) * geo.ppd, label: `${monthName(p.month)}${p.year !== planYear ? ` ${p.year}` : ''}` });
      d = next;
    }
    const work = new Set(plan.calendar.workdays);
    const t = parseISO(today);
    const byDay = geo.ppd >= 18;
    const ticks: { d: number; label: string; dow?: string; off?: boolean }[] = [];
    for (let d = geo.start; d <= geo.end; d++) {
      const p = dayParts(toISO(d));
      if (byDay) ticks.push({ d, label: String(p.day), dow: DOW[p.weekday]!, off: !work.has((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[p.weekday]!) });
      else if (p.weekday === 0 && (t === null || Math.abs(d - t) * geo.ppd >= 22)) ticks.push({ d, label: String(p.day) });
    }
    return { months, ticks, byDay };
  }, [geo, plan.start, plan.calendar.workdays, today]);


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

  useEffect(() => {
    if (!focusReq) return;
    const el = nameRefs.current.get(focusReq.id);
    if (!el) return;
    el.focus();
    if (focusReq.mode === 'end') el.setSelectionRange(el.value.length, el.value.length);
    else el.select();
    setFocusReq(null);
  }, [focusReq, order]);
  useEffect(() => {
    if (!openWhoFor) return;
    const cell = document.querySelector<HTMLElement>(`[data-who="${CSS.escape(openWhoFor)}"]`);
    if (cell) {
      who.open(cell, openWhoFor);
      setOpenWhoFor(null);
    }
  }, [openWhoFor, order]);

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
  const todayDay = parseISO(today);
  const todayX = parseISO(today) !== null && parseISO(today)! >= geo.start && parseISO(today)! <= geo.end ? x(today) : null;

  /** The always-there empty row at the bottom turns into a real item as soon as something is typed or picked. */
  const createItem = (fields: Partial<NormalizedPlan['items'][number]>) => {
    const next = { ...plan, items: [...plan.items, { id: '', name: 'New item', work: [], dependsOn: [], ...fields }] };
    const clean = applyChanges(next as NormalizedPlan, []).plan;
    onCommit(clean);
    return clean.items[clean.items.length - 1]!.id;
  };
  const focusName = (index: number) => {
    const next = order[index];
    if (next) nameRefs.current.get(next.id)?.focus();
    else draftRef.current?.focus();
  };

  const height = (order.length + 1) * ROW; // + the empty row for a new item

  return (
    <div class="board" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {/* list */}
      <div class="list" role="list" aria-label="Items in priority order">
        <div class="list-head" aria-hidden="true">
          <span>#</span>
          <span>Item</span>
          <span>Who</span>
          <span>Deadline</span>
          <span>Expected delivery</span>
          <span />
        </div>
        <div class="rows" style={{ height: `${height}px` }}>
          {order.map((it, i) => {
            const r = shown.byId.get(it.id)!;
            const o = analysis.outlook.get(it.id);
            const isDragged = drag?.id === it.id;
            const whoText = describeWork(plan, it.id);
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
                  aria-label={`#${i + 1} ${it.name}. Drag to reprioritize, or use the arrow keys.`}
                  title="Drag to reprioritize (or use ↑/↓)"
                  onPointerDown={(e) => onDown(e as unknown as PointerEvent, it.id, plan.items.indexOf(it))}
                  onKeyDown={(e) => onKeyMove(e as unknown as KeyboardEvent, it.id, plan.items.indexOf(it))}
                >
                  <span class="n">{i + 1}</span>
                  <Icon.grip />
                </button>
                <input
                  class="cell-input"
                  value={it.name}
                  title={it.name}
                  aria-label="Item name"
                  ref={(el) => {
                    if (el) nameRefs.current.set(it.id, el);
                  }}
                  onInput={(e) => {
                    const name = (e.currentTarget as HTMLInputElement).value;
                    onCommit({ ...plan, items: plan.items.map((x) => (x.id === it.id ? { ...x, name } : x)) }, `name:${it.id}`);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      focusName(i + 1);
                    }
                  }}
                  onFocus={() => onSelect(it.id)}
                />
                <WhoCell item={it} laneOf={laneOf} label={whoText} onOpen={(el) => who.open(el, it.id)} />
                <div class="due-cell">
                  <DateButton
                    value={it.deadline}
                    label={`Deadline for ${it.name}`}
                    placeholder="+ date"
                    format={(d) => <DueLabel iso={d} year={year} />}
                    onChange={(date) => commitChange([{ op: 'setDeadline', item: it.id, date }])}
                  />
                </div>
                <div class="status">
                  <Delivery status={r.status} problem={r.problem} badge={analysis.status.get(it.id)} base={o?.badge} chance={o?.chance} lens={analysis.lens} endDate={r.endDate} deadline={it.deadline} year={year} />
                </div>
                <button class="row-del icon-btn" aria-label={`Delete ${it.name}`} title="Delete item" onClick={() => setConfirmDelete({ id: it.id, name: it.name })}>
                  <Icon.trash />
                </button>
              </div>
            );
          })}
          <div class="row draft" style={{ top: `${order.length * ROW}px` }}>
            <span class="handle" aria-hidden="true">
              <Icon.plus />
            </span>
            <input
              ref={draftRef}
              class="cell-input"
              value={draft}
              placeholder="Add an item…"
              aria-label="New item: type its name"
              onInput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value;
                if (!v.trim()) {
                  setDraft(v);
                  return;
                }
                const id = createItem({ name: v });
                setDraft('');
                setFocusReq({ id, mode: 'end' });
              }}
            />
            <button class="who-cell" aria-label="New item: choose who works on it" onClick={() => setOpenWhoFor(createItem({}))}>
              <span class="who-empty">+ who</span>
            </button>
            <div class="due-cell">
              <DateButton
                value={undefined}
                label="New item: set a deadline"
                placeholder="+ date"
                format={(d) => d}
                onChange={(date) => {
                  if (!date) return;
                  setFocusReq({ id: createItem({ deadline: date }), mode: 'select' });
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* timeline */}
      <div class="timeline" style={{ width: `${geo.width}px`, minWidth: `${geo.width}px` }}>
        <div class="tl-head" aria-hidden="true">
          <div class="months">
            {scale.months.map((m) => (
              <div key={m.left} class="month" style={{ left: `${m.left}px`, width: `${m.width}px` }}>
                {m.width >= 34 ? m.label : ''}
              </div>
            ))}
          </div>
          <div class={cx('ticks', scale.byDay ? 'by-day' : 'by-week')}>
            {scale.ticks.map((t) =>
              scale.byDay ? (
                <div key={t.d} class={cx('day', t.off && 'off', t.d === todayDay && 'is-today')} style={{ left: `${(t.d - geo.start) * geo.ppd}px`, width: `${geo.ppd}px` }}>
                  <span class="dow">{t.dow}</span>
                  <span class="dnum">{t.label}</span>
                </div>
              ) : (
                <div key={t.d} class="wk" style={{ left: `${(t.d - geo.start) * geo.ppd}px` }}>
                  {t.label}
                </div>
              ),
            )}
            {!scale.byDay && todayX !== null && todayDay !== null && (
              <div class="tick-today" style={{ left: `${todayX + geo.ppd / 2}px` }}>
                {dayParts(toISO(todayDay)).day}
              </div>
            )}
          </div>
        </div>
        <div class="grid" style={{ height: `${height}px` }}>
          {offDays.map((s) => (
            <div key={s.from} class="offday" style={{ left: `${(s.from - geo.start) * geo.ppd}px`, width: `${s.len * geo.ppd}px` }} />
          ))}
          {todayX !== null && (
            <div class="today" title="Today" style={{ left: `${todayX + geo.ppd / 2}px` }} />
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

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.name}"?`}
          note="It's removed from the plan. You can undo this with ⌘/Ctrl Z."
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            commitChange([{ op: 'removeItem', item: confirmDelete.id }]);
            if (selected === confirmDelete.id) onSelect(null);
            setConfirmDelete(null);
          }}
        />
      )}
      {who.el && who.key && <WhoEditor anchor={who.el} plan={plan} itemId={who.key} onClose={who.close} onCommit={onCommit} />}
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
  const o = props.analysis.status.get(it.id);
  const parts = r.parts.filter((p) => p.start !== undefined && p.end !== undefined);
  const n = Math.max(1, parts.length);
  const inner = ROW - 14;
  const h = n > 1 ? Math.max(6, Math.floor(inner / n) - 1) : inner;
  const plannedR = props.planned.byId.get(it.id);
  const baseR = props.base.byId.get(it.id);
  const delta = props.dragging && baseR?.end !== undefined && r.end !== undefined ? r.end - baseR.end : 0;
  const endX = r.endDate ? x(r.endDate) + ppd : 0;
  // keep the finish-date label clear of a deadline diamond that sits just after the bar
  const diamondX = it.deadline ? x(it.deadline) + ppd / 2 : null;
  const labelX = diamondX !== null && diamondX > endX - 8 && diamondX < endX + 56 ? diamondX + 10 : endX + 8;
  const late = it.deadline && r.endDate && r.endDate > it.deadline;
  const dueEnd = it.deadline ? x(it.deadline) + ppd : 0;
  return (
    <div class={cx('bars', props.dim && 'dim')} style={{ top: `${props.top}px` }} onClick={props.onClick}>
      {props.lensActive && plannedR?.startDate && plannedR.endDate && (
        <div class="plan-ghost" title="Your estimate (as planned)" style={{ left: `${x(plannedR.startDate)}px`, width: `${x(plannedR.endDate) - x(plannedR.startDate) + ppd}px`, top: '5px', height: `${ROW - 10}px` }} />
      )}
      {late && r.endDate && it.deadline && (
        <div class="late-zone" title="Past the deadline" style={{ left: `${dueEnd}px`, width: `${Math.max(2, endX - dueEnd)}px`, top: '3px', height: `${ROW - 6}px` }} />
      )}
      {parts.map((p, k) => {
        const s = props.shown.calendar.dateAt(p.start!);
        const e = props.shown.calendar.dateAt(p.end!);
        const left = x(s) + 1;
        const width = Math.max(4, x(e) - x(s) + ppd - 2);
        const lateFrom = late ? Math.max(0, dueEnd - left) : width;
        return (
          <div
            key={p.lane}
            class={cx('bar', props.chain && 'chain')}
            title={`${it.name}: ${formatDay(s, props.year)} → ${formatDay(e, props.year)}`}
            style={{ left: `${left}px`, width: `${width}px`, top: `${7 + k * (h + 1)}px`, height: `${h}px`, background: props.laneColor(p.lane) }}
          >
            {lateFrom < width && <span class="bar-late" style={{ left: `${lateFrom}px` }} />}
          </div>
        );
      })}
      {it.deadline && (
        <div class="deadline" title={`Deadline ${formatDay(it.deadline, props.year)}${o ? ` · ${badgeLabel(o)}` : ''}`} style={{ left: `${x(it.deadline) + ppd / 2}px`, top: `${ROW / 2 - 7}px`, background: o ? BADGE_VAR[o] : 'var(--fg3)' }} />
      )}
      {r.endDate && (
        <span class={cx('end-label', late && 'late')} style={{ left: `${labelX}px`, top: `${ROW / 2 - 8}px` }}>
          {formatDay(r.endDate, props.year)}
        </span>
      )}
      {delta !== 0 && r.endDate && (
        <span class={cx('delta', delta < 0 ? 'up' : 'down')} style={{ left: `${labelX + 48}px`, top: `${ROW / 2 - 8}px` }}>
          {delta > 0 ? `+${delta}d` : `${delta}d`}
        </span>
      )}
      {r.status === 'empty' && <span class="empty-bar" style={{ left: '8px', top: `${ROW / 2 - 9}px` }}>add effort to schedule this</span>}
      {r.status === 'blocked' && <span class="empty-bar" style={{ left: '8px', top: `${ROW / 2 - 9}px`, color: 'var(--danger)' }}>⛔ {r.problem}</span>}
    </div>
  );
}

/**
 * The delivery date (under the selected lens), styled by deadline status: green when on time with room to spare
 * (safe, likely), amber when tight, red when late. Plain when the item has no deadline.
 */
export function Delivery(p: {
  status: string;
  problem?: string | undefined;
  badge?: Badge | undefined;
  base?: Badge | undefined;
  chance?: number | undefined;
  lens: LensId;
  endDate?: string | undefined;
  deadline?: string | undefined;
  year: number;
}) {
  if (p.status === 'blocked') return <span class="pill blocked" title={p.problem}>blocked</span>;
  if (p.status === 'empty') return <span class="pill empty" title="Add who works on it and how many days">no effort</span>;
  if (!p.endDate) return <span class="done-date">—</span>;
  const date = <DueLabel iso={p.endDate} year={p.year} />;
  if (!p.badge) return <span class="done-date" title={`Expected delivery ${formatDay(p.endDate, p.year)} · no deadline`}>{date}</span>;
  const lens = lensById(p.lens);
  const tip =
    p.badge === 'late' && p.base && p.base !== 'late'
      ? `Late if work takes ${lens.short} as long (${lens.label}). As planned: ${badgeLabel(p.base)}.`
      : p.badge === 'safe'
        ? 'Safe: on time even if work takes 2.7× as long'
        : p.badge === 'likely'
          ? 'Likely on time: on time if work takes the usual 1.6×, not at 2.7×'
          : p.badge === 'tight'
            ? 'Tight: on time only if everything goes to plan'
            : 'Late even if everything goes to plan';
  const due = p.deadline ? ` · deadline ${formatDay(p.deadline, p.year)}` : '';
  const pct = p.chance !== undefined ? ` · ${chanceLabel(p.chance)} chance as planned` : '';
  return (
    <span class={`pill delivery ${p.badge}`} title={tip + due + pct} aria-label={`Expected delivery ${formatDay(p.endDate, p.year)}: ${badgeLabel(p.badge)}${due}`}>
      {date}
    </span>
  );
}


/** A deadline in a narrow cell: "21 Oct", or "19 Feb" over a small "2027" when it isn't the plan's year. */
function DueLabel({ iso, year }: { iso: string; year: number }) {
  const y = Number(iso.slice(0, 4));
  if (y === year) return <>{formatDay(iso, year)}</>;
  // another year: "14 Jan" with a small raised "'27", on one line and in the same colour
  return (
    <span class="date-y" title={formatDay(iso, year)}>
      {formatDay(iso, y)}
      <span class="yr">’{String(y).slice(2)}</span>
    </span>
  );
}

/**
 * Who works on an item, in a narrow cell: one person with name and days; two with avatar + days each (or stacked
 * avatars if they don't fit, measured after layout); three or more as stacked avatars and the total days.
 */
function WhoCell({ item, laneOf, label, onOpen }: { item: NormalizedPlan['items'][number]; laneOf: (id: string) => NormalizedPlan['lanes'][number] | undefined; label: string; onOpen: (el: HTMLElement) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const work = item.work;
  const shape = work.map((w) => `${laneOf(w.lane)?.name}:${w.days}:${w.after ?? ''}`).join('|');
  const [squeezed, setSqueezed] = useState<string | null>(null);
  const stacked = work.length > 2 || (work.length === 2 && squeezed === shape);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && work.length === 2 && squeezed !== shape && el.scrollWidth > el.clientWidth + 1) setSqueezed(shape);
  });
  const color = (lane: string) => laneOf(lane)?.color ?? '#868e96';
  const name = (lane: string) => laneOf(lane)?.name ?? lane;
  return (
    <button ref={ref} class="who-cell" data-who={item.id} title={label} aria-label={`Who works on ${item.name}: ${work.length ? label : 'nobody yet'}`} onClick={(e) => onOpen(e.currentTarget as HTMLElement)}>
      {stacked ? (
        <span class="who-part stack">
          {work.slice(0, 3).map((w) => (
            <Avatar key={w.lane} name={name(w.lane)} color={color(w.lane)} />
          ))}
          {work.length > 3 && <span class="more">+{work.length - 3}</span>}
          <span class="who-days">{fmtDays(work.reduce((t, w) => t + w.days, 0))}</span>
        </span>
      ) : work.length ? (
        work.map((w, k) => {
          const lane = laneOf(w.lane);
          return (
            <span key={w.lane} class="who-part">
              {k > 0 && <span class="sep">{w.after ? '→' : '+'}</span>}
              <Avatar name={name(w.lane)} color={color(w.lane)} />
              {work.length === 1 && <span class="who-name">{name(w.lane)}</span>}
              {work.length === 1 && lane?.kind === 'team' && <span class="who-team">×{fmtSize(lane.size)}</span>}
              <span class="who-days">{fmtDays(w.days)}</span>
            </span>
          );
        })
      ) : (
        <span class="who-empty">+ who</span>
      )}
    </button>
  );
}

export const fmtDays = (d: number) => `${Number.isInteger(d) ? d : d.toFixed(1)}d`;
const fmtSize = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** A small "are you sure?" dialog. Cancel has focus, so Enter never deletes by accident; Escape cancels. */
export function ConfirmDialog(p: { title: string; note: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="dialog-back" onClick={(e) => e.target === e.currentTarget && p.onCancel()}>
      <div class="dialog confirm" role="alertdialog" aria-modal="true" aria-label={p.title}>
        <h2>{p.title}</h2>
        <p class="note">{p.note}</p>
        <div class="actions">
          <button ref={cancel} class="btn" onClick={p.onCancel}>
            Cancel
          </button>
          <button class="btn danger" onClick={p.onConfirm}>
            {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
