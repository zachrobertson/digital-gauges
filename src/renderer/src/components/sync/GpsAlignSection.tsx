import { useEffect, useState } from 'react';
import type { CameraGpsProbe, GpsClockInfo, TelemetryTrack, TimelineClip } from '@shared/types';
import { crossCheckWarnings, estimateVideoStartUtc, speedCrossCheck } from '@shared/gpsClock';
import { formatOffsetMs } from '@shared/sync';
import { useProject } from '../../store/project';

/** Probe results by file path — the probe is cheap, but there's no reason to repeat it. */
const probeCache = new Map<string, Promise<CameraGpsProbe>>();

function probeOnce(path: string): Promise<CameraGpsProbe> {
  let p = probeCache.get(path);
  if (!p) {
    p = window.api.probeCameraGps(path);
    probeCache.set(path, p);
    p.catch(() => probeCache.delete(path));
  }
  return p;
}

/** Spread above this means per-sample GPS times disagree enough to mention. */
const SPREAD_WARN_MS = 2000;

const AMBER = { background: 'rgba(245,177,74,0.12)', color: '#f5b14a' };

export function GpsAlignSection({
  clip,
  fitTrack,
  fitScope,
  active,
}: {
  clip: TimelineClip;
  fitTrack: TelemetryTrack;
  fitScope: 'local' | 'shared';
  /** The FIT sync anchor is currently 'gps' — show the stored result. */
  active: boolean;
}) {
  const setClipOffset = useProject((s) => s.setClipOffset);
  const setClipGpsClock = useProject((s) => s.setClipGpsClock);

  const [probe, setProbe] = useState<CameraGpsProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = clip.media.path;
  useEffect(() => {
    let live = true;
    setProbe(null);
    setError(null);
    probeOnce(path)
      .then((p) => { if (live) setProbe(p); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [path]);

  // Only describe a stored GPS result while it's the sync in effect.
  const gpsClock = active ? clip.media.gpsClock : undefined;
  const experimental = gpsClock?.experimental ?? probe?.experimental ?? false;

  const align = async () => {
    setBusy(true);
    setError(null);
    try {
      const track = await window.api.extractCameraGps(path, clip.media.durationMs);
      const est = estimateVideoStartUtc(track.samples);
      if (!est) throw new Error('Not enough GPS samples with a satellite fix to work out the video start time.');

      const fitStartMs = new Date(fitTrack.startTime).getTime();
      if (!Number.isFinite(fitStartMs)) throw new Error('The FIT file has no start time to align against.');
      const offsetMs = Math.round(fitStartMs - est.videoStartUtcMs);

      const warnings = [...track.warnings];
      if (est.spreadMs > SPREAD_WARN_MS) {
        warnings.push(`GPS timestamps in this clip vary by ${(est.spreadMs / 1000).toFixed(1)} s, so the offset may be less precise.`);
      }
      warnings.push(...crossCheckWarnings(speedCrossCheck(track.samples, fitTrack, offsetMs)));

      const info: GpsClockInfo = {
        videoStartUtcMs: est.videoStartUtcMs,
        format: track.format,
        model: track.model,
        experimental: track.experimental,
        fixSamples: est.fixSamples,
        spreadMs: est.spreadMs,
        warnings,
        computedAt: new Date().toISOString(),
      };
      setClipGpsClock(clip.id, info);
      setClipOffset(clip.id, fitTrack.id, offsetMs, fitScope, 'gps');
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setError(/cancel/i.test(msg) ? 'GPS alignment cancelled.' : msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  const available = probe?.status === 'available';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="field-label">GPS auto-align</div>
        {experimental && (
          <span className="px-1.5 py-0.5 rounded text-[9.5px] font-semibold" style={AMBER}>Experimental</span>
        )}
      </div>

      {!probe && !error && <p className="text-[11px] text-textfaint">Checking this clip for camera GPS…</p>}

      {probe && !available && (
        <p className="text-[11px] text-textfaint leading-relaxed">{probe.reason}</p>
      )}

      {available && (
        busy ? (
          <div className="flex gap-1.5">
            <button type="button" className="btn-elevated text-xs flex-1" disabled>Reading GPS…</button>
            <button type="button" className="btn-ghost text-xs" onClick={() => void window.api.cancelCameraGps()}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-elevated text-xs w-full"
            title={probe.reason}
            onClick={() => void align()}
          >
            {gpsClock ? 'Re-align via GPS' : 'Auto-align via GPS'}
          </button>
        )
      )}

      {experimental && available && !gpsClock && (
        <p className="text-[10.5px] leading-relaxed" style={{ color: AMBER.color }}>
          Support for this camera is experimental and hasn&apos;t been tested with real GPS footage. Check the result
          visually.
        </p>
      )}

      {error && <p className="text-[11px] text-red-400 leading-relaxed">{error}</p>}

      {gpsClock && (
        <div className="text-[11px] text-white/60 leading-relaxed">
          Video start from GPS: {new Date(gpsClock.videoStartUtcMs).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')}
          {' '}({gpsClock.fixSamples} fixes{gpsClock.model ? `, ${gpsClock.model}` : ''})
          {clip.media.creationTime && (
            <> · camera clock was {formatOffsetMs(new Date(clip.media.creationTime).getTime() - gpsClock.videoStartUtcMs)} off</>
          )}
        </div>
      )}
      {gpsClock?.warnings.map((w) => (
        <p key={w} className="text-[10.5px] leading-relaxed rounded px-2 py-1" style={AMBER}>{w}</p>
      ))}
    </div>
  );
}
