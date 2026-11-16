import { render, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { dayParts, formatDayLong, monthName, parseLooseDate, toISO, todayLocal, weekdayIndex } from '../engine/dates';
import { Popover } from './Popover';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** localStorage that never throws (private windows, blocked storage, sandboxed iframes). */
export const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

export function downloadBlob(name: string, mime: string, data: string | Uint8Array) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Rasterises an SVG string to PNG bytes (2× for crisp output). */
export async function svgToPng(svg: string): Promise<Uint8Array> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image failed'));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png failed'))), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── icons (stroke icons, 16px) ─────────────────────────────────────────────
const I = ({ children, size = 16 }: { children: ComponentChildren; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const Icon = {
  grip: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[5, 12, 19].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
    </svg>
  ),
  undo: () => <I><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></I>,
  redo: () => <I><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></I>,
  download: () => <I><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></I>,
  link: () => <I><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></I>,
  info: () => <I><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></I>,
  plus: () => <I><path d="M12 5v14" /><path d="M5 12h14" /></I>,
  trash: () => <I><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></I>,
  close: () => <I><path d="M18 6 6 18" /><path d="m6 6 12 12" /></I>,
  expand: () => <I><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /></I>,
  external: () => <I><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></I>,
  spark: () => <I><path d="M12 3v4" /><path d="M12 17v4" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="m6 6 2.5 2.5" /><path d="m15.5 15.5 2.5 2.5" /><path d="m6 18 2.5-2.5" /><path d="m15.5 8.5 2.5-2.5" /></I>,
  chain: () => <I><path d="M4 12h4" /><path d="M16 12h4" /><rect x="8" y="9" width="8" height="6" rx="2" /></I>,
  open: () => <I><path d="M4 20h16" /><path d="M12 4v11" /><path d="m7 9 5-5 5 5" /></I>,
  pencil: () => <I><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></I>,
  check: () => <I><path d="m5 12 5 5L20 7" /></I>,
  paste: () => <I><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" /><path d="M9 13h6" /><path d="M9 17h4" /></I>,
};

export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#4c6ef5" />
    <rect x="6" y="8" width="13" height="4" rx="2" fill="#fff" />
    <rect x="11" y="14" width="15" height="4" rx="2" fill="#fff" opacity=".85" />
    <rect x="9" y="20" width="9" height="4" rx="2" fill="#fff" opacity=".7" />
    <path d="M24 20.5l2.5 2.5-2.5 2.5-2.5-2.5z" fill="#ffd43b" />
  </svg>
);

/** A compact date ("14 Oct") that opens the native date picker; the real input sits invisibly on top. */
/**
 * Renders its children at the end of the page instead of where it sits (a small root of its own; `preact/compat` has
 * a portal, but importing it changes how every `onChange` in the app behaves). For popovers opened from inside a
 * stacking layer (the sticky list, the dock) that must not slide under another one.
 */
function Portal({ children }: { children: ComponentChildren }) {
  const host = useRef<HTMLDivElement | null>(null);
  if (!host.current) host.current = document.createElement('div');
  useLayoutEffect(() => {
    const el = host.current!;
    document.body.appendChild(el);
    return () => {
      render(null, el);
      el.remove();
    };
  }, []);
  useLayoutEffect(() => {
    render(<>{children}</>, host.current!);
  });
  return null;
}

const DOW2 = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/**
 * A month to pick a day from: Monday first, today and the chosen day marked, arrow keys move between days, and a field
 * that takes a typed date ("7 Dec", "2026-12-07"). Used by `DateButton` wherever there's a mouse.
 */
function Calendar({ value, onPick, onClear }: { value: string | undefined; onPick: (iso: string) => void; onClear?: (() => void) | undefined }) {
  const today = todayLocal();
  const shown = dayParts(value ?? today);
  const [ym, setYm] = useState({ y: shown.year, m: shown.month });
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const first = Date.UTC(ym.y, ym.m, 1) / 86_400_000;
  const gridStart = first - weekdayIndex(first); // the Monday on or before the 1st
  const move = (n: number) =>
    setYm(({ y, m }) => {
      const d = new Date(Date.UTC(y, m + n, 1));
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    });
  const onKeys = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    const days = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.cal-day')];
    const next = days[days.indexOf(document.activeElement as HTMLElement) + step];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  return (
    <div class="cal">
      <div class="cal-head">
        <button class="icon-btn" aria-label="Previous month" onClick={() => move(-1)}>
          ‹
        </button>
        <b>
          {monthName(ym.m)} {ym.y}
        </b>
        <button class="icon-btn" aria-label="Next month" onClick={() => move(1)}>
          ›
        </button>
      </div>
      <div class="cal-grid" onKeyDown={onKeys}>
        {DOW2.map((d) => (
          <span key={d} class="cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const iso = toISO(gridStart + i);
          const p = dayParts(iso);
          return (
            <button key={iso} class={cx('cal-day', p.month !== ym.m && 'out', iso === value && 'sel', iso === today && 'is-today')} aria-label={formatDayLong(iso)} aria-pressed={iso === value} onClick={() => onPick(iso)}>
              {p.day}
            </button>
          );
        })}
      </div>
      <form
        class="cal-foot"
        onSubmit={(e) => {
          e.preventDefault();
          const iso = parseLooseDate(text, today);
          if (iso) onPick(iso);
          else setBad(true);
        }}
      >
        <input
          class={cx('cal-text', bad && 'bad')}
          value={text}
          placeholder="or type: 7 Dec"
          aria-label="Type a date and press Enter"
          onInput={(e) => {
            setText((e.currentTarget as HTMLInputElement).value);
            setBad(false);
          }}
        />
        <button type="button" class="btn small ghost" onClick={() => onPick(today)}>
          Today
        </button>
        {onClear && value && (
          <button type="button" class="btn small ghost" onClick={onClear}>
            Clear
          </button>
        )}
      </form>
    </div>
  );
}

/**
 * A date shown as text that opens a picker. With a mouse it's our own calendar popover: it closes on a click
 * anywhere else, opens above when there's no room below, and looks the same in every browser (the system pickers
 * don't: Safari's stays open when the chart is clicked, and doesn't open at all near the bottom of the window).
 * Under a finger it's the system's picker, which is better there. Keyboard: Tab to it and type the date, or press
 * Enter for the calendar. `clearable` adds "Clear" (`onChange(null)`).
 */
export function DateButton(props: { value: string | undefined; onChange: (v: string | null) => void; label: string; placeholder: string; format: (iso: string) => ComponentChildren; class?: string; clearable?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const native = typeof matchMedia === 'function' && !!matchMedia('(pointer: coarse)').matches;
  // a date field fires both `input` and `change` for one pick: tell the owner once
  const last = useRef(props.value ?? '');
  last.current = props.value ?? '';
  const emit = (v: string) => {
    if (v === last.current) return;
    last.current = v;
    props.onChange(v || null);
  };
  return (
    <span
      ref={ref}
      class={cx('date-btn', !props.value && 'empty', open && 'open', native && 'native', props.class)}
      onClick={() => {
        if (!native) setOpen(true);
      }}
    >
      <span aria-hidden="true">{props.value ? props.format(props.value) : props.placeholder}</span>
      <input
        type="date"
        value={props.value ?? ''}
        aria-label={props.label}
        onClick={(e) => {
          if (!native) return;
          try {
            (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
          } catch {
            /* picker not available: the input still accepts typing */
          }
        }}
        onKeyDown={(e) => {
          if (!native && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onInput={(e) => emit((e.currentTarget as HTMLInputElement).value)}
        onChange={(e) => emit((e.currentTarget as HTMLInputElement).value)}
      />
      {/* At the page's root, not inside the row: the list and the dock are stacking layers of their own, and a calendar
          opened from one of them would slide under the other. */}
      {open && ref.current && (
        <Portal>
        <Popover anchor={ref.current} onClose={close} label={props.label} className="date-pop" fit="shift" focus={props.value ? '.cal-day.sel' : '.cal-day.is-today'}>
          <Calendar
            value={props.value}
            onPick={(iso) => {
              props.onChange(iso);
              close();
            }}
            onClear={
              props.clearable
                ? () => {
                    props.onChange(null);
                    close();
                  }
                : undefined
            }
          />
        </Popover>
        </Portal>
      )}
    </span>
  );
}

/**
 * Our own hints (`data-tip` on an element), shown after a short rest of the pointer. Native tooltips (`title`) are not
 * used anywhere: on macOS the system swaps the pointing-hand cursor back to an arrow the moment one shows, so every
 * clickable thing with a hint stopped looking clickable after half a second.
 */
let tipsInstalled = false;
export function installTips() {
  if (tipsInstalled || typeof document === 'undefined') return;
  tipsInstalled = true;
  let tip: HTMLElement | null = null;
  let target: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip?.remove();
    tip = null;
  };
  const show = (el: Element) => {
    const text = el.getAttribute('data-tip');
    if (!text || !el.isConnected) return;
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    document.body.appendChild(tip);
    const a = el.getBoundingClientRect();
    const b = tip.getBoundingClientRect();
    const below = a.bottom + 8;
    tip.style.left = `${Math.max(6, Math.min(a.left + a.width / 2 - b.width / 2, window.innerWidth - b.width - 6))}px`;
    tip.style.top = `${below + b.height > window.innerHeight - 6 ? Math.max(6, a.top - b.height - 8) : below}px`;
  };
  document.addEventListener(
    'pointerover',
    (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
      if (el === target) return;
      hide();
      if (!el) return;
      target = el;
      timer = setTimeout(() => show(el), 600);
    },
    true,
  );
  for (const type of ['pointerdown', 'keydown', 'scroll', 'wheel', 'blur']) window.addEventListener(type, hide, true);
  document.documentElement.addEventListener('pointerleave', hide);
}
