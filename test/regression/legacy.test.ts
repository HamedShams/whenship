import { describe, expect, it } from 'vitest';
import { schedule, validatePlan } from '../../src/engine';
import { rng } from '../helpers';

/**
 * A faithful port of the 2025 gantt_resource_planner scheduler (templates/index.html → redraw), kept as an oracle.
 * Squads have Back-End and Front-End engineers with a capacity %, items have effort in weeks and a max-parallel cap.
 */
function legacyEnds(cfg: { be: number; fe: number; effB: number; effF: number; items: { be: number; fe: number; cb: number; cf: number }[] }): number[] {
  const tasks = cfg.items.map((p) => ({ beRem: p.be * 5, feRem: p.fe * 5, capB: p.cb, capF: p.cf, end: -1 }));
  for (let d = 0; tasks.some((t) => t.beRem > 1e-9 || t.feRem > 1e-9); d++) {
    if (d > 5000) throw new Error('legacy engine did not finish');
    let freeB = cfg.be, freeF = cfg.fe;
    for (const t of tasks) {
      const takeB = Math.min(t.capB, t.beRem > 1e-9 ? freeB : 0);
      const takeF = Math.min(t.capF, t.feRem > 1e-9 ? freeF : 0);
      t.beRem -= takeB * (cfg.effB / 100);
      t.feRem -= takeF * (cfg.effF / 100);
      freeB -= takeB;
      freeF -= takeF;
    }
    for (const t of tasks) if (t.end < 0 && t.beRem <= 1e-9 && t.feRem <= 1e-9) t.end = d;
  }
  return tasks.map((t) => t.end);
}

function whenshipEnds(cfg: Parameters<typeof legacyEnds>[0]): number[] {
  const { plan, errors } = validatePlan(
    {
      start: '2026-09-07', // a Monday, so working-day indices line up with the legacy day counter
      lanes: [
        { id: 'be', name: 'Back-End', kind: 'team', size: cfg.be, availability: cfg.effB },
        { id: 'fe', name: 'Front-End', kind: 'team', size: cfg.fe, availability: cfg.effF },
      ],
      items: cfg.items.map((p, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        work: [
          ...(p.be > 0 ? [{ lane: 'be', days: p.be * 5, maxPeople: p.cb }] : []),
          ...(p.fe > 0 ? [{ lane: 'fe', days: p.fe * 5, maxPeople: p.cf }] : []),
        ],
      })),
    },
    { today: '2026-09-07' },
  );
  expect(errors).toEqual([]);
  return schedule(plan).items.map((r) => r.end ?? -1);
}

describe('regression against the 2025 engine', () => {
  it('reproduces the original sample squads (Alpha, Bravo) within the tail-waste fix', () => {
    const alpha = {
      be: 3, fe: 1.5, effB: 75, effF: 70,
      items: [
        { be: 0.6, fe: 1.2, cb: 1, cf: 1 },
        { be: 1.6, fe: 0.3, cb: 2, cf: 1 },
        { be: 0.7, fe: 0.7, cb: 1, cf: 1 },
        { be: 0.3, fe: 0.3, cb: 1, cf: 1 },
        { be: 0.1, fe: 1, cb: 1, cf: 1 },
      ],
    };
    const bravo = {
      be: 2.8, fe: 1.2, effB: 80, effF: 80,
      items: [
        { be: 2, fe: 0.6, cb: 2, cf: 1 },
        { be: 0.2, fe: 0.8, cb: 1, cf: 1 },
        { be: 1.2, fe: 0.2, cb: 1, cf: 1 },
        { be: 1, fe: 1, cb: 1, cf: 1 },
        { be: 3, fe: 3, cb: 2, cf: 1 },
      ],
    };
    for (const squad of [alpha, bravo]) {
      const old = legacyEnds(squad);
      const now = whenshipEnds(squad);
      now.forEach((end, i) => expect(end).toBeLessThanOrEqual(old[i]!));
      expect(Math.max(...now)).toBeGreaterThanOrEqual(Math.floor(Math.max(...old) * 0.85)); // the bug-#15 fix may finish a little earlier
    }
  });

  it('is never later than the old engine on 300 random squads, and equal when there is no tail waste', () => {
    const r = rng(2025);
    let equal = 0;
    for (let n = 0; n < 300; n++) {
      const integer = n % 3 === 0; // whole engineers at 100 % and whole-day efforts: no tail waste possible
      const cfg = {
        be: integer ? 1 + Math.floor(r() * 4) : Math.round((0.5 + r() * 4) * 10) / 10,
        fe: integer ? 1 + Math.floor(r() * 3) : Math.round((0.5 + r() * 3) * 10) / 10,
        effB: integer ? 100 : 50 + Math.floor(r() * 50),
        effF: integer ? 100 : 50 + Math.floor(r() * 50),
        items: Array.from({ length: 2 + Math.floor(r() * 8) }, () => ({
          be: integer ? Math.floor(r() * 4) : Math.round(r() * 30) / 10,
          fe: integer ? Math.floor(r() * 3) : Math.round(r() * 20) / 10,
          cb: integer ? 1 : 1 + Math.floor(r() * 2),
          cf: 1,
        })).filter((p) => p.be > 0 || p.fe > 0),
      };
      if (!cfg.items.length) continue;
      const old = legacyEnds(cfg);
      const now = whenshipEnds(cfg);
      now.forEach((end, i) => expect(end).toBeLessThanOrEqual(old[i]!));
      if (integer) {
        expect(now).toEqual(old);
        equal++;
      }
    }
    expect(equal).toBeGreaterThan(90);
  });
});
