import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { net } from 'electron';
import { resolveLocalMediaPath } from './local-media-path';

export { resolveLocalMediaPath } from './local-media-path';

/**
 * Serve a local file through the custom protocol with HTTP Range support.
 * HTML5 video requires range reads for playback and seeking on large files.
 */
export async function fetchLocalMedia(request: Request): Promise<Response> {
  const filePath = resolveLocalMediaPath(request.url);
  const { size } = await stat(filePath);

  const rangeHeader = request.headers.get('Range');
  if (!rangeHeader) {
    const fileUrl = pathToFileURL(filePath).toString();
    return net.fetch(fileUrl, {
      method: request.method,
      headers: request.headers,
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return new Response('Invalid Range header', { status: 416 });
  }

  let start = match[1] ? parseInt(match[1], 10) : 0;
  let end = match[2] ? parseInt(match[2], 10) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }

  end = Math.min(end, size - 1);
  const chunkSize = end - start + 1;

  const nodeStream = createReadStream(filePath, { start, end });
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    status: 206,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(chunkSize),
      'Content-Type': 'application/octet-stream',
    },
  });
}
