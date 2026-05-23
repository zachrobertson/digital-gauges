import { spawn, type ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { resolveExportMediaInfo, type ExportMediaInfo } from '../extractors/ffprobe';
import type { Project, ExportSettings } from '../../shared/types';
import { checkExportMemoryBudget, exportMemoryBudgetError } from './budget';

const FFMPEG_BIN: string = ((): string => {
  if (typeof ffmpegPath === 'string') return ffmpegPath;
  if (ffmpegPath && typeof (ffmpegPath as { path?: string }).path === 'string') {
    return (ffmpegPath as { path: string }).path;
  }
  throw new Error('Could not resolve ffmpeg-static binary path.');
})();

type JobPhase = 'streaming' | 'finalizing';

interface JobInternal {
  id: string;
  phase: JobPhase;
  project: Project;
  media: ExportMediaInfo;
  totalFrames: number;
  framesIn: number;
  frameBytes: number;
  proc: ChildProcess;
  overlayStdin: Writable;
  outputPath: string;
  cancelled: boolean;
  stderr: string;
  onProgress: (frameIdx: number, totalFrames: number) => void;
  onDone: (result: { ok: boolean; outputPath?: string; error?: string }) => void;
}

const JOBS = new Map<string, JobInternal>();

/**
 * Single-pass export: overlay RGBA frames stream into ffmpeg stdin (pipe:0).
 * No temp raw file — peak disk use is the output MP4 only.
 *
 * Backpressure: `writeExportFrame` awaits stdin drain before resolving, so the
 * renderer sends one frame at a time and memory stays bounded (~4× frame size).
 */
export async function startExport(
  project: Project,
  onProgress: (frameIdx: number, totalFrames: number) => void,
  onDone: (result: { ok: boolean; outputPath?: string; error?: string }) => void,
): Promise<{ jobId: string; framesExpected: number; width: number; height: number; durationMs: number }> {
  if (!project.video) throw new Error('Project has no source video.');
  if (!project.export.outputPath) throw new Error('Export path not set.');

  const media = await resolveExportMediaInfo(
    project.video.path,
    project.video.width,
    project.video.height,
    project.export.fps,
    project.export.resolution ?? 'source',
  );

  const budget = checkExportMemoryBudget(media.width, media.height);
  if (!budget.ok) {
    throw new Error(exportMemoryBudgetError(media.width, media.height));
  }

  const totalFrames = media.overlayFrameCount;
  const frameBytes = media.width * media.height * 4;
  const id = randomUUID();

  const proc = spawnFfmpegProcess(project, media, project.export.outputPath);
  if (!proc.stdin) {
    proc.kill('SIGKILL');
    throw new Error('ffmpeg stdin is not available for overlay streaming.');
  }

  const job: JobInternal = {
    id,
    phase: 'streaming',
    project,
    media,
    totalFrames,
    framesIn: 0,
    frameBytes,
    proc,
    overlayStdin: proc.stdin,
    outputPath: project.export.outputPath,
    cancelled: false,
    stderr: '',
    onProgress,
    onDone,
  };

  proc.stderr?.on('data', (chunk) => {
    handleStderr(job, chunk.toString());
  });

  proc.on('error', (err) => {
    if (job.cancelled) return;
    failJob(job, err.message);
  });

  proc.on('close', (code) => {
    if (job.cancelled) return;
    if (code === 0) {
      completeJob(job, { ok: true, outputPath: job.outputPath });
    } else {
      const detail = job.stderr.trim();
      failJob(
        job,
        detail
          ? `ffmpeg exited with code ${code}: ${detail}`
          : `ffmpeg exited with code ${code}`,
      );
    }
  });

  JOBS.set(id, job);

  return {
    jobId: id,
    framesExpected: totalFrames,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
  };
}

export async function writeExportFrame(jobId: string, frame: ArrayBuffer): Promise<void> {
  const job = JOBS.get(jobId);
  if (!job) throw new Error(`Unknown export job ${jobId}`);
  if (job.cancelled) return;
  if (job.phase !== 'streaming') {
    throw new Error(`Export job ${jobId} is not accepting frames (phase=${job.phase})`);
  }

  const buf = Buffer.from(frame);
  if (buf.byteLength !== job.frameBytes) {
    throw new Error(
      `Overlay frame size mismatch: got ${buf.byteLength} bytes, ` +
        `expected ${job.frameBytes} (${job.media.width}x${job.media.height} RGBA)`,
    );
  }

  await writeStdin(job.overlayStdin, buf);
  job.framesIn++;
  job.onProgress(job.framesIn, job.totalFrames);
}

export async function finishExportFrames(jobId: string): Promise<void> {
  const job = JOBS.get(jobId);
  if (!job) throw new Error(`Unknown export job ${jobId}`);
  if (job.cancelled) return;
  if (job.phase !== 'streaming') return;

  if (job.framesIn !== job.totalFrames) {
    failJob(
      job,
      `Overlay frame count mismatch: sent ${job.framesIn}, expected ${job.totalFrames}`,
    );
    return;
  }

  job.phase = 'finalizing';
  await closeStdin(job.overlayStdin);
}

export function cancelExport(jobId: string): void {
  const job = JOBS.get(jobId);
  if (!job) return;
  job.cancelled = true;
  job.proc.kill('SIGKILL');
  job.overlayStdin.destroy();
  completeJob(job, { ok: false, error: 'cancelled' });
}

function spawnFfmpegProcess(
  project: Project,
  media: ExportMediaInfo,
  outputPath: string,
): ChildProcess {
  const video = project.video!;
  const ex = project.export;
  const fps = media.exportFps;

  const needsScale =
    media.width !== media.sourceWidth || media.height !== media.sourceHeight;
  const baseChain = needsScale
    ? `[0:v]fps=${fps},scale=${media.width}:${media.height}[base]`
    : `[0:v]fps=${fps}[base]`;
  const filterComplex = `${baseChain};[base][1:v]overlay=format=auto:eof_action=pass[v]`;

  const args: string[] = [
    '-y',
    '-i', video.path,
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${media.width}x${media.height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    '-filter_complex',
    filterComplex,
    '-map', '[v]',
    '-map', '0:a?',
    '-r', String(fps),
    '-t', String(media.durationSec),
    ...codecArgs(ex),
    '-progress', 'pipe:2',
    '-loglevel', 'warning',
    outputPath,
  ];

  return spawn(FFMPEG_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

function handleStderr(job: JobInternal, text: string): void {
  job.stderr = tail(job.stderr + text, 16_000);
  for (const line of text.split('\n')) {
    const m = line.match(/^frame=\s*(\d+)/);
    if (m) {
      const frame = parseInt(m[1], 10);
      job.onProgress(Math.min(frame, job.totalFrames), job.totalFrames);
    }
  }
}

function failJob(job: JobInternal, error: string): void {
  if (job.cancelled) return;
  job.cancelled = true;
  job.proc.kill('SIGKILL');
  job.overlayStdin.destroy();
  completeJob(job, { ok: false, error });
}

function completeJob(
  job: JobInternal,
  result: { ok: boolean; outputPath?: string; error?: string },
): void {
  if (!JOBS.has(job.id)) return;
  JOBS.delete(job.id);
  job.onDone(result);
}

function writeStdin(stream: Writable, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err?: Error | null) => {
      if (settled) return;
      settled = true;
      stream.off('error', onError);
      stream.off('drain', onDrain);
      if (err) reject(err);
      else resolve();
    };
    const onError = (err: Error) => done(err);
    const onDrain = () => done();

    stream.once('error', onError);
    const ok = stream.write(buf, (err) => done(err));
    if (!ok) stream.once('drain', onDrain);
  });
}

function closeStdin(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

function tail(s: string, max: number): string {
  return s.length <= max ? s : s.slice(-max);
}

function codecArgs(ex: ExportSettings): string[] {
  switch (ex.codec) {
    case 'h264':
      return [
        '-c:v', 'libx264',
        '-crf', String(ex.crf),
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
      ];
    case 'hevc':
      return [
        '-c:v', 'libx265',
        '-crf', String(ex.crf),
        '-preset', 'medium',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
      ];
    case 'prores4444':
      return [
        '-c:v', 'prores_ks',
        '-profile:v', '4444',
        '-pix_fmt', 'yuva444p10le',
        '-c:a', 'copy',
      ];
  }
}
