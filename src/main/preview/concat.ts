import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ffmpegPath from 'ffmpeg-static';
import type { PreviewSegment } from '../../shared/types/ipc';
import type { TimelineClip } from '../../shared/types/project';
import { clipInMs, clipOutMs } from '../../shared/timeline';

const FFMPEG_BIN: string = ((): string => {
  if (typeof ffmpegPath === 'string') return ffmpegPath;
  if (ffmpegPath && typeof (ffmpegPath as { path?: string }).path === 'string') {
    return (ffmpegPath as { path: string }).path;
  }
  throw new Error('Could not resolve ffmpeg-static binary path.');
})();

const PREVIEW_MAX_WIDTH = 1280;
const PREVIEW_MAX_HEIGHT = 720;

export type EncodeProfile = 'preview' | 'source';

export interface BuildPreviewOptions {
  profile?: EncodeProfile;
}

type CacheEntry = { path: string; tempDir: string | null };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

function segmentKey(segments: PreviewSegment[], profile: EncodeProfile): string {
  const body = segments
    .map((s, i) => `${i}\0${s.path}\0${Math.round(s.inMs)}\0${Math.round(s.outMs)}`)
    .join('\n');
  return `${profile}\n${body}`;
}

function isTrimmed(seg: PreviewSegment): boolean {
  return seg.inMs > 0 || seg.outMs < seg.durationMs - 1;
}

/** Untrimmed segments can use the source file when export only re-encodes trimmed clips. */
function shouldReencodeSegment(seg: PreviewSegment, profile: EncodeProfile, anyTrim: boolean): boolean {
  if (isTrimmed(seg)) return true;
  // Preview concat needs uniform params when any clip is trimmed (720p, no audio).
  if (profile === 'preview' && anyTrim) return true;
  return false;
}

/**
 * Build (or return cached) a single preview MP4 for all clip segments.
 * Untrimmed single clip → its path directly. Untrimmed multi-clip → fast
 * concat copy. Any trimmed clip → per-segment trim re-encode then concat.
 */
export async function buildPreviewVideo(
  segments: PreviewSegment[],
  options: BuildPreviewOptions = {},
): Promise<string> {
  const profile = options.profile ?? 'preview';
  if (segments.length === 0) throw new Error('No clips to preview.');

  const anyTrim = segments.some(isTrimmed);
  if (!anyTrim && segments.length === 1) return segments[0]!.path;

  const key = segmentKey(segments, profile);
  const cached = cache.get(key);
  if (cached?.path) return cached.path;

  const existing = inflight.get(key);
  if (existing) return existing;

  const build = buildPreviewToDisk(segments, anyTrim, profile);
  inflight.set(key, build);
  try {
    const path = await build;
    return path;
  } finally {
    inflight.delete(key);
  }
}

async function buildPreviewToDisk(
  segments: PreviewSegment[],
  anyTrim: boolean,
  profile: EncodeProfile,
): Promise<string> {
  const key = segmentKey(segments, profile);
  const prevEntry = cache.get(key);

  const tempDir = await mkdtemp(join(tmpdir(), 'dg-preview-'));
  const outPath = join(tempDir, 'preview.mp4');

  try {
    if (!anyTrim) {
      // Fast path: stream-copy concat of full source files.
      const listPath = join(tempDir, 'concat.txt');
      await writeConcatList(listPath, segments.map((s) => s.path));
      await runConcatCopy(listPath, outPath);
    } else {
      const segPaths: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        if (shouldReencodeSegment(seg, profile, anyTrim)) {
          const segOut = join(tempDir, `seg-${i}.mp4`);
          await trimReencode(seg, segOut, profile);
          segPaths.push(segOut);
        } else {
          segPaths.push(seg.path);
        }
      }
      if (segPaths.length === 1) {
        cache.set(key, { path: segPaths[0]!, tempDir });
        if (prevEntry?.tempDir && prevEntry.tempDir !== tempDir) {
          await rm(prevEntry.tempDir, { recursive: true, force: true }).catch(() => {});
        }
        return segPaths[0]!;
      }
      const listPath = join(tempDir, 'concat.txt');
      await writeConcatList(listPath, segPaths);
      await runConcatCopy(listPath, outPath);
    }

    cache.set(key, { path: outPath, tempDir });
    if (prevEntry?.tempDir && prevEntry.tempDir !== tempDir) {
      await rm(prevEntry.tempDir, { recursive: true, force: true }).catch(() => {});
    }
    return outPath;
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function writeConcatList(listPath: string, paths: string[]): Promise<void> {
  const lines = paths.map((p) => {
    const normalized = p.replace(/\\/g, '/');
    return `file '${normalized.replace(/'/g, "'\\''")}'`;
  }).join('\n');
  await writeFile(listPath, lines, 'utf8');
}

function runConcatCopy(listPath: string, outPath: string): Promise<void> {
  return runFfmpeg([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outPath,
  ], 'preview concat');
}

/** Frame-accurate trim with re-encode so trimmed previews start exactly at inMs. */
function trimReencode(seg: PreviewSegment, outPath: string, profile: EncodeProfile): Promise<void> {
  const inSec = Math.max(0, seg.inMs / 1000);
  const durSec = Math.max(0.05, (seg.outMs - seg.inMs) / 1000);
  const args: string[] = [
    '-y',
    '-ss', String(inSec),
    '-i', seg.path,
    '-t', String(durSec),
    '-c:v', 'libx264',
  ];

  if (profile === 'preview') {
    args.push(
      '-vf',
      `scale=${PREVIEW_MAX_WIDTH}:${PREVIEW_MAX_HEIGHT}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-preset', 'ultrafast',
      '-crf', '24',
      '-an',
    );
  } else {
    args.push('-preset', 'veryfast', '-crf', '20', '-c:a', 'aac');
  }

  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath);
  return runFfmpeg(args, 'preview trim');
}

function runFfmpeg(args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (c) => { stderr = (stderr + c.toString()).slice(-8000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg ${label} exited with code ${code}`));
    });
  });
}

export function clearPreviewCache(): void {
  for (const entry of cache.values()) {
    if (entry.tempDir) {
      void rm(entry.tempDir, { recursive: true, force: true });
    }
  }
  cache.clear();
}

/** Build preview segments from timeline clips — shared by preview and export base concat. */
export function clipsToPreviewSegments(clips: TimelineClip[]): PreviewSegment[] {
  return clips.map((c) => ({
    path: c.media.path,
    inMs: clipInMs(c),
    outMs: clipOutMs(c),
    durationMs: c.media.durationMs,
  }));
}

/** Concatenate all base clips into one MP4 spanning the global timeline. */
export async function buildBaseConcatFromClips(clips: TimelineClip[]): Promise<string> {
  return buildPreviewVideo(clipsToPreviewSegments(clips), { profile: 'source' });
}
