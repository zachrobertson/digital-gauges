/**
 * Minimal MP4/QuickTime index reader: walks top-level boxes using only their
 * headers (skipping `mdat` without reading it), reads `moov`, and builds the
 * sample table for each track. Enough to find telemetry tracks and read their
 * samples directly by byte offset.
 */
import type { RangeReader } from './reader';

/** `moov` larger than this is not a sane camera file; refuse rather than read it. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
/** Cap on top-level boxes walked before giving up. */
const MAX_TOP_LEVEL_BOXES = 4096;

export interface Mp4Sample {
  offset: number;
  size: number;
  /** Presentation start, ms. */
  timeMs: number;
  durationMs: number;
}

export interface Mp4Track {
  handlerType: string;
  handlerName: string;
  /** First sample description format, e.g. 'avc1', 'gpmd', 'djmd', 'camm'. */
  format: string;
  timescale: number;
  samples: Mp4Sample[];
}

export interface Mp4Index {
  tracks: Mp4Track[];
}

interface Box {
  type: string;
  /** Offset of the box payload (after the header). */
  start: number;
  /** Offset one past the end of the box. */
  end: number;
}

/** Iterate child boxes inside a buffer region. */
function* childBoxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) return;
      size = Number(buf.readBigUInt64BE(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < header || off + size > end) return;
    yield { type, start: off + header, end: off + size };
    off += size;
  }
}

function findChild(buf: Buffer, parent: Box, type: string): Box | undefined {
  for (const b of childBoxes(buf, parent.start, parent.end)) if (b.type === type) return b;
  return undefined;
}

function cleanName(raw: Buffer): string {
  // hdlr names are C strings in MP4 and Pascal strings in QuickTime; keep printable ASCII.
  return raw.toString('latin1').replace(/[^\x20-\x7e]/g, '').trim();
}

function parseTrack(buf: Buffer, trak: Box): Mp4Track | null {
  const mdia = findChild(buf, trak, 'mdia');
  if (!mdia) return null;
  const mdhd = findChild(buf, mdia, 'mdhd');
  const hdlr = findChild(buf, mdia, 'hdlr');
  const minf = findChild(buf, mdia, 'minf');
  const stbl = minf && findChild(buf, minf, 'stbl');
  if (!mdhd || !hdlr || !stbl) return null;

  const version = buf.readUInt8(mdhd.start);
  const timescale = version === 1 ? buf.readUInt32BE(mdhd.start + 20) : buf.readUInt32BE(mdhd.start + 12);
  if (!timescale) return null;

  const handlerType = buf.toString('latin1', hdlr.start + 8, hdlr.start + 12);
  const handlerName = cleanName(buf.subarray(hdlr.start + 24, hdlr.end));

  const stsd = findChild(buf, stbl, 'stsd');
  const format = stsd && stsd.end - stsd.start >= 16
    ? buf.toString('latin1', stsd.start + 12, stsd.start + 16)
    : '';

  return {
    handlerType,
    handlerName,
    format,
    timescale,
    samples: buildSamples(buf, stbl, timescale),
  };
}

function buildSamples(buf: Buffer, stbl: Box, timescale: number): Mp4Sample[] {
  const stsz = findChild(buf, stbl, 'stsz');
  const stsc = findChild(buf, stbl, 'stsc');
  const stco = findChild(buf, stbl, 'stco');
  const co64 = findChild(buf, stbl, 'co64');
  const stts = findChild(buf, stbl, 'stts');
  if (!stsz || !stsc || (!stco && !co64)) return [];

  // Sample sizes.
  const fixedSize = buf.readUInt32BE(stsz.start + 4);
  const sampleCount = buf.readUInt32BE(stsz.start + 8);
  const sizeAt = (i: number) => (fixedSize !== 0 ? fixedSize : buf.readUInt32BE(stsz.start + 12 + i * 4));
  if (fixedSize === 0 && stsz.start + 12 + sampleCount * 4 > stsz.end) return [];

  // Chunk offsets.
  const chunkBox = (co64 ?? stco)!;
  const chunkCount = buf.readUInt32BE(chunkBox.start + 4);
  const chunkOffset = (i: number) => (co64
    ? Number(buf.readBigUInt64BE(co64.start + 8 + i * 8))
    : buf.readUInt32BE(stco!.start + 8 + i * 4));

  // Sample-to-chunk runs.
  const runs: Array<{ firstChunk: number; perChunk: number }> = [];
  const runCount = buf.readUInt32BE(stsc.start + 4);
  for (let i = 0; i < runCount; i++) {
    const at = stsc.start + 8 + i * 12;
    if (at + 12 > stsc.end) break;
    runs.push({ firstChunk: buf.readUInt32BE(at), perChunk: buf.readUInt32BE(at + 4) });
  }

  // Sample durations.
  const deltas: Array<{ count: number; delta: number }> = [];
  if (stts) {
    const n = buf.readUInt32BE(stts.start + 4);
    for (let i = 0; i < n; i++) {
      const at = stts.start + 8 + i * 8;
      if (at + 8 > stts.end) break;
      deltas.push({ count: buf.readUInt32BE(at), delta: buf.readUInt32BE(at + 4) });
    }
  }

  const samples: Mp4Sample[] = [];
  let sampleIdx = 0;
  let deltaRun = 0;
  let deltaLeft = deltas[0]?.count ?? 0;
  let ticks = 0;
  const nextDelta = (): number => {
    while (deltaRun < deltas.length && deltaLeft === 0) {
      deltaRun++;
      deltaLeft = deltas[deltaRun]?.count ?? 0;
    }
    if (deltaRun >= deltas.length) return deltas[deltas.length - 1]?.delta ?? 0;
    deltaLeft--;
    return deltas[deltaRun]!.delta;
  };

  for (let chunk = 0; chunk < chunkCount && sampleIdx < sampleCount; chunk++) {
    // stsc chunk numbers are 1-based.
    let perChunk = 0;
    for (const r of runs) {
      if (r.firstChunk <= chunk + 1) perChunk = r.perChunk;
      else break;
    }
    let off = chunkOffset(chunk);
    for (let k = 0; k < perChunk && sampleIdx < sampleCount; k++) {
      const size = sizeAt(sampleIdx);
      const delta = nextDelta();
      samples.push({
        offset: off,
        size,
        timeMs: (ticks / timescale) * 1000,
        durationMs: (delta / timescale) * 1000,
      });
      ticks += delta;
      off += size;
      sampleIdx++;
    }
  }
  return samples;
}

/**
 * Read just the box headers to locate `moov`, then parse it. Returns null for
 * files that aren't MP4/QuickTime (no `ftyp`/`moov`).
 */
export async function readMp4Index(reader: RangeReader): Promise<Mp4Index | null> {
  let off = 0;
  let moov: { start: number; size: number } | null = null;
  let sawFtyp = false;

  for (let n = 0; off + 8 <= reader.size && n < MAX_TOP_LEVEL_BOXES; n++) {
    const head = await reader.read(off, Math.min(16, reader.size - off));
    let size = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    if (n === 0 && !/^[\x20-\x7e]{4}$/.test(type)) return null;
    if (type === 'ftyp') sawFtyp = true;
    if (size === 1 && head.length >= 16) size = Number(head.readBigUInt64BE(8));
    else if (size === 0) size = reader.size - off;
    if (size < 8) return null;
    if (type === 'moov') {
      moov = { start: off, size };
      break;
    }
    off += size;
  }

  if (!sawFtyp || !moov) return null;
  if (moov.size > MAX_MOOV_BYTES) throw new Error(`moov box is ${moov.size} bytes — too large to index`);

  const buf = await reader.read(moov.start, Math.min(moov.size, reader.size - moov.start));
  const tracks: Mp4Track[] = [];
  const headerLen = buf.readUInt32BE(0) === 1 ? 16 : 8;
  for (const box of childBoxes(buf, headerLen, buf.length)) {
    if (box.type !== 'trak') continue;
    const t = parseTrack(buf, box);
    if (t) tracks.push(t);
  }
  return { tracks };
}
