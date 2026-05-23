import { useCallback, useEffect, useRef, useState } from 'react';

import { useProject } from '../../store/project';

import { findPluginById } from '../../store/plugins';

import { mergeGaugeLayout, syncGaugeVideoRectHeight } from '../../gauges/gaugeEditorLayout';
import { layoutTemplateForGauge } from '../../gauges/dataGauge';

import { appearanceDefaults } from '../../gauges/appearanceSchema';

import { CanvasOverlay } from './CanvasOverlay';

import { useVideoGaugeDrag, videoGaugeDragActive } from './useVideoGaugeDrag';

import { localMediaUrl } from '../../lib/paths';

/** Native `<video controls>` chrome height — interaction layer must not cover this strip. */
const VIDEO_CONTROL_BAR_H = 48;



/**

 * Video player with frame-accurate gauge overlay.

 *

 *   - Uses an HTML5 <video> element wrapping a local `file://` URL.

 *   - On every `timeupdate` (plus an rAF loop for sub-frame precision

 *     while playing) it pushes the current time into the project store

 *     as `playhead` (ms). The CanvasOverlay reads `playhead` and

 *     redraws all gauges in lockstep with the video clock.

 *   - Aspect-ratio-aware: the overlay canvas exactly covers the video

 *     box (letterboxed inside its container).

 */

export function VideoPlayer() {

  const video = useProject((s) => s.project.video);

  const gauges = useProject((s) => s.project.gauges);

  const setPlayhead = useProject((s) => s.setPlayhead);

  const playing = useProject((s) => s.playing);

  const setPlaying = useProject((s) => s.setPlaying);

  const updateGauge = useProject((s) => s.updateGauge);



  const videoRef = useRef<HTMLVideoElement>(null);

  const srcRef = useRef<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const [box, setBox] = useState<{ w: number; h: number; left: number; top: number }>({ w: 0, h: 0, left: 0, top: 0 });



  const togglePlayback = useCallback(() => {

    const el = videoRef.current;

    if (!el) return;

    if (el.paused) void el.play();

    else el.pause();

  }, []);



  const { interactionEnabled, interactionProps } = useVideoGaugeDrag(box, togglePlayback);



  useEffect(() => {

    if (!video || !containerRef.current) return;

    const update = () => {

      const c = containerRef.current!;

      const cw = c.clientWidth;

      const ch = c.clientHeight;

      const aspect = video.width / video.height || 16 / 9;

      const cAspect = cw / ch;

      let w = cw, h = ch;

      if (cAspect > aspect) { w = ch * aspect; h = ch; }

      else { w = cw; h = cw / aspect; }

      setBox({ w, h, left: (cw - w) / 2, top: (ch - h) / 2 });

    };

    update();

    const ro = new ResizeObserver(update);

    ro.observe(containerRef.current);

    return () => ro.disconnect();

  }, [video]);



  // Keep every gauge's on-video height matched to its layout frame aspect.

  useEffect(() => {

    if (videoGaugeDragActive) return;

    if (!video?.width || !video?.height || gauges.length === 0) return;

    for (const g of gauges) {

      const plugin = findPluginById(g.pluginId);

      if (!plugin) continue;

      const config = { ...plugin.defaultConfig, ...g.config };

      const template = layoutTemplateForGauge(g.pluginId, config as Record<string, unknown>);

      const layout = mergeGaugeLayout((config as { layout?: Parameters<typeof mergeGaugeLayout>[0] }).layout, template);

      const panelShape = (config as { cornerStyle?: string }).cornerStyle

        ?? appearanceDefaults.cornerStyle;

      const synced = syncGaugeVideoRectHeight(

        g.rect,

        layout,

        video.width,

        video.height,

        panelShape as 'rounded' | 'square' | 'pill' | 'circle',

      );

      if (

        Math.abs(synced.w - g.rect.w) > 0.0005

        || Math.abs(synced.h - g.rect.h) > 0.0005

      ) {

        updateGauge(g.id, { rect: synced });

      }

    }

  }, [video?.width, video?.height, video?.id, gauges, updateGauge]);



  // Set src imperatively so React re-renders (playhead, gauges, etc.) don't

  // re-apply the attribute and restart media loading mid-playback.

  useEffect(() => {

    const el = videoRef.current;

    if (!el || !video) return;

    const nextSrc = localMediaUrl(video.path);

    if (srcRef.current === nextSrc) return;

    srcRef.current = nextSrc;

    el.src = nextSrc;

    el.load();

  }, [video]);



  // Drive the rAF playhead loop while playing — `timeupdate` only fires

  // 4-5×/sec which would visibly stutter gauges.

  useEffect(() => {

    const el = videoRef.current;

    if (!el) return;

    let raf = 0;

    const tick = () => {

      setPlayhead(Math.round(el.currentTime * 1000));

      raf = requestAnimationFrame(tick);

    };

    if (playing) raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);

  }, [playing, setPlayhead]);



  useEffect(() => {

    const el = videoRef.current;

    if (!el) return;

    const onPlay = () => setPlaying(true);

    const onPause = () => setPlaying(false);

    const onSeek = () => setPlayhead(Math.round(el.currentTime * 1000));

    const onError = () => {

      const err = el.error;

      console.error('[VideoPlayer] media error', err?.code, err?.message, el.src);

    };

    el.addEventListener('play', onPlay);

    el.addEventListener('pause', onPause);

    el.addEventListener('seeked', onSeek);

    el.addEventListener('error', onError);

    return () => {

      el.removeEventListener('play', onPlay);

      el.removeEventListener('pause', onPause);

      el.removeEventListener('seeked', onSeek);

      el.removeEventListener('error', onError);

    };

  }, [setPlaying, setPlayhead, video]);



  if (!video) {

    return (

      <div className="flex-1 flex items-center justify-center text-white/40">

        Load a video to begin.

      </div>

    );

  }



  const videoBoxStyle = { left: box.left, top: box.top, width: box.w, height: box.h };



  return (

    <div ref={containerRef} className="relative flex-1 bg-black">

      <video

        ref={videoRef}

        className="absolute"

        style={videoBoxStyle}

        controls

        preload="auto"

      />

      {interactionEnabled && (

        <div

          className="absolute z-10 touch-none"

          style={{

            left: box.left,

            top: box.top,

            width: box.w,

            height: Math.max(0, box.h - VIDEO_CONTROL_BAR_H),

            ...interactionProps.style,

          }}

          onPointerDown={interactionProps.onPointerDown}

          onPointerMove={interactionProps.onPointerMove}

          onPointerUp={interactionProps.onPointerUp}

          onPointerCancel={interactionProps.onPointerCancel}

          onPointerLeave={interactionProps.onPointerLeave}

        />

      )}

      <div

        className="absolute pointer-events-none z-20"

        style={videoBoxStyle}

      >

        <CanvasOverlay width={box.w} height={box.h} showEditorAffordances />

      </div>

    </div>

  );

}


