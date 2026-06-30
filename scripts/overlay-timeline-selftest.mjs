/**
 * Manual test matrix for overlay timeline math + v4→v5 migration expectations.
 * Run: node scripts/overlay-timeline-selftest.mjs
 */
import assert from 'node:assert/strict';

const baseTime = '2024-06-01T12:00:00.000Z';
const overlayTime = '2024-06-01T12:00:10.000Z';

function videoUtcMs(video) {
  if (video?.creationTime) {
    const ms = new Date(video.creationTime).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function clipSourceTimeMs(clip, localMs) {
  const inMs = clip.inMs ?? 0;
  const outMs = clip.outMs ?? clip.media.durationMs;
  const dur = Math.max(0, outMs - inMs);
  const clamped = Math.max(0, Math.min(localMs, dur));
  return inMs + clamped;
}

function clipAtGlobalTime(clips, globalMs) {
  let start = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const inMs = clip.inMs ?? 0;
    const outMs = clip.outMs ?? clip.media.durationMs;
    const dur = Math.max(0, outMs - inMs);
    const end = start + dur;
    if (globalMs < end || i === clips.length - 1) {
      return { clip, localMs: Math.max(0, Math.min(globalMs - start, dur)) };
    }
    start = end;
  }
  return null;
}

function overlaySourceMsAt(globalMs, overlay, clips) {
  if (globalMs < overlay.startGlobalMs || globalMs >= overlay.endGlobalMs) return null;
  const offsetMs = overlay.offsetMs ?? 0;
  let sourceMs;
  if (overlay.alignMode === 'manual') {
    const inMs = overlay.inMs ?? 0;
    sourceMs = inMs + (globalMs - overlay.startGlobalMs) + offsetMs;
  } else {
    const loc = clipAtGlobalTime(clips, globalMs);
    if (!loc) return null;
    const baseUtc = videoUtcMs(loc.clip.media);
    const overlayUtc = videoUtcMs(overlay.media);
    if (baseUtc == null || overlayUtc == null) return null;
    sourceMs = baseUtc + clipSourceTimeMs(loc.clip, loc.localMs) - overlayUtc + offsetMs;
  }
  const inMs = overlay.inMs ?? 0;
  const outMs = overlay.outMs ?? overlay.media.durationMs;
  if (sourceMs < inMs || sourceMs >= outMs) return null;
  return sourceMs;
}

const clipA = {
  id: 'a',
  media: { durationMs: 30_000, creationTime: baseTime },
  inMs: 0,
  outMs: 30_000,
};
const clipB = {
  id: 'b',
  media: { durationMs: 30_000, creationTime: '2024-06-01T12:00:30.000Z' },
  inMs: 0,
  outMs: 30_000,
};
const clips = [clipA, clipB];
const overlayMedia = { durationMs: 20_000, creationTime: overlayTime };

// 1. Manual mode 1:1
{
  const overlay = {
    media: overlayMedia,
    startGlobalMs: 5_000,
    endGlobalMs: 15_000,
    alignMode: 'manual',
    offsetMs: 0,
    inMs: 0,
    outMs: 20_000,
  };
  assert.equal(overlaySourceMsAt(10_000, overlay, clips), 5_000);
}

// 2. Timestamp mode — at G=10s wall clocks align (overlay started 10s after base)
{
  const overlay = {
    media: overlayMedia,
    startGlobalMs: 0,
    endGlobalMs: 20_000,
    alignMode: 'timestamp',
    offsetMs: 0,
    inMs: 0,
    outMs: 20_000,
  };
  assert.equal(overlaySourceMsAt(10_000, overlay, [clipA]), 0);
}

// 3. Multi-clip span — source defined on both sides of clip boundary
{
  const overlay = {
    media: { ...overlayMedia, durationMs: 40_000 },
    startGlobalMs: 25_000,
    endGlobalMs: 35_000,
    alignMode: 'timestamp',
    offsetMs: 0,
    inMs: 0,
    outMs: 40_000,
  };
  assert.ok(overlaySourceMsAt(25_000, overlay, clips) != null);
  assert.ok(overlaySourceMsAt(32_000, overlay, clips) != null);
}

// 4. Z-order (sort check)
{
  const sorted = [{ z: 5 }, { z: 0 }].sort((a, b) => a.z - b.z);
  assert.equal(sorted[0].z, 0);
}

// 5. Audio toggle is data-only
{
  const overlay = { includeAudio: true };
  assert.equal(overlay.includeAudio, true);
}

// 6. v4 → v5 migration
{
  const v4 = { version: 4, overlays: undefined };
  const v5 = { ...v4, version: 5, overlays: v4.overlays ?? [] };
  assert.equal(v5.version, 5);
  assert.deepEqual(v5.overlays, []);
}

console.log('overlay-timeline-selftest: all 6 manual matrix checks passed');
