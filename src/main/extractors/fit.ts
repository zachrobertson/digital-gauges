import { readFile } from 'node:fs/promises';
import type { TelemetryTrack } from '../../shared/types';
import { emptyTrack, finalizeTrack, pushFrame } from './util';

interface FitRecord {
  timestamp?: Date | string;
  position_lat?: number;
  position_long?: number;
  altitude?: number;
  enhanced_altitude?: number;
  speed?: number;
  enhanced_speed?: number;
  heart_rate?: number;
  cadence?: number;
  power?: number;
  temperature?: number;
  distance?: number;
  grade?: number;
}

interface FitData {
  records?: FitRecord[];
  device_infos?: Array<{ manufacturer?: string; product?: string }>;
  file_id?: { manufacturer?: string; product?: string };
}

/**
 * Parse a `.fit` file (bike computer / smartwatch) into a TelemetryTrack.
 *
 * Uses `fit-file-parser` because its single-call API is simpler than
 * @garmin/fitsdk's manual mesg handlers; the SDK is still the right
 * fallback for files this library chokes on.
 */
export async function parseFitFile(filePath: string): Promise<TelemetryTrack> {
  const buffer = await readFile(filePath);

  const mod = await import('fit-file-parser');
  const FitParser: any = (mod as any).default ?? (mod as any).FitParser ?? mod;

  const parser = new FitParser({
    force: true,
    speedUnit: 'm/s',
    lengthUnit: 'm',
    temperatureUnit: 'celsius',
    elapsedRecordField: false,
    mode: 'list',
  });

  const data: FitData = await new Promise((resolve, reject) => {
    parser.parse(buffer, (err: Error | string | null, result: FitData) => {
      if (err) reject(typeof err === 'string' ? new Error(err) : err);
      else resolve(result);
    });
  });

  const records = data.records ?? [];

  const brand = inferFitBrand(data);
  const startTime = records[0]?.timestamp
    ? new Date(records[0].timestamp as string | Date)
    : new Date();

  const track = emptyTrack('fit', brand, startTime);

  for (const r of records) {
    if (!r.timestamp) continue;
    const t = new Date(r.timestamp as string | Date).getTime();
    const offsetMs = t - startTime.getTime();
    pushFrame(track, offsetMs, {
      lat: numberOrUndef(r.position_lat),
      lon: numberOrUndef(r.position_long),
      alt: numberOrUndef(r.enhanced_altitude ?? r.altitude),
      speed: numberOrUndef(r.enhanced_speed ?? r.speed),
      hr: numberOrUndef(r.heart_rate),
      cadence: numberOrUndef(r.cadence),
      power: numberOrUndef(r.power),
      temp: numberOrUndef(r.temperature),
      distance: numberOrUndef(r.distance),
      grade: numberOrUndef(r.grade !== undefined ? r.grade / 100 : undefined),
    });
  }

  if (track.frames.length === 0) {
    track.warnings.push('FIT file contained no record messages.');
  }

  return finalizeTrack(track);
}

function inferFitBrand(data: FitData): string {
  const fid = data.file_id;
  const fromFileId = [fid?.manufacturer, fid?.product].filter(Boolean).join(' ').trim();
  if (fromFileId) return capitalizeBrand(fromFileId);

  const dev = data.device_infos?.[0];
  const fromDev = [dev?.manufacturer, dev?.product].filter(Boolean).join(' ').trim();
  if (fromDev) return capitalizeBrand(fromDev);

  return 'Unknown FIT device';
}

function capitalizeBrand(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function numberOrUndef(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return v;
}
