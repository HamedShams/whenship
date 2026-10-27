import { schedule, type Schedule } from './schedule';
import type { NormalizedPlan } from './types';

/**
 * Forecast lenses: "what if every piece of work takes k× as long as estimated".
 *
 * Two outside-view multipliers: 1.6× (P50, half of comparable work is done by then) and 3.1× (P90, nine in ten).
 * They come from a blended heuristic: Todd Little's 2006 lognormal model of software estimation error combined with
 * Flyvbjerg et al.'s 2022 power-law findings on IT project overruns, sanity-checked by simple/geometric averaging and a
 * 50/50 Monte Carlo mixture. Practical, generic rules of thumb, not a formal industry standard.
 */
export type LensId = 'planned' | 'likely' | 'safe';

export interface Lens {
  id: LensId;
  label: string;
  factor: number;
  /** Share of comparable work that finishes within this factor (null for the user's own estimate). */
  percentile: number | null;
  short: string;
  blurb: string;
}

export const LENSES: readonly Lens[] = [
  { id: 'planned', label: 'As planned', factor: 1, percentile: null, short: '1×', blurb: 'Exactly what you entered: if everything goes to plan.' },
  { id: 'likely', label: 'Likely', factor: 1.6, percentile: 0.5, short: '1.6×', blurb: 'How it usually goes: about half of projects are done by here.' },
  { id: 'safe', label: 'Safe bet', factor: 3.1, percentile: 0.9, short: '3.1×', blurb: 'A date you can promise: about 9 in 10 projects are done by here.' },
];

/** The two anchors of the overrun curve: P50 at 1.6×, P90 at 3.1×. */
export const P50 = 1.6;
export const P90 = 3.1;

export const METHOD_NOTE =
  'People underestimate, so whenship can show how your plan looks when work runs long the way it usually does. ' +
  'The multipliers (1.6× likely: about half of projects are done by then; 3.1× safe bet: about 9 in 10) are a blended ' +
  "outside-view heuristic: Todd Little's 2006 lognormal model of software estimation error, combined with Flyvbjerg et " +
  "al.'s 2022 power-law findings on IT project overruns, sanity-checked by simple/geometric averaging and a 50/50 Monte " +
  'Carlo mixture. They are practical, generic rules of thumb, not a formal industry standard. Your own track record beats them.';

/** The same method in two sentences, for the chart's lens guide (the README and the connector carry the long form). */
export const METHOD_SHORT =
  "A blended outside-view heuristic: Todd Little's 2006 lognormal model of software estimation error, combined with " +
  "Flyvbjerg et al.'s 2022 power-law findings on IT project overruns. A practical rule of thumb, not an industry " +
  'standard; your own track record beats it.';

export function lensById(id: string | undefined): Lens {
  return LENSES.find((l) => l.id === toLensId(id)) ?? LENSES[0]!;
}

/** Reads a lens name, including ones from older versions ("worst" became the 3.1× safe bet). */
export function toLensId(id: unknown): LensId | undefined {
  if (id === 'planned' || id === 'likely' || id === 'safe') return id;
  if (id === 'worst') return 'safe';
  return undefined;
}

// ── normal distribution helpers ───────────────────────────────────────────
function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 (max error 1.5e-7)
  const s = Math.sign(x);
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
}
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

const Z90 = 1.2815516; // standard normal quantile of 0.9
const SIGMA = Math.log(P90 / P50) / Z90;

/**
 * P(actual / estimate ≤ k): a lognormal curve through the two anchors (cdf(1.6) = 0.5, cdf(3.1) = 0.9). It also matches
 * the rest of the blended table closely (P80 ≈ 2.5×, P95 ≈ 3.7×) and gives cdf(1) ≈ 0.18: about 1 plan in 5 finishes
 * as estimated.
 */
export function overrunCdf(k: number): number {
  if (!(k > 0)) return 0;
  return normalCdf(Math.log(k / P50) / SIGMA);
}

// ── deadline outlook ──────────────────────────────────────────────────────
export type Badge = 'safe' | 'likely' | 'tight' | 'late' | 'unknown';

export interface Outlook {
  badge: Badge;
  /** P(on time) assuming the whole plan runs long or short together, from the overrun curve. */
  chance?: number;
  /** Largest overrun factor at which the item still meets its deadline. */
  survives?: number;
}

// a grid of overrun factors (it must contain 1, P50 and P90) for finding where each deadline breaks
const SWEEP = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.45, 1.6, 1.8, 2, 2.25, 2.5, 2.8, 3.1, 3.5, 4, 4.5, 5.5, 7];

/**
 * For every dated item: which lens it survives (badge) and an approximate chance of being on time.
 * Runs the scheduler at a sweep of factors (fast: plans are small).
 */
export function deadlineOutlook(plan: NormalizedPlan, base?: Schedule): Map<string, Outlook> {
  const out = new Map<string, Outlook>();
  const dated = plan.items.filter((it) => it.deadline);
  if (!dated.length) return out;
  const runs = SWEEP.map((f) => (f === 1 && base && base.factor === 1 ? base : schedule(plan, { factor: f })));
  for (const it of dated) {
    const lateAt = (i: number): boolean | null => {
      const r = runs[i]!.byId.get(it.id)!;
      return r.status !== 'scheduled' || r.end === undefined ? null : r.late === true;
    };
    if (lateAt(SWEEP.indexOf(1)) === null) {
      out.set(it.id, { badge: 'unknown' });
      continue;
    }
    let lastOk = -1;
    for (let i = 0; i < SWEEP.length; i++) {
      if (lateAt(i) !== false) break;
      lastOk = i;
    }
    const isLate = (f: number) => lateAt(SWEEP.indexOf(f)) !== false;
    const badge: Badge = isLate(1) ? 'late' : isLate(P50) ? 'tight' : isLate(P90) ? 'likely' : 'safe';
    const survives = lastOk < 0 ? 0 : SWEEP[lastOk]!;
    // the true break-even factor lies between the last on-time and the first late factor: use their geometric middle
    const next = SWEEP[lastOk + 1];
    const chance = lastOk < 0 ? overrunCdf(SWEEP[0]! / 1.25) : next === undefined ? overrunCdf(survives) : overrunCdf(Math.sqrt(survives * next));
    out.set(it.id, { badge, survives, chance });
  }
  return out;
}

