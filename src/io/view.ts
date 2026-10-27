/**
 * How the chart is shown, apart from the plan itself: the timeline zoom. Like the lens, it travels in share links and is
 * remembered by the browser, but never goes into the plan file.
 */
export type Zoom = 'day' | 'week' | 'month';

/** Pixels per calendar day for each zoom level (the chart, and images exported from it). */
export const ZOOM_PPD: Record<Zoom, number> = { day: 26, week: 10, month: 4 };

export function toZoom(v: unknown): Zoom | undefined {
  return v === 'day' || v === 'week' || v === 'month' ? v : undefined;
}
