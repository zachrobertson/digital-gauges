import { normalize } from 'node:path';

/**
 * Resolve a filesystem path from a `local-media:` request URL.
 *
 * The renderer emits `local-media://media/?p=<encoded-path>`, but Chromium
 * often rewrites that to a path-style URL on follow-up requests (especially
 * byte-range reads during playback):
 *
 *   local-media:///C%3A%5CUsers%5Cusername%5Cvideo.MP4
 */
export function resolveLocalMediaPath(requestUrl: string): string {
  const url = new URL(requestUrl);

  const fromQuery = url.searchParams.get('p');
  if (fromQuery) return normalizeFilesystemPath(fromQuery);

  let raw = decodeURIComponent(url.pathname);
  while (raw.startsWith('/')) raw = raw.slice(1);
  if (!raw) {
    throw new Error(`missing media path in ${requestUrl}`);
  }
  return normalizeFilesystemPath(raw);
}

function normalizeFilesystemPath(raw: string): string {
  return normalize(raw.replace(/\//g, process.platform === 'win32' ? '\\' : '/'));
}
