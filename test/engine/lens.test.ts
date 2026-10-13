import { describe, expect, it } from 'vitest';
import { LENSES, OVERRUN_TABLE, analyze, deadlineOutlook, headline, overrunCdf, schedule, validatePlan } from '../../src/engine';
import { plan } from '../helpers';

describe('forecast lenses', () => {
  it('use the blended multipliers 1× / 1.6× / 2.7× / 3.9×', () => {
    expect(LENSES.map((l) => [l.id, l.factor])).toEqual([
      ['planned', 1],
      ['likely', 1.6],
      ['safe', 2.7],
      ['worst', 3.9],
    ]);
    expect(OVERRUN_TABLE.map((r) => r.factor)).toEqual([1.6, 2.5, 2.7, 3.1, 3.9]);
  });

  it('reproduce the table exactly as a distribution', () => {
    for (const row of OVERRUN_TABLE) expect(overrunCdf(row.factor)).toBeCloseTo(row.p, 3);
  });

  it('give a smooth, increasing chance curve', () => {
    let prev = 0;
    for (let k = 0.3; k <= 8; k += 0.05) {
      const c = overrunCdf(k);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
    expect(overrunCdf(1)).toBeGreaterThan(0.15);
    expect(overrunCdf(1)).toBeLessThan(0.22); // by this heuristic, ~1 plan in 5 finishes as estimated
    expect(overrunCdf(100)).toBeLessThanOrEqual(1);
  });
});

describe('deadline outlook', () => {
  // Sara alone: 5 days of work starting Thu 24 Sep (ends Wed 30 Sep as planned).
  const make = (deadline: string) =>
    plan({ lanes: ['Sara'], items: [{ name: 'Work', who: 'Sara', days: 5, deadline }] });
  const badge = (deadline: string) => deadlineOutlook(make(deadline)).get('work')!;

  it('labels each deadline by how much slip it survives', () => {
    expect(badge('2026-09-29').badge).toBe('late'); // late even as planned
    expect(badge('2026-09-30').badge).toBe('tight'); // only if all goes to plan
    expect(badge('2026-10-06').badge).toBe('likely'); // survives 1.6× (8 days → Mon 5 Oct) but not 2.7×
    expect(badge('2026-10-15').badge).toBe('safe'); // survives 2.7× (13.5 days)
  });

  it('turns survival into an approximate chance', () => {
    const tight = badge('2026-09-30').chance!;
    const safe = badge('2026-10-15').chance!;
    expect(tight).toBeGreaterThan(0.1);
    expect(tight).toBeLessThan(0.3);
    expect(safe).toBeGreaterThan(0.85);
  });

  it('never changes the plan itself: "As planned" uses the entered estimates', () => {
    const a = analyze(make('2026-10-02'), 'planned');
    expect(a.current).toBe(a.planned);
    expect(a.current.byId.get('work')!.endDate).toBe('2026-09-30');
    const likely = analyze(make('2026-10-02'), 'likely');
    expect(likely.planned.byId.get('work')!.endDate).toBe('2026-09-30');
    expect(likely.current.byId.get('work')!.endDate).toBe('2026-10-05'); // 8 working days
  });

  it('summarises risk in one headline', () => {
    const p = plan({
      lanes: ['Sara'],
      items: [
        { name: 'A', who: 'Sara', days: 5, deadline: '2026-09-29' },
        { name: 'B', who: 'Sara', days: 1, deadline: '2026-12-31' },
      ],
    });
    expect(headline(analyze(p))).toBe('1 of 2 deadlines late even as planned · all done 1 Oct');
    expect(schedule(p).endDate).toBe('2026-10-01');
  });

  it('status follows the lens: a deadline the lens dates miss shows as late', () => {
    // Sara: A 4d (due Thu 1 Oct), B 2d (due Fri 9 Oct). As planned A ends Tue 29 Sep, B Thu 1 Oct.
    const p = plan({
      lanes: ['Sara'],
      items: [
        { name: 'A', who: 'Sara', days: 4, deadline: '2026-10-01' },
        { name: 'B', who: 'Sara', days: 2, deadline: '2026-10-09' },
      ],
    });
    const planned = analyze(p, 'planned');
    const worst = analyze(p, 'worst');
    // the outlook (how much slip it survives) doesn't depend on the lens…
    expect(worst.outlook.get('a')!.badge).toBe(planned.outlook.get('a')!.badge);
    expect(planned.status.get('a')).toBe(planned.outlook.get('a')!.badge);
    // …but the status shown under Worst case (3.9×) is late for every deadline its dates miss
    for (const id of ['a', 'b']) expect(worst.status.get(id)).toBe(worst.current.byId.get(id)!.late ? 'late' : worst.outlook.get(id)!.badge);
    expect(worst.status.get('a')).toBe('late');
    expect(planned.status.get('a')).not.toBe('late');
    expect(worst.counts.late).toBe([...worst.status.values()].filter((b) => b === 'late').length);
    expect(headline(worst)).toMatch(/^\d of 2 deadlines late if work takes 3\.9× as long/);
  });

  it('values stay out of everything while switched off', () => {
    const input = { start: '2026-09-24', currency: '€', lanes: ['Sara'], items: [{ name: 'A', who: 'Sara', days: 5, deadline: '2026-09-29', value: 100000 }] };
    const off = validatePlan(input, { today: '2026-09-24' });
    expect(off.plan.items[0]!.value).toBeUndefined();
    expect(off.plan.currency).toBeUndefined();
    expect(off.warnings.map((w) => w.message)).toContain('values (money at stake) are turned off for now; ignored');
    expect(headline(analyze(off.plan))).not.toMatch(/at risk/);
    // the dormant code still works when the switch is turned on
    const on = validatePlan(input, { today: '2026-09-24', features: { itemValue: true } });
    expect(headline(analyze(on.plan, 'planned', { itemValue: true }))).toBe('the deadline is late even as planned · 100k € at risk · all done 30 Sep');
  });
});
