import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, cpus } from 'node:os';
import { FFMPEG_BIN } from '../ffmpeg-binaries';
import type { PreviewProgress, PreviewSegment } from '../../shared/types/ipc';
import type { TimelineClip } from '../../shared/types/project';
import { clipInMs, clipOutMs } from '../../shared/timeline';

const PREVIEW_MAX_WIDTH = 1280;
const PREVIEW_MAX_HEIGHT = 720;

/**
 * Max number of trim re-encodes to run at once. Each ffmpeg/libx264 process is
 * itself multi-threaded, so we cap concurrency well below the core count to get
 * parallel throughput without oversubscribing the CPU.
 */
const PREVIEW_ENCODE_CONCURRENCY = Math.max(1, Math.min(4, cpus().length || 1));

export type EncodeProfile = 'preview' | 'source';

export interface BuildPreviewOptions {
  profile?: EncodeProfile;
  /** Abort the build (kills any running ffmpeg) when the timeline changes mid-build. */
  signal?: AbortSignal;
  onProgress?: (progress: PreviewProgress) => void;
}

type EncodeSlot = {
  clipIndex: number;
  weight: number;
  fraction: number;
  done: boolean;
};

/** Weighted progress across parallel clip encodes and a final concat step. */
class PreviewProgressReporter {
  private slots: EncodeSlot[] = [];
  private concatWeight = 0;
  private concatFraction = 0;
  private probingWeight = 0;
  private probingDone = true;
  private clipCount = 0;
  private finished = false;

  constructor(private readonly onProgress: (progress: PreviewProgress) => void) {}

  plan(segments: PreviewSegment[], reencode: boolean[]): void {
    this.clipCount = segments.length;
    let encodeWeight = 0;
    for (let i = 0; i < segments.length; i++) {
      if (!reencode[i]) continue;
      const w = trimmedDurationSec(segments[i]!);
      this.slots.push({ clipIndex: i, weight: w, fraction: 0, done: false });
      encodeWeight += w;
    }
    const outputSec = segments.reduce((sum, seg) => sum + trimmedDurationSec(seg), 0);
    this.concatWeight = this.slots.length > 0
      ? Math.max(0.5, encodeWeight * 0.05)
      : Math.max(0.5, outputSec * 0.1);
    this.probingWeight = this.slots.length > 0 ? Math.max(0.25, encodeWeight * 0.02) : 0;
    this.probingDone = this.probingWeight === 0;
    this.emitCurrent('encoding', 'Preparing preview…');
  }

  planConcatOnly(segments: PreviewSegment[]): void {
    this.clipCount = segments.length;
    const outputSec = segments.reduce((sum, seg) => sum + trimmedDurationSec(seg), 0);
    this.concatWeight = Math.max(0.5, outputSec * 0.1);
    this.probingDone = true;
    this.emitCurrent('concat', 'Joining clips…');
  }

  markProbing(): void {
    if (this.probingDone) return;
    this.emitCurrent('probing', 'Preparing encoder…');
  }

  markProbingDone(): void {
    this.probingDone = true;
    this.emitCurrent('encoding', this.slots.length > 0 ? 'Encoding clips…' : 'Preparing preview…');
  }

  markEncodeStart(slotIndex: number): void {
    const slot = this.slots[slotIndex];
    if (!slot) return;
    slot.fraction = 0;
    this.emitCurrent('encoding', encodeMessage(slot.clipIndex, this.clipCount));
  }

  setEncodeFraction(slotIndex: number, fraction: number): void {
    const slot = this.slots[slotIndex];
    if (!slot || slot.done) return;
    slot.fraction = Math.max(0, Math.min(1, fraction));
    this.emitCurrent('encoding', encodeMessage(slot.clipIndex, this.clipCount), slot.clipIndex, slot.fraction * 100);
  }

  markEncodeDone(slotIndex: number): void {
    const slot = this.slots[slotIndex];
    if (!slot) return;
    slot.fraction = 1;
    slot.done = true;
    this.emitCurrent('encoding', encodeMessage(slot.clipIndex, this.clipCount), slot.clipIndex, 100);
  }

  setConcatFraction(fraction: number): void {
    this.concatFraction = Math.max(0, Math.min(1, fraction));
    this.emitCurrent('concat', this.slots.length > 0 ? 'Joining clips…' : 'Joining clips…');
  }

  markDone(): void {
    if (this.finished) return;
    this.finished = true;
    for (const slot of this.slots) {
      slot.fraction = 1;
      slot.done = true;
    }
    this.concatFraction = 1;
    this.probingDone = true;
    this.onProgress({ phase: 'done', percent: 100, message: 'Preview ready' });
  }

  private totalWeight(): number {
    const encodeWeight = this.slots.reduce((sum, slot) => sum + slot.weight, 0);
    return encodeWeight + this.concatWeight + (this.probingDone ? 0 : this.probingWeight);
  }

  private completedWeight(): number {
    let done = 0;
    if (!this.probingDone) return 0;
    done += this.probingWeight;
    for (const slot of this.slots) {
      done += slot.weight * (slot.done ? 1 : slot.fraction);
    }
    done += this.concatWeight * this.concatFraction;
    return done;
  }

  private emitCurrent(
    phase: PreviewProgress['phase'],
    message: string,
    clipIndex?: number,
    clipPercent?: number,
  ): void {
    if (this.finished) return;
    const total = this.totalWeight();
    const percent = total > 0 ? Math.min(99, (this.completedWeight() / total) * 100) : 0;
    this.onProgress({
      phase,
      percent,
      clipIndex,
      clipCount: this.clipCount,
      clipPercent,
      message,
    });
  }
}

function trimmedDurationSec(seg: PreviewSegment): number {
  return Math.max(0.05, (seg.outMs - seg.inMs) / 1000);
}

function encodeMessage(clipIndex: number, clipCount: number): string {
  return clipCount > 1
    ? `Encoding clip ${clipIndex + 1} of ${clipCount}…`
    : 'Encoding preview…';
}

function appendFfmpegProgress(
  chunk: string,
  buffer: { tail: string },
  durationSec: number,
  onProgress: (fraction: number) => void,
): void {
  buffer.tail += chunk;
  const parts = buffer.tail.split('\n');
  buffer.tail = parts.pop() ?? '';
  for (const line of parts) {
    const trimmed = line.trim();
    if (trimmed.startsWith('out_time_ms=')) {
      const ms = Number(trimmed.slice('out_time_ms='.length));
      if (Number.isFinite(ms) && durationSec > 0) {
        onProgress(Math.min(1, ms / 1000 / durationSec));
      }
    } else if (trimmed === 'progress=end') {
      onProgress(1);
    }
  }
}

type CacheEntry = { path: string; tempDir: string | null };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

/**
 * Per-clip re-encode cache, keyed by (profile, source, in, out) and independent
 * of clip order/position. Lets a reorder or move reuse already-rendered trimmed
 * segments and only re-run the cheap stream-copy concat. LRU-bounded so repeated
 * trimming doesn't grow temp storage without limit.
 */
type SegmentCacheEntry = { path: string; dir: string };
const segmentCache = new Map<string, SegmentCacheEntry>();
const SEGMENT_CACHE_MAX = 64;

function segmentKey(segments: PreviewSegment[], profile: EncodeProfile): string {
  const body = segments
    .map((s, i) => `${i}\0${s.path}\0${Math.round(s.inMs)}\0${Math.round(s.outMs)}`)
    .join('\n');
  return `${profile}\n${body}`;
}

function perClipKey(seg: PreviewSegment, profile: EncodeProfile): string {
  return `${profile}\0${seg.path}\0${Math.round(seg.inMs)}\0${Math.round(seg.outMs)}`;
}

class PreviewAbortError extends Error {
  constructor(label: string) {
    super(`ffmpeg ${label} aborted`);
    this.name = 'PreviewAbortError';
  }
}

/** True when a preview build rejected because it was superseded/cancelled (not a real failure). */
export function isPreviewAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PreviewAbortError';
}

/** Get a cached re-encoded segment or encode (and cache) it. Skips work on cache hit. */
async function getOrEncodeSegment(
  seg: PreviewSegment,
  profile: EncodeProfile,
  signal?: AbortSignal,
  reporter?: PreviewProgressReporter,
  slotIndex?: number,
): Promise<string> {
  const key = perClipKey(seg, profile);
  const hit = segmentCache.get(key);
  if (hit) {
    // Refresh LRU recency.
    segmentCache.delete(key);
    segmentCache.set(key, hit);
    if (reporter != null && slotIndex != null) reporter.markEncodeDone(slotIndex);
    return hit.path;
  }

  if (reporter != null && slotIndex != null) reporter.markEncodeStart(slotIndex);

  const dir = await mkdtemp(join(tmpdir(), 'dg-segment-'));
  const out = join(dir, 'segment.mp4');
  try {
    await trimReencode(seg, out, profile, signal, reporter, slotIndex);
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  if (reporter != null && slotIndex != null) reporter.markEncodeDone(slotIndex);
  segmentCache.set(key, { path: out, dir });
  evictSegmentCache();
  return out;
}

function evictSegmentCache(): void {
  while (segmentCache.size > SEGMENT_CACHE_MAX) {
    const oldest = segmentCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const entry = segmentCache.get(oldest);
    segmentCache.delete(oldest);
    if (entry) void rm(entry.dir, { recursive: true, force: true });
  }
}

function isTrimmed(seg: PreviewSegment): boolean {
  return seg.inMs > 0 || seg.outMs < seg.durationMs - 1;
}

/** Run async tasks with a bounded number running concurrently, preserving completion of all. */
async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  if (tasks.length === 0) return;
  const max = Math.max(1, Math.min(limit, tasks.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: max }, () => worker()));
}

/**
 * Build (or return cached) a single preview MP4 for all clip segments.
 * Untrimmed single clip → its path directly. Untrimmed multi-clip → fast
 * concat copy. Any trimmed clip → only the trimmed segments are re-encoded
 * (in parallel); untrimmed clips pass through untouched and the parts are
 * stream-copy concatenated.
 */
export async function buildPreviewVideo(
  segments: PreviewSegment[],
  options: BuildPreviewOptions = {},
): Promise<string> {
  const profile = options.profile ?? 'preview';
  const { signal, onProgress } = options;
  if (segments.length === 0) throw new Error('No clips to preview.');

  const anyTrim = segments.some(isTrimmed);
  if (!anyTrim && segments.length === 1) return segments[0]!.path;

  const key = segmentKey(segments, profile);
  const cached = cache.get(key);
  if (cached?.path) {
    onProgress?.({ phase: 'done', percent: 100, message: 'Preview ready' });
    return cached.path;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const build = buildPreviewToDisk(segments, anyTrim, profile, signal, onProgress);
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
  signal?: AbortSignal,
  onProgress?: (progress: PreviewProgress) => void,
): Promise<string> {
  const reporter = onProgress ? new PreviewProgressReporter(onProgress) : null;
  const key = segmentKey(segments, profile);
  const prevEntry = cache.get(key);

  const tempDir = await mkdtemp(join(tmpdir(), 'dg-preview-'));
  const outPath = join(tempDir, 'preview.mp4');

  try {
    let resultPath: string;
    // Temp dir owned by this build's cache entry (null when the result is a
    // per-clip cached segment that owns its own dir).
    let ownDir: string | null = tempDir;

    if (!anyTrim) {
      reporter?.planConcatOnly(segments);
      const listPath = join(tempDir, 'concat.txt');
      await writeConcatList(listPath, segments.map((s) => s.path));
      const concatDurationSec = segments.reduce((sum, seg) => sum + trimmedDurationSec(seg), 0);
      await runConcatCopy(listPath, outPath, signal, {
        durationSec: concatDurationSec,
        onProgress: (fraction) => reporter?.setConcatFraction(fraction),
      });
      resultPath = outPath;
    } else {
      const reencode = segments.map(isTrimmed);
      reporter?.plan(segments, reencode);
      reporter?.markProbing();
      await resolveH264Encoder();
      reporter?.markProbingDone();

      const encodeProfile: EncodeProfile = reencode.some((r) => !r) ? 'source' : profile;

      const segPaths = new Array<string>(segments.length);
      const encodeTasks: Array<() => Promise<void>> = [];
      let slotIndex = 0;
      for (let i = 0; i < segments.length; i++) {
        if (reencode[i]) {
          const seg = segments[i]!;
          const idx = i;
          const currentSlot = slotIndex++;
          encodeTasks.push(async () => {
            segPaths[idx] = await getOrEncodeSegment(seg, encodeProfile, signal, reporter ?? undefined, currentSlot);
          });
        } else {
          segPaths[i] = segments[i]!.path;
        }
      }

      await runWithConcurrency(encodeTasks, PREVIEW_ENCODE_CONCURRENCY);

      if (segPaths.length === 1) {
        resultPath = segPaths[0]!;
        ownDir = null;
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      } else {
        reporter?.setConcatFraction(0);
        const listPath = join(tempDir, 'concat.txt');
        await writeConcatList(listPath, segPaths);
        const concatDurationSec = segments.reduce((sum, seg) => sum + trimmedDurationSec(seg), 0);
        await runConcatCopy(listPath, outPath, signal, {
          durationSec: concatDurationSec,
          onProgress: (fraction) => reporter?.setConcatFraction(fraction),
        });
        resultPath = outPath;
      }
    }

    cache.set(key, { path: resultPath, tempDir: ownDir });
    if (prevEntry?.tempDir && prevEntry.tempDir !== ownDir) {
      await rm(prevEntry.tempDir, { recursive: true, force: true }).catch(() => {});
    }
    reporter?.markDone();
    return resultPath;
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

function runConcatCopy(
  listPath: string,
  outPath: string,
  signal?: AbortSignal,
  progress?: { durationSec: number; onProgress?: (fraction: number) => void },
): Promise<void> {
  return runFfmpeg([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outPath,
  ], 'preview concat', signal, progress);
}

/** Frame-accurate trim with re-encode so trimmed previews start exactly at inMs. */
async function trimReencode(
  seg: PreviewSegment,
  outPath: string,
  profile: EncodeProfile,
  signal?: AbortSignal,
  reporter?: PreviewProgressReporter,
  slotIndex?: number,
): Promise<void> {
  const encoder = await resolveH264Encoder();
  const inSec = Math.max(0, seg.inMs / 1000);
  const durSec = trimmedDurationSec(seg);
  const args: string[] = [
    '-y',
    '-ss', String(inSec),
    '-i', seg.path,
    '-t', String(durSec),
  ];

  if (profile === 'preview') {
    args.push(
      '-vf',
      `scale=${PREVIEW_MAX_WIDTH}:${PREVIEW_MAX_HEIGHT}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    );
  }

  args.push('-c:v', encoder, ...encoderQualityArgs(encoder, profile));
  if (profile === 'preview') {
    args.push('-an');
  } else {
    args.push('-c:a', 'aac');
  }

  // yuv420p output keeps re-encoded parts compatible with passthrough source
  // clips for the stream-copy concat, regardless of which encoder produced them.
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath);
  return runFfmpeg(args, 'preview trim', signal, {
    durationSec: durSec,
    onProgress: (fraction) => {
      if (reporter != null && slotIndex != null) reporter.setEncodeFraction(slotIndex, fraction);
    },
  });
}

type H264Encoder =
  | 'h264_nvenc'
  | 'h264_qsv'
  | 'h264_amf'
  | 'h264_videotoolbox'
  | 'libx264';

let resolvedEncoder: H264Encoder | null = null;
let encoderProbe: Promise<H264Encoder> | null = null;

/** Hardware encoder candidates to try, best-first, per platform; libx264 is the universal fallback. */
function encoderCandidates(): H264Encoder[] {
  switch (process.platform) {
    case 'win32':
      return ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];
    case 'darwin':
      return ['h264_videotoolbox', 'libx264'];
    default:
      return ['h264_nvenc', 'h264_qsv', 'libx264'];
  }
}

/** Encoder-specific quality/speed flags. Preview favors speed; source favors quality. */
function encoderQualityArgs(encoder: H264Encoder, profile: EncodeProfile): string[] {
  const preview = profile === 'preview';
  switch (encoder) {
    case 'h264_nvenc':
      return preview
        ? ['-preset', 'p1', '-rc', 'vbr', '-cq', '28', '-b:v', '0']
        : ['-preset', 'p4', '-rc', 'vbr', '-cq', '22', '-b:v', '0'];
    case 'h264_qsv':
      return preview
        ? ['-preset', 'veryfast', '-global_quality', '28']
        : ['-preset', 'veryfast', '-global_quality', '22'];
    case 'h264_amf':
      return preview
        ? ['-quality', 'speed', '-rc', 'cqp', '-qp_i', '28', '-qp_p', '28']
        : ['-quality', 'balanced', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '22'];
    case 'h264_videotoolbox':
      return preview ? ['-q:v', '50'] : ['-q:v', '62'];
    case 'libx264':
    default:
      return preview
        ? ['-preset', 'ultrafast', '-crf', '24']
        : ['-preset', 'veryfast', '-crf', '20'];
  }
}

/**
 * Pick the fastest working H.264 encoder once per process. A codec being listed
 * by ffmpeg doesn't mean the hardware/driver is usable, so each candidate is
 * confirmed with a tiny throwaway encode before being selected.
 */
function resolveH264Encoder(): Promise<H264Encoder> {
  if (resolvedEncoder) return Promise.resolve(resolvedEncoder);
  if (encoderProbe) return encoderProbe;
  encoderProbe = (async (): Promise<H264Encoder> => {
    let available: Set<string>;
    try {
      available = await listFfmpegEncoders();
    } catch {
      available = new Set();
    }
    for (const codec of encoderCandidates()) {
      if (codec === 'libx264') break;
      if (!available.has(codec)) continue;
      if (await testEncoder(codec)) {
        resolvedEncoder = codec;
        console.info(`[preview] using hardware H.264 encoder: ${codec}`);
        return codec;
      }
    }
    resolvedEncoder = 'libx264';
    console.info('[preview] using software H.264 encoder: libx264');
    return 'libx264';
  })();
  return encoderProbe;
}

async function listFfmpegEncoders(): Promise<Set<string>> {
  const stdout = await runFfmpegCapture(['-hide_banner', '-encoders']);
  const set = new Set<string>();
  for (const line of stdout.split('\n')) {
    // Encoder rows look like: " V....D h264_nvenc           NVIDIA NVENC ..."
    const m = line.match(/^\s*[A-Z.]{6}\s+(\S+)/);
    if (m) set.add(m[1]!);
  }
  return set;
}

function testEncoder(codec: string): Promise<boolean> {
  return runFfmpeg([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=256x144:r=30',
    '-frames:v', '5',
    '-c:v', codec,
    '-pix_fmt', 'yuv420p',
    '-f', 'null', '-',
  ], `probe ${codec}`).then(() => true, () => false);
}

function runFfmpeg(
  args: string[],
  label: string,
  signal?: AbortSignal,
  progress?: { durationSec: number; onProgress?: (fraction: number) => void },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PreviewAbortError(label));
      return;
    }
    const ffmpegArgs = progress?.onProgress
      ? [...args.slice(0, -1), '-progress', 'pipe:2', '-loglevel', 'error', args.at(-1)!]
      : args;
    const proc = spawn(FFMPEG_BIN, ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const progressBuffer = { tail: '' };
    let aborted = false;
    const onAbort = (): void => {
      aborted = true;
      proc.kill('SIGKILL');
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    proc.stderr?.on('data', (c) => {
      const text = c.toString();
      stderr = (stderr + text).slice(-8000);
      if (progress?.onProgress && progress.durationSec > 0) {
        appendFfmpegProgress(text, progressBuffer, progress.durationSec, progress.onProgress);
      }
    });
    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (aborted) {
        reject(new PreviewAbortError(label));
      } else if (code === 0) {
        progress?.onProgress?.(1);
        resolve();
      } else {
        reject(new Error(stderr.trim() || `ffmpeg ${label} exited with code ${code}`));
      }
    });
  });
}

function runFfmpegCapture(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    proc.stdout?.on('data', (c) => { stdout += c.toString(); });
    proc.on('error', reject);
    proc.on('close', () => resolve(stdout));
  });
}

export function clearPreviewCache(): void {
  for (const entry of cache.values()) {
    if (entry.tempDir) {
      void rm(entry.tempDir, { recursive: true, force: true });
    }
  }
  cache.clear();
  for (const entry of segmentCache.values()) {
    void rm(entry.dir, { recursive: true, force: true });
  }
  segmentCache.clear();
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
