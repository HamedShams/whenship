// @vitest-environment happy-dom
// The drag recorder for support: nothing unless the address asks for it (#debug), then a record that can be copied.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  location.hash = '';
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('the drag recorder', () => {
  it('is off by default: it records nothing and shows nothing', async () => {
    const m = await import('../../src/ui/dragLog');
    expect(m.dragLogOn).toBe(false);
    m.dragLog('begin', { id: 'a' });
    expect(document.querySelector('.drag-log')).toBeNull();
  });

  it('with #debug in the address (also after a share link) it writes each event down and hands the record over', async () => {
    for (const hash of ['#debug', '#p=abc&debug']) {
      vi.resetModules();
      document.body.innerHTML = '';
      location.hash = hash;
      const m = await import('../../src/ui/dragLog');
      expect(m.dragLogOn).toBe(true);
      m.dragLog('begin', { id: 'a', from: 3 });
      m.dragLog('move', { y: 120.5, buttons: 1 });
      const box = document.querySelector('.drag-log')!;
      expect(box.textContent).toContain('2 lines');
      const [copy, clear] = [...box.querySelectorAll('button')] as HTMLButtonElement[];
      const writeText = vi.fn(async (_text: string) => {});
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      copy!.click();
      await Promise.resolve();
      const lines = writeText.mock.calls[0]![0].split('\n').map((l) => JSON.parse(l) as { what: string; t: number });
      expect(lines.map((l) => l.what)).toEqual(['begin', 'move']);
      expect(lines[1]).toMatchObject({ y: 120.5, buttons: 1 });
      expect(typeof lines[0]!.t).toBe('number'); // when, in milliseconds
      expect(copy!.textContent).toBe('Copied');
      clear!.click();
      expect(box.textContent).toContain('0 lines');
      vi.unstubAllGlobals();
    }
  });

  it('a clipboard that refuses still gives the record: it is put in a box, selected', async () => {
    location.hash = '#debug';
    const m = await import('../../src/ui/dragLog');
    m.dragLog('drop', { over: 0 });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => Promise.reject(new Error('no')) } });
    (document.querySelector('.drag-log button') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect((document.querySelector('.drag-log textarea') as HTMLTextAreaElement).value).toContain('"what":"drop"');
  });

  it("after a drop the record goes on for a while: every scroll, of the page or of anything inside it, and the page's own picture when it changes", async () => {
    location.hash = '#debug';
    const m = await import('../../src/ui/dragLog');
    let sy = 86;
    m.dragLogAfter(() => ({ sy, row: 170 }));
    await new Promise((r) => setTimeout(r, 40));
    const inner = document.createElement('div');
    inner.className = 'board';
    document.body.appendChild(inner);
    inner.scrollTop = 44;
    inner.dispatchEvent(new Event('scroll'));
    sy = 130; // the page moved by itself
    window.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 60));
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    (document.querySelector('.drag-log button') as HTMLButtonElement).click();
    await Promise.resolve();
    const lines = writeText.mock.calls[0]![0].split('\n').map((l) => JSON.parse(l) as { what: string; sy?: number; on?: string; top?: number });
    expect(lines.filter((l) => l.what === 'after').map((l) => l.sy)).toEqual([86, 130]); // written only when it changes
    expect(lines.filter((l) => l.what === 'scroll-after').map((l) => l.on)).toEqual(['board', 'page']);
    expect(lines.find((l) => l.what === 'scroll-after')!.top).toBe(44);
  });

  it('with #debug the page draws what it believes: a tag on every row at the place it has measured the row to be', async () => {
    document.body.innerHTML = '<div class="board-head"></div><div class="board"></div><div class="list"><div class="row" data-item="first"></div><div class="row" data-item="second"></div><div class="row" data-item="far-below"></div></div>';
    const rect = (sel: string, r: Partial<DOMRect>) => vi.spyOn(document.querySelector(sel)!, 'getBoundingClientRect').mockReturnValue(r as DOMRect);
    rect('.board-head', { left: 0, bottom: 170.3 });
    rect('[data-item="first"]', { left: 0, top: 170.3, bottom: 214.3 });
    rect('[data-item="second"]', { left: 0, top: 214.3, bottom: 258.3 });
    rect('[data-item="far-below"]', { left: 0, top: 5000, bottom: 5044 });
    const off = await import('../../src/ui/dragLog');
    off.dragOverlay();
    expect(document.querySelector('.drag-overlay')).toBeNull(); // nothing without #debug
    vi.resetModules();
    location.hash = '#debug';
    const m = await import('../../src/ui/dragLog');
    m.dragOverlay();
    m.dragOverlay(); // once
    await new Promise((r) => setTimeout(r, 60));
    expect(document.querySelectorAll('.drag-overlay')).toHaveLength(1);
    const tags = [...document.querySelectorAll<HTMLElement>('.drag-overlay b')].map((b) => [b.textContent, b.style.top]);
    expect(tags[0]![0]).toMatch(/^header ends 170\.3 · page scroll 0 · inner 0$/);
    expect(tags.slice(1)).toEqual([['first 170.3', '171.3px'], ['second 214.3', '215.3px']]); // rows out of the window get no tag
    expect((document.querySelector('.drag-overlay .line') as HTMLElement).style.top).toBe('170.3px');
  });
});
