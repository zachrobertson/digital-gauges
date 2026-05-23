import { freemem, totalmem } from 'node:os';

/** Fraction of currently free RAM we allow for export frame buffers (renderer + IPC + pipe). */
const FREE_RAM_FRACTION = 0.25;

/** Assume this many frame-sized buffers in flight during streaming export. */
const BUFFERS_IN_FLIGHT = 4;

export interface ExportBudgetCheck {
  frameBytes: number;
  budgetBytes: number;
  freeBytes: number;
  totalBytes: number;
  ok: boolean;
}

export function checkExportMemoryBudget(width: number, height: number): ExportBudgetCheck {
  const frameBytes = width * height * 4;
  const freeBytes = freemem();
  const totalBytes = totalmem();
  const budgetBytes = Math.floor(freeBytes * FREE_RAM_FRACTION);
  const neededBytes = frameBytes * BUFFERS_IN_FLIGHT;
  return {
    frameBytes,
    budgetBytes,
    freeBytes,
    totalBytes,
    ok: neededBytes <= budgetBytes,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function exportMemoryBudgetError(width: number, height: number): string {
  const c = checkExportMemoryBudget(width, height);
  const needed = c.frameBytes * BUFFERS_IN_FLIGHT;
  return (
    `Not enough free memory for a ${width}×${height} export ` +
    `(needs ~${formatBytes(needed)} for streaming buffers, ` +
    `budget ${formatBytes(c.budgetBytes)} = 25% of ${formatBytes(c.freeBytes)} free). ` +
    `Try the 1080p resolution preset or close other applications.`
  );
}
