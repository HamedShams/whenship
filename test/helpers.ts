import { validatePlan, type NormalizedPlan, type PlanInput } from '../src/engine';

/** Validates a test plan and fails loudly on any error. */
export function plan(p: PlanInput): NormalizedPlan {
  const { plan: out, errors } = validatePlan({ start: '2026-09-24', lanes: [], ...p }, { today: '2026-09-24' });
  if (errors.length) throw new Error(`invalid test plan: ${JSON.stringify(errors)}`);
  return out;
}

/** A tiny deterministic RNG (LCG) for property tests. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
