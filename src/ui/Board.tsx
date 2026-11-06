import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Analysis } from '../engine/analysis';
import { applyChanges, moveItem, type Change } from '../engine/changes';
import { addDays, dayParts, formatDay, monthName, parseISO, toISO, weekdayIndex } from '../engine/dates';
import { badgeLabel, chanceLabel } from '../engine/analysis';
import { lensById, type Badge, type LensId } from '../engine/lens';
import { describeWork } from '../engine/report';
import { schedule, type Schedule } from '../engine/schedule';
import { fitPpd, ZOOM_PPD, type Zoom } from '../io/view';
import { LIMITS } from '../engine/validate';
import type { NormalizedPlan } from '../engine/types';
import { useAnchor } from './Popover';
import { Avatar, WhoEditor } from './WhoEditor';
import { cx, DateButton, Icon } from './lib';

export const ROW = 44;
/** Room for a note drawn in place of a bar ("add effort to schedule this"). */
const NOTE_W = 170;
/** Room after the last day for its finish label ("19 Mar 2027" and a ±days badge beside it): the calendar runs on under it, so the chart looks full. */
export const LABEL_ROOM = 120;
/** The chart never draws more calendar than this (the engine's own horizon plus the label room at a pixel a day). */
const MAX_DRAWN_DAYS = 1100 + LABEL_ROOM;
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
  /** How much of the calendar each day gets: a fixed scale, or `fit` (the whole plan in the width at hand). */
  zoom: Zoom;
  /** A plan to show as a ghost over the current one: an option being previewed. */
  preview?: NormalizedPlan | null;
}

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
  end = Math.min(end, start + 1100);
  return { start, end, span: end - start + 1 };
}

/**
 * A month block's label for the width it has: "Jan 2027" → "Jan ’27" → "Jan" (or "’27" where the year says more than
 * the name) → "J" → nothing. `year` is set only where the year changes from the plan's own.
 */
export function monthLabel(width: number, name: string, year: number | null): string {
  const yy = year === null ? '' : `’${String(year).slice(2)}`;
  if (width >= 72) return year === null ? name : `${name} ${year}`;
  if (width >= 46) return year === null ? name : `${name} ${yy}`;
  if (width >= 28) return year === null ? name : yy;
  if (width >= 12) return name[0]!;
  return '';
}

/** The fixed scale a plan of this length reads best at (used by `fit` while the chart's width is unknown). */
export function autoZoom(span: number): Exclude<Zoom, 'fit'> {
  return span <= 75 ? 'day' : span <= 260 ? 'week' : 'month';
}

/** Pixels per day: `fit` sizes days to the width at hand (a fixed scale by plan length until it's measured). */
export function pixelsPerDay(zoom: Zoom, span: number, width: number): number {
  if (zoom !== 'fit') return ZOOM_PPD[zoom];
  return width > 0 ? fitPpd(span, width) : ZOOM_PPD[autoZoom(span)];
}

interface Drag {
  id: string;
  from: number;
  over: number;
  startY: number;
  /** Started from the bar in the timeline (not the row's handle). */
  byBar?: boolean;
}
/** Dragging a bar's right edge changes the item's effort for that lane. */
interface Resize {
  id: string;
  lane: string;
  startX: number;
  days0: number;
  /** Person-days one working day of this lane is worth for this item (people at once × availability). */
  perDay: number;
  /** The effort the plan is re-planned with: half-day steps. */
  days: number;
  /** The bar's width when the drag began, and how far the pointer has moved: the bar itself follows the pointer. */
  width0: number;
  dx: number;
}
/** Dragging a deadline diamond moves the deadline. */
interface DeadlineDrag {
  id: string;
  startX: number;
  date0: string;
  date: string;
}

/**
 * Dragging must never select text or leave focus behind in another row. Focus moves to the board itself, so ⌘/Ctrl Z
 * right after a drop reaches the app (inside Claude, a press that doesn't focus the chart leaves the keys with the chat).
 */
function startDragging(wrap: HTMLElement | null) {
  window.getSelection?.()?.removeAllRanges();
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest('.board')) active.blur();
  wrap?.focus({ preventScroll: true });
}

const snapHalf = (n: number) => Math.round(n * 2) / 2;

export function Board({ plan, analysis, selected, highlight, today, onSelect, onCommit, focusId, onFocused, zoom, preview: previewPlan }: Props) {
  const factor = lensById(analysis.lens).factor;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  const [dlDrag, setDlDrag] = useState<DeadlineDrag | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const who = useAnchor<string>();
  const [draft, setDraft] = useState('');
  const draftRef = useRef<HTMLInputElement>(null);
  const [focusReq, setFocusReq] = useState<{ id: string; mode: 'end' | 'select' } | null>(null);
  const [openWhoFor, setOpenWhoFor] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  // The latest drag and pointer offset, for handlers that run between renders.
  const dragRef = useRef<Drag | null>(null);
  const resizeRef = useRef<Resize | null>(null);
  const dlRef = useRef<DeadlineDrag | null>(null);
  const dyRef = useRef(0);
  const followScroll = () => {
    if (boardRef.current && scaleRef.current) scaleRef.current.style.transform = `translateX(${-boardRef.current.scrollLeft}px)`;
  };
  useLayoutEffect(followScroll);
  // a sideways swipe over the scale scrolls the board
  const scrollFromHead = (e: WheelEvent) => {
    const b = boardRef.current;
    if (b && Math.abs(e.deltaX) > Math.abs(e.deltaY)) b.scrollLeft += e.deltaX;
  };

  // The width the timeline has, so `fit` can size days to it. The first render can't know it (nothing is laid out
  // yet) and draws at a fixed scale; the first measured render draws at the fitted one without animating the step.
  const [clipW, setClipW] = useState(0);
  const [fresh, setFresh] = useState(true);
  useLayoutEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    // whole pixels, rounded down: a chart half a pixel wider than its box makes Safari show a scrollbar for it
    const measure = () => setClipW(Math.floor(el.getBoundingClientRect().width));
    measure();
    const raf = el.getBoundingClientRect().width ? 0 : requestAnimationFrame(measure); // not laid out yet: once more after the first frame
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, []);
  useEffect(() => {
    if (clipW > 0 && fresh) setFresh(false); // after the first measured paint: transitions from here on
  }, [clipW]);

  // live edits that re-plan before they're committed: a drag's new order, a bar's new effort, a moved deadline
  const liveChanges = useMemo<Change[] | null>(() => {
    if (resize) return [{ op: 'setEffort', item: resize.id, lane: resize.lane, days: resize.days }];
    if (dlDrag) return [{ op: 'setDeadline', item: dlDrag.id, date: dlDrag.date }];
    return null;
  }, [resize?.id, resize?.lane, resize?.days, dlDrag?.id, dlDrag?.date]);
  const livePlan = useMemo(() => (liveChanges ? applyChanges(plan, liveChanges).plan : null), [plan, liveChanges]);
  const preview = useMemo(
    () => (drag && drag.over !== drag.from ? schedule(moveItem(plan, drag.id, drag.over), { factor }) : livePlan ? schedule(livePlan, { factor }) : null),
    [plan, drag?.id, drag?.over, drag?.from, livePlan, factor],
  );
  // an option being previewed: its schedule is drawn as a ghost over the real bars (rows stay put)
  const ghost = useMemo(() => (previewPlan && !preview ? schedule(previewPlan, { factor }) : null), [previewPlan, preview, factor]);
  const shown: Schedule = preview ?? analysis.current;
  const shownPlan = livePlan ?? plan;
  const order = useMemo(() => (drag ? moveItem(plan, drag.id, drag.over).items : plan.items), [plan, drag?.id, drag?.over]);
  // Rows are absolutely positioned, so they stay in the plan's DOM order and only their `top` follows the preview order:
  // moving DOM nodes mid-drag could drop the pointer capture and strand the drag.
  const slot = useMemo(() => new Map(order.map((it, i) => [it.id, i])), [order]);

  // Timeline geometry (calendar days, so dates line up with real weeks). The scale comes from the plan as it is; a
  // preview or ghost that runs past its end only widens the chart. So nothing rescales under the pointer while a bar
  // is being resized, a row dragged or an option previewed; the chart re-fits once the change is real.
  const geo = useMemo(() => {
    const own = timelineSpan(plan, analysis, today, null);
    const full = timelineSpan(plan, analysis, today, preview ?? ghost);
    // one day of slack: the label room is rounded up to whole days below, and that must never push the chart past its box
    const ppd = pixelsPerDay(zoom, own.span + 1, Math.max(0, clipW - LABEL_ROOM));
    // The calendar drawn: at least the plan plus room for its last label; under `fit` it runs to the right edge of the
    // width at hand, so the chart is never followed by a blank strip.
    const least = full.span + Math.ceil(LABEL_ROOM / ppd);
    const span = Math.min(MAX_DRAWN_DAYS, zoom === 'fit' && clipW > 0 ? Math.max(least, Math.floor(clipW / ppd)) : least);
    return { start: full.start, end: full.start + span - 1, span, ppd, width: Math.ceil(span * ppd) }; // a whole number of pixels, never past the box
  }, [plan, analysis, preview, ghost, today, zoom, clipW]);
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
      // a month too narrow for its name shows its initial (a pixel a day fits a year in a laptop's width)
      // the year is named where it changes: on January, or on the first block when the chart starts in another year
      const showYear = p.year !== planYear && (p.month === 0 || d === geo.start);
      months.push({ left: (d - geo.start) * geo.ppd, width: (next - d) * geo.ppd, label: monthLabel((next - d) * geo.ppd, monthName(p.month), showYear ? p.year : null) });
      d = next;
    }
    const work = new Set(plan.calendar.workdays);
    const t = parseISO(today);
    const byDay = geo.ppd >= 18;
    const ticks: { d: number; label: string; dow?: string; off?: boolean }[] = [];
    for (let d = geo.start; d <= geo.end; d++) {
      const p = dayParts(toISO(d));
      if (byDay) ticks.push({ d, label: String(p.day), dow: DOW[p.weekday]!, off: !work.has((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[p.weekday]!) });
      // zoomed far out, every other week keeps the labels apart; narrower still, the month blocks are the scale
      else if (p.weekday === 0 && geo.ppd >= 2 && (geo.ppd >= 4 || Math.floor(d / 7) % 2 === 0) && (t === null || Math.abs(d - t) * geo.ppd >= 22)) ticks.push({ d, label: String(p.day) });
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

  // The header marks itself stuck once the page has scrolled it under the toolbar (set directly, not rendered).
  useEffect(() => {
    const wrap = wrapRef.current;
    const head = wrap?.querySelector<HTMLElement>('.board-head');
    if (!wrap || !head) return;
    const check = () => head.classList.toggle('stuck', wrap.getBoundingClientRect().top < head.getBoundingClientRect().top - 0.5);
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

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
  const commitChange = (changes: Change[], key?: string) => onCommit(applyChanges(plan, changes).plan, key);

  // ── drag handlers ──
  // The dragged row and its bars follow the pointer directly (no re-render per move); the board re-renders only when
  // the row crosses into another slot, which also re-plans the live preview.
  const dragged = (id: string) => wrapRef.current?.querySelectorAll<HTMLElement>(`[data-item="${CSS.escape(id)}"]`) ?? [];
  const slotOf = (d: Drag, dy: number) => Math.max(0, Math.min(plan.items.length - 1, Math.round(d.from + dy / ROW)));
  const rowTop = (i: number) => i * ROW;
  // Capturing the pointer keeps moves coming when it leaves the window; the drag works without it (see below).
  const capture = (e: PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* not an active pointer (e.g. a synthetic event) */
    }
  };
  const begin = (d: Drag, dy: number) => {
    startDragging(wrapRef.current);
    hover(null);
    dragRef.current = d;
    dyRef.current = dy;
    for (const el of dragged(d.id)) el.style.top = `${rowTop(d.from) + dy}px`;
    setDrag(d);
  };
  const onDown = (e: PointerEvent, id: string, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    capture(e);
    begin({ id, from: index, over: index, startY: e.clientY }, 0);
  };
  // Bars: a press that moves up or down drags the item (like its handle); a press without moving selects it.
  const pressed = useRef<{ id: string; index: number; x: number; y: number } | null>(null);
  const onBarDown = (e: PointerEvent, id: string, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection across the rows it passes
    pressed.current = { id, index, x: e.clientX, y: e.clientY };
    capture(e);
  };
  // A bar's right edge: dragging it sideways changes the effort of that part, half a day at a time.
  const onEdgeDown = (e: PointerEvent, id: string, lane: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const it = plan.items.find((x) => x.id === id);
    const part = it?.work.find((w) => w.lane === lane);
    const l = laneOf(lane);
    if (!it || !part || !l) return;
    startDragging(wrapRef.current);
    capture(e);
    const perDay = Math.max(0.1, (Math.min(part.maxPeople, Math.max(l.size, 0.1)) * l.availability) / 100);
    const bar = (e.currentTarget as HTMLElement).parentElement;
    const width0 = (bar && (parseFloat(bar.style.width) || bar.offsetWidth)) || 4;
    const r: Resize = { id, lane, startX: e.clientX, days0: part.days, perDay, days: part.days, width0, dx: 0 };
    resizeRef.current = r;
    setResize(r);
  };
  // The deadline diamond: drag it to another day.
  const onDiamondDown = (e: PointerEvent, id: string, date: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startDragging(wrapRef.current);
    capture(e);
    const d: DeadlineDrag = { id, startX: e.clientX, date0: date, date };
    dlRef.current = d;
    setDlDrag(d);
  };
  const onMove = (e: PointerEvent) => {
    const rs = resizeRef.current;
    if (rs) {
      // a day of sideways movement is a day of the calendar; working days are what effort is counted in
      const dx = e.clientX - rs.startX;
      const calDays = dx / geo.ppd;
      const workDays = calDays * (plan.calendar.workdays.length / 7);
      const days = Math.min(LIMITS.maxDays, Math.max(0.5, snapHalf(rs.days0 + workDays * rs.perDay)));
      resizeRef.current = { ...rs, days, dx };
      setResize(resizeRef.current);
      return;
    }
    const dd = dlRef.current;
    if (dd) {
      const date = addDays(dd.date0, Math.round((e.clientX - dd.startX) / geo.ppd));
      if (date !== dd.date) {
        dlRef.current = { ...dd, date };
        setDlDrag(dlRef.current);
      }
      return;
    }
    const p = pressed.current;
    if (p && !dragRef.current) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (Math.abs(dy) > 4 && Math.abs(dy) >= Math.abs(dx)) {
        // an up-or-down pull reorders
        pressed.current = null;
        const d: Drag = { id: p.id, from: p.index, over: p.index, startY: p.y, byBar: true };
        begin({ ...d, over: slotOf(d, dy) }, dy);
      } else if (Math.abs(dx) > 8) {
        pressed.current = null; // a sideways pull on a bar's body is neither a reorder nor a click (its edge changes the effort)
      }
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    dyRef.current = dy;
    for (const el of dragged(d.id)) el.style.top = `${rowTop(d.from) + dy}px`;
    const over = slotOf(d, dy);
    if (over !== d.over) {
      dragRef.current = { ...d, over };
      setDrag(dragRef.current);
    }
  };
  const onUp = (e?: PointerEvent) => {
    const rs = resizeRef.current;
    if (rs) {
      resizeRef.current = null;
      setResize(null);
      if (rs.days !== rs.days0) commitChange([{ op: 'setEffort', item: rs.id, lane: rs.lane, days: rs.days }]);
      return;
    }
    const dd = dlRef.current;
    if (dd) {
      dlRef.current = null;
      setDlDrag(null);
      if (dd.date !== dd.date0) commitChange([{ op: 'setDeadline', item: dd.id, date: dd.date }]);
      else onSelect(selected === dd.id ? null : dd.id);
      return;
    }
    const p = pressed.current;
    if (p) {
      pressed.current = null;
      const still = !!e && Math.abs(e.clientX - p.x) < 5 && Math.abs(e.clientY - p.y) < 5;
      if (still) onSelect(selected === p.id ? null : p.id);
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    for (const el of dragged(d.id)) el.style.top = `${rowTop(d.over)}px`; // drop into the slot
    if (d.over !== d.from) onCommit(moveItem(plan, d.id, d.over));
    setDrag(null);
  };
  const onCancel = () => {
    pressed.current = null;
    resizeRef.current = null;
    dlRef.current = null;
    setResize(null);
    setDlDrag(null);
    const d = dragRef.current;
    dragRef.current = null;
    if (d) for (const el of dragged(d.id)) el.style.top = `${rowTop(d.from)}px`;
    setDrag(null);
  };
  // Moves and releases are followed on the whole window, so a drag always ends, even if the pointer is let go outside
  // the board or the browser drops the capture.
  const handlers = useRef({ onMove, onUp, onCancel });
  handlers.current = { onMove, onUp, onCancel };
  useEffect(() => {
    const move = (e: PointerEvent) => handlers.current.onMove(e);
    const up = (e: PointerEvent) => handlers.current.onUp(e);
    const cancel = () => handlers.current.onCancel();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, []);
  // An item's row and its bars are one piece: hovering either lights up both (and shows the row's drag grip).
  const hovered = useRef<string | null>(null);
  const hover = (id: string | null) => {
    if (hovered.current === id) return;
    if (hovered.current) for (const el of dragged(hovered.current)) el.removeAttribute('data-hover');
    hovered.current = id;
    if (id && !dragRef.current) for (const el of dragged(id)) el.setAttribute('data-hover', '');
  };
  const onKeyMove = (e: KeyboardEvent, id: string, index: number) => {
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : null;
    if (to === null || to < 0 || to >= plan.items.length) return;
    e.preventDefault();
    onCommit(moveItem(plan, id, to));
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-handle="${id}"]`)?.focus());
  };

  const topOf = (id: string, i: number) => (drag && drag.id === id ? rowTop(drag.from) + dyRef.current : rowTop(i));
  const year = dayParts(plan.start).year;
  const todayDay = parseISO(today);
  const todayX = parseISO(today) !== null && parseISO(today)! >= geo.start && parseISO(today)! <= geo.end ? x(today) : null;

  /** The always-there empty row at the bottom turns into a real item as soon as something is typed or picked. */
  const createItem = (fields: Partial<NormalizedPlan['items'][number]>) => {
    if (plan.items.length >= LIMITS.items) return '';
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
  // Enter in an effort cell goes to the next row's, like Enter in a name
  const focusDays = (index: number) => {
    const next = order[index];
    wrapRef.current?.querySelector<HTMLInputElement>(next ? `.row[data-item="${CSS.escape(next.id)}"] .days-cell input` : '.row.draft .days-cell input')?.focus();
  };
  const full = plan.items.length >= LIMITS.items;

  const height = (order.length + 1) * ROW; // + the empty row for a new item
  // one person, no team: effort is a number in the row, the person is implied
  const solo = plan.lanes.length === 1 && plan.lanes[0]!.kind !== 'team' ? plan.lanes[0]! : null;

  return (
    <div
      ref={wrapRef}
      tabIndex={-1}
      class={cx('board-wrap', drag && 'is-dragging', resize && 'is-resizing', dlDrag && 'is-resizing', ghost && 'has-ghost', fresh && 'unmeasured')}
      onPointerLeave={() => hover(null)}
      onDragStart={(e) => e.preventDefault()} // no native drag of selected text or images (Safari)
    >
      {/* Column titles and the calendar scale: outside the scrolling board so they can stick under the toolbar while the
          page scrolls; the scale follows the board's horizontal scroll. */}
      <div class="board-head" aria-hidden="true" onWheel={scrollFromHead}>
        <div class="list-head">
          <span>#</span>
          <span>Item</span>
          <span title="Working days of effort, per person">Effort</span>
          <span title="The deadline">Due</span>
          <span title="When it will be finished, as scheduled">Expected delivery</span>
          <span />
        </div>
        <div class="tl-clip" ref={clipRef}>
          <div ref={scaleRef} class="tl-head" style={{ width: `${geo.width}px` }}>
            <div class="months">
              {scale.months.map((m) => (
                <div key={m.left} class={cx('month', m.width < 46 && 'tight')} style={{ left: `${m.left}px`, width: `${m.width}px` }}>
                  {m.label}
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
        </div>
      </div>
      <div class="board" ref={boardRef} onScroll={followScroll}>
        {/* list */}
        <div class="list" role="list" aria-label="Items in priority order">
          <div class="rows" style={{ height: `${height}px` }}>
            {plan.items.map((it) => {
              const i = slot.get(it.id)!;
              const r = shown.byId.get(it.id)!;
              const o = analysis.outlook.get(it.id);
              const isDragged = drag?.id === it.id;
              const shownIt = shownPlan.items.find((x) => x.id === it.id) ?? it;
              const whoText = describeWork(shownPlan, it.id);
              return (
                <div
                  key={it.id}
                  role="listitem"
                  data-item={it.id}
                  class={cx('row', selected === it.id && 'sel', it.done && 'done', isDragged && 'dragging', isDragged && drag?.byBar && 'by-bar', highlight && !highlight.has(it.id) && 'dim')}
                  style={{ top: `${topOf(it.id, i)}px` }}
                  onPointerEnter={() => hover(it.id)}
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
                  {solo ? (
                    <DaysCell item={shownIt} lane={solo} onFocus={() => onSelect(it.id)} onEnter={() => focusDays(i + 1)} onChange={(days) => commitChange([{ op: 'setEffort', item: it.id, lane: solo.id, days }], `days:${it.id}`)} />
                  ) : (
                    <WhoCell item={shownIt} laneOf={laneOf} label={whoText} onOpen={(el) => who.open(el, it.id)} />
                  )}
                  <div class="due-cell">
                    <DateButton
                      value={shownIt.deadline}
                      label={`Deadline for ${it.name}`}
                      placeholder="+ date"
                      format={(d) => <DueLabel iso={d} year={year} />}
                      onChange={(date) => commitChange([{ op: 'setDeadline', item: it.id, date }])}
                    />
                  </div>
                  <div class="status">
                    <Delivery status={r.status} problem={r.problem} badge={analysis.status.get(it.id)} base={o?.badge} chance={o?.chance} lens={analysis.lens} endDate={r.endDate} deadline={shownIt.deadline} year={year} />
                  </div>
                  <button class="row-del icon-btn" aria-label={`Delete ${it.name}`} title="Delete item" onClick={() => setConfirmDelete({ id: it.id, name: it.name })}>
                    <Icon.trash />
                  </button>
                </div>
              );
            })}
            {full ? (
              <div class="row draft full" style={{ top: `${rowTop(order.length)}px` }}>
                <span class="handle" aria-hidden="true">
                  <Icon.plus />
                </span>
                <span class="full-note">This plan is full ({LIMITS.items} items). Split it into two plans, or delete what's finished.</span>
              </div>
            ) : (
            <div class="row draft" style={{ top: `${rowTop(order.length)}px` }}>
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
              {solo ? (
                <DaysCell
                  item={null}
                  lane={solo}
                  onChange={(days) => {
                    if (days > 0) setFocusReq({ id: createItem({ work: [{ lane: solo.id, days, maxPeople: 1 }] }), mode: 'select' });
                  }}
                />
              ) : (
                <button class="who-cell" aria-label="New item: choose who works on it" onClick={() => setOpenWhoFor(createItem({}))}>
                  <span class="who-empty">+ who</span>
                </button>
              )}
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
            )}
          </div>
        </div>

        {/* timeline */}
        <div class="timeline" style={{ width: `${geo.width}px`, minWidth: `${geo.width}px` }}>
          <div class="grid" style={{ height: `${height}px` }}>
            {offDays.map((s) => (
              <div key={s.from} class="offday" style={{ left: `${(s.from - geo.start) * geo.ppd}px`, width: `${s.len * geo.ppd}px` }} />
            ))}
            {todayX !== null && <div class="today" title="Today" style={{ left: `${todayX + geo.ppd / 2}px` }} />}
          </div>
          <div class="rows" style={{ height: `${height}px` }}>
            {plan.items.map((it) => (
              <BarRow
                key={it.id}
                it={shownPlan.items.find((x) => x.id === it.id) ?? it}
                top={topOf(it.id, slot.get(it.id)!)}
                shown={shown}
                ghost={ghost}
                base={analysis.current}
                planned={analysis.planned}
                analysis={analysis}
                lensActive={factor !== 1}
                x={x}
                ppd={geo.ppd}
                todayLine={todayX !== null ? todayX + geo.ppd / 2 : null}
                laneColor={(id) => laneOf(id)?.color ?? '#4c6ef5'}
                dragging={!!drag}
                isDragged={drag?.id === it.id}
                resizing={resize?.id === it.id ? resize : null}
                dim={!!highlight && !highlight.has(it.id)}
                chain={!!highlight && highlight.has(it.id)}
                year={year}
                sel={selected === it.id}
                onPointerDown={(e) => onBarDown(e, it.id, plan.items.indexOf(it))}
                onEdgeDown={(e, lane) => onEdgeDown(e, it.id, lane)}
                onDiamondDown={(e, date) => onDiamondDown(e, it.id, date)}
                onHover={() => hover(it.id)}
              />
            ))}
          </div>
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
  ghost: Schedule | null;
  base: Schedule;
  planned: Schedule;
  analysis: Analysis;
  lensActive: boolean;
  x: (iso: string) => number;
  ppd: number;
  /** Where the today line is drawn, if it's on the chart. */
  todayLine: number | null;
  laneColor: (id: string) => string;
  dragging: boolean;
  isDragged: boolean;
  resizing: Resize | null;
  dim: boolean;
  chain: boolean;
  year: number;
  sel: boolean;
  onPointerDown: (e: PointerEvent) => void;
  onEdgeDown: (e: PointerEvent, lane: string) => void;
  onDiamondDown: (e: PointerEvent, date: string) => void;
  onHover: () => void;
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
  const live = props.dragging || !!props.resizing || props.shown !== props.base;
  const delta = live && baseR?.end !== undefined && r.end !== undefined ? r.end - baseR.end : 0;
  const endX = r.endDate ? x(r.endDate) + ppd : 0;
  // keep the finish-date label clear of a deadline diamond that sits just after the bar
  const diamondX = it.deadline ? x(it.deadline) + ppd / 2 : null;
  const labelX = diamondX !== null && diamondX > endX - 8 && diamondX < endX + 56 ? diamondX + 10 : endX + 8;
  const late = it.deadline && r.endDate && r.endDate > it.deadline;
  const dueEnd = it.deadline ? x(it.deadline) + ppd : 0;
  // a note in place of the bar ("add effort…") moves past the deadline diamond and the today line instead of running over them
  let noteX = 8;
  for (const mark of [diamondX, props.todayLine].filter((m): m is number => m !== null).sort((a, b) => a - b)) {
    if (mark > noteX - 10 && mark < noteX + NOTE_W) noteX = mark + 12;
  }
  // the previewed option, drawn over the real bars
  const g = props.ghost?.byId.get(it.id);
  const gParts = g?.parts.filter((p) => p.start !== undefined && p.end !== undefined) ?? [];
  const gDelta = g && r.end !== undefined && g.end !== undefined ? g.end - r.end : null;
  const gEndX = g?.endDate ? x(g.endDate) + ppd : null;
  return (
    <div
      data-item={it.id}
      class={cx('bars', props.dim && 'dim', props.sel && 'sel', props.isDragged && 'dragging', it.done && 'done')}
      style={{ top: `${props.top}px` }}
      onPointerDown={(e) => props.onPointerDown(e as unknown as PointerEvent)}
      onPointerEnter={props.onHover}
    >
      {/* With a lens on, a thin baseline under the bars keeps the user's own estimate (the usual Gantt "baseline"). */}
      {props.lensActive && plannedR?.startDate && plannedR.endDate && (
        <div
          class="baseline"
          title={`Your estimate (as planned): ${formatDay(plannedR.startDate, props.year)} → ${formatDay(plannedR.endDate, props.year)}`}
          style={{ left: `${x(plannedR.startDate) + 1}px`, width: `${Math.max(4, x(plannedR.endDate) - x(plannedR.startDate) + ppd - 2)}px`, top: `${ROW - 6}px` }}
        />
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
        const rs = props.resizing && props.resizing.lane === p.lane ? props.resizing : null;
        const drawnW = rs ? Math.max(4, rs.width0 + rs.dx) : width; // under the pointer the bar moves with it, not in half-day steps
        return (
          <div
            key={p.lane}
            class={cx('bar', props.chain && 'chain', rs && 'resizing')}
            title={`${it.name}: ${formatDay(s, props.year)} → ${formatDay(e, props.year)}. Drag the right edge to change the effort.`}
            style={{ left: `${left}px`, width: `${drawnW}px`, top: `${7 + k * (h + 1)}px`, height: `${h}px`, background: props.laneColor(p.lane) }}
          >
            {lateFrom < width && <span class="bar-late" style={{ left: `${lateFrom}px` }} />}
            {rs && <span class="bar-days">{fmtDays(rs.days)}</span>}
            <span class="bar-edge" onPointerDown={(ev) => props.onEdgeDown(ev as unknown as PointerEvent, p.lane)} title="Drag to change the effort" />
          </div>
        );
      })}
      {gParts.map((p, k) => {
        const s = props.ghost!.calendar.dateAt(p.start!);
        const e = props.ghost!.calendar.dateAt(p.end!);
        return (
          <div
            key={`g-${p.lane}`}
            class="bar ghost"
            style={{ left: `${x(s) + 1}px`, width: `${Math.max(4, x(e) - x(s) + ppd - 2)}px`, top: `${7 + k * (h + 1)}px`, height: `${h}px`, borderColor: props.laneColor(p.lane), background: `color-mix(in srgb, ${props.laneColor(p.lane)} 22%, transparent)` }}
          />
        );
      })}
      {it.deadline && (
        <div
          class="deadline"
          title={`Deadline ${formatDay(it.deadline, props.year)}${o ? ` · ${badgeLabel(o)}` : ''}. Drag to move it.`}
          style={{ left: `${x(it.deadline) + ppd / 2}px`, top: `${ROW / 2 - 7}px`, background: o ? BADGE_VAR[o] : 'var(--fg3)' }}
          onPointerDown={(ev) => props.onDiamondDown(ev as unknown as PointerEvent, it.deadline!)}
        />
      )}
      {r.endDate && (
        <span class="end-tag" style={{ left: `${labelX}px`, top: `${ROW / 2 - 8}px` }}>
          <span class={cx('end-label', late && 'late')}>{formatDay(r.endDate, props.year)}</span>
          {delta !== 0 && <span class={cx('delta', delta < 0 ? 'up' : 'down')}>{delta > 0 ? `+${delta}d` : `${delta}d`}</span>}
        </span>
      )}
      {gDelta !== null && gDelta !== 0 && gEndX !== null && (
        <span class={cx('delta', 'ghost-delta', gDelta < 0 ? 'up' : 'down')} style={{ left: `${gEndX + 8}px`, top: `${ROW / 2 - 8}px` }}>
          {gDelta > 0 ? `+${gDelta}d` : `${gDelta}d`}
        </span>
      )}
      {r.status === 'done' && (
        <span class="empty-bar done-bar" style={{ left: `${noteX}px`, top: `${ROW / 2 - 9}px` }}>
          <Icon.check /> done
        </span>
      )}
      {r.status === 'empty' && <span class="empty-bar" style={{ left: `${noteX}px`, top: `${ROW / 2 - 9}px` }}>add effort to schedule this</span>}
      {r.status === 'blocked' && <span class="empty-bar" style={{ left: `${noteX}px`, top: `${ROW / 2 - 9}px`, color: 'var(--danger)' }}>⛔ {r.problem}</span>}
    </div>
  );
}

/**
 * One quiet line under the chart: what the marks mean, and a "Tips" toggle for how to work with the chart (open on a
 * first visit, since the intro is the one time it's read; closed after that, the tooltips on the chart carry the rest).
 * Diamonds are the usual Gantt milestone marker; here each one is an item's deadline, coloured like its delivery date.
 * With a lens on, bars are stretched and a thin baseline keeps the user's own estimate.
 */
export function Legend({ lens, onPlanned, tipsOpen }: { lens: LensId; onPlanned: () => void; tipsOpen?: boolean }) {
  const l = lensById(lens);
  const [tips, setTips] = useState(!!tipsOpen);
  useEffect(() => {
    if (tipsOpen) setTips(true);
  }, [tipsOpen]);
  return (
    <div class="legend" aria-label="Chart key and tips">
      <span>
        <i class="k-diamond" style={{ background: 'var(--ok)' }} />
        <i class="k-diamond" style={{ background: 'var(--warn)' }} />
        <i class="k-diamond" style={{ background: 'var(--danger)' }} />
        deadline: on time, tight, late
      </span>
      <span>
        <i class="k-late" /> past its deadline
      </span>
      <span>
        <i class="k-today" /> today
      </span>
      {l.factor !== 1 && (
        <span class="k-lens">
          <i class="k-baseline" /> your estimate · bars show {l.label} ({l.short})
          <button class="link-btn" onClick={onPlanned}>
            Show as planned
          </button>
        </span>
      )}
      <button class="link-btn tips-toggle" aria-expanded={tips} onClick={() => setTips((v) => !v)}>
        {tips ? 'Hide tips' : 'Tips'}
      </button>
      {tips && (
        <span class="legend-tips">
          Drag ⠿ or a bar up or down to reprioritize · drag a bar's right edge to change its effort · drag a diamond to move a deadline · click a row to see why it lands when it does · hover an option to preview it as dashed bars
        </span>
      )}
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
  if (p.status === 'done') return <span class="pill done" title="Finished: it takes no more time">done</span>;
  if (p.status === 'blocked') return <span class="pill blocked" title={p.problem}>blocked</span>;
  if (p.status === 'empty') return <span class="pill empty" title="Add who works on it and how many days">no effort</span>;
  if (!p.endDate) return <span class="done-date">—</span>;
  const date = <DueLabel iso={p.endDate} year={p.year} />;
  if (!p.badge) return <span class="done-date" title={`Finishes ${formatDay(p.endDate, p.year)} · no deadline`}>{date}</span>;
  const lens = lensById(p.lens);
  const tip =
    p.badge === 'late' && p.base && p.base !== 'late'
      ? `Late if work takes ${lens.short} as long (${lens.label}). As planned: ${badgeLabel(p.base)}.`
      : p.badge === 'safe'
        ? 'Safe: on time even if work takes 3.1× as long'
        : p.badge === 'likely'
          ? 'Likely on time: on time if work takes the usual 1.6×, not at 3.1×'
          : p.badge === 'tight'
            ? 'Tight: on time only if everything goes to plan'
            : 'Late even if everything goes to plan';
  const due = p.deadline ? ` · deadline ${formatDay(p.deadline, p.year)}` : '';
  const pct = p.chance !== undefined ? ` · ${chanceLabel(p.chance)} chance as planned` : '';
  return (
    <span class={`pill delivery ${p.badge}`} title={tip + due + pct} aria-label={`Finishes ${formatDay(p.endDate, p.year)}: ${badgeLabel(p.badge)}${due}`}>
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
 * Who works on an item, in a narrow cell: everyone's avatar, always (stacked when there are several), the name when
 * it's one person, a "→" when there's a hand-off, and the days as a pill (one person's, or everyone's together).
 * The tooltip has the whole story ("Martin 1d + Sara 3d after Martin").
 */
function WhoCell({ item, laneOf, label, onOpen }: { item: NormalizedPlan['items'][number]; laneOf: (id: string) => NormalizedPlan['lanes'][number] | undefined; label: string; onOpen: (el: HTMLElement) => void }) {
  const work = item.work;
  const color = (lane: string) => laneOf(lane)?.color ?? '#868e96';
  const name = (lane: string) => laneOf(lane)?.name ?? lane;
  const one = work.length === 1 ? laneOf(work[0]!.lane) : undefined;
  return (
    <button class="who-cell" data-who={item.id} title={label} aria-label={`Who works on ${item.name}: ${work.length ? label : 'nobody yet'}`} onClick={(e) => onOpen(e.currentTarget as HTMLElement)}>
      {work.length ? (
        <>
          <span class={cx('who-people', work.length > 1 && 'who-stack')}>
            {work.slice(0, 3).map((w) => (
              <Avatar key={w.lane} name={name(w.lane)} color={color(w.lane)} />
            ))}
            {work.length > 3 && <span class="more">+{work.length - 3}</span>}
          </span>
          {work.length === 1 && <span class="who-name">{name(work[0]!.lane)}</span>}
          {one?.kind === 'team' && <span class="who-team">×{fmtSize(one.size)}</span>}
          {work.some((w) => w.after) && (
            <span class="who-handoff" aria-hidden="true">
              →
            </span>
          )}
          <span class="who-days">{fmtDays(work.reduce((t, w) => t + w.days, 0))}</span>
        </>
      ) : (
        <span class="who-empty">+ who</span>
      )}
    </button>
  );
}

/**
 * Effort as a plain number in the row, for plans with one person: type the days, the way you would in a spreadsheet,
 * and the item is theirs. (With several people or a team, the who cell and its editor take over.)
 */
function DaysCell({ item, lane, onChange, onFocus, onEnter }: { item: NormalizedPlan['items'][number] | null; lane: NormalizedPlan['lanes'][number]; onChange: (days: number) => void; onFocus?: () => void; onEnter?: () => void }) {
  const part = item?.work.find((w) => w.lane === lane.id);
  return (
    <span class="days-cell" data-who={item?.id ?? ''}>
      <input
        type="number"
        min="0"
        max={LIMITS.maxDays}
        step="0.5"
        inputMode="decimal"
        value={part && part.days > 0 ? part.days : ''}
        placeholder="days"
        aria-label={item ? `${item.name}: working days for ${lane.name}` : 'New item: working days'}
        onFocus={onFocus}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
        onInput={(e) => onChange(Math.min(LIMITS.maxDays, Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0)))}
      />
      <span class="unit" aria-hidden="true">
        {part?.days === 1 ? 'day' : 'days'}
      </span>
    </span>
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
