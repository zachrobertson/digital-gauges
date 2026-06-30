import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useProject } from '../../store/project';
import type { useExport } from '../../lib/useExport';
import { firstClipMedia, totalDurationMs } from '@shared/timeline';
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
  exportApi: ReturnType<typeof useExport>;
}

function formatFpsDisplay(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return '—';
  const rounded = Math.round(fps * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/\.?0+$/, '');
}
function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) { const h = Math.floor(m / 60); return `${h}h ${m % 60}m`; }
  return m > 0 ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
function bitsPerPixel(codec: ExportCodec, crf: number): number {
  if (codec === 'prores4444') return 1.9;
  const base = codec === 'hevc' ? 0.09 : 0.15;
  return base * Math.pow(2, (28 - crf) / 6);
}

const CRF_MIN = 15;
const CRF_MAX = 28;
const RES_OPTIONS: { value: ExportResolution; label: string; dims: (w: number, h: number) => string }[] = [
  { value: 'source', label: 'Source', dims: (w, h) => `${w}×${h}` },
  { value: '1080p', label: '1080p', dims: () => `${EXPORT_1080P.width}×${EXPORT_1080P.height}` },
  { value: '4k', label: '4K UHD', dims: () => `${EXPORT_4K.width}×${EXPORT_4K.height}` },
];
const CODEC_OPTIONS: { value: ExportCodec; label: string; sub: string }[] = [
  { value: 'h264', label: 'H.264', sub: 'Most compatible' },
  { value: 'hevc', label: 'HEVC', sub: 'Smaller files' },
  { value: 'prores4444', label: 'ProRes 4444', sub: 'Editing / alpha' },
];

/** Export page — project summary (left) and settings / live progress (right). */
export function ExportWorkspace({ exportApi }: Props) {
  const project = useProject((s) => s.project);
  const setExport = useProject((s) => s.setExport);
  const ex = project.export;
  const video = firstClipMedia(project);
  const total = totalDurationMs(project.clips);
  const { startExport, cancel, progress, progressDetail, exporting, elapsedMs } = exportApi;

  if (!video) {
    return (
      <div className="h-full flex items-center justify-center text-textfaint text-sm">
        Add a clip in Edit mode before exporting.
      </div>
    );
  }

  const out = resolveExportDimensions(video.width, video.height, ex.resolution ?? 'source');
  const upscale = isUpscaleTo4k(video.width, video.height, ex.resolution ?? 'source');
  const sourceFps = video.fps;
  const sourceFpsLabel = formatFpsDisplay(sourceFps);
  const matchSourceFps = roundExportFps(sourceFps);
  const isMatchSource = Math.abs(ex.fps - matchSourceFps) < 0.01;
  const exportsAboveSource = ex.fps > sourceFps + 0.01;
  const durationSec = total / 1000;
  const frames = Math.round(durationSec * ex.fps);
  const bitrateMbps = (bitsPerPixel(ex.codec, ex.crf) * out.width * out.height * ex.fps) / 1_000_000;
  const sizeBytes = (bitrateMbps * 1_000_000 * durationSec) / 8;
  const renderSec = frames / 18;
  const etaSec = progress > 1 ? (elapsedMs / 1000) * (100 / progress - 1) : renderSec;
  const segCount = project.clips.length;
  const curSeg = progressDetail.totalFrames > 0
    ? Math.min(segCount, Math.max(1, Math.ceil((progressDetail.framesRendered / Math.max(1, progressDetail.totalFrames)) * segCount)))
    : 1;

  return (
    <div className="flex h-full min-h-0">
      {/* Left: project summary */}
      <aside className="w-72 shrink-0 bg-bg-panel border-r border-white/[0.07] p-4 overflow-y-auto">
        <div className="field-label mb-2">Project</div>
        <div className="flex flex-col gap-2.5">
          <SummaryRow label="Clips" value={String(project.clips.length)} />
          <SummaryRow label="Gauges" value={String(project.gauges.filter((g) => g.placed !== false).length)} />
          <SummaryRow label="Duration" value={formatClock(durationSec)} />
          <SummaryRow label="Output" value={`${out.width}×${out.height}`} />
          <SummaryRow label="Audio" value={ex.includeAudio !== false ? 'Copy source' : 'None'} />
        </div>
      </aside>

      {/* Right: settings or progress */}
      <main className="flex-1 min-w-0 p-5 overflow-y-auto bg-[#0c1014]">
        {!exporting ? (
          <div className="max-w-2xl flex flex-col gap-5">
            <div>
              <div className="field-label mb-2">Resolution</div>
              <div className="flex gap-2.5">
                {RES_OPTIONS.map((r) => (
                  <Choice key={r.value} on={(ex.resolution ?? 'source') === r.value} label={r.label} sub={r.dims(video.width, video.height)} onClick={() => setExport({ resolution: r.value })} />
                ))}
              </div>
              {upscale && <p className="text-[11px] text-warn mt-1.5">Upscaling to 4K — quality limited by the {video.width}×{video.height} source.</p>}
            </div>

            <div>
              <div className="field-label mb-2">Codec</div>
              <div className="flex gap-2.5">
                {CODEC_OPTIONS.map((c) => (
                  <Choice key={c.value} on={ex.codec === c.value} label={c.label} sub={c.sub} onClick={() => setExport({ codec: c.value })} />
                ))}
              </div>
            </div>

            <div className="flex gap-5">
              <div className="flex-1">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="field-label">Quality {ex.codec === 'prores4444' ? '(N/A for ProRes)' : ''}</div>
                  {ex.codec !== 'prores4444' && <CrfHelpButton />}
                </div>
                {ex.codec === 'prores4444' ? (
                  <input
                    type="text"
                    value="lossless"
                    disabled
                    className="w-24 bg-bg-elev rounded-lg px-2.5 py-2 text-xs font-mono border border-white/[0.07] opacity-40"
                  />
                ) : (
                  <CrfInput value={ex.crf} onChange={(crf) => setExport({ crf })} />
                )}
              </div>
              <div className="flex-1">
                <div className="field-label mb-2">Frame rate</div>
                <div className="flex gap-2 flex-wrap">
                  {[24, 30, 60].map((f) => {
                    const presetSelected = !isMatchSource && Math.abs(ex.fps - f) < 0.01;
                    return (
                      <button
                        key={f}
                        type="button"
                        className={`px-3.5 py-2 rounded-lg text-xs font-semibold border ${
                          presetSelected
                            ? 'bg-accent text-accent-ink border-transparent'
                            : 'bg-bg-elev text-textdim border-white/[0.07]'
                        }`}
                        onClick={() => setExport({ fps: f })}
                      >
                        {f} fps
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={`px-3.5 py-2 rounded-lg text-xs border border-dashed ${
                      isMatchSource
                        ? 'bg-accent text-accent-ink border-transparent'
                        : 'text-textdim border-white/[0.16]'
                    }`}
                    onClick={() => setExport({ fps: matchSourceFps })}
                  >
                    Match source ({sourceFpsLabel} fps)
                  </button>
                </div>
                <p className="text-[11px] text-textfaint mt-1.5">
                  Source frame rate: <span className="font-mono text-textdim">{sourceFpsLabel} fps</span>
                </p>
                {exportsAboveSource && (
                  <p className="text-[11px] text-warn mt-1">
                    Export frame rate is above source — FFmpeg will interpolate frames to reach {formatFpsDisplay(ex.fps)} fps.
                  </p>
                )}
              </div>
            </div>

            <div>
              <div className="field-label mb-2">Audio</div>
              <button
                type="button"
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold border ${
                  ex.includeAudio !== false
                    ? 'bg-accent text-accent-ink border-transparent'
                    : 'bg-bg-elev text-textdim border-white/[0.07]'
                }`}
                onClick={() => setExport({ includeAudio: ex.includeAudio === false })}
              >
                Export audio
              </button>
            </div>

            {/* Estimates + start */}
            <div className="rounded-xl border border-white/[0.07] bg-bg-panel p-4 flex items-center gap-4">
              <Estimate label="Estimated size" value={`~${formatBytes(sizeBytes)}`} />
              <Estimate label="Bitrate" value={`~${bitrateMbps.toFixed(0)} Mbps`} bordered />
              <Estimate label="Est. render time" value={`~${formatClock(renderSec)}`} bordered />
              <div className="ml-auto">
                <button type="button" className="px-5 py-2.5 rounded-[10px] bg-accent text-accent-ink text-sm font-bold" onClick={() => void startExport()}>
                  Start export
                </button>
              </div>
            </div>
            <p className="text-[11px] text-textfaint">Estimates are approximate and vary with content and hardware.</p>
          </div>
        ) : (
          <div className="max-w-2xl flex flex-col gap-4 h-full justify-center">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-warn" />
              <span className="text-base font-semibold">Rendering overlays…</span>
              <span className="ml-auto font-mono text-xl font-bold">{progress.toFixed(0)}%</span>
            </div>

            <div className="h-3.5 rounded-full bg-bg-elev border border-white/[0.07] overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>

            <div className="rounded-xl border border-white/[0.07] bg-bg-panel p-4 flex items-center gap-4">
              <Estimate label="Stage" value={segCount > 1 ? `Clip ${curSeg} of ${segCount}` : 'Rendering'} />
              <Estimate
                label="Frames"
                value={progressDetail.totalFrames > 0 ? `${progressDetail.framesRendered} / ${progressDetail.totalFrames}` : '—'}
                bordered
              />
              <Estimate label="Time left" value={`~${formatClock(etaSec)}`} bordered />
              <Estimate label="Output" value={`~${formatBytes(sizeBytes)}`} bordered />
            </div>

            <div className="flex">
              <button type="button" className="ml-auto btn-danger text-sm" onClick={() => void cancel()}>Cancel export</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function CrfHelpButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/20 text-[10px] leading-none text-textfaint hover:text-white hover:border-white/40"
        aria-label="CRF quality help"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
          onPointerDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <div
            className="panel w-full max-w-xs p-4 flex flex-col gap-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="crf-help-title"
          >
            <h3 id="crf-help-title" className="text-sm font-semibold">CRF quality</h3>
            <div className="text-xs text-textdim leading-relaxed flex flex-col gap-2">
              <p>CRF controls compression quality for H.264 and HEVC exports. Lower values mean higher quality and larger files.</p>
              <p><span className="text-white/80">Minimum ({CRF_MIN}):</span> highest quality, largest file size.</p>
              <p><span className="text-white/80">Maximum ({CRF_MAX}):</span> lowest quality, smallest file size.</p>
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function CrfInput({ value, onChange }: { value: number; onChange: (crf: number) => void }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const trimmed = draft.trim();
  const parsed = trimmed === '' ? NaN : Number(trimmed);
  const hasNumeric = trimmed !== '' && Number.isFinite(parsed);
  let rangeError: 'min' | 'max' | null = null;
  if (hasNumeric) {
    if (parsed < CRF_MIN) rangeError = 'min';
    else if (parsed > CRF_MAX) rangeError = 'max';
  }

  const handleChange = (raw: string) => {
    setDraft(raw);
    const next = raw.trim();
    if (next === '') return;
    const n = Number(next);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return;
    if (n >= CRF_MIN && n <= CRF_MAX) onChange(n);
  };

  const handleBlur = () => {
    if (rangeError || trimmed === '' || !Number.isInteger(parsed)) {
      setDraft(String(value));
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          className={`w-24 bg-bg-elev rounded-lg px-2.5 py-2 text-xs font-mono border ${rangeError ? 'border-red-400/60' : 'border-white/[0.07]'}`}
          aria-invalid={rangeError != null}
          aria-describedby={rangeError ? 'crf-range-error' : undefined}
        />
        <span className="text-xs text-textfaint">CRF</span>
      </div>
      {rangeError === 'max' && (
        <p id="crf-range-error" className="text-[11px] text-red-300 mt-1">Maximum value is {CRF_MAX}.</p>
      )}
      {rangeError === 'min' && (
        <p id="crf-range-error" className="text-[11px] text-red-300 mt-1">Minimum value is {CRF_MIN}.</p>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center">
      <span className="text-xs text-textfaint">{label}</span>
      <span className="ml-auto font-mono text-[12.5px]">{value}</span>
    </div>
  );
}
function Choice({ label, sub, on, onClick }: { label: string; sub?: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex-1 text-left px-3 py-2.5 rounded-[10px] border transition-colors ${on ? 'bg-bg-hover border-accent' : 'bg-bg-elev border-white/[0.07] hover:bg-bg-hover'}`}>
      <div className="text-[12.5px] font-semibold">{label}</div>
      {sub && <div className="text-[10.5px] text-textfaint mt-0.5">{sub}</div>}
    </button>
  );
}
function Estimate({ label, value, bordered }: { label: string; value: ReactNode; bordered?: boolean }) {
  return (
    <div className={`flex-1 ${bordered ? 'border-l border-white/[0.07] pl-4' : ''}`}>
      <div className="text-[11px] text-textfaint">{label}</div>
      <div className="font-mono text-lg font-bold mt-0.5">{value}</div>
    </div>
  );
}
