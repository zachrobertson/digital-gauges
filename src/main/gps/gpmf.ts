/**
 * GoPro GPMF (KLV) decoding — GPS only.
 *
 * Spec: https://github.com/gopro/gpmf-parser
 *   KLV header = 4-char key, 1-byte type, 1-byte struct size, 2-byte repeat (BE).
 *   Payload = structSize × repeat bytes, padded to 4 bytes. Type 0 = nested.
 *   DEVC → STRM → { sticky keys (SCAL, TYPE, GPSF, GPSU, …), data (GPS5 / GPS9) }.
 *
 * GPS5 (HERO5–HERO11): lat, lon, alt, 2D speed, 3D speed — int32 ÷ SCAL.
 *   UTC comes from GPSU (one per payload); fix from GPSF.
 * GPS9 (HERO11, HERO13+): lat, lon, alt, 2D speed, 3D speed, days since 2000,
 *   secs since midnight, DOP, fix — complex type described by TYPE.
 */

interface Klv {
  key: string;
  type: string;
  structSize: number;
  repeat: number;
  /** Offset of the value data. */
  data: number;
  /** Offset one past this KLV (padded). */
  next: number;
}

function readKlv(buf: Buffer, off: number, end: number): Klv | null {
  if (off + 8 > end) return null;
  const key = buf.toString('latin1', off, off + 4);
  const typeCode = buf.readUInt8(off + 4);
  const structSize = buf.readUInt8(off + 5);
  const repeat = buf.readUInt16BE(off + 6);
  const len = structSize * repeat;
  const padded = (len + 3) & ~3;
  if (off + 8 + len > end) return null;
  return {
    key,
    type: typeCode === 0 ? '\0' : String.fromCharCode(typeCode),
    structSize,
    repeat,
    data: off + 8,
    next: off + 8 + padded,
  };
}

function* klvs(buf: Buffer, start: number, end: number): Generator<Klv> {
  let off = start;
  while (off < end) {
    const k = readKlv(buf, off, end);
    if (!k) return;
    yield k;
    off = k.next;
  }
}

const TYPE_SIZE: Record<string, number> = {
  b: 1, B: 1, c: 1, s: 2, S: 2, l: 4, L: 4, f: 4, F: 4, j: 8, J: 8, d: 8, q: 4, Q: 8, U: 16,
};

/** Read one scalar of GPMF type `t` at `off`. */
function readScalar(buf: Buffer, off: number, t: string): number {
  switch (t) {
    case 'b': return buf.readInt8(off);
    case 'B': return buf.readUInt8(off);
    case 's': return buf.readInt16BE(off);
    case 'S': return buf.readUInt16BE(off);
    case 'l': return buf.readInt32BE(off);
    case 'L': return buf.readUInt32BE(off);
    case 'f': return buf.readFloatBE(off);
    case 'd': return buf.readDoubleBE(off);
    case 'j': return Number(buf.readBigInt64BE(off));
    case 'J': return Number(buf.readBigUInt64BE(off));
    case 'q': return buf.readInt32BE(off) / 65536; // Q15.16 fixed point
    case 'Q': return Number(buf.readBigInt64BE(off)) / 4294967296; // Q31.32
    default: throw new Error(`Unsupported GPMF scalar type '${t}'`);
  }
}

/** All numeric values of a KLV as a flat array. */
function readNumbers(buf: Buffer, k: Klv): number[] {
  const size = TYPE_SIZE[k.type];
  if (!size) return [];
  const count = (k.structSize * k.repeat) / size;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(readScalar(buf, k.data + i * size, k.type));
  return out;
}

function readString(buf: Buffer, k: Klv): string {
  return buf.toString('latin1', k.data, k.data + k.structSize * k.repeat).replace(/\0+$/, '').trim();
}

/** GPSU "yymmddhhmmss.sss" → epoch ms (UTC). */
export function parseGpsu(s: string): number | null {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?/.exec(s);
  if (!m) return null;
  const [, yy, mo, dd, hh, mi, ss, frac] = m;
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return Date.UTC(2000 + Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mi), Number(ss), ms);
}

const GPS9_EPOCH_MS = Date.UTC(2000, 0, 1);

export interface GpmfGpsPoint {
  /** Fraction of the payload duration at which this sample was taken (0..1). */
  t: number;
  /** UTC epoch ms when known per sample (GPS9) or per payload (GPS5 + GPSU, first sample only). */
  utcMs: number | null;
  lat: number;
  lon: number;
  speed: number;
  fix: number;
}

export interface GpmfPayloadGps {
  /** Device name (DVNM), e.g. "HERO11 Black". */
  model?: string;
  /** True if this payload contains any GPS stream at all. */
  hasGpsStream: boolean;
  points: GpmfGpsPoint[];
  /** Payload-level UTC from GPSU (GPS5 cameras). */
  payloadUtcMs: number | null;
}

/** Decode the GPS content of one GPMF payload (one MP4 `gpmd` sample). */
export function decodeGpmfPayloadGps(buf: Buffer): GpmfPayloadGps {
  const out: GpmfPayloadGps = { hasGpsStream: false, points: [], payloadUtcMs: null };
  let gps9Seen = false;
  const gps5Points: GpmfGpsPoint[] = [];

  for (const devc of klvs(buf, 0, buf.length)) {
    if (devc.key !== 'DEVC' || devc.type !== '\0') continue;
    const devEnd = devc.data + devc.structSize * devc.repeat;

    for (const k of klvs(buf, devc.data, devEnd)) {
      if (k.key === 'DVNM' && k.type === 'c') out.model ??= readString(buf, k);
      if (k.key !== 'STRM' || k.type !== '\0') continue;

      const strmEnd = k.data + k.structSize * k.repeat;
      let scal: number[] = [1];
      let typeDesc = '';
      let gpsf: number | null = null;
      let gpsu: number | null = null;

      for (const s of klvs(buf, k.data, strmEnd)) {
        switch (s.key) {
          case 'SCAL': scal = readNumbers(buf, s); break;
          case 'TYPE': typeDesc = readString(buf, s); break;
          case 'GPSF': gpsf = readNumbers(buf, s)[0] ?? null; break;
          case 'GPSU': {
            gpsu = s.type === 'U' || s.type === 'c' ? parseGpsu(readString(buf, s)) : null;
            out.payloadUtcMs ??= gpsu;
            break;
          }
          case 'GPS5': {
            out.hasGpsStream = true;
            const vals = readNumbers(buf, s);
            const per = 5;
            const n = Math.floor(vals.length / per);
            for (let i = 0; i < n; i++) {
              const v = (j: number) => vals[i * per + j]! / (scal[j] ?? scal[0] ?? 1);
              gps5Points.push({
                t: n > 1 ? i / n : 0,
                utcMs: i === 0 ? gpsu : null,
                lat: v(0),
                lon: v(1),
                speed: v(3), // 2D ground speed
                fix: gpsf ?? 0,
              });
            }
            break;
          }
          case 'GPS9': {
            out.hasGpsStream = true;
            gps9Seen = true;
            out.points.push(...decodeGps9(buf, s, scal, typeDesc));
            break;
          }
        }
      }
    }
  }

  // Prefer GPS9 (per-sample time + fix) when a camera writes both.
  if (!gps9Seen) out.points = gps5Points;
  return out;
}

function decodeGps9(buf: Buffer, k: Klv, scal: number[], typeDesc: string): GpmfGpsPoint[] {
  // GPS9 is a complex ('?') type; TYPE lists each field's scalar type. The spec's
  // layout is "lllllllSS" — fall back to it if TYPE is missing.
  const types = (k.type === '?' && typeDesc ? typeDesc : 'lllllllSS').split('');
  const sizes = types.map((t) => TYPE_SIZE[t] ?? 0);
  const recSize = sizes.reduce((a, b) => a + b, 0);
  if (recSize === 0 || recSize !== k.structSize || types.length < 9) return [];

  const points: GpmfGpsPoint[] = [];
  for (let i = 0; i < k.repeat; i++) {
    let off = k.data + i * k.structSize;
    const f: number[] = [];
    for (let j = 0; j < types.length; j++) {
      f.push(readScalar(buf, off, types[j]!) / (scal[j] ?? 1));
      off += sizes[j]!;
    }
    const [lat, lon, , speed2d, , days, secs, , fix] = f as [number, number, number, number, number, number, number, number, number];
    points.push({
      t: k.repeat > 1 ? i / k.repeat : 0,
      utcMs: Math.round(GPS9_EPOCH_MS + days * 86_400_000 + secs * 1000),
      lat,
      lon,
      speed: speed2d,
      fix: Math.round(fix),
    });
  }
  return points;
}
