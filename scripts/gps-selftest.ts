/**
 * Camera GPS sync self-test. Builds synthetic GoPro (GPMF in MP4) and Insta360
 * (trailer) files, then checks probe speed/limits, decoding, the video start
 * estimate, the speed cross-check, and how the 'gps' sync anchor behaves.
 *
 * Optionally checks real files: GPS_SAMPLES="a.mp4:available,b.MP4:no-gps"
 *
 * Run: npx tsx scripts/gps-selftest.ts
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractCameraGps, probeCameraGps } from '../src/main/gps/index';
import { decodeGpmfPayloadGps, parseGpsu } from '../src/main/gps/gpmf';
import { INSTA360_MAGIC } from '../src/main/gps/insta360';
import { crossCheckWarnings, estimateVideoStartUtc, speedCrossCheck } from '../src/shared/gpsClock';
import {
  applySharedFitAnchorToAllClips,
  computeOffsetFromAnchor,
  effectiveSharedFitOffsetMs,
  repairSharedFitSync,
} from '../src/shared/sync';
import type { CameraGpsSample, MediaSource, TelemetryTrack, TimelineClip } from '../src/shared/types';

// ---------------------------------------------------------------- GPMF builders

function klv(key: string, type: string, structSize: number, repeat: number, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(key, 0, 'latin1');
  head.writeUInt8(type === '\0' ? 0 : type.charCodeAt(0), 4);
  head.writeUInt8(structSize, 5);
  head.writeUInt16BE(repeat, 6);
  const pad = Buffer.alloc((4 - (data.length % 4)) % 4);
  return Buffer.concat([head, data, pad]);
}
const nest = (key: string, children: Buffer[]) => {
  const data = Buffer.concat(children);
  return klv(key, '\0', 1, data.length, data);
};
const str = (key: string, s: string) => klv(key, 'c', 1, s.length, Buffer.from(s, 'latin1'));
const int32s = (key: string, vals: number[]) => {
  const b = Buffer.alloc(vals.length * 4);
  vals.forEach((v, i) => b.writeInt32BE(Math.round(v), i * 4));
  return klv(key, 'l', 4, vals.length, b);
};

const GPS9_EPOCH = Date.UTC(2000, 0, 1);

/** One 1-second GPMF payload with GPS9 samples (HERO13 style). */
function gps9Payload(startUtcMs: number, n: number, lat0: number, speed: (i: number) => number): Buffer {
  const rec = Buffer.alloc(n * 32);
  for (let i = 0; i < n; i++) {
    const utc = startUtcMs + (i * 1000) / n;
    const days = Math.floor((utc - GPS9_EPOCH) / 86_400_000);
    const secs = (utc - GPS9_EPOCH - days * 86_400_000) / 1000;
    const o = i * 32;
    rec.writeInt32BE(Math.round((lat0 + i * 1e-5) * 1e7), o);
    rec.writeInt32BE(Math.round(-8.65 * 1e7), o + 4);
    rec.writeInt32BE(12_000, o + 8);
    rec.writeInt32BE(Math.round(speed(i) * 1000), o + 12);
    rec.writeInt32BE(Math.round(speed(i) * 100), o + 16);
    rec.writeInt32BE(days, o + 20);
    rec.writeInt32BE(Math.round(secs * 1000), o + 24);
    rec.writeUInt16BE(150, o + 28);
    rec.writeUInt16BE(3, o + 30);
  }
  return nest('DEVC', [
    str('DVNM', 'HERO13 Black'),
    nest('STRM', [
      int32s('SCAL', [1e7, 1e7, 1000, 1000, 100, 1, 1000, 100, 1]),
      str('TYPE', 'lllllllSS'),
      klv('GPS9', '?', 32, n, rec),
    ]),
  ]);
}

/** One GPMF payload with GPS5 + GPSU + GPSF (HERO9 style). */
function gps5Payload(startUtcMs: number, n: number, fix: number): Buffer {
  const d = new Date(startUtcMs);
  const p2 = (x: number) => String(x).padStart(2, '0');
  const gpsu = `${p2(d.getUTCFullYear() - 2000)}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`
    + `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
  const vals: number[] = [];
  for (let i = 0; i < n; i++) vals.push(42.1 * 1e7, -8.6 * 1e7, 10_000, 5_000, 500);
  const gpsfBuf = Buffer.alloc(4);
  gpsfBuf.writeUInt32BE(fix);
  const gps5 = Buffer.alloc(vals.length * 4);
  vals.forEach((v, i) => gps5.writeInt32BE(Math.round(v), i * 4));
  return nest('DEVC', [
    str('DVNM', 'HERO9 Black'),
    nest('STRM', [
      int32s('SCAL', [1e7, 1e7, 1000, 1000, 100]),
      klv('GPSF', 'L', 4, 1, gpsfBuf),
      klv('GPSU', 'U', 16, 1, Buffer.from(gpsu, 'latin1')),
      klv('GPS5', 'l', 20, n, gps5),
    ]),
  ]);
}

/** HERO12-style payload: accelerometer only, no GPS stream. */
function noGpsPayload(): Buffer {
  return nest('DEVC', [str('DVNM', 'HERO12 Black'), nest('STRM', [int32s('ACCL', [1, 2, 3])])]);
}

// ---------------------------------------------------------------- MP4 builder

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}
const u32 = (...v: number[]) => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32BE(x, i * 4)); return b; };

/** MP4 with a 1 s/sample gpmd track; moov placed after mdat (as GoPro does). */
function goproMp4(payloads: Buffer[], videoPadding = 0): Buffer {
  const ftyp = box('ftyp', Buffer.from('mp41'), u32(0), Buffer.from('mp41'));
  const pad = Buffer.alloc(videoPadding); // stands in for video frames
  const mdatBody = Buffer.concat([pad, ...payloads]);
  const mdat = box('mdat', mdatBody);
  let off = ftyp.length + 8 + pad.length;
  const offsets = payloads.map((p) => { const o = off; off += p.length; return o; });

  const mdhd = box('mdhd', u32(0, 0, 0, 1000, payloads.length * 1000), Buffer.alloc(4));
  const hdlr = box('hdlr', u32(0, 0), Buffer.from('meta'), Buffer.alloc(12), Buffer.from('GoPro MET\0', 'latin1'));
  const stsdEntry = Buffer.concat([u32(16), Buffer.from('gpmd'), Buffer.alloc(8)]);
  const stbl = box('stbl',
    box('stsd', u32(0, 1), stsdEntry),
    box('stts', u32(0, 1, payloads.length, 1000)),
    box('stsc', u32(0, 1, 1, 1, 1)),
    box('stsz', u32(0, 0, payloads.length, ...payloads.map((p) => p.length))),
    box('stco', u32(0, payloads.length, ...offsets)));
  const moov = box('moov', box('trak', box('mdia', mdhd, hdlr, box('minf', stbl))));
  return Buffer.concat([ftyp, mdat, moov]);
}

// ---------------------------------------------------------------- Insta360 builder

function instaGps(utcMs: number, lat: number, fix: 'A' | 'V'): Buffer {
  const b = Buffer.alloc(53);
  b.writeBigUInt64LE(BigInt(Math.floor(utcMs / 1000)), 0);
  b.writeUInt16LE(utcMs % 1000, 8);
  b.writeUInt8(fix.charCodeAt(0), 10);
  b.writeDoubleLE(Math.abs(lat), 11);
  b.writeUInt8((lat < 0 ? 'S' : 'N').charCodeAt(0), 19);
  b.writeDoubleLE(122.3, 20);
  b.writeUInt8('W'.charCodeAt(0), 28);
  b.writeDoubleLE(4.2, 29);
  return b;
}

function desc(id: number, size: number, format = 0): Buffer {
  const d = Buffer.alloc(6);
  d.writeUInt8(format, 0);
  d.writeUInt8(id, 1);
  d.writeUInt32LE(size, 2);
  return d;
}

/** Fake video bytes + Insta360 trailer. `withOffsets` = modern layout with an index record. */
function insta360File(records: Array<{ id: number; data: Buffer }>, withOffsets: boolean, version = 3): Buffer {
  const video = Buffer.alloc(4096, 0x11);
  const parts: Buffer[] = [];
  const table: Buffer[] = [];
  let rel = 0;
  for (const r of records) {
    const e = Buffer.alloc(10);
    e.writeUInt8(r.id, 0);
    e.writeUInt32LE(r.data.length, 2);
    e.writeUInt32LE(rel, 6);
    table.push(e);
    parts.push(r.data, desc(r.id, r.data.length));
    rel += r.data.length + 6;
  }
  if (withOffsets) {
    const t = Buffer.concat(table);
    parts.push(t, desc(0, t.length));
  }
  const body = Buffer.concat(parts);
  const footer = Buffer.alloc(72);
  footer.writeUInt32LE(body.length + 72, 32);
  footer.writeUInt32LE(version, 36);
  INSTA360_MAGIC.copy(footer, 40);
  return Buffer.concat([video, body, footer]);
}

// ---------------------------------------------------------------- tests

const START = Date.UTC(2026, 6, 20, 11, 43, 11, 0);

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'dg-gps-test-'));
  const file = async (name: string, data: Buffer) => { const p = join(dir, name); await writeFile(p, data); return p; };

  try {
    // --- GPMF decoding
    assert.equal(parseGpsu('240805122830.174'), Date.UTC(2024, 7, 5, 12, 28, 30, 174), 'GPSU parse');
    const p9 = decodeGpmfPayloadGps(gps9Payload(START, 10, 42.42, () => 5));
    assert.equal(p9.model, 'HERO13 Black');
    assert.equal(p9.points.length, 10, 'GPS9 points');
    assert.equal(p9.points[0]!.utcMs, START, 'GPS9 per-sample UTC');
    assert.ok(Math.abs(p9.points[0]!.lat - 42.42) < 1e-6 && p9.points[0]!.fix === 3, 'GPS9 lat/fix');
    const p5 = decodeGpmfPayloadGps(gps5Payload(START, 18, 3));
    assert.equal(p5.points.length, 18, 'GPS5 points');
    assert.equal(p5.payloadUtcMs, START, 'GPSU on GPS5 payload');
    assert.ok(Math.abs(p5.points[0]!.speed - 5) < 1e-9, 'GPS5 2D speed scaled');
    assert.equal(decodeGpmfPayloadGps(noGpsPayload()).hasGpsStream, false, 'no GPS stream');

    // --- GoPro probe/extract: GPS9 with lots of "video" that must not be read
    const VIDEO_BYTES = 20 * 1024 * 1024;
    const g13 = await file('hero13.mp4', goproMp4(
      Array.from({ length: 30 }, (_, i) => gps9Payload(START + 5000 + i * 1000, 10, 42.42, () => 5)),
      VIDEO_BYTES,
    ));
    const pr13 = await probeCameraGps(g13);
    assert.equal(pr13.status, 'available', pr13.reason);
    assert.equal(pr13.model, 'HERO13 Black');
    assert.equal(pr13.experimental, false);
    assert.ok(pr13.bytesRead < 64 * 1024, `probe read ${pr13.bytesRead} bytes of a ${VIDEO_BYTES}-byte file`);
    const ex13 = await extractCameraGps(g13);
    assert.equal(ex13.samples.length, 300);
    assert.ok(ex13.bytesRead < 128 * 1024, `extract read ${ex13.bytesRead} bytes`);
    const est13 = estimateVideoStartUtc(ex13.samples)!;
    // GPS UTC was START+5s at video t=0 (camera clock irrelevant).
    assert.equal(est13.videoStartUtcMs, START + 5000, 'video start from GPS9');
    assert.ok(est13.spreadMs <= 1, 'GPS9 estimates agree');
    assert.equal(ex13.warnings.length, 0, 'no GPS5 precision warning for GPS9');

    // --- GoPro GPS5 camera gets the precision warning
    const g9 = await file('hero9.mp4', goproMp4(Array.from({ length: 5 }, (_, i) => gps5Payload(START + i * 1000, 18, 3))));
    const ex9 = await extractCameraGps(g9);
    assert.equal(estimateVideoStartUtc(ex9.samples)!.videoStartUtcMs, START, 'video start from GPSU');
    assert.ok(ex9.warnings.some((w) => /±1–2 s/.test(w)), 'GPS5 precision warning');

    // --- HERO12: no GPS stream, named in the reason
    const g12 = await file('hero12.mp4', goproMp4(Array.from({ length: 20 }, noGpsPayload), VIDEO_BYTES));
    const pr12 = await probeCameraGps(g12);
    assert.equal(pr12.status, 'no-gps');
    assert.match(pr12.reason, /HERO12 Black has no GPS receiver/);
    assert.ok(pr12.bytesRead < 64 * 1024, 'HERO12 fails fast');

    // --- GPS on but never locked
    const gNoFix = await file('nofix.mp4', goproMp4(Array.from({ length: 10 }, (_, i) => gps5Payload(START + i * 1000, 18, 0))));
    const prNoFix = await probeCameraGps(gNoFix);
    assert.equal(prNoFix.status, 'no-gps');
    assert.match(prNoFix.reason, /satellite lock/);

    // --- Insta360: modern layout with GPS
    const meta = Buffer.from('\x0a\x0bInsta360 X5\x12\x04v1.0', 'latin1');
    const gpsRec = Buffer.concat(Array.from({ length: 200 }, (_, i) => instaGps(START + 2000 + i * 100, -33.9, 'A')));
    const iGps = await file('x5.insv', insta360File([{ id: 1, data: meta }, { id: 7, data: gpsRec }], true));
    const prI = await probeCameraGps(iGps);
    assert.equal(prI.status, 'available', prI.reason);
    assert.equal(prI.format, 'insta360');
    assert.equal(prI.model, 'Insta360 X5');
    assert.equal(prI.experimental, true, 'Insta360 is experimental');
    const exI = await extractCameraGps(iGps, { videoDurationMs: 25_000 });
    assert.equal(exI.samples.length, 200);
    assert.ok(exI.samples[0]!.lat < 0 && exI.samples[0]!.lon < 0, 'N/S and E/W refs applied');
    assert.equal(estimateVideoStartUtc(exI.samples)!.videoStartUtcMs, START + 2000, 'first fix = recording start');
    assert.ok(exI.warnings.some((w) => /experimental/i.test(w)), 'experimental warning');
    assert.ok(exI.warnings.some((w) => /first GPS fix is assumed/.test(w)), 'timing assumption warning');
    assert.ok(!exI.warnings.some((w) => /longer than the video/.test(w)), 'GPS log fits the video');

    // --- Insta360: GPS log much longer than the video triggers a warning
    const exLong = await extractCameraGps(iGps, { videoDurationMs: 5000 });
    assert.ok(exLong.warnings.some((w) => /longer than the video/.test(w)), 'long GPS log warning');

    // --- Insta360: trailer without GPS (like the X6 sample) and legacy layout
    const iNoGps = await file('x6.insv', insta360File([{ id: 1, data: meta }, { id: 3, data: Buffer.alloc(5000) }], true));
    const prNo = await probeCameraGps(iNoGps);
    assert.equal(prNo.status, 'no-gps');
    assert.match(prNo.reason, /GPS remote/);
    assert.ok(prNo.bytesRead < 1024, `no-GPS Insta360 read ${prNo.bytesRead} bytes`);

    const iLegacy = await file('legacy.insv', insta360File([{ id: 7, data: gpsRec }, { id: 1, data: meta }], false));
    assert.equal((await probeCameraGps(iLegacy)).status, 'available', 'legacy backwards walk');

    const iOdd = await file('odd.insv', insta360File([{ id: 7, data: Buffer.alloc(60) }], true));
    assert.equal((await probeCameraGps(iOdd)).status, 'unsupported', 'unknown GPS layout');

    const iVoid = await file('void.insv', insta360File([{ id: 7, data: instaGps(START, 10, 'V') }], true));
    assert.equal((await probeCameraGps(iVoid)).status, 'no-gps', 'GPS record without fix');

    // --- Not a camera file / missing file
    assert.equal((await probeCameraGps(await file('junk.bin', Buffer.alloc(1000, 7)))).status, 'no-gps');
    assert.equal((await probeCameraGps(join(dir, 'missing.mp4'))).status, 'no-gps');

    // --- Speed cross-check
    const fitStart = START - 60_000;
    const speedAt = (rideMs: number) => 5 + 3 * Math.sin(rideMs / 7000);
    const fit: TelemetryTrack = {
      id: 'fit-1', source: 'fit', brand: 'test', startTime: new Date(fitStart).toISOString(),
      fields: ['speed'], sampleRateHz: 1, warnings: [],
      frames: Array.from({ length: 600 }, (_, i) => ({ offsetMs: i * 1000, speed: speedAt(i * 1000) })),
    };
    const videoStart = START;
    const trueOffset = fitStart - videoStart; // −60 s: FIT started a minute before the video
    const cam: CameraGpsSample[] = Array.from({ length: 1200 }, (_, i) => {
      const videoMs = i * 100;
      return { videoMs, utcMs: videoStart + videoMs, lat: 0, lon: 0, fix: 3, speed: speedAt(videoMs - trueOffset) };
    });
    const ok = speedCrossCheck(cam, fit, trueOffset)!;
    assert.ok(Math.abs(ok.bestLagMs) <= 250, `correct offset: best lag ${ok.bestLagMs}`);
    assert.deepEqual(crossCheckWarnings(ok), []);
    const off = speedCrossCheck(cam, fit, trueOffset + 8000)!;
    assert.ok(Math.abs(off.bestLagMs + 8000) <= 500, `wrong offset found: best lag ${off.bestLagMs}`);
    assert.match(crossCheckWarnings(off)[0]!, /disagrees/);
    assert.equal(speedCrossCheck(cam.map((s) => ({ ...s, speed: 4 })), fit, trueOffset), null, 'flat speed: no verdict');

    // --- 'gps' anchor: computed from media.gpsClock, then kept fixed across clips
    const media = (over: Partial<MediaSource> = {}): MediaSource => ({
      id: 'm', path: '/a.mp4', filename: 'a.mp4', durationMs: 60_000, width: 1920, height: 1080, fps: 30, ...over,
    });
    const gpsMedia = media({
      creationTime: new Date(START + 86_400_000).toISOString(), // camera clock a day out
      gpsClock: {
        videoStartUtcMs: START, format: 'gopro', experimental: false, fixSamples: 100, spreadMs: 0,
        warnings: [], computedAt: new Date().toISOString(),
      },
    });
    assert.equal(computeOffsetFromAnchor('gps', gpsMedia, fit), trueOffset, 'gps anchor ignores bad camera clock');
    assert.equal(computeOffsetFromAnchor('gps', media(), fit), 0, 'gps anchor without gpsClock');

    const mk = (id: string, m: MediaSource): TimelineClip => ({
      id, media: m, localTracks: [], localTrackSync: {}, sharedTrackSync: { 'fit-1': { offsetMs: 0, playSpeedPercent: 100, anchor: 'utc' } },
      inMs: 0, outMs: 60_000, startGlobalMs: 0,
    });
    let clips = [mk('c0', gpsMedia), mk('c1', media())];
    clips = applySharedFitAnchorToAllClips(clips, 'fit-1', fit, 'gps', trueOffset);
    assert.equal(clips[0]!.sharedTrackSync['fit-1']!.anchor, 'gps');
    assert.equal(effectiveSharedFitOffsetMs(clips, 0, 'fit-1'), trueOffset, 'clip 0 keeps GPS offset');
    assert.equal(effectiveSharedFitOffsetMs(clips, 1, 'fit-1'), trueOffset - 60_000, 'clip 1 chains from clip 0');
    assert.equal(repairSharedFitSync(clips, [fit]), clips, 'repair leaves GPS anchors alone');

    // --- Optional: real camera files
    for (const spec of (process.env.GPS_SAMPLES ?? '').split(',').filter(Boolean)) {
      const i = spec.lastIndexOf(':');
      const [path, want] = [spec.slice(0, i), spec.slice(i + 1)];
      const r = await probeCameraGps(path);
      console.log(`  ${path}: ${r.status} (${r.bytesRead} B, ${r.elapsedMs} ms) — ${r.reason}`);
      assert.equal(r.status, want, `${path}: expected ${want}`);
    }

    console.log('gps-selftest: all checks passed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
