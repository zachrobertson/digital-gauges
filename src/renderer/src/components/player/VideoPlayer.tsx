import { useCallback, useEffect, useRef, useState } from 'react';
import {
  firstClipMedia,
  globalMsToPreviewTimeSec,
  previewTimeToGlobalMs,
  projectDurationMs,
  totalDurationMs,
} from '@shared/timeline';
import { useProject } from '../../store/project';
import { findPluginById } from '../../store/plugins';
import { mergeGaugeLayout, syncGaugeVideoRectHeight } from '../../gauges/gaugeEditorLayout';
import { layoutTemplateForGauge } from '../../gauges/dataGauge';
import { CanvasOverlay } from './CanvasOverlay';
import { VideoOverlayLayer } from './VideoOverlayLayer';
import { useVideoGaugeDrag, videoGaugeDragActive } from './useVideoGaugeDrag';
import { useVideoOverlayDrag, videoOverlayDragActive } from './useVideoOverlayDrag';
import { localMediaUrl } from '../../lib/paths';
import { usePreviewVideoState } from '../../lib/PreviewVideoProvider';
import { PreviewProgressBar } from '../PreviewProgressBar';

/** Native `<video controls>` chrome height — interaction layer must not cover this strip. */
const VIDEO_CONTROL_BAR_H = 48;

/**
 * Video player with a single concatenated preview source.
 * Playhead is mapped proportionally from the preview video clock to the
 * logical multi-clip timeline so gauge telemetry stays in sync.
 */
export function VideoPlayer({ editable = true }: { editable?: boolean } = {}) {
  const clips = useProject((s) => s.project.clips);
  const overlays = useProject((s) => s.project.overlays);
  const selectedOverlayId = useProject((s) => s.selectedOverlayId);
  const gauges = useProject((s) => s.project.gauges);
  const playhead = useProject((s) => s.playhead);
  const playing = useProject((s) => s.playing);
  const setPlayhead = useProject((s) => s.setPlayhead);
  const setPlaying = useProject((s) => s.setPlaying);
  const updateGauge = useProject((s) => s.updateGauge);

  const layoutMedia = firstClipMedia(useProject.getState().project);
  const logicalTotalMs = projectDurationMs(clips, overlays);
  const previewStale = useProject((s) => s.previewStale);
  const trimInProgress = useProject((s) => s.trimInProgress);
  const previewBuilding = useProject((s) => s.previewBuilding);
  const previewProgress = useProject((s) => s.previewProgress);
  const previewFrozen = previewStale || trimInProgress || previewBuilding;
  const { previewPath, loading: previewLoading, error: previewError } = usePreviewVideoState();

  const videoRef = useRef<HTMLVideoElement>(null);
  const srcRef = useRef<string | null>(null);
  const seekingRef = useRef(false);
  /** Who initiated the current seek — external timeline scrub vs native video controls. */
  const seekSourceRef = useRef<'external' | 'video' | null>(null);
  /** Latest global ms requested by timeline scrub — applied after in-flight seeks finish. */
  const pendingSeekGlobalMsRef = useRef<number | null>(null);
  const scrubSeekRafRef = useRef(0);
  const lastVideoGlobalMsRef = useRef(0);
  const previewDurationSecRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [box, setBox] = useState<{ w: number; h: number; left: number; top: number }>({
    w: 0, h: 0, left: 0, top: 0,
  });

  const syncPlayheadFromVideo = useCallback(() => {
    const el = videoRef.current;
    if (!el || previewFrozen) return;
    // While the timeline is driving the video to a pending target, don't pull playhead back.
    if (seekSourceRef.current === 'external' && pendingSeekGlobalMsRef.current != null) return;
    const previewDur = previewDurationSecRef.current > 0
      ? previewDurationSecRef.current
      : (el.duration || totalDurationMs(clips) / 1000);
    const globalMs = previewTimeToGlobalMs(el.currentTime, previewDur, clips);
    lastVideoGlobalMsRef.current = globalMs;
    const prev = useProject.getState().playhead;
    const paused = !useProject.getState().playing;
    if (paused || Math.abs(globalMs - prev) >= 25) {
      setPlayhead(globalMs);
    }
  }, [clips, previewFrozen, setPlayhead]);

  const previewDurationSec = useCallback((el: HTMLVideoElement) => (
    previewDurationSecRef.current > 0
      ? previewDurationSecRef.current
      : (el.duration || totalDurationMs(clips) / 1000)
  ), [clips]);

  /** Seek the preview file to a global timeline position while paused/scrubbing. */
  const seekVideoToGlobalMs = useCallback((globalMs: number) => {
    const el = videoRef.current;
    if (!el || !previewPath || previewFrozen || logicalTotalMs <= 0) return;
    if (useProject.getState().playing) return;

    const clampedMs = Math.min(Math.max(0, globalMs), logicalTotalMs);
    seekSourceRef.current = 'external';
    pendingSeekGlobalMsRef.current = clampedMs;

    const targetSec = globalMsToPreviewTimeSec(
      clampedMs,
      previewDurationSec(el),
      clips,
    );
    if (Math.abs(el.currentTime - targetSec) <= 0.05) {
      pendingSeekGlobalMsRef.current = null;
      seekSourceRef.current = null;
      lastVideoGlobalMsRef.current = clampedMs;
      seekingRef.current = false;
      return;
    }

    seekingRef.current = true;
    el.currentTime = targetSec;
  }, [clips, logicalTotalMs, previewDurationSec, previewFrozen, previewPath]);

  const finishPendingSeek = useCallback(() => {
    const el = videoRef.current;
    if (!el) {
      seekingRef.current = false;
      seekSourceRef.current = null;
      return;
    }

    if (seekSourceRef.current === 'external' && pendingSeekGlobalMsRef.current != null) {
      if (useProject.getState().playing) {
        pendingSeekGlobalMsRef.current = null;
        seekSourceRef.current = null;
        seekingRef.current = false;
        syncPlayheadFromVideo();
        return;
      }

      const pending = pendingSeekGlobalMsRef.current;
      const targetSec = globalMsToPreviewTimeSec(
        pending,
        previewDurationSec(el),
        clips,
      );
      if (Math.abs(el.currentTime - targetSec) > 0.05) {
        seekingRef.current = true;
        el.currentTime = targetSec;
        return;
      }

      pendingSeekGlobalMsRef.current = null;
      seekSourceRef.current = null;
      lastVideoGlobalMsRef.current = pending;
      seekingRef.current = false;
      return;
    }

    // Native video scrub or playback seek — mirror clock to global playhead.
    seekSourceRef.current = null;
    pendingSeekGlobalMsRef.current = null;
    seekingRef.current = false;
    syncPlayheadFromVideo();
  }, [clips, previewDurationSec, syncPlayheadFromVideo]);

  const togglePlayback = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const { interactionEnabled, interactionProps } = useVideoGaugeDrag(box, togglePlayback, {
    disabled: videoOverlayDragActive,
  });
  const { overlayDragEnabled, overlayInteractionProps } = useVideoOverlayDrag(box, {
    disabled: videoGaugeDragActive,
  });

  const onInteractionPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    overlayInteractionProps.onPointerDown(e);
    if (!e.defaultPrevented && !videoOverlayDragActive) {
      interactionProps.onPointerDown(e);
    }
  };
  const onInteractionPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (videoOverlayDragActive) overlayInteractionProps.onPointerMove(e);
    else interactionProps.onPointerMove(e);
  };
  const onInteractionPointerUp: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (videoOverlayDragActive) overlayInteractionProps.onPointerUp(e);
    else interactionProps.onPointerUp(e);
  };
  const onInteractionPointerCancel: React.PointerEventHandler<HTMLDivElement> = (e) => {
    overlayInteractionProps.onPointerCancel(e);
    interactionProps.onPointerCancel(e);
  };

  useEffect(() => {
    if (!layoutMedia || !containerRef.current) return;
    const update = () => {
      const c = containerRef.current!;
      const cw = c.clientWidth;
      const ch = c.clientHeight;
      const aspect = layoutMedia.width / layoutMedia.height || 16 / 9;
      const cAspect = cw / ch;
      let w = cw;
      let h = ch;
      if (cAspect > aspect) { w = ch * aspect; h = ch; }
      else { w = cw; h = cw / aspect; }
      setBox({ w, h, left: (cw - w) / 2, top: (ch - h) / 2 });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [layoutMedia, previewPath]);

  useEffect(() => {
    if (videoGaugeDragActive) return;
    if (!layoutMedia?.width || !layoutMedia?.height || gauges.length === 0) return;
    for (const g of gauges) {
      const plugin = findPluginById(g.pluginId);
      if (!plugin) continue;
      const config = { ...plugin.defaultConfig, ...g.config };
      const template = layoutTemplateForGauge(g.pluginId, config as Record<string, unknown>);
      const layout = mergeGaugeLayout(
        (config as { layout?: Parameters<typeof mergeGaugeLayout>[0] }).layout,
        template,
      );
      const synced = syncGaugeVideoRectHeight(
        g.rect,
        layout,
        layoutMedia.width,
        layoutMedia.height,
      );
      if (
        Math.abs(synced.w - g.rect.w) > 0.0005
        || Math.abs(synced.h - g.rect.h) > 0.0005
      ) {
        updateGauge(g.id, { rect: synced });
      }
    }
  }, [layoutMedia?.width, layoutMedia?.height, layoutMedia?.id, gauges, updateGauge]);

  // Load concatenated preview as a single video source.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (!previewPath) {
      setMediaReady(false);
      el.pause();
      if (srcRef.current) {
        srcRef.current = null;
        el.removeAttribute('src');
        el.load();
      }
      return;
    }

    const nextSrc = localMediaUrl(previewPath);
    if (srcRef.current === nextSrc) return;

    setMediaReady(false);
    seekingRef.current = true;
    srcRef.current = nextSrc;
    const resumePlayhead = useProject.getState().playhead;
    el.src = nextSrc;
    el.load();

    const onLoaded = () => {
      previewDurationSecRef.current = el.duration || logicalTotalMs / 1000;
      seekingRef.current = false;
      seekSourceRef.current = null;
      pendingSeekGlobalMsRef.current = null;
      setMediaReady(true);
      seekVideoToGlobalMs(resumePlayhead);
    };
    const onLoadError = () => {
      seekingRef.current = false;
      setMediaReady(false);
    };

    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('error', onLoadError, { once: true });
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('error', onLoadError);
    };
  }, [previewPath, clips, logicalTotalMs, seekVideoToGlobalMs]);

  // Seek preview video when playhead changes externally (timeline scrub, etc.).
  useEffect(() => {
    if (!previewPath || previewFrozen || logicalTotalMs <= 0) return;
    if (useProject.getState().playing) return;
    // Playhead was just updated from native video scrub — don't seek the video back.
    if (seekSourceRef.current === 'video') return;
    if (Math.abs(playhead - lastVideoGlobalMsRef.current) < 30) return;

    cancelAnimationFrame(scrubSeekRafRef.current);
    scrubSeekRafRef.current = requestAnimationFrame(() => {
      seekVideoToGlobalMs(playhead);
    });
    return () => cancelAnimationFrame(scrubSeekRafRef.current);
  }, [playhead, previewPath, logicalTotalMs, previewFrozen, seekVideoToGlobalMs]);

  // Mirror preview clock → global playhead while the video is active (throttled in syncPlayheadFromVideo).
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !previewPath) return;
    let raf = 0;

    const tick = () => {
      if (!el.paused && !el.ended) {
        syncPlayheadFromVideo();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onDurationChange = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        previewDurationSecRef.current = el.duration;
      }
    };
    el.addEventListener('durationchange', onDurationChange);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('durationchange', onDurationChange);
    };
  }, [previewPath, syncPlayheadFromVideo]);

  // Drive the preview <video> from the global transport's play/pause state.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !previewPath || previewLoading || !mediaReady) return;
    if (previewFrozen) {
      if (!el.paused) el.pause();
      return;
    }
    if (playing && el.paused) {
      void el.play().catch(() => {});
    } else if (!playing && !el.paused) {
      el.pause();
    }
  }, [playing, previewPath, previewLoading, previewFrozen, mediaReady]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onPlay = () => {
      const s = useProject.getState();
      if (s.previewStale || s.trimInProgress || s.previewBuilding) {
        el.pause();
        return;
      }
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onSeeked = () => finishPendingSeek();
    const onSeeking = () => {
      seekingRef.current = true;
      // Native control scrub — don't treat as an external timeline-driven seek.
      if (seekSourceRef.current !== 'external') {
        seekSourceRef.current = 'video';
        pendingSeekGlobalMsRef.current = null;
      }
    };
    const onTimeUpdate = () => {
      if (useProject.getState().playing) return;
      if (seekSourceRef.current === 'external' && pendingSeekGlobalMsRef.current != null) return;
      syncPlayheadFromVideo();
    };
    const onEnded = () => setPlaying(false);
    const onError = () => {
      const err = el.error;
      console.error('[VideoPlayer] media error', err?.code, err?.message, el.src);
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('seeked', onSeeked);
    el.addEventListener('seeking', onSeeking);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('seeked', onSeeked);
      el.removeEventListener('seeking', onSeeking);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
  }, [setPlaying, finishPendingSeek, syncPlayheadFromVideo]);

  if (clips.length === 0) {
    return (
      <div className="flex-1 min-h-0 h-full w-full flex items-center justify-center text-white/40">
        Add a clip to begin.
      </div>
    );
  }

  if (previewError) {
    return (
      <div className="flex-1 min-h-0 h-full w-full flex flex-col items-center justify-center text-red-300/80 gap-2 px-6 text-center">
        <div>Preview failed: {previewError}</div>
        <div className="text-xs text-white/40">Clips may use incompatible codecs for fast concat.</div>
      </div>
    );
  }

  const videoBoxStyle = { left: box.left, top: box.top, width: box.w, height: box.h };

  const frozenMessage = trimInProgress
    ? 'Trim in progress — preview paused'
    : previewStale
      ? 'Preview out of date — click Generate Preview'
      : null;

  const showPreviewProgress = (previewBuilding || previewLoading) && previewProgress;

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 h-full w-full bg-black">
      {(previewLoading || previewBuilding) && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/75 text-white/60 px-6">
          {showPreviewProgress ? (
            <PreviewProgressBar progress={previewProgress} />
          ) : (
            <>
              <div className="text-sm">Building preview…</div>
              <div className="text-xs text-white/40">
                {previewPath ? 'Updating preview…' : 'Concatenating clips for playback'}
              </div>
            </>
          )}
        </div>
      )}
      {frozenMessage && !previewBuilding && !previewLoading && (
        <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
          <div className="px-4 py-2 rounded-lg bg-black/80 border border-white/10 text-sm text-white/70">
            {frozenMessage}
          </div>
        </div>
      )}
      <video
        ref={videoRef}
        className="absolute"
        style={videoBoxStyle}
        controls
        preload="auto"
      />
      <VideoOverlayLayer
        clips={clips}
        overlays={overlays}
        globalMs={playhead}
        playing={playing}
        box={box}
        selectedOverlayId={selectedOverlayId}
        previewFrozen={previewFrozen}
      />
      {editable && (interactionEnabled || overlayDragEnabled) && (
        <div
          className="absolute z-[15] touch-none"
          style={{
            left: box.left,
            top: box.top,
            width: box.w,
            height: Math.max(0, box.h - VIDEO_CONTROL_BAR_H),
            cursor: videoOverlayDragActive
              ? overlayInteractionProps.style?.cursor
              : interactionProps.style?.cursor,
          }}
          onPointerDown={onInteractionPointerDown}
          onPointerMove={onInteractionPointerMove}
          onPointerUp={onInteractionPointerUp}
          onPointerCancel={onInteractionPointerCancel}
          onPointerLeave={interactionProps.onPointerLeave}
        />
      )}
      <div className="absolute pointer-events-none z-20" style={videoBoxStyle}>
        <CanvasOverlay width={box.w} height={box.h} showEditorAffordances={editable} previewFrozen={previewFrozen} />
      </div>
    </div>
  );
}
