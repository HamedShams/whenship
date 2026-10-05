import { useCallback, useRef, useState } from 'preact/hooks';
import type { NormalizedPlan } from '../engine/types';

interface History {
  plan: NormalizedPlan;
  past: NormalizedPlan[];
  future: NormalizedPlan[];
}

/**
 * The plan plus undo/redo. Rapid edits to the same field (typing, steppers) merge into one undo step.
 */
export function usePlanHistory(initial: NormalizedPlan) {
  const [h, setH] = useState<History>({ plan: initial, past: [], future: [] });
  const last = useRef<{ key: string; at: number } | null>(null);

  const commit = useCallback((next: NormalizedPlan, mergeKey?: string) => {
    const now = Date.now();
    const merge = !!mergeKey && last.current?.key === mergeKey && now - last.current.at < 1500;
    last.current = mergeKey ? { key: mergeKey, at: now } : null;
    setH((prev) => (next === prev.plan ? prev : { plan: next, past: merge ? prev.past : [...prev.past.slice(-99), prev.plan], future: [] }));
  }, []);

  /** Replaces the plan without an undo step (loading, syncing from the host). */
  const reset = useCallback((next: NormalizedPlan) => {
    last.current = null;
    setH({ plan: next, past: [], future: [] });
  }, []);

  const undo = useCallback(() => {
    last.current = null;
    setH((prev) => (prev.past.length ? { plan: prev.past[prev.past.length - 1]!, past: prev.past.slice(0, -1), future: [prev.plan, ...prev.future] } : prev));
  }, []);

  const redo = useCallback(() => {
    last.current = null;
    setH((prev) => (prev.future.length ? { plan: prev.future[0]!, past: [...prev.past, prev.plan], future: prev.future.slice(1) } : prev));
  }, []);

  return { plan: h.plan, commit, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}
