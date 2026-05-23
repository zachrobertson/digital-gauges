import type { ReactNode } from 'react';
import { useProject } from '../store/project';
import {
  EXPORT_4K,
  EXPORT_1080P,
  isUpscaleTo4k,
  resolveExportDimensions,
  roundExportFps,
  type ExportCodec,
  type ExportResolution,
} from '@shared/types';

interface Props {
  open: boolean;
  onClose(): void;
  onExport(): void;
  onCancelExport?(): void;
  exporting: boolean;
}

export function ExportDialog({ open, onClose, onExport, onCancelExport, exporting }: Props) {
  const project = useProject((s) => s.project);
  const exportSettings = project.export;
  const setExport = useProject((s) => s.setExport);
  const video = project.video;

  if (!open || !video) return null;

  const sourceW = video.width;
  const sourceH = video.height;
  const out = resolveExportDimensions(sourceW, sourceH, exportSettings.resolution ?? 'source');
  const upscaleWarning = isUpscaleTo4k(sourceW, sourceH, exportSettings.resolution ?? 'source');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="panel w-full max-w-md p-5 flex flex-col gap-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
      >
        <div>
          <h2 id="export-dialog-title" className="text-base font-semibold">
            Export settings
          </h2>
          <p className="text-xs text-white/40 mt-1">
            Source: {sourceW}×{sourceH} @ {roundExportFps(video.fps)} fps
          </p>
        </div>

        <Field label="Resolution">
          <select
            className="select-input"
            value={exportSettings.resolution ?? 'source'}
            onChange={(e) =>
              setExport({ resolution: e.target.value as ExportResolution })
            }
          >
            <option value="source">Source ({sourceW}×{sourceH})</option>
            <option value="1080p">
              1080p ({EXPORT_1080P.width}×{EXPORT_1080P.height})
            </option>
            <option value="4k">
              4K ({EXPORT_4K.width}×{EXPORT_4K.height})
            </option>
          </select>
          <p className="text-xs text-white/40 mt-1">
            Output: {out.width}×{out.height}
          </p>
          {upscaleWarning && (
            <p className="text-xs text-amber-300/90 mt-1">
              Upscaling from {sourceW}×{sourceH} to 4K — quality may be limited by the source.
            </p>
          )}
        </Field>

        <Field label={`Frame rate (${exportSettings.fps} fps)`}>
          <input
            type="range"
            min={24}
            max={60}
            step={0.001}
            value={exportSettings.fps}
            onChange={(e) => setExport({ fps: parseFloat(e.target.value) })}
          />
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              className="btn-ghost text-xs py-0.5"
              onClick={() => setExport({ fps: roundExportFps(video.fps) })}
            >
              Match source
            </button>
          </div>
        </Field>

        <Field label="Codec">
          <select
            className="select-input"
            value={exportSettings.codec}
            onChange={(e) => setExport({ codec: e.target.value as ExportCodec })}
          >
            <option value="h264">H.264 (MP4)</option>
            <option value="hevc">HEVC (MP4)</option>
            <option value="prores4444">ProRes 4444</option>
          </select>
        </Field>

        {exportSettings.codec !== 'prores4444' && (
          <Field label={`Quality (CRF ${exportSettings.crf})`}>
            <input
              type="range"
              min={15}
              max={28}
              step={1}
              value={exportSettings.crf}
              onChange={(e) => setExport({ crf: parseInt(e.target.value, 10) })}
            />
          </Field>
        )}

        <p className="text-xs text-white/35">
          Long exports stream frames directly to ffmpeg (no multi‑GB temp file). Only the output MP4 grows on disk.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          {exporting ? (
            <button type="button" className="btn-ghost text-red-300" onClick={onCancelExport}>
              Stop export
            </button>
          ) : (
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={exporting}
            onClick={onExport}
          >
            {exporting ? 'Exporting…' : 'Export MP4'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}
