import { open, type FileHandle } from 'node:fs/promises';

/** Thrown when a probe/extract exceeds its byte budget or is cancelled. */
export class GpsReadAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GpsReadAbort';
  }
}

/**
 * Random-access reader that counts bytes and enforces a budget, so a probe can
 * never accidentally scan a multi-GB video.
 */
export class RangeReader {
  bytesRead = 0;

  private constructor(
    private readonly fh: FileHandle,
    readonly size: number,
    private readonly budgetBytes: number,
    private readonly signal?: AbortSignal,
  ) {}

  static async open(path: string, budgetBytes: number, signal?: AbortSignal): Promise<RangeReader> {
    const fh = await open(path, 'r');
    const { size } = await fh.stat();
    return new RangeReader(fh, size, budgetBytes, signal);
  }

  async read(offset: number, length: number): Promise<Buffer> {
    if (this.signal?.aborted) throw new GpsReadAbort('Cancelled');
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new RangeError(`Read ${offset}+${length} outside file of ${this.size} bytes`);
    }
    if (this.bytesRead + length > this.budgetBytes) {
      throw new GpsReadAbort(`Read budget of ${this.budgetBytes} bytes exceeded`);
    }
    const buf = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await this.fh.read(buf, done, length - done, offset + done);
      if (bytesRead === 0) break;
      done += bytesRead;
    }
    this.bytesRead += done;
    return done === length ? buf : buf.subarray(0, done);
  }

  async close(): Promise<void> {
    await this.fh.close();
  }
}
