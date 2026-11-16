import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** The open popovers, oldest first: one opened from inside another (a calendar from the holidays editor) sits above it. */
const stack: { el: () => HTMLElement | null }[] = [];

/**
 * What everything that opens over the page shares: a place in the stack, so that Escape closes the one on top, and a
 * press outside closes it, unless the press lands on its anchor or in something opened from inside it (its calendar).
 */
function useDismiss(ref: { current: HTMLElement | null }, anchor: HTMLElement | null, onClose: () => void) {
  useEffect(() => {
    const me = { el: () => ref.current };
    stack.push(me);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current || ref.current.contains(t) || (anchor && anchor.contains(t))) return;
      if (stack.slice(stack.indexOf(me) + 1).some((p) => p.el()?.contains(t))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === me) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      stack.splice(stack.indexOf(me), 1);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);
}

/**
 * What a row opens (its settings, who works on it, why its date): docked under the row, part of the page. It is
 * placed from the row's place in the list, not from where the row happens to be drawn at that moment, so it is always
 * right under its row and travels with it. It never flips above the row, never moves to stay on screen and never
 * scrolls inside: it scrolls with the page, under the chart's header and under the options dock, and the chart makes
 * room below its last row for whatever hangs past it.
 */
export function Docked({
  anchor,
  top,
  left,
  width,
  onClose,
  label,
  className,
  children,
}: {
  /** What was clicked to open it: a press there is not a press outside. */
  anchor: HTMLElement | null;
  /** Where its top edge sits inside the chart (pixels from the chart's top): the bottom edge of its row. */
  top: number;
  left?: number | undefined;
  width?: number | undefined;
  onClose: () => void;
  label: string;
  className?: string;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, anchor, onClose);
  // the chart keeps room for it under its last row (a popup past the end of the page could never be scrolled to)
  useLayoutEffect(() => {
    const el = ref.current;
    const wrap = el?.parentElement;
    if (!el || !wrap) return;
    const room = () => (wrap.style.minHeight = `${top + el.offsetHeight + 12}px`);
    room();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(room);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [top]);
  useLayoutEffect(
    () => () => {
      const wrap = ref.current?.parentElement;
      if (wrap) wrap.style.minHeight = '';
    },
    [],
  );
  return (
    <div
      ref={ref}
      class={`docked ${className ?? ''}`}
      role="dialog"
      aria-label={label}
      style={{ top: `${top}px`, ...(left !== undefined ? { left: `${left}px` } : null), ...(width !== undefined ? { width: `${width}px` } : null) }}
    >
      {children}
    </div>
  );
}

/** A small anchored popover: opens below its anchor, flips to stay on screen, closes on outside click / Escape. */
export function Popover({
  anchor,
  onClose,
  children,
  label,
  className,
  focus,
  fit = 'scroll',
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ComponentChildren;
  label: string;
  className?: string;
  /** The control that gets the focus when it opens (a selector); the first one otherwise; `false` leaves the focus where it is. */
  focus?: string | false;
  /**
   * What to do when it doesn't fit beside its anchor: `scroll` (default) caps its height and lets it scroll inside;
   * `shift` keeps it whole and moves it to stay on screen, over its anchor if it must (a calendar must never scroll).
   */
  fit?: 'scroll' | 'shift';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number | null } | null>(null);
  const placeRef = useRef<(() => void) | null>(null);

  // Stay attached to the anchor: re-place on any scroll (page, board, list) or resize, and close once the anchor
  // leaves the screen or the page (e.g. its row was deleted).
  useLayoutEffect(() => {
    if (!anchor) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      if (!ref.current) return;
      if (!anchor.isConnected) return onClose();
      const a = anchor.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const topEdge = stickyEdge(anchor);
      if (a.bottom < topEdge || a.top > vh || a.right < 0 || a.left > vw) return onClose();
      // Prefer below the anchor; flip above when there's more room there. Never taller than the room available, so
      // a long popover scrolls inside itself instead of running off the screen.
      const el = ref.current;
      const natural = el.scrollHeight + 2;
      const below = vh - a.bottom - 14;
      const above = a.top - topEdge - 14;
      const placeBelow = natural <= below || below >= above;
      const left = Math.max(8, Math.min(a.left, vw - el.getBoundingClientRect().width - 8));
      if (fit === 'shift') {
        const want = placeBelow ? a.bottom + 6 : a.top - 6 - natural;
        const top = Math.max(8, Math.min(want, vh - natural - 8));
        setPos((old) => (old && old.top === top && old.left === left && old.maxHeight === null ? old : { top, left, maxHeight: null }));
        return;
      }
      const maxHeight = Math.max(120, placeBelow ? below : above);
      const height = Math.min(natural, maxHeight);
      const top = placeBelow ? a.bottom + 6 : a.top - 6 - height;
      setPos((old) => (old && old.top === top && old.left === left && old.maxHeight === maxHeight ? old : { top, left, maxHeight }));
    };
    placeRef.current = place;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      placeRef.current = null;
    };
  }, [anchor, onClose, fit]);
  // content can grow or shrink (e.g. a person added in the editor): re-place after every render
  useLayoutEffect(() => {
    placeRef.current?.();
  });

  useDismiss(ref, anchor, onClose);

  useEffect(() => {
    if (focus === false) return;
    const first = (focus && ref.current?.querySelector<HTMLElement>(focus)) || ref.current?.querySelector<HTMLElement>('input, select, button, textarea');
    first?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={ref}
      class={`popover ${className ?? ''}`}
      role="dialog"
      aria-label={label}
      style={pos ? { top: `${pos.top}px`, left: `${pos.left}px`, maxHeight: pos.maxHeight === null ? 'none' : `${pos.maxHeight}px` } : { top: '-9999px', left: '-9999px' }}
    >
      {children}
    </div>
  );
}

/**
 * Anchors in the page can slide under the sticky toolbar, and rows in the board under its sticky header: the lowest of
 * those edges counts as the top of the screen.
 */
function stickyEdge(anchor: HTMLElement): number {
  let edge = 0;
  for (const [sel, applies] of [['.toolbar', true], ['.board-head', !!anchor.closest('.board')]] as const) {
    const bar = applies ? document.querySelector(sel) : null;
    if (bar && !bar.contains(anchor) && getComputedStyle(bar).position === 'sticky') edge = Math.max(edge, bar.getBoundingClientRect().bottom);
  }
  return edge;
}

/** Hook for "click a chip, open a popover anchored to it". */
export function useAnchor<T = string>() {
  const [state, setState] = useState<{ el: HTMLElement; key: T } | null>(null);
  const open = useCallback((el: HTMLElement, key: T) => setState({ el, key }), []);
  const close = useCallback(() => setState(null), []);
  return {
    open,
    close,
    el: state?.el ?? null,
    key: state?.key ?? null,
  };
}
