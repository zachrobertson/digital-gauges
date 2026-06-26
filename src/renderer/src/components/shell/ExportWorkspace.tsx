import type { ReactNode } from 'react';
import { useProject } from '../../store/project';
import type { useExport } from '../../lib/useExport';
import { localMediaUrl } from '../../lib/paths';
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

/** Export page — output summary + preview (left) and settings / live progress (right). */
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
      {/* Left: thumbnail + summary */}
      <aside className="w-72 shrink-0 bg-bg-panel border-r border-white/[0.07] p-4 overflow-y-auto">
        <div className="field-label mb-2">Source</div>
        <ExportThumbnail path={video.path} />

        <div className="field-label mt-4 mb-2">Project</div>
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
                <div className="field-label mb-2">Quality {ex.codec === 'prores4444' ? '(N/A for ProRes)' : ''}</div>
                <div className="flex items-center gap-2.5" style={{ opacity: ex.codec === 'prores4444' ? 0.4 : 1 }}>
                  <input
                    type="range" min={15} max={28} step={1} value={ex.crf}
                    disabled={ex.codec === 'prores4444'}
                    onChange={(e) => setExport({ crf: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-accent"
                  />
                  <span className="font-mono text-xs w-20 text-right">{ex.codec === 'prores4444' ? 'lossless' : `CRF ${ex.crf}`}</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="field-label mb-2">Frame rate</div>
                <div className="flex gap-2 flex-wrap">
                  {[24, 30, 60].map((f) => (
                    <button key={f} type="button" className={`px-3.5 py-2 rounded-lg text-xs font-semibold border ${Math.round(ex.fps) === f ? 'bg-accent text-accent-ink border-transparent' : 'bg-bg-elev text-white border-white/[0.07]'}`} onClick={() => setExport({ fps: f })}>{f} fps</button>
                  ))}
                  <button type="button" className="px-3.5 py-2 rounded-lg text-xs text-textdim border border-dashed border-white/[0.16]" onClick={() => setExport({ fps: roundExportFps(video.fps) })}>Match source</button>
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={ex.includeAudio !== false}
                onChange={(e) => setExport({ includeAudio: e.target.checked })}
              />
              Include audio from source clips
            </label>

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

/** Static first-frame thumbnail — no playback controls or preview build. */
function ExportThumbnail({ path }: { path: string }) {
  return (
    <div className="aspect-video rounded-[10px] overflow-hidden border border-white/[0.16] bg-black">
      <video
        src={localMediaUrl(path)}
        className="w-full h-full object-contain pointer-events-none"
        muted
        playsInline
        preload="metadata"
        aria-hidden
        onLoadedData={(e) => { e.currentTarget.currentTime = 0.1; }}
      />
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
