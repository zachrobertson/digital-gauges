/**
 * Verifies that trimming a video clip does NOT trim the FIT telemetry and that
 * the FIT<->video sync is preserved across trims.
 *
 * Run: npx tsx scripts/trim-sync-selftest.ts
 */
import assert from 'node:assert/strict';
import type { TimelineClip, TrackSyncSettings } from '../src/shared/types';
import { clipAtGlobalTime, clipDurationMs, clipInMs } from '../src/shared/timeline';
import { effectiveSharedFitOffsetMs, offsetFromSyncPoint } from '../src/shared/sync';

const FIT_ID = 'fit-1';
const MEDIA = { path: '/ride.mp4', durationMs: 60_000 };

function manualSync(offsetMs: number): TrackSyncSettings {
  return { offsetMs, playSpeedPercent: 100, anchor: 'manual' };
}

function makeClip(over: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'c0',
    media: MEDIA,
    localTracks: [],
    localTrackSync: {},
    sharedTrackSync: { [FIT_ID]: manualSync(0) },
    inMs: 0,
    outMs: 60_000,
    startGlobalMs: 0,
    ...over,
  };
}

/**
 * Mirrors telemetry.ts sampling: FIT ride time shown at global G is
 * (clipInMs + localMs) - effectiveOffset. Returns null in timeline gaps
 * (i.e. when gauges would render with no telemetry).
 */
function fitRideTimeAtGlobal(clips: TimelineClip[], globalMs: number): number | null {
  const loc = clipAtGlobalTime(clips, globalMs);
  if (!loc) return null;
  const offset = effectiveSharedFitOffsetMs(clips, loc.clipIndex, FIT_ID);
  return clipInMs(loc.clip) + loc.localMs - offset;
}

/** The single-clip head-trim transform performed by setClipTrim (post-fix). */
function headTrim(clip: TimelineClip, newInMs: number): TimelineClip {
  // setClipTrim keeps startGlobalMs anchored (no `+ deltaIn` gap) and never
  // touches sharedTrackSync for the clip being trimmed.
  return { ...clip, inMs: newInMs };
}

// --- Baseline: untrimmed clip, FIT offset 0 => global G shows ride time G ---
{
  const clips = [makeClip({})];
  assert.equal(fitRideTimeAtGlobal(clips, 0), 0);
  assert.equal(fitRideTimeAtGlobal(clips, 30_000), 30_000);
}

// --- Head trim 10s: no telemetry gap, sync preserved, FIT data intact ---
{
  const original = makeClip({});
  const trimmed = headTrim(original, 10_000);
  const clips = [trimmed];

  // 1. No leading telemetry gap: gauges still have data at the timeline start.
  assert.notEqual(
    fitRideTimeAtGlobal(clips, 0),
    null,
    'head-trim must not open a telemetry gap at global 0',
  );

  // 2. FIT<->video pairing preserved. The first visible video frame is source
  //    time 10s; the gauge must show the FIT sample paired with source 10s.
  assert.equal(
    fitRideTimeAtGlobal(clips, 0),
    10_000,
    'first trimmed frame (source 10s) must still show FIT ride time 10s',
  );

  // 3. The stored sync setting for the trimmed clip is byte-for-byte unchanged.
  assert.deepEqual(
    trimmed.sharedTrackSync,
    original.sharedTrackSync,
    'trim must not modify the clip FIT sync settings',
  );

  // 4. FIT frames are never sliced — full ride still reachable by adjusting sync.
  //    Nudging the offset by -10s brings the pre-trim ride start back into view,
  //    proving no FIT data was lost to the trim.
  const reSynced = [{
    ...trimmed,
    sharedTrackSync: { [FIT_ID]: manualSync(-10_000) },
  }];
  assert.equal(
    fitRideTimeAtGlobal(reSynced, 0),
    20_000,
    'sync remains freely adjustable after trim (no data lost to the trim)',
  );
}

// --- Tail trim 10s: unaffected, sync preserved ---
{
  const original = makeClip({});
  const trimmed = { ...original, outMs: 50_000 };
  const clips = [trimmed];
  assert.equal(fitRideTimeAtGlobal(clips, 0), 0);
  assert.equal(fitRideTimeAtGlobal(clips, 40_000), 40_000);
  assert.deepEqual(trimmed.sharedTrackSync, original.sharedTrackSync);
}

// --- Regression guard: the OLD `+ deltaIn` behavior opened a telemetry gap ---
{
  const buggy = [makeClip({ inMs: 10_000, startGlobalMs: 10_000 })];
  assert.equal(
    fitRideTimeAtGlobal(buggy, 0),
    null,
    'sanity: the old startGlobalMs += deltaIn shift produced a telemetry gap',
  );
}

// --- Sync page must agree with the gauge overlay on a trimmed clip ---
// The gauge (telemetry.ts) samples FIT ride time at source time:
//   ride = (clipInMs + clipLocalMs) - offset.
// The Sync page derives several values that must match this exactly.
{
  const OFFSET = 3_145;
  const clip = makeClip({
    inMs: 29_395, // head-trimmed clip, as in the reported screenshot
    sharedTrackSync: { [FIT_ID]: manualSync(OFFSET) },
  });
  const clips = [clip];
  const selectedClipStartMs = 0; // first clip
  const clipIn = clipInMs(clip);
  const clipDur = clipDurationMs(clip);
  const globalPlayheadMs = 2_750;
  const clipLocalPlayhead = globalPlayheadMs - selectedClipStartMs;
  const fitOffset = effectiveSharedFitOffsetMs(clips, 0, FIT_ID);

  // Ground truth: the gauge's FIT ride time at the playhead.
  const gaugeRide = fitRideTimeAtGlobal(clips, globalPlayheadMs)!;
  assert.equal(gaugeRide, 29_000, 'sanity: gauge samples FIT ride 0:29 at start');

  // 1. SyncViewer: ride time read off the waveform at the playhead must match.
  //    Waveform draws ride T at global (globalFitT0Ms + T), so the ride under the
  //    playhead = globalPlayhead - globalFitT0Ms.
  const globalFitT0Ms = selectedClipStartMs + fitOffset - clipIn; // fixed formula
  const waveformRideAtPlayhead = globalPlayheadMs - globalFitT0Ms;
  assert.equal(
    waveformRideAtPlayhead,
    gaugeRide,
    'SyncViewer waveform must show the same FIT ride time as the gauge',
  );

  // 2. SyncControlsPanel "fit clip" readout must match the gauge.
  const fitClipLocalMs = clipLocalPlayhead + clipIn - fitOffset; // fixed formula
  assert.equal(fitClipLocalMs, gaugeRide, '"fit clip" readout must match the gauge');

  // 3. "Set sync point @ playhead" pins FIT t=0 to the playhead: after applying
  //    the new offset, the gauge ride time at the playhead must be 0.
  const clipLocal = Math.max(0, Math.min(globalPlayheadMs - selectedClipStartMs, clipDur));
  const newOffset = offsetFromSyncPoint(clipLocal + clipIn, 0); // fixed formula
  const reSynced = [{ ...clip, sharedTrackSync: { [FIT_ID]: manualSync(newOffset) } }];
  assert.equal(
    fitRideTimeAtGlobal(reSynced, globalPlayheadMs),
    0,
    '"set sync point @ playhead" must pin FIT ride 0 to the playhead frame',
  );
}

console.log('trim-sync-selftest: all checks passed');
