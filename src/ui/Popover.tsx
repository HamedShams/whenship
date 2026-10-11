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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

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
      // anchors in the page body can slide under the sticky toolbar: treat its bottom edge as the top of the screen
      const bar = anchor.closest('.toolbar') ? null : document.querySelector('.toolbar');
      const topEdge = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().bottom : 0;
      if (a.bottom < topEdge || a.top > vh || a.right < 0 || a.left > vw) return onClose();
      const p = ref.current.getBoundingClientRect();
      let top = a.bottom + 6;
      if (top + p.height > vh - 8 && a.top - p.height - 6 > 8) top = a.top - p.height - 6;
      const left = Math.max(8, Math.min(a.left, vw - p.width - 8));
      setPos((old) => (old && old.top === Math.max(8, top) && old.left === left ? old : { top: Math.max(8, top), left }));
    };
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
    };
  }, [anchor, onClose]);

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
      style={pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : { top: '-9999px', left: '-9999px' }}
    >
      {children}
    </div>
  );
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
