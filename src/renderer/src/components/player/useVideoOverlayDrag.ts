import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { VideoOverlayClip } from '@shared/types';
import { useProject } from '../../store/project';

export let videoOverlayDragActive = false;

type DragMode = 'move' | 'resize';
type Corner = 'nw' | 'ne' | 'sw' | 'se';

interface DragState {
  mode: DragMode;
  id: string;
  corner?: Corner;
  startX: number;
  startY: number;
  startRect: VideoOverlayClip['rect'];
  boxW: number;
  boxH: number;
}

const HANDLE_PX = 10;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clientToRel(clientX: number, clientY: number, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
}

function hitResizeHandle(
  relX: number,
  relY: number,
  rect: VideoOverlayClip['rect'],
  pxW: number,
  pxH: number,
): Corner | null {
  const hx = HANDLE_PX / pxW;
  const hy = HANDLE_PX / pxH;
  const left = relX >= rect.x && relX <= rect.x + hx;
  const right = relX >= rect.x + rect.w - hx && relX <= rect.x + rect.w;
  const top = relY >= rect.y && relY <= rect.y + hy;
  const bottom = relY >= rect.y + rect.h - hy && relY <= rect.y + rect.h;
  if (left && top) return 'nw';
  if (right && top) return 'ne';
  if (left && bottom) return 'sw';
  if (right && bottom) return 'se';
  return null;
}

function hitOverlayAt(
  overlays: VideoOverlayClip[],
  relX: number,
  relY: number,
): VideoOverlayClip | null {
  const sorted = [...overlays].sort((a, b) => b.z - a.z);
  return sorted.find((o) =>
    relX >= o.rect.x && relX <= o.rect.x + o.rect.w
    && relY >= o.rect.y && relY <= o.rect.y + o.rect.h,
  ) ?? null;
}

function resizeRect(
  start: VideoOverlayClip['rect'],
  corner: Corner,
  dxRel: number,
  dyRel: number,
): VideoOverlayClip['rect'] {
  const min = 0.05;
  let { x, y, w, h } = start;
  if (corner === 'nw') {
    x = clamp(start.x + dxRel, 0, start.x + start.w - min);
    y = clamp(start.y + dyRel, 0, start.y + start.h - min);
    w = start.x + start.w - x;
    h = start.y + start.h - y;
  } else if (corner === 'ne') {
    y = clamp(start.y + dyRel, 0, start.y + start.h - min);
    w = clamp(start.w + dxRel, min, 1 - start.x);
    h = start.y + start.h - y;
  } else if (corner === 'sw') {
    x = clamp(start.x + dxRel, 0, start.x + start.w - min);
    w = start.x + start.w - x;
    h = clamp(start.h + dyRel, min, 1 - start.y);
  } else {
    w = clamp(start.w + dxRel, min, 1 - start.x);
    h = clamp(start.h + dyRel, min, 1 - start.y);
  }
  return { x, y, w, h };
}

export interface VideoOverlayInteractionProps {
  style?: CSSProperties;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useVideoOverlayDrag(
  box: { w: number; h: number },
  options?: { disabled?: boolean },
): { overlayInteractionProps: VideoOverlayInteractionProps; overlayDragEnabled: boolean } {
  const selectOverlay = useProject((s) => s.selectOverlay);
  const selectedOverlayId = useProject((s) => s.selectedOverlayId);
  const setOverlayRect = useProject((s) => s.setOverlayRect);
  const dragRef = useRef<DragState | null>(null);
  const [cursor, setCursor] = useState('');

  const finishDrag = useCallback(() => {
    videoOverlayDragActive = false;
    dragRef.current = null;
  }, []);

  const applyDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dxRel = (e.clientX - d.startX) / d.boxW;
    const dyRel = (e.clientY - d.startY) / d.boxH;

    if (d.mode === 'move') {
      const start = d.startRect;
      setOverlayRect(d.id, {
        ...start,
        x: clamp(start.x + dxRel, 0, 1 - start.w),
        y: clamp(start.y + dyRel, 0, 1 - start.h),
      });
      return;
    }

    if (d.corner) {
      setOverlayRect(d.id, resizeRect(d.startRect, d.corner, dxRel, dyRel));
    }
  }, [setOverlayRect]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || box.w <= 0 || box.h <= 0 || options?.disabled) return;

    const el = e.currentTarget;
    const bounds = el.getBoundingClientRect();
    const rel = clientToRel(e.clientX, e.clientY, el);
    if (!rel) return;

    const { project } = useProject.getState();
    const selected = selectedOverlayId
      ? project.overlays.find((o) => o.id === selectedOverlayId)
      : null;

    if (selected) {
      const handle = hitResizeHandle(rel.x, rel.y, selected.rect, bounds.width, bounds.height);
      if (handle) {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        videoOverlayDragActive = true;
        dragRef.current = {
          mode: 'resize',
          id: selected.id,
          corner: handle,
          startX: e.clientX,
          startY: e.clientY,
          startRect: { ...selected.rect },
          boxW: bounds.width,
          boxH: bounds.height,
        };
        setCursor(handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize');
        return;
      }
    }

    const hit = hitOverlayAt(project.overlays, rel.x, rel.y);
    if (!hit) return;

    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    selectOverlay(hit.id);
    videoOverlayDragActive = true;
    dragRef.current = {
      mode: 'move',
      id: hit.id,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...hit.rect },
      boxW: bounds.width,
      boxH: bounds.height,
    };
    setCursor('grabbing');
  }, [box.w, box.h, options?.disabled, selectOverlay, selectedOverlayId]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const bounds = el.getBoundingClientRect();
    if (dragRef.current) {
      if (dragRef.current.boxW !== bounds.width && bounds.width > 0) dragRef.current.boxW = bounds.width;
      if (dragRef.current.boxH !== bounds.height && bounds.height > 0) dragRef.current.boxH = bounds.height;
      applyDrag(e);
      return;
    }

    const rel = clientToRel(e.clientX, e.clientY, el);
    if (!rel) {
      setCursor('');
      return;
    }

    const { project } = useProject.getState();
    const selected = selectedOverlayId
      ? project.overlays.find((o) => o.id === selectedOverlayId)
      : null;
    if (selected) {
      const handle = hitResizeHandle(rel.x, rel.y, selected.rect, bounds.width, bounds.height);
      if (handle) {
        setCursor(handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize');
        return;
      }
    }

    const hit = hitOverlayAt(project.overlays, rel.x, rel.y);
    setCursor(hit ? 'grab' : '');
  }, [applyDrag, selectedOverlayId]);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    applyDrag(e);
    finishDrag();
    setCursor('');
  }, [applyDrag, finishDrag]);

  const onPointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    finishDrag();
    setCursor('');
  }, [finishDrag]);

  const overlayDragEnabled = box.w > 0 && box.h > 0 && !options?.disabled;

  return {
    overlayDragEnabled,
    overlayInteractionProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      style: { cursor, zIndex: 15 },
    },
  };
}
