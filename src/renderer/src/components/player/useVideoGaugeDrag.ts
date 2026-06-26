import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import type { GaugeInstance } from '@shared/types';

import { firstClipMedia } from '@shared/timeline';

import { useProject } from '../../store/project';

import { findPluginById } from '../../store/plugins';

import { layoutTemplateForGauge } from '../../gauges/dataGauge';

import { isEllipseFrame, type FrameStyleConfig } from '../../gauges/frameStyle';

import {

  hitVideoGaugeResizeHandle,

  mergeGaugeLayout,

  resizeVideoGaugeRect,

  videoResizeHandleCursor,

  type LayoutCorner,

} from '../../gauges/gaugeEditorLayout';



/** Set while dragging on the video so sidebar aspect-sync does not fight the drag. */

export let videoGaugeDragActive = false;



interface MoveDragState {

  mode: 'move';

  id: string;

  startX: number;

  startY: number;

  startRect: GaugeInstance['rect'];

  boxW: number;

  boxH: number;

}



interface ResizeDragState {

  mode: 'resize';

  id: string;

  corner: LayoutCorner;

  startX: number;

  startY: number;

  startRect: GaugeInstance['rect'];

  boxW: number;

  boxH: number;

}



type DragState = MoveDragState | ResizeDragState;



function clamp(v: number, lo: number, hi: number): number {

  return Math.max(lo, Math.min(hi, v));

}



function clientToRel(clientX: number, clientY: number, el: HTMLElement) {

  const r = el.getBoundingClientRect();

  if (r.width <= 0 || r.height <= 0) return null;

  return {

    x: (clientX - r.left) / r.width,

    y: (clientY - r.top) / r.height,

  };

}



function hitGaugeAt(

  gauges: GaugeInstance[],

  relX: number,

  relY: number,

): GaugeInstance | null {

  const sorted = [...gauges].filter((g) => g.placed !== false).sort((a, b) => b.z - a.z);

  return sorted.find((g) =>

    relX >= g.rect.x

    && relX <= g.rect.x + g.rect.w

    && relY >= g.rect.y

    && relY <= g.rect.y + g.rect.h,

  ) ?? null;

}



function gaugeIsEllipse(gauge: GaugeInstance): boolean {
  const plugin = findPluginById(gauge.pluginId);
  const config = { ...plugin?.defaultConfig, ...gauge.config };
  return isEllipseFrame(config as FrameStyleConfig);
}



function gaugeLayout(gauge: GaugeInstance) {

  const plugin = findPluginById(gauge.pluginId);

  const config = { ...plugin?.defaultConfig, ...gauge.config };

  const template = layoutTemplateForGauge(gauge.pluginId, config as Record<string, unknown>);

  return mergeGaugeLayout(

    (config as { layout?: Parameters<typeof mergeGaugeLayout>[0] }).layout,

    template,

  );

}



export interface VideoGaugeInteractionProps {

  className?: string;

  style?: CSSProperties;

  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;

  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;

  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;

  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;

  onPointerLeave: (e: ReactPointerEvent<HTMLDivElement>) => void;

}



/**

 * Pointer drag for on-video gauge repositioning and resizing on a dedicated interaction layer

 * above the HTML video element (native video steals pointer events otherwise).

 */

export function useVideoGaugeDrag(

  box: { w: number; h: number; left: number; top: number },

  onBackgroundPointerDown?: () => void,

  options?: { disabled?: boolean },

): { interactionProps: VideoGaugeInteractionProps; interactionEnabled: boolean } {

  const selectGauge = useProject((s) => s.selectGauge);

  const selectedGaugeId = useProject((s) => s.selectedGaugeId);

  const updateGauge = useProject((s) => s.updateGauge);

  const dragRef = useRef<DragState | null>(null);

  const [cursor, setCursor] = useState('');



  const finishDrag = useCallback(() => {

    videoGaugeDragActive = false;

    dragRef.current = null;

  }, []);



  const applyDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {

    const d = dragRef.current;

    if (!d) return;



    const dxRel = (e.clientX - d.startX) / d.boxW;

    const dyRel = (e.clientY - d.startY) / d.boxH;



    if (d.mode === 'move') {

      const start = d.startRect;

      updateGauge(d.id, {

        rect: {

          ...start,

          x: clamp(start.x + dxRel, 0, 1 - start.w),

          y: clamp(start.y + dyRel, 0, 1 - start.h),

        },

      });

      return;

    }



    const { project } = useProject.getState();

    const gauge = project.gauges.find((g) => g.id === d.id);

    if (!gauge) return;



    const media = firstClipMedia(project);

    if (!media?.width || !media?.height) return;



    const layout = gaugeLayout(gauge);

    const next = resizeVideoGaugeRect(
      d.startRect,
      d.corner,
      dxRel,
      dyRel,
      layout,
      media.width,
      media.height,
    );

    updateGauge(d.id, { rect: next });

  }, [updateGauge]);



  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {

    if (e.button !== 0 || box.w <= 0 || box.h <= 0) return;



    const el = e.currentTarget;

    const bounds = el.getBoundingClientRect();

    if (bounds.width <= 0 || bounds.height <= 0) return;



    const rel = clientToRel(e.clientX, e.clientY, el);

    if (!rel || rel.x < 0 || rel.x > 1 || rel.y < 0 || rel.y > 1) return;



    const { project } = useProject.getState();

    const selected = selectedGaugeId

      ? project.gauges.find((g) => g.id === selectedGaugeId && g.placed !== false)

      : null;



    if (selected) {

      const isEllipse = gaugeIsEllipse(selected);

      const handle = hitVideoGaugeResizeHandle(

        rel.x,

        rel.y,

        selected.rect,

        isEllipse,

        bounds.width,

        bounds.height,

      );

      if (handle) {

        e.preventDefault();

        e.stopPropagation();

        el.setPointerCapture(e.pointerId);

        videoGaugeDragActive = true;

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

        setCursor(videoResizeHandleCursor(handle));

        return;

      }

    }



    const hit = hitGaugeAt(project.gauges, rel.x, rel.y);

    if (!hit) {

      onBackgroundPointerDown?.();

      return;

    }



    e.preventDefault();

    e.stopPropagation();

    el.setPointerCapture(e.pointerId);



    selectGauge(hit.id);

    videoGaugeDragActive = true;

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

  }, [box.w, box.h, onBackgroundPointerDown, selectGauge, selectedGaugeId]);



  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {

    const el = e.currentTarget;

    const bounds = el.getBoundingClientRect();

    const pxW = bounds.width;

    const pxH = bounds.height;



    if (dragRef.current) {

      if (dragRef.current.boxW !== pxW && pxW > 0) dragRef.current.boxW = pxW;

      if (dragRef.current.boxH !== pxH && pxH > 0) dragRef.current.boxH = pxH;

      applyDrag(e);

      return;

    }



    const rel = clientToRel(e.clientX, e.clientY, el);

    if (!rel || rel.x < 0 || rel.x > 1 || rel.y < 0 || rel.y > 1) {

      setCursor('');

      return;

    }



    const { project } = useProject.getState();

    const selected = selectedGaugeId

      ? project.gauges.find((g) => g.id === selectedGaugeId && g.placed !== false)

      : null;



    if (selected) {

      const isEllipse = gaugeIsEllipse(selected);

      const handle = hitVideoGaugeResizeHandle(

        rel.x,

        rel.y,

        selected.rect,

        isEllipse,

        pxW,

        pxH,

      );

      if (handle) {

        setCursor(videoResizeHandleCursor(handle));

        return;

      }

    }



    const hit = hitGaugeAt(project.gauges, rel.x, rel.y);

    setCursor(hit ? 'grab' : '');

  }, [applyDrag, selectedGaugeId]);



  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {

    const d = dragRef.current;

    if (!d) return;

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



  const onPointerLeave = useCallback(() => {

    if (dragRef.current) return;

    setCursor('');

  }, []);



  const interactionEnabled = box.w > 0 && box.h > 0 && !options?.disabled;



  return {

    interactionEnabled,

    interactionProps: {

      onPointerDown,

      onPointerMove,

      onPointerUp,

      onPointerCancel,

      onPointerLeave,

      style: { cursor },

    },

  };

}

