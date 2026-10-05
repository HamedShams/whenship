import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

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

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const p = ref.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = a.bottom + 6;
    if (top + p.height > vh - 8 && a.top - p.height - 6 > 8) top = a.top - p.height - 6;
    let left = Math.min(a.left, vw - p.width - 8);
    left = Math.max(8, left);
    setPos({ top: Math.max(8, top), left });
  }, [anchor]);

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
    first?.focus();
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
  return {
    open: (el: HTMLElement, key: T) => setState({ el, key }),
    close: () => setState(null),
    el: state?.el ?? null,
    key: state?.key ?? null,
  };
}
