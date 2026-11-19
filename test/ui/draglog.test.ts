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
});
