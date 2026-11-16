/**
 * How the chart is shown, apart from the plan itself: the timeline zoom. Like the lens, it travels in share links and is
 * remembered by the browser, but never goes into the plan file.
 *
 * `fit` (the default) sizes days so the whole plan fits the width the chart has, between a readable minimum and a
 * comfortable maximum; past the minimum the chart scrolls. The others are fixed scales.
 */
export type Zoom = 'fit' | 'day' | 'week' | 'month';

/** Pixels per calendar day for each fixed zoom level (the chart, and images exported from it). */
export const ZOOM_PPD: Record<Exclude<Zoom, 'fit'>, number> = { day: 26, week: 10, month: 4 };

/**
 * Fit means fit: a day can shrink to a pixel before the chart scrolls (the header then shows months only, and the fixed
 * scales are a menu away). It never stretches a day beyond the day scale.
 */
export const FIT_MIN_PPD = 1;
export const FIT_MAX_PPD = ZOOM_PPD.day;

/**
 * Pixels per day that fit `span` calendar days into `width` pixels, within the bounds. Tenths of a pixel, not whole
 * pixels: rounding a 160-day plan down to whole pixels a day would leave up to 160 px of the width unused.
 */
export function fitPpd(span: number, width: number): number {
  if (!(width > 0) || !(span > 0)) return FIT_MAX_PPD;
  return Math.max(FIT_MIN_PPD, Math.min(FIT_MAX_PPD, Math.floor((width / span) * 10) / 10));
}

export function ppdFor(zoom: Zoom, span: number, width: number): number {
  return zoom === 'fit' ? fitPpd(span, width) : ZOOM_PPD[zoom];
}

export function toZoom(v: unknown): Zoom | undefined {
  return v === 'fit' || v === 'day' || v === 'week' || v === 'month' ? v : undefined;
}
