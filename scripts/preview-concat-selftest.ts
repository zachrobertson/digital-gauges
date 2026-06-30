/**
 * Smoke test for preview vs source encode profiles in concat.ts.
 * Run: npx tsx scripts/preview-concat-selftest.ts
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import ffmpegPath from 'ffmpeg-static';
import {
  buildPreviewVideo,
  buildBaseConcatFromClips,
  clearPreviewCache,
} from '../src/main/preview/concat';

const FFMPEG: string = ((): string => {
  if (typeof ffmpegPath === 'string') return ffmpegPath;
  if (ffmpegPath && typeof (ffmpegPath as { path?: string }).path === 'string') {
    return (ffmpegPath as { path: string }).path;
  }
  throw new Error('Could not resolve ffmpeg-static binary path.');
})();

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.slice(-2000) || `exit ${code}`));
    });
  });
}

async function probe(path: string): Promise<{ width: number; height: number }> {
  const { stderr } = await new Promise<{ stderr: string }>((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-hide_banner', '-i', path], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', () => resolve({ stderr }));
  });
  const m = stderr.match(/,\s*(\d{2,5})x(\d{2,5})/);
  assert.ok(m, `Could not probe ${path}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

async function makeClip(dir: string, name: string, seconds = 2): Promise<string> {
  const path = join(dir, name);
  await run(FFMPEG, [
    '-y', '-f', 'lavfi', '-i', `testsrc=size=1920x1080:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', path,
  ]);
  return path;
}

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'dg-concat-test-'));
  try {
    const clipA = await makeClip(tempRoot, 'a.mp4');
    const clipB = await makeClip(tempRoot, 'b.mp4');
    const durationMs = 2000;

    clearPreviewCache();

    const previewOut = await buildPreviewVideo([{
      path: clipA,
      inMs: 500,
      outMs: 1500,
      durationMs,
    }]);
    const previewDims = await probe(previewOut);
    assert.ok(
      previewDims.width <= 1280 && previewDims.height <= 720,
      `preview should fit 1280x720 box, got ${previewDims.width}x${previewDims.height}`,
    );

    clearPreviewCache();

    const sourceOut = await buildBaseConcatFromClips([{
      id: 'c1',
      media: { path: clipA, durationMs },
      inMs: 500,
      outMs: 1500,
    }]);
    const sourceDims = await probe(sourceOut);
    assert.equal(sourceDims.width, 1920, 'source profile should preserve width');
    assert.equal(sourceDims.height, 1080, 'source profile should preserve height');

    clearPreviewCache();

    const mixedOut = await buildBaseConcatFromClips([
      { id: 'c1', media: { path: clipA, durationMs } },
      { id: 'c2', media: { path: clipB, durationMs }, inMs: 0, outMs: 1000 },
    ]);
    assert.ok(mixedOut.endsWith('.mp4'), 'mixed export concat should produce mp4');

    clearPreviewCache();

    // Mixed preview: one untrimmed clip passes through, one trimmed clip is
    // re-encoded; the stream-copy concat must still yield a valid, probeable mp4.
    const mixedPreviewOut = await buildPreviewVideo([
      { path: clipA, inMs: 0, outMs: durationMs, durationMs },
      { path: clipB, inMs: 500, outMs: 1500, durationMs },
    ]);
    const mixedPreviewDims = await probe(mixedPreviewOut);
    assert.ok(
      mixedPreviewDims.width > 0 && mixedPreviewDims.height > 0,
      'mixed preview concat should produce a playable mp4',
    );

    clearPreviewCache();

    // Per-clip cache: a reorder reuses the already-rendered trimmed segment and
    // only re-runs the concat. Both builds must produce valid, playable output.
    const order1 = await buildPreviewVideo([
      { path: clipA, inMs: 500, outMs: 1500, durationMs },
      { path: clipB, inMs: 0, outMs: durationMs, durationMs },
    ]);
    assert.ok((await probe(order1)).width > 0, 'first ordering should be playable');
    const order2 = await buildPreviewVideo([
      { path: clipB, inMs: 0, outMs: durationMs, durationMs },
      { path: clipA, inMs: 500, outMs: 1500, durationMs },
    ]);
    assert.ok((await probe(order2)).width > 0, 'reordered rebuild should be playable');

    clearPreviewCache();
    const prevKeyPath = await buildPreviewVideo([{
      path: clipA, inMs: 200, outMs: 1800, durationMs,
    }]);
    const srcKeyPath = await buildBaseConcatFromClips([{
      id: 'c1', media: { path: clipA, durationMs }, inMs: 200, outMs: 1800,
    }]);
    assert.notEqual(prevKeyPath, srcKeyPath, 'preview and source caches must not collide');

    console.log('preview-concat-selftest: all checks passed');
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    clearPreviewCache();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
