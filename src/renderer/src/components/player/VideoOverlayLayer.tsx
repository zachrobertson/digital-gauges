import { useEffect, useRef } from 'react';
import { activeOverlaysAt } from '@shared/timeline';
import { overlaySourceMsAt } from '@shared/sync';
import type { TimelineClip, VideoOverlayClip } from '@shared/types';
import { localMediaUrl } from '../../lib/paths';

interface VideoOverlayLayerProps {
  clips: TimelineClip[];
  overlays: VideoOverlayClip[];
  globalMs: number;
  playing: boolean;
  box: { w: number; h: number; left: number; top: number };
  selectedOverlayId: string | null;
  previewFrozen?: boolean;
}

function OverlayVideo({
  overlay,
  clips,
  globalMs,
  playing,
  box,
  selected,
  previewFrozen,
}: {
  overlay: VideoOverlayClip;
  clips: TimelineClip[];
  globalMs: number;
  playing: boolean;
  box: { w: number; h: number; left: number; top: number };
  selected: boolean;
  previewFrozen: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSourceMsRef = useRef<number | null>(null);

  const sourceMs = overlaySourceMsAt(globalMs, overlay, clips);
  const visible = sourceMs != null;
  const opacity = overlay.opacity ?? 1;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || sourceMs == null) return;
    if (previewFrozen) {
      if (!el.paused) el.pause();
      return;
    }
    const targetSec = sourceMs / 1000;
    if (lastSourceMsRef.current == null || Math.abs(targetSec - el.currentTime) > 0.08) {
      el.currentTime = targetSec;
    }
    lastSourceMsRef.current = sourceMs;
    if (playing && el.paused) void el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }, [sourceMs, playing, globalMs, previewFrozen]);

  if (!visible) return null;

  const { rect, z } = overlay;
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
    opacity,
    zIndex: 10 + z,
    objectFit: 'cover',
    pointerEvents: 'none',
    outline: selected ? '2px solid #3ddc97' : undefined,
    outlineOffset: selected ? -1 : undefined,
  };

  return (
    <video
      ref={videoRef}
      src={localMediaUrl(overlay.media.path)}
      style={style}
      muted
      playsInline
      preload="auto"
    />
  );
}

/** Stacked PiP overlay videos above the base preview, below gauge canvas. */
export function VideoOverlayLayer({
  clips,
  overlays,
  globalMs,
  playing,
  box,
  selectedOverlayId,
  previewFrozen = false,
}: VideoOverlayLayerProps) {
  const active = activeOverlaysAt(globalMs, overlays);

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
    >
      {active.map((overlay) => (
        <OverlayVideo
          key={overlay.id}
          overlay={overlay}
          clips={clips}
          globalMs={globalMs}
          playing={playing}
          box={box}
          selected={overlay.id === selectedOverlayId}
          previewFrozen={previewFrozen}
        />
      ))}
    </div>
  );
}
