import { app, BrowserWindow, shell } from 'electron';
import { mkdir, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { build } from 'esbuild';
import { watch as chokidarWatch, FSWatcher } from 'chokidar';
import { randomUUID } from 'node:crypto';
import type { UserPluginInfo } from '../../shared/types';
import { safePluginCacheBasename, userGaugeModuleUrl } from '../user-gauge';

/**
 * User gauge plugin loader.
 *
 * - Watches `~/Documents/DigitalGauges/gauges/` (or the platform
 *   equivalent) for `*.gauge.tsx` files.
 * - On add/change, transpiles to ESM via esbuild and writes the result
 *   to a side-by-side `.cache/<id>.js`.
 * - Notifies the renderer via the `plugins:changed` channel. The
 *   renderer dynamic-imports transpiled modules via the `user-gauge:`
 *   custom protocol (Chromium blocks raw `file://` from http:// dev).
 *
 * Security note: transpiled user code runs in the renderer. We treat
 * `~/Documents/DigitalGauges/gauges/` as a trust boundary that the user
 * owns; we do not auto-load remote URLs.
 */

const PLUGINS = new Map<string /* pluginId */, UserPluginInfo>();
let watcher: FSWatcher | null = null;
let mainWindowGetter: (() => BrowserWindow | null) | null = null;

export function startUserPluginLoader(getWindow: () => BrowserWindow | null): void {
  mainWindowGetter = getWindow;

  const folder = getPluginsFolder();
  ensureFolder(folder).then(async () => {
    await ensureExampleGauge(folder);
    await scanInitial(folder);

    watcher = chokidarWatch(folder, {
      ignored: (p: string) => /(^|[/\\])\..|[/\\]\.cache([/\\]|$)/.test(p),
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });

    watcher.on('add', (p: string) => { if (isGaugeFile(p)) loadOrReload(p); });
    watcher.on('change', (p: string) => { if (isGaugeFile(p)) loadOrReload(p); });
    watcher.on('unlink', (p: string) => { if (isGaugeFile(p)) unload(p); });
  });
}

export function getPluginsFolder(): string {
  return join(app.getPath('documents'), 'DigitalGauges', 'gauges');
}

export async function listLoadedPlugins(): Promise<UserPluginInfo[]> {
  return [...PLUGINS.values()];
}

export async function openPluginsFolder(): Promise<void> {
  const folder = getPluginsFolder();
  await ensureFolder(folder);
  shell.openPath(folder);
}

export interface InstallExampleResult {
  ok: boolean;
  path?: string;
  alreadyExists?: boolean;
  error?: string;
}

const DEMO_GAUGE_NAME = 'demo-stats.gauge.tsx';

export async function installExampleGauge(): Promise<InstallExampleResult> {
  const folder = getPluginsFolder();
  await ensureFolder(folder);
  const dest = join(folder, DEMO_GAUGE_NAME);
  if (existsSync(dest)) {
    return { ok: true, path: dest, alreadyExists: true };
  }

  const source = resolveExampleSource();
  if (!source) {
    return { ok: false, error: 'Example gauge source not found' };
  }

  try {
    await copyFile(source, dest);
    await loadOrReload(dest);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function resolveExampleSource(): string | null {
  const candidates = [
    join(app.getAppPath(), 'examples', DEMO_GAUGE_NAME),
    join(app.getAppPath(), '..', 'examples', DEMO_GAUGE_NAME),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function ensureFolder(p: string): Promise<void> {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
  const cache = join(p, '.cache');
  if (!existsSync(cache)) await mkdir(cache, { recursive: true });
}

function isGaugeFile(p: string): boolean {
  return /\.gauge\.tsx?$/i.test(p);
}

async function scanInitial(folder: string): Promise<void> {
  const entries = await readdir(folder).catch(() => []);
  for (const e of entries) {
    const full = join(folder, e);
    if (isGaugeFile(full)) await loadOrReload(full);
  }
  emitChange();
}

async function loadOrReload(filePath: string): Promise<void> {
  const pluginId = pluginIdFromPath(filePath);
  const folder = getPluginsFolder();
  const cacheFile = join(folder, '.cache', `${safePluginCacheBasename(pluginId)}-${randomUUID()}.mjs`);

  try {
    const result = await build({
      entryPoints: [filePath],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      write: false,
      external: ['react', 'react-dom'],
      logLevel: 'silent',
      plugins: [digitalGaugesTypeStubPlugin()],
    });

    const file = result.outputFiles?.[0];
    if (!file) throw new Error('esbuild produced no output');

    await writeFile(cacheFile, file.contents);

    const info: UserPluginInfo = {
      pluginId,
      filePath,
      name: basename(filePath).replace(/\.gauge\.tsx?$/i, ''),
      moduleUrl: userGaugeModuleUrl(cacheFile),
      loadedAt: new Date().toISOString(),
    };
    PLUGINS.set(pluginId, info);
  } catch (err) {
    PLUGINS.set(pluginId, {
      pluginId,
      filePath,
      name: basename(filePath).replace(/\.gauge\.tsx?$/i, ''),
      moduleUrl: '',
      loadedAt: new Date().toISOString(),
      error: (err as Error).message,
    });
  }

  emitChange();
}

function unload(filePath: string): void {
  const id = pluginIdFromPath(filePath);
  PLUGINS.delete(id);
  emitChange();
}

function pluginIdFromPath(filePath: string): string {
  return 'user:' + basename(filePath).replace(/\.gauge\.tsx?$/i, '').toLowerCase();
}

function emitChange(): void {
  const win = mainWindowGetter?.();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('plugins:changed', [...PLUGINS.values()]);
}

/** Stub `digital-gauges` imports — user gauges only use type imports, stripped at compile time. */
function digitalGaugesTypeStubPlugin(): import('esbuild').Plugin {
  return {
    name: 'digital-gauges-type-stub',
    setup(build) {
      build.onResolve({ filter: /^digital-gauges$/ }, () => ({
        path: 'digital-gauges',
        namespace: 'digital-gauges-stub',
      }));
      build.onLoad({ filter: /.*/, namespace: 'digital-gauges-stub' }, () => ({
        contents: 'export {};',
        loader: 'js',
      }));
    },
  };
}

/** Bundle a starter example so users can crib from a working file. */
async function ensureExampleGauge(folder: string): Promise<void> {
  const example = join(folder, 'example.gauge.tsx.txt');
  if (existsSync(example)) return;

  const source = resolveExampleSource();
  if (source) {
    const body = await readFile(source, 'utf8');
    const header = `// Save this file as "myThing.gauge.tsx" (drop the .txt) to load it.
// Full API reference: docs/writing-gauges.md in the Digital Gauges repo.

`;
    await writeFile(example, header + body, 'utf8');
    return;
  }

  const body = `// Save this file as "myThing.gauge.tsx" (drop the .txt) to load it.
// See docs/writing-gauges.md for the full GaugePlugin API.

import type { GaugePlugin } from 'digital-gauges';

const plugin: GaugePlugin = {
  id: 'user:example',
  name: 'Example gauge',
  description: 'Minimal speed readout — copy and customize.',
  fields: ['speed'],
  defaultRect: { x: 0.05, y: 0.05, w: 0.18, h: 0.1 },
  defaultConfig: { color: '#3ddc97', label: 'KM/H' },
  schema: {
    type: 'object',
    properties: {
      color: { type: 'string', format: 'color', title: 'Bar color' },
      label: { type: 'string', title: 'Label' },
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const speed = frame?.speed ?? 0;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = (config as { color?: string }).color ?? '#3ddc97';
    ctx.font = \`bold \${Math.floor(rect.h * 0.6)}px Inter, system-ui\`;
    ctx.textBaseline = 'middle';
    ctx.fillText(
      \`\${(speed * 3.6).toFixed(0)} \${(config as { label?: string }).label ?? ''}\`,
      rect.x + 12,
      rect.y + rect.h / 2,
    );
  },
};

export default plugin;
`;
  await writeFile(example, body, 'utf8');
}
