/**
 * Insta360 trailer GPS — EXPERIMENTAL.
 *
 * Implemented from telemetry-parser's documented layout
 * (https://github.com/AdrianEddy/telemetry-parser, src/insta360) and checked
 * only against files *without* GPS; no GPS-bearing sample has been tested.
 *
 * Layout (all little-endian):
 *   Footer = last 72 bytes: padding[32], trailerSize u32, version u32, magic[32].
 *   Each record's data is followed by a 6-byte descriptor: format u8, id u8, size u32.
 *   The descriptor just before the footer is normally the Offsets record (id 0):
 *   10-byte entries of id u8, format u8, size u32, offset u32 (from trailer start).
 *   GPS = record id 7: packed 53-byte samples —
 *     unix secs u64, millis u16, fix u8 ('A' acquired / 'V' void),
 *     lat f64, latRef u8 (N/S), lon f64, lonRef u8 (E/W),
 *     speed f64 (m/s), track f64, altitude f64.
 */
import type { CameraGpsProbe, CameraGpsSample } from '../../shared/types/gps';
import type { RangeReader } from './reader';

export const INSTA360_MAGIC = Buffer.from('8db42d694ccc418790edff439fe026bf', 'latin1');
const FOOTER_SIZE = 72;
const DESCRIPTOR_SIZE = 6;
const RECORD_OFFSETS = 0;
const RECORD_METADATA = 1;
const RECORD_GPS = 7;
const GPS_SAMPLE_SIZE = 53;
const MAX_RECORDS = 256;
/** GPS records beyond this are not plausible (≈ 20 h at 10 Hz). */
const MAX_GPS_RECORD_BYTES = 64 * 1024 * 1024;

export const INSTA360_EXPERIMENTAL_WARNING =
  'Insta360 GPS support is experimental: it is built from the published file format but has not been tested '
  + 'with real GPS-remote footage. Check the alignment visually.';

interface TrailerRecord {
  id: number;
  format: number;
  size: number;
  /** Absolute file offset of the record data. */
  offset: number;
}

interface Trailer {
  version: number;
  start: number;
  records: TrailerRecord[];
}

/** Read the footer + record index. Returns null when the file has no Insta360 trailer. */
export async function readInsta360Trailer(reader: RangeReader): Promise<Trailer | null> {
  if (reader.size < FOOTER_SIZE + DESCRIPTOR_SIZE) return null;
  const footer = await reader.read(reader.size - FOOTER_SIZE, FOOTER_SIZE);
  if (!footer.subarray(40, 72).equals(INSTA360_MAGIC)) return null;

  const trailerSize = footer.readUInt32LE(32);
  const version = footer.readUInt32LE(36);
  if (trailerSize < FOOTER_SIZE || trailerSize > reader.size) return null;
  const start = reader.size - trailerSize;

  const descAt = reader.size - FOOTER_SIZE - DESCRIPTOR_SIZE;
  const desc = await reader.read(descAt, DESCRIPTOR_SIZE);
  const firstId = desc.readUInt8(1);
  const firstSize = desc.readUInt32LE(2);

  const records: TrailerRecord[] = [];

  if (firstId === RECORD_OFFSETS && firstSize > 0 && descAt - firstSize >= start) {
    // Preferred: offsets table (all recent cameras, incl. X4/X5/X6).
    const table = await reader.read(descAt - firstSize, firstSize);
    for (let i = 0; i + 10 <= table.length; i += 10) {
      const id = table.readUInt8(i);
      if (id === 0) continue;
      const size = table.readUInt32LE(i + 2);
      const offset = start + table.readUInt32LE(i + 6);
      if (offset + size > reader.size - FOOTER_SIZE) continue;
      records.push({ id, format: table.readUInt8(i + 1), size, offset });
    }
  } else {
    // Older files: walk descriptors backwards from the footer.
    let end = descAt + DESCRIPTOR_SIZE;
    for (let n = 0; n < MAX_RECORDS; n++) {
      const at = end - DESCRIPTOR_SIZE;
      if (at < start) break;
      const d = await reader.read(at, DESCRIPTOR_SIZE);
      const size = d.readUInt32LE(2);
      const dataStart = at - size;
      if (dataStart < start) break; // Corrupt or unknown layout — stop rather than guess.
      records.push({ id: d.readUInt8(1), format: d.readUInt8(0), size, offset: dataStart });
      end = dataStart;
    }
  }

  return { version, start, records };
}

/** Camera model from the metadata record (protobuf; we just scan for the model string). */
async function readModel(reader: RangeReader, trailer: Trailer): Promise<string | undefined> {
  const meta = trailer.records.find((r) => r.id === RECORD_METADATA);
  if (!meta || meta.size === 0 || meta.size > 64 * 1024) return undefined;
  const text = (await reader.read(meta.offset, meta.size)).toString('latin1');
  return /Insta360 [A-Za-z0-9 ]+?(?=[^A-Za-z0-9 ]|$)/.exec(text)?.[0]?.trim();
}

interface RawGps {
  utcMs: number;
  acquired: boolean;
  lat: number;
  lon: number;
  speed: number;
}

function decodeSample(buf: Buffer, off: number): RawGps {
  const secs = Number(buf.readBigUInt64LE(off));
  const millis = buf.readUInt16LE(off + 8);
  const fix = String.fromCharCode(buf.readUInt8(off + 10));
  let lat = buf.readDoubleLE(off + 11);
  const latRef = String.fromCharCode(buf.readUInt8(off + 19));
  let lon = buf.readDoubleLE(off + 20);
  const lonRef = String.fromCharCode(buf.readUInt8(off + 28));
  const speed = buf.readDoubleLE(off + 29);
  if (latRef === 'S') lat = -Math.abs(lat);
  if (lonRef === 'W') lon = -Math.abs(lon);
  return { utcMs: secs * 1000 + millis, acquired: fix === 'A', lat, lon, speed };
}

function plausible(g: RawGps): boolean {
  return g.acquired
    && Math.abs(g.lat) <= 90 && Math.abs(g.lon) <= 180
    && g.utcMs > Date.UTC(2015, 0, 1) && g.utcMs < Date.UTC(2100, 0, 1);
}

type ProbeBody = Omit<CameraGpsProbe, 'bytesRead' | 'elapsedMs'>;

export async function probeInsta360(reader: RangeReader, trailer: Trailer): Promise<ProbeBody> {
  const base = { format: 'insta360' as const, experimental: true };
  const model = await readModel(reader, trailer);
  const gps = trailer.records.find((r) => r.id === RECORD_GPS);
  const name = model ?? 'This Insta360 file';

  if (!gps || gps.size === 0) {
    return {
      ...base,
      status: 'no-gps',
      model,
      reason: `${name} has no GPS record. Insta360 cameras only record GPS with the GPS remote (or app GPS) connected.`,
    };
  }
  if (gps.size % GPS_SAMPLE_SIZE !== 0 || gps.size > MAX_GPS_RECORD_BYTES) {
    return {
      ...base,
      status: 'unsupported',
      model,
      reason: `${name} has GPS data in a layout this version doesn't recognise (record of ${gps.size} bytes).`,
    };
  }

  // Spot-check up to 20 samples spread across the record.
  const count = gps.size / GPS_SAMPLE_SIZE;
  const step = Math.max(1, Math.floor(count / 20));
  for (let i = 0; i < count; i += step) {
    const buf = await reader.read(gps.offset + i * GPS_SAMPLE_SIZE, GPS_SAMPLE_SIZE);
    if (plausible(decodeSample(buf, 0))) {
      return { ...base, status: 'available', model, reason: `GPS found (${name}). Experimental.` };
    }
  }
  return { ...base, status: 'no-gps', model, reason: `${name} has a GPS record but no satellite fix.` };
}

export async function extractInsta360(
  reader: RangeReader,
  trailer: Trailer,
  videoDurationMs: number | undefined,
): Promise<{ samples: CameraGpsSample[]; model?: string; warnings: string[] }> {
  const model = await readModel(reader, trailer);
  const gps = trailer.records.find((r) => r.id === RECORD_GPS);
  const warnings = [INSTA360_EXPERIMENTAL_WARNING];
  if (!gps || gps.size % GPS_SAMPLE_SIZE !== 0) return { samples: [], model, warnings };

  const buf = await reader.read(gps.offset, gps.size);
  const raw: RawGps[] = [];
  for (let off = 0; off + GPS_SAMPLE_SIZE <= buf.length; off += GPS_SAMPLE_SIZE) {
    const g = decodeSample(buf, off);
    if (plausible(g)) raw.push(g);
  }
  raw.sort((a, b) => a.utcMs - b.utcMs);
  if (raw.length === 0) return { samples: [], model, warnings };

  // The trailer stores GPS by UTC only — there is no per-sample video time.
  // Assume the GPS log starts when recording starts; flag it when that looks wrong.
  const firstUtc = raw[0]!.utcMs;
  warnings.push(
    'Insta360 GPS has no video timestamps, so the first GPS fix is assumed to be the start of the recording. '
    + 'If the GPS remote took a while to get a fix, the offset will be off by that delay.',
  );
  const spanMs = raw[raw.length - 1]!.utcMs - firstUtc;
  if (videoDurationMs && spanMs > videoDurationMs + 5000) {
    warnings.push(
      `The GPS log (${(spanMs / 1000).toFixed(0)} s) is longer than the video (${(videoDurationMs / 1000).toFixed(0)} s), `
      + 'so the start-of-recording assumption is probably wrong for this file.',
    );
  }

  const samples = raw.map((g) => ({
    videoMs: g.utcMs - firstUtc,
    utcMs: g.utcMs,
    lat: g.lat,
    lon: g.lon,
    speed: g.speed,
    fix: 3,
  }));
  return { samples, model, warnings };
}
