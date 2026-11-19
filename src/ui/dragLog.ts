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

/**
 * After a drop the record goes on for two seconds: every scroll (of the page or of anything inside it) and, once a
 * frame, the page's own picture again. What goes wrong after the hand lets go is otherwise never written down.
 */
export function dragLogAfter(snap: () => Record<string, unknown>) {
  if (!dragLogOn) return;
  const until = performance.now() + 2000;
  let last = '';
  const onScroll = (e: Event) => {
    const t = e.target;
    dragLog('scroll-after', { on: t instanceof Element ? t.className.split(' ')[0] || t.nodeName : 'page', top: t instanceof Element ? t.scrollTop : Math.round(window.scrollY * 10) / 10 });
  };
  const onOther = (e: Event) => dragLog(`${e.type}-after`, { on: (e.target as Element | null)?.nodeName ?? null, focus: document.activeElement?.className?.split(' ')[0] || document.activeElement?.nodeName });
  const others = ['focusin', 'click', 'resize', 'selectionchange'];
  window.addEventListener('scroll', onScroll, true);
  for (const type of others) document.addEventListener(type, onOther, true);
  const step = () => {
    const line = JSON.stringify(snap());
    if (line !== last) dragLog('after', JSON.parse((last = line)));
    if (performance.now() < until) return void requestAnimationFrame(step);
    window.removeEventListener('scroll', onScroll, true);
    for (const type of others) document.removeEventListener(type, onOther, true);
    dragLog('after-end');
  };
  requestAnimationFrame(step);
}

/**
 * What the page believes, drawn on the screen: with `#debug`, a small tag for every row at the place the page has
 * measured that row to be, and a line where it has measured the chart header to end. The tags are fixed to the window,
 * the rows scroll with the page; on a screen that agrees with the page each tag sits on its own row. A screenshot of
 * tags that sit on other rows shows the browser drawing something else than it reports, and by how much.
 */
export function dragOverlay() {
  if (!dragLogOn || typeof document === 'undefined' || document.querySelector('.drag-overlay')) return;
  const layer = document.createElement('div');
  layer.className = 'drag-overlay';
  document.body.appendChild(layer);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const step = () => {
    if (!layer.isConnected) return;
    requestAnimationFrame(step);
    const head = document.querySelector('.board-head')?.getBoundingClientRect();
    const rows = [...document.querySelectorAll<HTMLElement>('.list .row[data-item]')];
    const board = document.querySelector('.board');
    let html = '';
    if (head) html += `<i class="line" style="top:${head.bottom}px"></i><b style="top:${head.bottom - 15}px;left:${head.left + 150}px">header ends ${r1(head.bottom)} · page scroll ${r1(window.scrollY)} · inner ${board ? r1(board.scrollTop) : '-'}</b>`;
    for (const row of rows) {
      const b = row.getBoundingClientRect();
      if (b.bottom < 0 || b.top > window.innerHeight) continue;
      html += `<b style="top:${b.top + 1}px;left:${b.left + 2}px">${row.dataset.item} ${r1(b.top)}</b>`;
    }
    if (layer.innerHTML !== html) layer.innerHTML = html;
  };
  requestAnimationFrame(step);
}

