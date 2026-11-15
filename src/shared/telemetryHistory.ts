/**
 * Stateless rolling-window statistics over telemetry tracks.
 *
 * Gauges only receive the single merged frame at the playhead. Anything that
 * needs history (e.g. "3s average power") is computed here directly from the
 * track, so the result depends only on the timeline position — identical in
 * live preview, while scrubbing, and in export.
 *
 * A window average is the mean of the samples whose timestamps fall in
 * (end - window, end] — the same definition bike computers use for "3s power".
 * Like the live value (`sampleAt`, sample-and-hold), it only changes when a
 * new sample arrives. If no sample falls in the window (a recording gap), the
 * most recent value is held.
 */
import type { TelemetryField, TelemetryTrack } from './types/telemetry';

interface FieldSeries {
  /** Sample times (track ms), ascending. */
  t: Float64Array;
  /** Field value at each sample. */
  v: Float64Array;
  /** Prefix sums: cum[i] = v[0] + … + v[i-1] (length n + 1). */
  cum: Float64Array;
}

/** Per-track, per-field series cache. Tracks are immutable once loaded. */
const seriesCache = new WeakMap<TelemetryTrack, Map<string, FieldSeries | null>>();

function seriesFor(track: TelemetryTrack, field: string): FieldSeries | null {
  let byField = seriesCache.get(track);
  if (!byField) {
    byField = new Map();
    seriesCache.set(track, byField);
  }
  const cached = byField.get(field);
  if (cached !== undefined) return cached;

  const ts: number[] = [];
  const vs: number[] = [];
  for (const frame of track.frames) {
    const x = frame[field];
    if (typeof x !== 'number' || !Number.isFinite(x)) continue;
    // Guard against duplicate/out-of-order timestamps: last value at a time wins.
    if (ts.length > 0 && frame.offsetMs <= ts[ts.length - 1]) {
      if (frame.offsetMs === ts[ts.length - 1]) vs[vs.length - 1] = x;
      continue;
    }
    ts.push(frame.offsetMs);
    vs.push(x);
  }

  if (ts.length === 0) {
    byField.set(field, null);
    return null;
  }

  const n = ts.length;
  const series: FieldSeries = {
    t: Float64Array.from(ts),
    v: Float64Array.from(vs),
    cum: new Float64Array(n + 1),
  };
  for (let i = 0; i < n; i++) {
    series.cum[i + 1] = series.cum[i] + series.v[i];
  }
  byField.set(field, series);
  return series;
}

/** Largest index with t[i] <= x, or -1 when x precedes the first sample. */
function indexAtOrBefore(t: Float64Array, x: number): number {
  if (x < t[0]) return -1;
  let lo = 0;
  let hi = t.length - 1;
  if (x >= t[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Mean of `field` over samples with timestamps in (endMs - windowMs, endMs],
 * in the track's own time base. Falls back to the held value at endMs when the
 * window contains no samples (windowMs <= 0, or a gap in the recording).
 * Returns undefined when the track has no value for `field` at or before endMs.
 */
export function trackWindowAverage(
  track: TelemetryTrack,
  field: string,
  endMs: number,
  windowMs: number,
): number | undefined {
  const s = seriesFor(track, field);
  if (!s || !Number.isFinite(endMs)) return undefined;
  const last = indexAtOrBefore(s.t, endMs);
  if (last < 0) return undefined;

  const w = Number.isFinite(windowMs) ? Math.max(0, windowMs) : 0;
  // First sample strictly after the window start.
  const first = indexAtOrBefore(s.t, endMs - w) + 1;
  if (first > last) return s.v[last];
  return (s.cum[last + 1] - s.cum[first]) / (last - first + 1);
}

/** Rolling-window access to telemetry around the current frame. */
export interface TelemetryHistory {
  /**
   * Mean of `field` over samples in the trailing `windowMs` of ride time
   * ending at the current frame. Returns undefined if no track has the field.
   */
  average(field: TelemetryField, windowMs: number): number | undefined;
}

/** A track and the track-local time that corresponds to the current frame. */
export interface TrackSamplePoint {
  track: TelemetryTrack;
  sampleMs: number;
}

/** History with no data — used when there is no timeline context (e.g. editor previews). */
export const EMPTY_TELEMETRY_HISTORY: TelemetryHistory = {
  average: () => undefined,
};

/**
 * Build a history view over tracks sampled at the given points. Points are in
 * merge order; like frame merging, later tracks win when several have the field.
 */
export function createTelemetryHistory(points: TrackSamplePoint[]): TelemetryHistory {
  if (points.length === 0) return EMPTY_TELEMETRY_HISTORY;
  return {
    average(field, windowMs) {
      for (let i = points.length - 1; i >= 0; i--) {
        const { track, sampleMs } = points[i];
        const avg = trackWindowAverage(track, field, sampleMs, windowMs);
        if (avg !== undefined) return avg;
      }
      return undefined;
    },
  };
}
