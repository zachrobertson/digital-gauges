import { spawn, type ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FFMPEG_BIN } from '../ffmpeg-binaries';
import { resolveExportMediaInfo, type ExportMediaInfo } from '../extractors/ffprobe';
import { buildBaseConcatFromClips } from '../preview/concat';
import type { Project, ExportSettings } from '../../shared/types';
import { clipDurationMs, clipInMs, projectDurationMs, totalDurationMs } from '../../shared/timeline';
import { distinctOverlayPaths, expandOverlayExportSegments } from '../../shared/overlayExport';
import { checkExportMemoryBudget, exportMemoryBudgetError } from './budget';

type JobPhase = 'streaming' | 'segment-finalizing' | 'concat' | 'finalizing';
type JobMode = 'single' | 'multi' | 'composite';

interface JobInternal {
  id: string;
  mode: JobMode;
  phase: JobPhase;
  project: Project;
  media: ExportMediaInfo;
  totalFrames: number;
  framesIn: number;
  frameBytes: number;
  proc: ChildProcess | null;
  overlayStdin: Writable | null;
  outputPath: string;
  cancelled: boolean;
  stderr: string;
  onProgress: (frameIdx: number, totalFrames: number) => void;
  onDone: (result: { ok: boolean; outputPath?: string; error?: string }) => void;
  tempDir: string | null;
  segmentPaths: string[];
  currentSegmentIndex: number;
  segmentFramesExpected: number;
  segmentFramesIn: number;
  pendingSegmentPath: string | null;
  pendingSegmentDone: { resolve: () => void; reject: (e: Error) => void } | null;
}

const JOBS = new Map<string, JobInternal>();

export async function startExport(
  project: Project,
  onProgress: (frameIdx: number, totalFrames: number) => void,
  onDone: (result: { ok: boolean; outputPath?: string; error?: string }) => void,
): Promise<{
  jobId: string;
  framesExpected: number;
  width: number;
  height: number;
  durationMs: number;
  segmentCount: number;
}> {
  if (project.clips.length === 0) throw new Error('Project has no clips.');
  if (!project.export.outputPath) throw new Error('Export path not set.');

  const firstClip = project.clips[0]!.media;
  const hasOverlays = project.overlays.length > 0;
  const compoundDurationMs = hasOverlays
    ? projectDurationMs(project.clips, project.overlays)
    : totalDurationMs(project.clips);
  const fps = project.export.fps;

  const media = await resolveExportMediaInfo(
    firstClip.path,
    firstClip.width,
    firstClip.height,
    fps,
    project.export.resolution ?? 'source',
  );

  const budget = checkExportMemoryBudget(media.width, media.height);
  if (!budget.ok) {
    throw new Error(exportMemoryBudgetError(media.width, media.height));
  }

  const totalFrames = Math.max(1, Math.ceil((compoundDurationMs / 1000) * fps));
  const frameBytes = media.width * media.height * 4;
  const id = randomUUID();
  const mode: JobMode = hasOverlays
    ? 'composite'
    : project.clips.length > 1
      ? 'multi'
      : 'single';
  const tempDir = mode !== 'single' ? await mkdtemp(join(tmpdir(), 'dg-export-')) : null;

  const job: JobInternal = {
    id,
    mode,
    phase: 'streaming',
    project,
    media: { ...media, durationMs: compoundDurationMs, durationSec: compoundDurationMs / 1000, overlayFrameCount: totalFrames },
    totalFrames,
    framesIn: 0,
    frameBytes,
    proc: null,
    overlayStdin: null,
    outputPath: project.export.outputPath,
    cancelled: false,
    stderr: '',
    onProgress,
    onDone,
    tempDir,
    segmentPaths: [],
    currentSegmentIndex: -1,
    segmentFramesExpected: 0,
    segmentFramesIn: 0,
    pendingSegmentPath: null,
    pendingSegmentDone: null,
  };

  if (mode === 'single') {
    const singleClip = project.clips[0]!;
    const proc = spawnFfmpegProcess(
      singleClip.media.path,
      project,
      media,
      project.export.outputPath,
      clipDurationMs(singleClip) / 1000,
      clipInMs(singleClip) / 1000,
    );
    if (!proc.stdin) {
      proc.kill('SIGKILL');
      throw new Error('ffmpeg stdin is not available for overlay streaming.');
    }
    job.proc = proc;
    job.overlayStdin = proc.stdin;
    attachProcHandlers(job, proc);
  } else if (mode === 'composite') {
    const basePath = await buildBaseConcatFromClips(project.clips);
    const proc = spawnCompositeFfmpegProcess(
      basePath,
      project,
      media,
      project.export.outputPath,
      compoundDurationMs / 1000,
    );
    if (!proc.stdin) {
      proc.kill('SIGKILL');
      throw new Error('ffmpeg stdin is not available for composite export.');
    }
    job.proc = proc;
    job.overlayStdin = proc.stdin;
    attachProcHandlers(job, proc);
  }

  JOBS.set(id, job);

  return {
    jobId: id,
    framesExpected: totalFrames,
    width: media.width,
    height: media.height,
    durationMs: compoundDurationMs,
    segmentCount: mode === 'multi' ? project.clips.length : 1,
  };
}

export async function startExportSegment(
  jobId: string,
  clipIndex: number,
): Promise<{ framesExpected: number }> {
  const job = JOBS.get(jobId);
  if (!job) throw new Error(`Unknown export job ${jobId}`);
  if (job.mode !== 'multi') throw new Error('Job is not multi-clip.');
  if (job.cancelled) throw new Error('Export cancelled.');

  const clip = job.project.clips[clipIndex];
  if (!clip) throw new Error(`Invalid clip index ${clipIndex}`);

  const segPath = join(job.tempDir!, `segment-${clipIndex}.mp4`);
  const durationSec = clipDurationMs(clip) / 1000;
  const segFrames = Math.max(1, Math.ceil(durationSec * job.media.exportFps));

  const proc = spawnFfmpegProcess(
    clip.media.path,
    job.project,
    job.media,
    segPath,
    durationSec,
    clipInMs(clip) / 1000,
  );
  if (!proc.stdin) {
    proc.kill('SIGKILL');
    throw new Error('ffmpeg stdin is not available for segment export.');
  }

  job.proc = proc;
  job.overlayStdin = proc.stdin;
  job.currentSegmentIndex = clipIndex;
  job.segmentFramesExpected = segFrames;
  job.segmentFramesIn = 0;
  job.phase = 'streaming';
  job.stderr = '';
  job.pendingSegmentPath = segPath;

  attachProcHandlers(job, proc);

  return { framesExpected: segFrames };
}

export async function writeExportFrame(jobId: string, frame: ArrayBuffer): Promise<void> {
  const job = JOBS.get(jobId);
  if (!job) throw new Error(`Unknown export job ${jobId}`);
  if (job.cancelled) return;
  if (job.phase !== 'streaming' || !job.overlayStdin) {
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
  job.segmentFramesIn++;
  job.onProgress(job.framesIn, job.totalFrames);
}

export async function finishExportSegment(jobId: string): Promise<void> {
  const job = JOBS.get(jobId);
  if (!job) throw new Error(`Unknown export job ${jobId}`);
  if (job.cancelled) return;
  if (job.mode !== 'multi') return;
  if (job.phase !== 'streaming') return;

  if (job.segmentFramesIn !== job.segmentFramesExpected) {
    failJob(job, `Segment frame count mismatch: sent ${job.segmentFramesIn}, expected ${job.segmentFramesExpected}`);
    return;
  }

  job.phase = 'segment-finalizing';
  if (job.overlayStdin) await closeStdin(job.overlayStdin);
  job.overlayStdin = null;

  await new Promise<void>((resolve, reject) => {
    job.pendingSegmentDone = { resolve, reject };
  });
}

export async function finishExportFrames(jobId: string): Promise<void> {
  const job = JOBS.get(jobId);
  if (!job) throw new Error(`Unknown export job ${jobId}`);
  if (job.cancelled) return;

  if (job.mode === 'single' || job.mode === 'composite') {
    if (job.phase !== 'streaming') return;
    if (job.framesIn !== job.totalFrames) {
      failJob(job, `Overlay frame count mismatch: sent ${job.framesIn}, expected ${job.totalFrames}`);
      return;
    }
    job.phase = 'finalizing';
    if (job.overlayStdin) await closeStdin(job.overlayStdin);
    return;
  }

  if (job.segmentPaths.length !== job.project.clips.length) {
    failJob(job, `Expected ${job.project.clips.length} segments, got ${job.segmentPaths.length}`);
    return;
  }

  job.phase = 'concat';
  try {
    await concatSegments(job);
    completeJob(job, { ok: true, outputPath: job.outputPath });
  } catch (e) {
    failJob(job, (e as Error).message);
  }
}

export function cancelExport(jobId: string): void {
  const job = JOBS.get(jobId);
  if (!job) return;
  job.cancelled = true;
  job.proc?.kill('SIGKILL');
  job.overlayStdin?.destroy();
  void cleanupTempDir(job);
  completeJob(job, { ok: false, error: 'cancelled' });
}

function attachProcHandlers(job: JobInternal, proc: ChildProcess): void {
  proc.stderr?.on('data', (chunk) => {
    handleStderr(job, chunk.toString());
  });

  proc.on('error', (err) => {
    if (job.cancelled) return;
    failJob(job, err.message);
  });

  proc.on('close', (code) => {
    if (job.cancelled) return;

    if (job.mode === 'multi' && job.phase === 'segment-finalizing') {
      if (code === 0) {
        if (job.pendingSegmentPath) job.segmentPaths.push(job.pendingSegmentPath);
        job.pendingSegmentPath = null;
        job.proc = null;
        job.phase = 'streaming';
        job.pendingSegmentDone?.resolve();
        job.pendingSegmentDone = null;
      } else {
        const detail = job.stderr.trim();
        const err = detail
          ? `ffmpeg segment exited with code ${code}: ${detail}`
          : `ffmpeg segment exited with code ${code}`;
        job.pendingSegmentDone?.reject(new Error(err));
        job.pendingSegmentDone = null;
        failJob(job, err);
      }
      return;
    }

    if (code === 0) {
      completeJob(job, { ok: true, outputPath: job.outputPath });
    } else {
      const detail = job.stderr.trim();
      failJob(
        job,
        detail ? `ffmpeg exited with code ${code}: ${detail}` : `ffmpeg exited with code ${code}`,
      );
    }
  });
}

async function concatSegments(job: JobInternal): Promise<void> {
  if (!job.tempDir) throw new Error('Missing temp directory for concat.');
  const listPath = join(job.tempDir, 'concat.txt');
  const lines = job.segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listPath, lines, 'utf8');

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      job.outputPath,
    ];
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (c) => { stderr = tail(stderr + c.toString(), 16_000); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg concat exited with code ${code}`));
    });
  });

  await cleanupTempDir(job);
}

async function cleanupTempDir(job: JobInternal): Promise<void> {
  if (!job.tempDir) return;
  try {
    await rm(job.tempDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  job.tempDir = null;
}

function spawnFfmpegProcess(
  videoPath: string,
  project: Project,
  media: ExportMediaInfo,
  outputPath: string,
  durationSec: number,
  inSec = 0,
): ChildProcess {
  const ex = project.export;
  const fps = media.exportFps;

  const needsScale =
    media.width !== media.sourceWidth || media.height !== media.sourceHeight;
  const baseChain = needsScale
    ? `[0:v]fps=${fps},scale=${media.width}:${media.height}[base]`
    : `[0:v]fps=${fps}[base]`;
  const filterComplex = `${baseChain};[base][1:v]overlay=format=auto:eof_action=pass[v]`;

  // Accurate input seek (-ss before -i) trims the source to the clip in-point;
  // decoding from the prior keyframe is frame-accurate because we re-encode.
  const seekArgs = inSec > 0 ? ['-ss', String(inSec)] : [];

  const includeAudio = ex.includeAudio !== false;
  const args: string[] = [
    '-y',
    ...seekArgs,
    '-i', videoPath,
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${media.width}x${media.height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    '-filter_complex',
    filterComplex,
    '-map', '[v]',
    ...(includeAudio ? ['-map', '0:a?'] : []),
    '-r', String(fps),
    '-t', String(durationSec),
    ...codecArgs(ex),
    '-progress', 'pipe:2',
    '-loglevel', 'warning',
    outputPath,
  ];

  return spawn(FFMPEG_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

function spawnCompositeFfmpegProcess(
  baseVideoPath: string,
  project: Project,
  media: ExportMediaInfo,
  outputPath: string,
  durationSec: number,
): ChildProcess {
  const ex = project.export;
  const fps = media.exportFps;
  const overlayPaths = distinctOverlayPaths(project.overlays);
  const gaugeInputIdx = 1 + overlayPaths.length;
  const pathToInput = new Map(overlayPaths.map((p, i) => [p, i + 1]));

  const needsScale =
    media.width !== media.sourceWidth || media.height !== media.sourceHeight;
  const filterParts: string[] = [];
  filterParts.push(
    needsScale
      ? `[0:v]fps=${fps},scale=${media.width}:${media.height}[vbase]`
      : `[0:v]fps=${fps}[vbase]`,
  );

  let current = '[vbase]';
  let segIdx = 0;
  const sortedOverlays = [...project.overlays].sort((a, b) => a.z - b.z);

  for (const overlay of sortedOverlays) {
    const inputIdx = pathToInput.get(overlay.media.path);
    if (inputIdx == null) continue;
    const segments = expandOverlayExportSegments(overlay, project.clips);
    for (const seg of segments) {
      const dur = seg.globalEndSec - seg.globalStartSec;
      if (dur <= 0) continue;
      const pipW = Math.max(2, Math.round(overlay.rect.w * media.width));
      const pipH = Math.max(2, Math.round(overlay.rect.h * media.height));
      const x = Math.round(overlay.rect.x * media.width);
      const y = Math.round(overlay.rect.y * media.height);
      const scaled = `ovs${segIdx}`;
      const out = `ovout${segIdx}`;
      filterParts.push(
        `[${inputIdx}:v]trim=start=${seg.sourceStartSec}:duration=${dur},setpts=PTS-STARTPTS,`
        + `scale=${pipW}:${pipH}[${scaled}]`,
      );
      filterParts.push(
        `${current}[${scaled}]overlay=x=${x}:y=${y}:enable='between(t,${seg.globalStartSec},${seg.globalEndSec})':format=auto[${out}]`,
      );
      current = `[${out}]`;
      segIdx++;
    }
  }

  filterParts.push(`${current}[${gaugeInputIdx}:v]overlay=format=auto:eof_action=pass[vout]`);

  const includeAudio = ex.includeAudio !== false;
  const audioParts = includeAudio
    ? buildCompositeAudioFilter(project, pathToInput)
    : { filters: [] as string[], mapArgs: [] as string[] };
  const filterComplex = [...filterParts, ...audioParts.filters].join(';');
  const mixedAudio = audioParts.mapArgs.includes('[aout]');

  const args: string[] = [
    '-y',
    '-i', baseVideoPath,
    ...overlayPaths.flatMap((p) => ['-i', p]),
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${media.width}x${media.height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    ...audioParts.mapArgs,
    '-r', String(fps),
    '-t', String(durationSec),
    ...codecArgs(ex, mixedAudio),
    '-progress', 'pipe:2',
    '-loglevel', 'warning',
    outputPath,
  ];

  return spawn(FFMPEG_BIN, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

function buildCompositeAudioFilter(
  project: Project,
  pathToInput: Map<string, number>,
): { filters: string[]; mapArgs: string[] } {
  const audioOverlays = project.overlays.filter((o) => o.includeAudio);
  if (audioOverlays.length === 0) {
    return { filters: [], mapArgs: ['-map', '0:a?'] };
  }

  const filters: string[] = [];
  const mixInputs: string[] = ['[0:a]'];
  let audIdx = 0;

  for (const overlay of audioOverlays) {
    const inputIdx = pathToInput.get(overlay.media.path);
    if (inputIdx == null) continue;
    const segments = expandOverlayExportSegments(overlay, project.clips);
    for (const seg of segments) {
      const dur = seg.globalEndSec - seg.globalStartSec;
      if (dur <= 0) continue;
      const label = `aud${audIdx}`;
      const delayMs = Math.round(seg.globalStartSec * 1000);
      filters.push(
        `[${inputIdx}:a]atrim=start=${seg.sourceStartSec}:duration=${dur},asetpts=PTS-STARTPTS,`
        + `adelay=${delayMs}|${delayMs}[${label}]`,
      );
      mixInputs.push(`[${label}]`);
      audIdx++;
    }
  }

  if (mixInputs.length <= 1) {
    return { filters, mapArgs: ['-map', '0:a?'] };
  }

  filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0[aout]`);
  return { filters, mapArgs: ['-map', '[aout]'] };
}

function handleStderr(job: JobInternal, text: string): void {
  job.stderr = tail(job.stderr + text, 16_000);
}

function failJob(job: JobInternal, error: string): void {
  if (job.cancelled) return;
  job.cancelled = true;
  job.proc?.kill('SIGKILL');
  job.overlayStdin?.destroy();
  void cleanupTempDir(job);
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

function codecArgs(ex: ExportSettings, encodeAudio = false): string[] {
  if (ex.includeAudio === false) return ['-an', ...videoCodecArgs(ex)];
  const audioArgs = encodeAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'copy'];
  return [...videoCodecArgs(ex), ...audioArgs];
}

function videoCodecArgs(ex: ExportSettings): string[] {
  switch (ex.codec) {
    case 'h264':
      return [
        '-c:v', 'libx264',
        '-crf', String(ex.crf),
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
      ];
    case 'hevc':
      return [
        '-c:v', 'libx265',
        '-crf', String(ex.crf),
        '-preset', 'medium',
        '-pix_fmt', 'yuv420p',
      ];
    case 'prores4444':
      return [
        '-c:v', 'prores_ks',
        '-profile:v', '4444',
        '-pix_fmt', 'yuva444p10le',
      ];
  }
}
