/**
 * Turn camera GPS samples into a video start time, and sanity-check the
 * resulting FIT offset by comparing camera GPS speed with FIT speed.
 */
import type { CameraGpsSample } from './types/gps';
import type { TelemetryTrack } from './types/telemetry';

/** Minimum fixed samples needed before we trust an estimate. */
export const MIN_FIX_SAMPLES = 3;

export interface VideoStartEstimate {
  /** UTC epoch ms of source video t=0. */
  videoStartUtcMs: number;
  fixSamples: number;
  /** p90 − p10 of per-sample estimates, ms. */
  spreadMs: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Each fixed sample says "video t=videoMs happened at utcMs", so each one gives
 * an estimate of the video start: utcMs − videoMs. The median is robust to the
 * odd bad timestamp (e.g. before the receiver's clock settles).
 */
export function estimateVideoStartUtc(samples: CameraGpsSample[]): VideoStartEstimate | null {
  const estimates = samples
    .filter((s) => s.fix >= 2 && Number.isFinite(s.utcMs) && s.utcMs > 0 && Number.isFinite(s.videoMs))
    .map((s) => s.utcMs - s.videoMs)
    .sort((a, b) => a - b);
  if (estimates.length < MIN_FIX_SAMPLES) return null;
  return {
    videoStartUtcMs: Math.round(quantile(estimates, 0.5)),
    fixSamples: estimates.length,
    spreadMs: Math.round(quantile(estimates, 0.9) - quantile(estimates, 0.1)),
  };
}

export interface SpeedCrossCheck {
  /** Shift (ms) that best matches camera speed to FIT speed; ~0 means the GPS offset agrees. */
  bestLagMs: number;
  /** Mean |camera − FIT| speed (m/s) at the GPS offset. */
  errorAtOffset: number;
  /** Mean |camera − FIT| speed (m/s) at the best lag. */
  errorAtBest: number;
  /** Camera samples compared. */
  comparedSamples: number;
}

/** Largest index with frames[i].offsetMs <= t, or -1. */
function fitIndexAt(track: TelemetryTrack, t: number): number {
  const f = track.frames;
  if (f.length === 0 || t < f[0]!.offsetMs) return -1;
  let lo = 0;
  let hi = f.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (f[mid]!.offsetMs <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** FIT speed at ride time t, linearly interpolated (1 Hz steps would bias the lag by up to 1 s). */
function fitSpeedAt(track: TelemetryTrack, t: number): number | undefined {
  const f = track.frames;
  const i = fitIndexAt(track, t);
  if (i < 0 || t > f[f.length - 1]!.offsetMs) return undefined;
  const a = f[i]!;
  const va = a.speed;
  if (typeof va !== 'number' || !Number.isFinite(va)) return undefined;
  const b = f[i + 1];
  const vb = b?.speed;
  if (!b || typeof vb !== 'number' || !Number.isFinite(vb) || b.offsetMs === a.offsetMs) return va;
  return va + ((vb - va) * (t - a.offsetMs)) / (b.offsetMs - a.offsetMs);
}

/**
 * Compare camera GPS speed with FIT speed for lags in ±`searchMs` around the
 * offset (FIT is read at videoMs − offsetMs − lag). Returns null when there
 * isn't enough overlapping, moving data to say anything.
 */
export function speedCrossCheck(
  samples: CameraGpsSample[],
  fitTrack: TelemetryTrack,
  offsetMs: number,
  searchMs = 30_000,
  stepMs = 250,
): SpeedCrossCheck | null {
  if (!fitTrack.fields.includes('speed')) return null;

  // Thin to ~1 Hz: plenty for a speed profile and keeps the search cheap.
  const cam: CameraGpsSample[] = [];
  let lastMs = -Infinity;
  for (const s of samples) {
    if (s.fix < 2 || s.speed === undefined || !Number.isFinite(s.speed)) continue;
    if (s.videoMs - lastMs < 1000) continue;
    cam.push(s);
    lastMs = s.videoMs;
  }
  if (cam.length < 10) return null;

  // A flat speed profile (standing still) can't confirm anything.
  const speeds = cam.map((s) => s.speed!);
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const variance = speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length;
  if (Math.sqrt(variance) < 0.5) return null;

  const errorAt = (lag: number): { err: number; n: number } => {
    let sum = 0;
    let n = 0;
    for (const s of cam) {
      const fit = fitSpeedAt(fitTrack, s.videoMs - offsetMs - lag);
      if (fit === undefined) continue;
      sum += Math.abs(s.speed! - fit);
      n++;
    }
    return { err: n > 0 ? sum / n : Infinity, n };
  };

  const atOffset = errorAt(0);
  if (atOffset.n < 10) return null;

  let best = { lag: 0, err: atOffset.err };
  for (let lag = -searchMs; lag <= searchMs; lag += stepMs) {
    const { err, n } = errorAt(lag);
    if (n >= Math.max(10, atOffset.n * 0.5) && err < best.err) best = { lag, err };
  }

  return {
    bestLagMs: best.lag,
    errorAtOffset: atOffset.err,
    errorAtBest: best.err,
    comparedSamples: atOffset.n,
  };
}

/** Warnings to show the user for a cross-check result. */
export function crossCheckWarnings(check: SpeedCrossCheck | null): string[] {
  if (!check) {
    return ['Speed cross-check skipped: not enough overlapping movement between camera GPS and the FIT file.'];
  }
  const lagS = (check.bestLagMs / 1000).toFixed(1);
  // Only flag when moving the offset makes a real difference to the match.
  if (Math.abs(check.bestLagMs) >= 2000 && check.errorAtBest < check.errorAtOffset * 0.7) {
    return [
      `Speed cross-check disagrees: FIT speed matches camera GPS best ${lagS}s away from the GPS offset. `
      + 'Check the alignment visually.',
    ];
  }
  return [];
}
