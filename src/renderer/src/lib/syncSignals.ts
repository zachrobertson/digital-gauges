import type { TelemetryField, TelemetryFrame, TelemetryTrack } from '@shared/types';
import { sampleAt } from './telemetry';

const STEP_MS = 500;

/** Scalar fields suitable for 1D sync waveforms — stable display order. */
export const SYNC_PLOT_FIELDS: TelemetryField[] = [
  'speed',
  'power',
  'hr',
  'cadence',
  'alt',
  'temp',
  'grade',
  'distance',
  'leanAngle',
];

export const FIELD_COLORS: Record<TelemetryField, string> = {
  speed: '#60a5fa',
  power: '#f59e0b',
  hr: '#ef4444',
  cadence: '#10b981',
  alt: '#a78bfa',
  temp: '#f472b6',
  grade: '#eab308',
  distance: '#38bdf8',
  distanceToFinish: '#22d3ee',
  leanAngle: '#fb923c',
  accelX: '#94a3b8',
  accelY: '#64748b',
  accelZ: '#475569',
  gyroX: '#cbd5e1',
  gyroY: '#94a3b8',
  gyroZ: '#64748b',
  lat: '#94a3b8',
  lon: '#94a3b8',
};

export interface SignalSeries {
  field: TelemetryField;
  label: string;
  color: string;
  stepMs: number;
  /** Timeline ms at index 0 — values[i] is the sample at startMs + i * stepMs. */
  startMs: number;
  values: (number | null)[];
}

function resample(
  track: TelemetryTrack,
  startMs: number,
  endMs: number,
  offsetMs: number,
  read: (frame: TelemetryFrame | null) => number | null,
): (number | null)[] {
  if (endMs <= startMs) return [];
  const n = Math.max(1, Math.ceil((endMs - startMs) / STEP_MS) + 1);
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const videoT = startMs + i * STEP_MS;
    const f = sampleAt(track, videoT - offsetMs);
    out[i] = read(f);
  }
  return out;
}

function readField(frame: TelemetryFrame | null, field: TelemetryField): number | null {
  if (!frame) return null;
  const v = frame[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * One normalized waveform per sync-friendly scalar field present on the track.
 * Samples the timeline in `[startMs, endMs]` at a fixed step; `offsetMs` is the
 * timeline position where the track's t=0 sits (so the track is read at
 * `videoT − offsetMs`).
 */
export function trackSyncSignals(
  track: TelemetryTrack,
  startMs: number,
  endMs: number,
  offsetMs: number,
): SignalSeries[] {
  const fields = SYNC_PLOT_FIELDS.filter((f) => track.fields.includes(f));
  return fields.map((field) => ({
    field,
    label: field,
    color: FIELD_COLORS[field],
    stepMs: STEP_MS,
    startMs,
    values: resample(track, startMs, endMs, offsetMs, (f) => readField(f, field)),
  }));
}

export function normalizeSeries(values: (number | null)[]): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (!Number.isFinite(min) || max - min < 1e-9) {
    return values.map((v) => (v === null ? 0 : 0.5));
  }
  return values.map((v) => (v === null ? 0 : (v - min) / (max - min)));
}

export function formatFieldValue(field: TelemetryField, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  switch (field) {
    case 'speed': return `${(v * 3.6).toFixed(1)} km/h`;
    case 'power': return `${Math.round(v)} W`;
    case 'hr': return `${Math.round(v)} bpm`;
    case 'cadence': return `${Math.round(v)} rpm`;
    case 'alt': return `${Math.round(v)} m`;
    case 'temp': return `${v.toFixed(1)} °C`;
    case 'grade': return `${(v * 100).toFixed(1)}%`;
    case 'distance': return `${(v / 1000).toFixed(2)} km`;
    case 'distanceToFinish': return `${(v / 1000).toFixed(2)} km`;
    case 'leanAngle': return `${((v * 180) / Math.PI).toFixed(1)}°`;
    default: return v.toFixed(2);
  }
}
