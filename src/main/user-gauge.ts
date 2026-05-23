import { pathToFileURL } from 'node:url';
import { net } from 'electron';
import { resolveLocalMediaPath } from './local-media-path';

/** Serve a transpiled user gauge module to the renderer via custom protocol. */
export async function fetchUserGaugeModule(request: Request): Promise<Response> {
  const filePath = resolveLocalMediaPath(request.url);
  const fileUrl = pathToFileURL(filePath).toString();
  const res = await net.fetch(fileUrl);

  if (!res.ok) {
    return res;
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

/** Build a renderer-importable URL for a cached gauge module on disk. */
export function userGaugeModuleUrl(absolutePath: string): string {
  return `user-gauge://module/?p=${encodeURIComponent(absolutePath)}`;
}

/** Filesystem-safe cache basename — plugin ids use `user:` which is invalid on Windows. */
export function safePluginCacheBasename(pluginId: string): string {
  return pluginId.replace(/:/g, '-').replace(/[^a-zA-Z0-9._-]/g, '_');
}
