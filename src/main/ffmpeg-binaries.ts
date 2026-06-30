import { existsSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
// @ts-expect-error — ffprobe-static doesn't ship type declarations.
import ffprobePath from 'ffprobe-static';

/**
 * Native binaries are unpacked to `app.asar.unpacked`, but ffmpeg-static and
 * ffprobe-static resolve paths relative to `__dirname` inside the ASAR archive.
 */
export function resolvePackagedBinaryPath(binaryPath: string): string {
  const unpacked = binaryPath.replace(/app\.asar([\\/]|$)/, 'app.asar.unpacked$1');
  if (unpacked !== binaryPath && existsSync(unpacked)) return unpacked;
  return binaryPath;
}

function resolveFfmpegRaw(): string {
  if (typeof ffmpegPath === 'string') return ffmpegPath;
  if (ffmpegPath && typeof (ffmpegPath as { path?: string }).path === 'string') {
    return (ffmpegPath as { path: string }).path;
  }
  throw new Error('Could not resolve ffmpeg-static binary path.');
}

function resolveFfprobeRaw(): string {
  const path =
    (ffprobePath as unknown as { path?: string })?.path ??
    (ffprobePath as unknown as string);
  if (!path) throw new Error('Could not resolve ffprobe-static binary path.');
  return path;
}

export const FFMPEG_BIN = resolvePackagedBinaryPath(resolveFfmpegRaw());
export const FFPROBE_BIN = resolvePackagedBinaryPath(resolveFfprobeRaw());
