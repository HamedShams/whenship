import { schedule, type Schedule } from './schedule';
import type { NormalizedPlan } from './types';

/**
 * Forecast lenses: "what if every piece of work takes k× as long as estimated".
 *
 * The multipliers are a blended outside-view heuristic: Todd Little's 2006 lognormal model of software estimation
 * error combined with Flyvbjerg et al.'s 2022 power-law findings on IT project overruns, with the midpoint
 * sanity-checked by simple/geometric averaging and a 50/50 Monte Carlo mixture. They are practical, generic rules of
 * thumb for converting an initial estimate into confidence-based forecasts, not a formal industry standard.
 */
export type LensId = 'planned' | 'likely' | 'safe' | 'worst';

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
  { id: 'safe', label: 'Safe bet', factor: 2.7, percentile: 0.85, short: '2.7×', blurb: 'A date you can promise: about 85 in 100 projects are done by here.' },
  { id: 'worst', label: 'Worst case', factor: 3.9, percentile: 0.95, short: '3.9×', blurb: 'When things go badly: only 1 in 20 projects run longer.' },
];

/** The full blended table (P50 … P95), for pros and for the chance calculation. */
export const OVERRUN_TABLE: readonly { p: number; factor: number }[] = [
  { p: 0.5, factor: 1.6 },
  { p: 0.8, factor: 2.5 },
  { p: 0.85, factor: 2.7 },
  { p: 0.9, factor: 3.1 },
  { p: 0.95, factor: 3.9 },
];

export const METHOD_NOTE =
  'People underestimate, so whenship can show how your plan looks when work runs long the way it usually does. ' +
  'The multipliers (1.6× likely, 2.5× P80, 2.7× safe, 3.1× P90, 3.9× worst case) are a blended outside-view heuristic: ' +
  "Todd Little's 2006 lognormal model of software estimation error, combined with Flyvbjerg et al.'s 2022 power-law " +
  'findings on IT project overruns, with the midpoint sanity-checked by simple/geometric averaging and a 50/50 Monte Carlo ' +
  'mixture. They are practical, generic rules of thumb, not a formal industry standard. Your own track record beats them.';

export function lensById(id: string | undefined): Lens {
  return LENSES.find((l) => l.id === id) ?? LENSES[0]!;
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
function normalInv(p: number): number {
  // Acklam's rational approximation
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

const KNOTS = OVERRUN_TABLE.map((row) => ({ z: normalInv(row.p), ln: Math.log(row.factor) }));

/**
 * P(actual / estimate ≤ k) under the blended table: log-linear between the table's quantiles in probit space,
 * extending the first and last segments outward. Exact at every table point (e.g. cdf(2.7) = 0.85).
 */
export function overrunCdf(k: number): number {
  if (!(k > 0)) return 0;
  const ln = Math.log(k);
  let lo = KNOTS[0]!, hi = KNOTS[1]!;
  if (ln >= KNOTS[KNOTS.length - 1]!.ln) {
    lo = KNOTS[KNOTS.length - 2]!;
    hi = KNOTS[KNOTS.length - 1]!;
  } else {
    for (let i = 1; i < KNOTS.length; i++) {
      if (ln <= KNOTS[i]!.ln) {
        lo = KNOTS[i - 1]!;
        hi = KNOTS[i]!;
        break;
      }
    }
  }
  const z = lo.z + ((hi.z - lo.z) * (ln - lo.ln)) / (hi.ln - lo.ln);
  return normalCdf(z);
}

// ── deadline outlook ──────────────────────────────────────────────────────
export type Badge = 'safe' | 'likely' | 'tight' | 'late' | 'unknown';

export interface Outlook {
  badge: Badge;
  /** P(on time) assuming the whole plan runs long or short together, from the blended table. */
  chance?: number;
  /** Largest overrun factor at which the item still meets its deadline. */
  survives?: number;
}

const SWEEP = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.45, 1.6, 1.8, 2, 2.25, 2.5, 2.7, 2.9, 3.1, 3.5, 3.9, 4.5, 5.5, 7];

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
    const badge: Badge = isLate(1) ? 'late' : isLate(1.6) ? 'tight' : isLate(2.7) ? 'likely' : 'safe';
    const survives = lastOk < 0 ? 0 : SWEEP[lastOk]!;
    // the true break-even factor lies between the last on-time and the first late factor: use their geometric middle
    const next = SWEEP[lastOk + 1];
    const chance = lastOk < 0 ? overrunCdf(SWEEP[0]! / 1.25) : next === undefined ? overrunCdf(survives) : overrunCdf(Math.sqrt(survives * next));
    out.set(it.id, { badge, survives, chance });
  }
  return out;
}

export function lensSchedule(plan: NormalizedPlan, lens: LensId): Schedule {
  return schedule(plan, { factor: lensById(lens).factor });
}
