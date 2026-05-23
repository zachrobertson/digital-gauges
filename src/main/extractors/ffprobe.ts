import { resolveExportDimensions, type ExportResolution } from '../../shared/export';
import { spawn } from 'node:child_process';// @ts-expect-error — ffprobe-static doesn't ship type declarations.
import ffprobePath from 'ffprobe-static';

export interface FfprobeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  codec_tag_string?: string;
  codec_tag?: string;
  handler_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  nb_frames?: string;
  tags?: Record<string, string>;
}

export interface FfprobeFormat {
  filename: string;
  duration?: string;
  bit_rate?: string;
  format_name?: string;
  tags?: Record<string, string>;
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

const FFPROBE_BIN: string =
  (ffprobePath as unknown as { path?: string })?.path ??
  (ffprobePath as unknown as string);

/**
 * Wraps ffprobe -print_format json -show_format -show_streams.
 *
 * Throws if the file isn't probeable (e.g. raw `.insv` containers will
 * fail — extractors should pre-route by extension before calling this).
 */
export async function ffprobe(filePath: string): Promise<FfprobeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE_BIN, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as FfprobeResult);
      } catch (e) {
        reject(new Error(`ffprobe JSON parse failed: ${(e as Error).message}`));
      }
    });
  });
}

/** Convenience: read the first video stream from a probe. */
export function pickVideoStream(probe: FfprobeResult): FfprobeStream | null {
  return probe.streams.find((s) => s.codec_type === 'video') ?? null;
}

/** Convenience: read all data/metadata streams. */
export function pickDataStreams(probe: FfprobeResult): FfprobeStream[] {
  return probe.streams.filter((s) => s.codec_type === 'data');
}

/** Parse "30/1" or "30000/1001" → 29.97. */
export function parseFps(rate: string | undefined): number {
  if (!rate) return 30;
  const [num, den] = rate.split('/').map((n) => parseFloat(n));
  if (!num || !den) return 30;
  return num / den;
}

/** Longest duration reported by the container or any stream (seconds). */
export function probeDurationSec(probe: FfprobeResult): number {
  const secs: number[] = [];
  if (probe.format?.duration) secs.push(parseFloat(probe.format.duration));
  for (const s of probe.streams) {
    if (s.duration) secs.push(parseFloat(s.duration));
  }
  const valid = secs.filter((n) => Number.isFinite(n) && n > 0);
  return valid.length > 0 ? Math.max(...valid) : 0;
}

export function probeDurationMs(probe: FfprobeResult): number {
  return Math.round(probeDurationSec(probe) * 1000);
}

/** ISO 8601 UTC from container tags, when ffprobe reports creation_time. */
export function probeCreationTime(probe: FfprobeResult): string | undefined {
  const raw = probe.format?.tags?.creation_time;
  if (!raw) return undefined;
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

export interface ExportMediaInfo {
  durationSec: number;
  durationMs: number;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  sourceFps: number;
  exportFps: number;
  overlayFrameCount: number;
}

/** Fresh probe used at export time — do not rely on cached project.video.durationMs. */
export async function resolveExportMediaInfo(
  videoPath: string,
  width: number,
  height: number,
  exportFps: number,
  resolution: ExportResolution = 'source',
): Promise<ExportMediaInfo> {
  const probe = await ffprobe(videoPath);
  const videoStream = pickVideoStream(probe);
  const durationSec = probeDurationSec(probe);
  if (durationSec <= 0) {
    throw new Error(`Could not determine video duration for ${videoPath}`);
  }
  const sourceWidth = videoStream?.width ?? width;
  const sourceHeight = videoStream?.height ?? height;
  const { width: outW, height: outH } = resolveExportDimensions(
    sourceWidth,
    sourceHeight,
    resolution,
  );
  const sourceFps = parseFps(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate);
  const overlayFrameCount = Math.max(1, Math.ceil(durationSec * exportFps));
  return {
    durationSec,
    durationMs: Math.round(durationSec * 1000),
    sourceWidth,
    sourceHeight,
    width: outW,
    height: outH,
    sourceFps,
    exportFps,
    overlayFrameCount,
  };
}
