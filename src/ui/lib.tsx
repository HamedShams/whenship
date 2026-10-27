import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

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
export function DateButton(props: { value: string | undefined; onChange: (v: string | null) => void; label: string; placeholder: string; format: (iso: string) => ComponentChildren; class?: string }) {
  return (
    <span class={cx('date-btn', !props.value && 'empty', props.class)}>
      <span aria-hidden="true">{props.value ? props.format(props.value) : props.placeholder}</span>
      <input
        type="date"
        value={props.value ?? ''}
        aria-label={props.label}
        onClick={(e) => {
          try {
            (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
          } catch {
            /* picker not available: the input still accepts typing */
          }
        }}
        onChange={(e) => props.onChange((e.currentTarget as HTMLInputElement).value || null)}
      />
    </span>
  );
}
