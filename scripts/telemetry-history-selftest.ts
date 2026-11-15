/**
 * Verifies rolling-window telemetry averages: window math, sparse and
 * irregular samples, track precedence, and that history lines up with the
 * merged frame through clip sync offsets (preview == export).
 *
 * Run: npx tsx --tsconfig tsconfig.web.json scripts/telemetry-history-selftest.ts
 */
import assert from 'node:assert/strict';
import type { Project, TelemetryTrack, TimelineClip } from '../src/shared/types';
import { createTelemetryHistory, trackWindowAverage } from '../src/shared/telemetryHistory';
import {
  frameAtClipLocalTime,
  frameAtGlobalTime,
  historyAtClipLocalTime,
  historyAtGlobalTime,
} from '../src/renderer/src/lib/telemetry';

function track(id: string, frames: TelemetryTrack['frames'], source: TelemetryTrack['source'] = 'fit'): TelemetryTrack {
  return {
    id,
    source,
    brand: 'test',
    startTime: '2026-01-01T00:00:00.000Z',
    fields: [...new Set(frames.flatMap((f) => Object.keys(f).filter((k) => k !== 'offsetMs')))],
    sampleRateHz: 1,
    frames,
    warnings: [],
  };
}

const near = (actual: number | undefined, expected: number, msg: string) => {
  assert.ok(actual !== undefined, `${msg}: got undefined`);
  assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: expected ${expected}, got ${actual}`);
};

// --- Window math (1 Hz) ---
const power = track('p', [
  { offsetMs: 0, power: 100 },
  { offsetMs: 1000, power: 200 },
  { offsetMs: 2000, power: 300 },
  { offsetMs: 3000, power: 400 },
]);
near(trackWindowAverage(power, 'power', 3000, 3000), 300, '3s window = last 3 samples (like a head unit)');
near(trackWindowAverage(power, 'power', 3500, 3000), 300, 'steps only when a new sample arrives');
near(trackWindowAverage(power, 'power', 2500, 1000), 300, 'one-sample window');
near(trackWindowAverage(power, 'power', 2500, 10_000), 200, 'window clipped to start of data');
near(trackWindowAverage(power, 'power', 1500, 0), 200, 'zero window = held value');
near(trackWindowAverage(power, 'power', 0, 3000), 100, 'at first sample');
near(trackWindowAverage(power, 'power', 9000, 1000), 400, 'gap past last sample holds last value');
assert.equal(trackWindowAverage(power, 'power', -1, 3000), undefined, 'before data');
assert.equal(trackWindowAverage(power, 'hr', 2000, 3000), undefined, 'missing field');

// --- Sparse rows and irregular sampling ---
const sparse = track('s', [
  { offsetMs: 0, hr: 100 },
  { offsetMs: 500, power: 999 },       // no hr: row is skipped for hr
  { offsetMs: 1000, hr: 120 },
  { offsetMs: 3000, hr: 160 },         // irregular gap (smart recording)
]);
near(trackWindowAverage(sparse, 'hr', 3000, 3000), (120 + 160) / 2, 'sparse rows ignored; window start is exclusive');
near(trackWindowAverage(sparse, 'hr', 2500, 1000), 120, 'gap inside window holds last value');

// --- Track precedence: later tracks win, earlier tracks fill gaps ---
const camera = track('cam', [{ offsetMs: 0, speed: 1 }, { offsetMs: 1000, speed: 1 }], 'gopro');
const fitSpeed = track('fit', [{ offsetMs: 0, speed: 5, hr: 140 }, { offsetMs: 1000, speed: 5, hr: 140 }]);
const history = createTelemetryHistory([
  { track: camera, sampleMs: 1000 },
  { track: fitSpeed, sampleMs: 1000 },
]);
near(history.average('speed', 1000), 5, 'later track wins');
const camOnly = createTelemetryHistory([
  { track: fitSpeed, sampleMs: 1000 },
  { track: track('cam2', [{ offsetMs: 0, cadence: 90 }], 'gopro'), sampleMs: 1000 },
]);
near(camOnly.average('hr', 1000), 140, 'falls back to earlier track for missing field');

// --- Integration: history follows the same sync mapping as the merged frame ---
const ride = track('fit-1', Array.from({ length: 120 }, (_, i) => ({ offsetMs: i * 1000, power: i * 10 })));
const clip: TimelineClip = {
  id: 'c0',
  media: { path: '/ride.mp4', durationMs: 60_000 },
  localTracks: [],
  localTrackSync: {},
  // Video t=0 corresponds to ride t=30s.
  sharedTrackSync: { 'fit-1': { offsetMs: -30_000, playSpeedPercent: 100, anchor: 'manual' } },
  inMs: 10_000,
  outMs: 60_000,
  startGlobalMs: 0,
};
const project = {
  clips: [clip],
  overlays: [],
  sharedTracks: [ride],
  gauges: [],
} as unknown as Project;

// Global 5s → source 15s (trim in 10s) → ride 45s → power 450; 3s average of samples 43–45s = 440.
const g = 5_000;
assert.equal(frameAtGlobalTime(project, g).power, 450, 'merged frame at global time');
near(historyAtGlobalTime(project, g).average('power', 0), 450, 'history zero-window matches frame');
near(historyAtGlobalTime(project, g).average('power', 3000), 440, '3s average at global time');
// Export path (clip-local) must agree with preview path (global).
assert.equal(frameAtClipLocalTime(project, clip, g).power, 450, 'clip-local frame');
near(historyAtClipLocalTime(project, clip, g).average('power', 3000), 440, 'export == preview');
assert.equal(
  historyAtGlobalTime({ ...project, clips: [] } as Project, g).average('power', 3000),
  undefined,
  'no clips → no history',
);

console.log('telemetry-history-selftest: all assertions passed');
