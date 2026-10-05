// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, type Host } from '../../src/ui/App';
import { validatePlan } from '../../src/engine';
import { SAMPLES } from '../../src/io/samples';

const today = '2026-10-05';
const sample = () => validatePlan(SAMPLES[0]!.build(today), { today }).plan;

function mount(host: Partial<Host> = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const changes: unknown[] = [];
  const h: Host = {
    mode: 'web',
    save: vi.fn(async () => 'saved' as const),
    copy: vi.fn(async () => true),
    baseUrl: () => 'https://example.test/',
    onChange: (plan) => changes.push(plan),
    ...host,
  };
  act(() => render(<App host={h} initialPlan={sample()} today={today} />, root));
  return { root, host: h, changes };
}
const text = (root: Element, sel: string) => root.querySelector(sel)?.textContent ?? '';
const button = (root: Element, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label))!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('app (web and widget share it)', () => {
  it('renders the plan: headline, rows, bars and status pills', () => {
    const { root, changes } = mount();
    expect(text(root, '.headline')).toMatch(/1 of 6 deadlines late even as planned/);
    expect(root.querySelectorAll('.row')).toHaveLength(7);
    expect(root.querySelectorAll('.bar').length).toBeGreaterThanOrEqual(7);
    expect(text(root, '.row:nth-child(4) .status')).toBe('late');
    expect(changes).toHaveLength(1); // the host hears about the initial plan (the widget syncs it)
  });

  it('switching the lens re-dates the plan but never changes the input', async () => {
    const { root, changes } = mount();
    await act(() => button(root, 'Likely').click());
    expect(text(root, '.headline')).toMatch(/Likely 1\.6×: /);
    expect(root.querySelectorAll('.plan-ghost').length).toBeGreaterThan(0);
    expect(JSON.stringify(changes.at(-1))).toBe(JSON.stringify(changes[0]));
  });

  it('applying a suggestion changes the plan, and undo restores it', async () => {
    const { root, changes } = mount();
    await act(() => new Promise((r) => setTimeout(r, 250))); // insights settle
    const first = root.querySelector('.insight b')!.textContent!;
    expect(first).toMatch(/Quick fix for Acme/);
    await act(() => (root.querySelector('.insight button') as HTMLButtonElement).click());
    expect(text(root, '.headline')).toMatch(/^2 deadlines late|^4 tight|^\d+ tight|^1 of 6/);
    expect(changes.length).toBe(2);
    await act(() => (root.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click());
    expect(JSON.stringify(changes.at(-1))).toBe(JSON.stringify(changes[0]));
  });

  it('exports through the host and copies a link with the plan inside', async () => {
    const { root, host } = mount();
    await act(() => button(root, 'Export').click());
    await act(() => button(document.body, 'Save plan').click());
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(host.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'client-deliverables.whenship.yaml', mime: 'application/yaml' }));
    await act(() => button(root, 'Copy link').click());
    expect(host.copy).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/example\.test\/#p=/));
  });

  it('turning a working day off moves dates', async () => {
    const { root } = mount();
    const before = text(root, '.headline');
    await act(() => (root.querySelector('[title^="Friday"]') as HTMLButtonElement).click());
    expect(text(root, '.headline')).not.toBe(before);
    expect(root.querySelector('[title^="Friday"]')!.getAttribute('aria-pressed')).toBe('false');
  });
});
