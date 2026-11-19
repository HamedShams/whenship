/**
 * A drag recorder for support. With `#debug` in the address, every row drag is written down as it happens: each
 * pointer and wheel event as the browser delivered it, and the page's own numbers (scroll position, where the chart's
 * header and the list are, where the row is drawn). A small box in the corner copies the record. It exists because a
 * drag can go wrong only under a real hand on a real trackpad, where no test can follow it. Off, it does nothing.
 */
export const dragLogOn = typeof location !== 'undefined' && /(^|[#&])debug\b/.test(location.hash);

const lines: string[] = [];
let box: HTMLElement | null = null;

function show() {
  if (!box) {
    box = document.createElement('div');
    box.className = 'drag-log';
    const count = document.createElement('span');
    const copy = document.createElement('button');
    copy.textContent = 'Copy drag log';
    copy.onclick = async () => {
      const text = lines.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'Copied';
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        box!.appendChild(area);
        area.select();
      }
    };
    const clear = document.createElement('button');
    clear.textContent = 'Clear';
    clear.onclick = () => {
      lines.length = 0;
      copy.textContent = 'Copy drag log';
      show();
    };
    box.append(count, copy, clear);
    document.body.appendChild(box);
  }
  box.firstElementChild!.textContent = `${lines.length} lines`;
}

/** Writes one line of the record (nothing unless `#debug` is on). */
export function dragLog(what: string, data: Record<string, unknown> = {}) {
  if (!dragLogOn) return;
  if (lines.length > 6000) lines.splice(0, 1000);
  lines.push(JSON.stringify({ t: Math.round(performance.now()), what, ...data }));
  show();
}
