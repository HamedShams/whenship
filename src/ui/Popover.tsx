import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** A small anchored popover: opens below its anchor, flips to stay on screen, closes on outside click / Escape. */
export function Popover({
  anchor,
  onClose,
  children,
  label,
  className,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ComponentChildren;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
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
      const maxHeight = Math.max(120, placeBelow ? below : above);
      const height = Math.min(natural, maxHeight);
      const top = placeBelow ? a.bottom + 6 : a.top - 6 - height;
      const left = Math.max(8, Math.min(a.left, vw - el.getBoundingClientRect().width - 8));
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
  }, [anchor, onClose]);
  // content can grow or shrink (e.g. a person added in the editor): re-place after every render
  useLayoutEffect(() => {
    placeRef.current?.();
  });

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(anchor && anchor.contains(e.target as Node))) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('input, select, button, textarea');
    first?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      ref={ref}
      class={`popover ${className ?? ''}`}
      role="dialog"
      aria-label={label}
      style={pos ? { top: `${pos.top}px`, left: `${pos.left}px`, maxHeight: `${pos.maxHeight}px` } : { top: '-9999px', left: '-9999px' }}
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
