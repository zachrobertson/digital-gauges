import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { GaugeElement, TextSlot } from '@shared/types/gaugeElement';
import { isDataElement } from '@shared/types/gaugeElement';
import type { TelemetryFrame } from '@shared/types';
import type { GaugeEditorMeta } from '../../gauges/gaugeEditorAdapter';
import { mergeElementFieldConfig } from '../../gauges/gaugeEditorAdapter';
import {
  SAMPLE_EDITOR_ROUTE,
  sampleRouteCursor,
  type LatLon,
  type MarkerStyle,
} from '../../gauges/gpsMapDraw';
import type { DataGaugeConfig } from '../../gauges/dataGauge';
import type { FrameShape } from '../../gauges/frameStyle';
import { renderGaugeElements } from '../../gauges/elementRender';
import type { GaugeLayoutConfig, LayoutCorner, LayoutRect, XY } from '../../gauges/gaugeEditorLayout';
import {
  arcGeometry,
  clamp,
  dialPoint,
  LAYOUT_REF_H,
  LAYOUT_REF_W,
  MAX_ARC_RADIUS,
  panelCircleGeometry,
  panelRadius,
  panelEllipseGeometry,
  pointToDialDeg,
  resizeLayoutRect,
  snapBoundsCenterMoveDelta,
  snapLayoutRect,
  snapPointToGrid,
  snapRectMoveByCenter,
  snapToGrid,
  wrap360,
} from '../../gauges/gaugeEditorLayout';
import {
  applyBoundsMove,
  elementBounds,
  elementSnapCenter,
  isElementLocked,
  selectionBounds,
  shouldSnapElement,
  textSlotBounds,
  updateElement,
} from '../../lib/gaugeElementFactory';
import {
  isSelected,
  normalizeDragRect,
  selectElement,
  selectInMarquee,
} from '../../lib/elementSelection';
import { fieldMeta } from '../../gauges/fieldRegistry';
import { panelStyleFromConfig, type AppearanceConfig } from '../../gauges/common';

const PREVIEW_MIN_ZOOM = 0.25;
const PREVIEW_MAX_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 1.12;
const PREVIEW_CANVAS_SIZE = LAYOUT_REF_W;
const LAYOUT_CANVAS_Y_OFFSET = (PREVIEW_CANVAS_SIZE - LAYOUT_REF_H) / 2;
const DRAG_CAPTURE_PX = 4;
const GAUGE_RECT_RESIZE_OPTIONS = { constrainToLayout: false, minW: 1, minH: 1 } as const;
/** SVG needs a non-transparent fill for pointer events to hit the interior of a rect. */
const SELECTION_MOVE_FILL = 'rgba(255,255,255,0.001)';
const SELECTION_COLOR = '#3ddc97';
const PANEL_GUIDE_COLOR = 'rgba(255,255,255,0.22)';
const SELECTION_STROKE_WIDTH = 1;
const CORNER_MARKER_SIZE = 4;
const HANDLE_RADIUS = 4;
const HANDLE_HIT_RADIUS = 8;
const BOUNDS_GUIDE_COLOR = PANEL_GUIDE_COLOR;

function clampCornerRadius(rect: LayoutRect, rx: number): number {
  return Math.min(Math.max(0, rx), rect.w / 2, rect.h / 2);
}

function cornerMarkerPoints(rect: LayoutRect, rx: number): XY[] {
  const { x, y, w, h } = rect;
  const r = clampCornerRadius(rect, rx);
  if (r <= 0) {
    return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  }
  return [
    { x: x + r, y },
    { x: x + w - r, y },
    { x: x + w - r, y: y + h },
    { x: x + r, y: y + h },
  ];
}

function CornerMarkers({
  rect,
  rx,
  color = SELECTION_COLOR,
}: {
  rect: LayoutRect;
  rx: number;
  color?: string;
}) {
  const half = CORNER_MARKER_SIZE / 2;
  return (
    <g pointerEvents="none">
      {cornerMarkerPoints(rect, rx).map((p, i) => (
        <rect
          key={i}
          x={p.x - half}
          y={p.y - half}
          width={CORNER_MARKER_SIZE}
          height={CORNER_MARKER_SIZE}
          fill={color}
          stroke="#0c1014"
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function SelectionOutline({
  rect,
  rx = 0,
  color = BOUNDS_GUIDE_COLOR,
  interactive = false,
  onPointerDown,
}: {
  rect: LayoutRect;
  rx?: number;
  color?: string;
  interactive?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const cornerRx = clampCornerRadius(rect, rx);
  return (
    <g pointerEvents={interactive ? 'auto' : 'none'}>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        rx={cornerRx}
        ry={cornerRx}
        fill={interactive ? SELECTION_MOVE_FILL : 'none'}
        stroke={color}
        strokeWidth={SELECTION_STROKE_WIDTH}
        vectorEffect="non-scaling-stroke"
        style={interactive ? { cursor: 'move' } : undefined}
        onPointerDown={onPointerDown}
      />
      <CornerMarkers rect={rect} rx={cornerRx} color={color} />
    </g>
  );
}

type DragKind =
  | { kind: 'rect-move'; pointerOrigin: XY; rectOrigin: LayoutRect }
  | { kind: 'rect-resize'; corner: LayoutCorner; pointerOrigin: XY; rectOrigin: LayoutRect }
  | {
    kind: 'el-slot-move';
    elementId: string;
    slot: 'value' | 'unit';
    pointerOrigin: XY;
    posOrigin: XY;
    slotOrigin: TextSlot;
  }
  | {
    kind: 'el-rect-move';
    elementId: string;
    pointerOrigin: XY;
    rectOrigin: LayoutRect;
  }
  | {
    kind: 'el-point-move';
    elementId: string;
    pointerOrigin: XY;
    posOrigin: XY;
  }
  | {
    kind: 'el-arc-center';
    elementId: string;
    pointerOrigin: XY;
    centerOrigin: XY;
  }
  | { kind: 'el-arc-radius'; elementId: string; centerOrigin: XY }
  | {
    kind: 'el-arc-start' | 'el-arc-end';
    elementId: string;
    startDeg: number;
    endDeg: number;
    centerOrigin: XY;
    radius: number;
  }
  | {
    kind: 'selection-move';
    elementIds: string[];
    pointerOrigin: XY;
    elementsOrigin: GaugeElement[];
  }
  | {
    kind: 'marquee';
    pointerOrigin: XY;
    additive: boolean;
  };

function buildElementMoveDrag(
  element: GaugeElement,
  origin: XY,
  textSlot?: 'value' | 'unit',
): DragKind | null {
  switch (element.kind) {
    case 'bar':
    case 'map':
      return {
        kind: 'el-rect-move',
        elementId: element.id,
        pointerOrigin: origin,
        rectOrigin: { ...element.rect },
      };
    case 'arc':
      return {
        kind: 'el-arc-center',
        elementId: element.id,
        pointerOrigin: origin,
        centerOrigin: { ...element.center },
      };
    case 'text': {
      if (!textSlot) return null;
      const slotOrigin = textSlot === 'value' ? element.value : element.unit;
      if (!slotOrigin.visible) return null;
      return {
        kind: 'el-slot-move',
        elementId: element.id,
        slot: textSlot,
        pointerOrigin: origin,
        posOrigin: { ...slotOrigin.pos },
        slotOrigin: structuredClone(slotOrigin),
      };
    }
    case 'staticText':
    case 'image':
      return {
        kind: 'el-point-move',
        elementId: element.id,
        pointerOrigin: origin,
        posOrigin: { ...element.pos },
      };
    default:
      return null;
  }
}

function buildSelectionMoveDrag(
  elementIds: string[],
  elements: GaugeElement[],
  origin: XY,
): DragKind {
  const elementsOrigin = elementIds
    .map((id) => elements.find((e) => e.id === id))
    .filter((e): e is GaugeElement => e != null)
    .map((e) => structuredClone(e));
  return {
    kind: 'selection-move',
    elementIds,
    pointerOrigin: origin,
    elementsOrigin,
  };
}

function snapElementCenterToGrid(element: GaugeElement, gridSize: number, enabled: boolean): GaugeElement {
  if (!enabled) return element;
  const center = elementSnapCenter(element);
  if (!center) return element;
  const snapped = snapPointToGrid(center, gridSize, true);
  const dx = snapped.x - center.x;
  const dy = snapped.y - center.y;
  if (dx === 0 && dy === 0) return element;
  return { ...element, ...applyBoundsMove(element, dx, dy) } as GaugeElement;
}

function dragUsesElementSnap(
  drag: DragKind,
  layout: GaugeLayoutConfig,
  editorSnapEnabled: boolean,
): boolean {
  if (!editorSnapEnabled) return false;
  if (drag.kind === 'rect-move' || drag.kind === 'rect-resize') return true;
  if (
    drag.kind === 'el-rect-move'
    || drag.kind === 'el-slot-move'
    || drag.kind === 'el-point-move'
    || drag.kind === 'el-arc-center'
    || drag.kind === 'el-arc-radius'
    || drag.kind === 'el-arc-start'
    || drag.kind === 'el-arc-end'
  ) {
    const el = layout.elements.find((e) => e.id === drag.elementId);
    return el ? shouldSnapElement(el, editorSnapEnabled) : false;
  }
  if (drag.kind === 'selection-move') {
    const movable = drag.elementIds.filter((id) => {
      const el = layout.elements.find((e) => e.id === id);
      return el && !isElementLocked(el);
    });
    return movable.length > 0 && movable.every((id) => {
      const el = layout.elements.find((e) => e.id === id);
      return el != null && shouldSnapElement(el, editorSnapEnabled);
    });
  }
  return false;
}

function applyDragSnapCommit(
  layout: GaugeLayoutConfig,
  drag: DragKind,
  gridSize: number,
  editorSnapEnabled: boolean,
): GaugeLayoutConfig {
  if (!editorSnapEnabled) return layout;

  switch (drag.kind) {
    case 'rect-move': {
      const gr = layout.gaugeRect;
      const center = { x: gr.x + gr.w / 2, y: gr.y + gr.h / 2 };
      const snapped = snapPointToGrid(center, gridSize, true);
      return {
        ...layout,
        gaugeRect: { ...gr, x: snapped.x - gr.w / 2, y: snapped.y - gr.h / 2 },
      };
    }
    case 'rect-resize':
      return { ...layout, gaugeRect: snapLayoutRect(layout.gaugeRect, gridSize, true) };
    case 'el-arc-center':
    case 'el-point-move': {
      const el = layout.elements.find((e) => e.id === drag.elementId);
      if (!el || !shouldSnapElement(el, editorSnapEnabled)) return layout;
      const snapped = snapElementCenterToGrid(el, gridSize, true);
      return {
        ...layout,
        elements: layout.elements.map((e) => (e.id === drag.elementId ? snapped : e)),
      };
    }
    case 'el-rect-move': {
      const el = layout.elements.find((e) => e.id === drag.elementId);
      if (!el || (el.kind !== 'bar' && el.kind !== 'map') || !shouldSnapElement(el, editorSnapEnabled)) return layout;
      const center = { x: el.rect.x + el.rect.w / 2, y: el.rect.y + el.rect.h / 2 };
      const snapped = snapPointToGrid(center, gridSize, true);
      return {
        ...layout,
        elements: updateElement(layout.elements, drag.elementId, {
          rect: {
            ...el.rect,
            x: snapped.x - el.rect.w / 2,
            y: snapped.y - el.rect.h / 2,
          },
        }),
      };
    }
    case 'el-slot-move': {
      const el = layout.elements.find((e) => e.id === drag.elementId);
      if (!el || el.kind !== 'text' || !shouldSnapElement(el, editorSnapEnabled)) return layout;
      const slot = drag.slot === 'value' ? el.value : el.unit;
      const pos = snapPointToGrid(slot.pos, gridSize, true);
      return {
        ...layout,
        elements: updateElement(layout.elements, drag.elementId, {
          [drag.slot]: { ...slot, pos },
        }),
      };
    }
    case 'el-arc-radius': {
      const el = layout.elements.find((e) => e.id === drag.elementId);
      if (!el || el.kind !== 'arc' || !shouldSnapElement(el, editorSnapEnabled)) return layout;
      return {
        ...layout,
        elements: updateElement(layout.elements, drag.elementId, {
          radius: snapToGrid(el.radius, gridSize, true),
        }),
      };
    }
    case 'selection-move': {
      const movable = drag.elementIds.filter((id) => {
        const el = layout.elements.find((e) => e.id === id);
        return el && !isElementLocked(el);
      });
      if (
        movable.length === 0
        || !movable.every((id) => {
          const el = layout.elements.find((e) => e.id === id);
          return el != null && shouldSnapElement(el, editorSnapEnabled);
        })
      ) {
        return layout;
      }
      const union = selectionBounds(layout.elements, drag.elementIds);
      if (!union) return layout;
      const center = { x: union.x + union.w / 2, y: union.y + union.h / 2 };
      const snapped = snapPointToGrid(center, gridSize, true);
      const dx = snapped.x - center.x;
      const dy = snapped.y - center.y;
      if (dx === 0 && dy === 0) return layout;
      return {
        ...layout,
        elements: layout.elements.map((el) => {
          const idx = drag.elementIds.indexOf(el.id);
          if (idx < 0) return el;
          if (isElementLocked(el)) return el;
          const origin = drag.elementsOrigin[idx];
          if (!origin) return el;
          return { ...el, ...applyBoundsMove(origin, dx, dy) } as GaugeElement;
        }),
      };
    }
    default:
      return layout;
  }
}

interface Props {
  layout: GaugeLayoutConfig;
  selectedElementIds: string[];
  accentColor: string;
  gaugeFillColor: string;
  trailColor: string;
  cursorColor: string;
  previewRoute: LatLon[] | null;
  courseStart?: LatLon | null;
  courseFinish?: LatLon | null;
  startMarkerStyle?: MarkerStyle;
  finishMarkerStyle?: MarkerStyle;
  startMarkerColor?: string;
  finishMarkerColor?: string;
  markerLength?: number;
  markerWidth?: number;
  fontFamily: string;
  frameShape: FrameShape;
  frameCornerRadius: number;
  previewRatio: number;
  scaleMax: number;
  meta: GaugeEditorMeta;
  config: Record<string, unknown>;
  onLayoutChange: (layout: GaugeLayoutConfig) => void;
  onSelectElements?: (ids: string[]) => void;
  showGrid?: boolean;
  snapEnabled?: boolean;
  gridSize?: number;
  /** Fill parent container; hide zoom chrome (video layout overlay). */
  embedded?: boolean;
}

function stepPreviewZoom(current: number, direction: 'in' | 'out'): number {
  const next = direction === 'in' ? current * PREVIEW_ZOOM_STEP : current / PREVIEW_ZOOM_STEP;
  return clamp(next, PREVIEW_MIN_ZOOM, PREVIEW_MAX_ZOOM);
}

function buildPreviewGridStyle(): React.CSSProperties {
  return { backgroundColor: '#13171c' };
}

function LayoutGrid({ show, gridSize }: { show: boolean; gridSize: number }) {
  if (!show || gridSize <= 0) return null;
  const line = 'rgba(255,255,255,0.06)';
  const lines: React.ReactNode[] = [];
  for (let x = 0; x <= LAYOUT_REF_W; x += gridSize) {
    lines.push(
      <line
        key={`v${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={LAYOUT_REF_H}
        stroke={line}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }
  for (let y = 0; y <= LAYOUT_REF_H; y += gridSize) {
    lines.push(
      <line
        key={`h${y}`}
        x1={0}
        y1={y}
        x2={LAYOUT_REF_W}
        y2={y}
        stroke={line}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />,
    );
  }
  return <g pointerEvents="none">{lines}</g>;
}

function buildPreviewGaugeConfig(
  config: Record<string, unknown>,
  previewRoute: LatLon[] | null,
  courseStart?: LatLon | null,
  courseFinish?: LatLon | null,
): DataGaugeConfig {
  return {
    ...(config as DataGaugeConfig),
    fullTrack: previewRoute ?? [],
    courseStart: courseStart ?? null,
    courseFinish: courseFinish ?? null,
  };
}

function buildPreviewTelemetryFrame(
  layout: GaugeLayoutConfig,
  config: Record<string, unknown>,
  ratio: number,
  previewRoute: LatLon[] | null,
): TelemetryFrame {
  const clamped = clamp(ratio, 0, 1);
  const frame: TelemetryFrame = { offsetMs: 0 };
  for (const el of layout.elements) {
    if (!isDataElement(el) || el.kind === 'map') continue;
    const cfg = mergeElementFieldConfig(config, el);
    const meta = fieldMeta(el.field);
    if (!meta) continue;
    const displayVal = clamped * meta.getScaleMax(cfg);
    frame[el.field] = meta.displayToRaw ? meta.displayToRaw(displayVal, cfg) : displayVal;
  }
  const route = previewRoute && previewRoute.length >= 2 ? previewRoute : SAMPLE_EDITOR_ROUTE;
  const cursor = sampleRouteCursor(route, clamped);
  frame.lat = cursor.lat;
  frame.lon = cursor.lon;
  return frame;
}

function GaugeElementsCanvas({
  layout,
  config,
  previewRatio,
  previewRoute,
  courseStart,
  courseFinish,
}: {
  layout: GaugeLayoutConfig;
  config: Record<string, unknown>;
  previewRatio: number;
  previewRoute: LatLon[] | null;
  courseStart?: LatLon | null;
  courseFinish?: LatLon | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, LAYOUT_REF_W, LAYOUT_REF_H);

    const gaugeConfig = buildPreviewGaugeConfig(config, previewRoute, courseStart, courseFinish);
    const frame = buildPreviewTelemetryFrame(layout, config, previewRatio, previewRoute);
    const panelStyle = panelStyleFromConfig(gaugeConfig as AppearanceConfig);
    renderGaugeElements(ctx, layout, frame, gaugeConfig, panelStyle);
  }, [layout, config, previewRatio, previewRoute, courseStart, courseFinish]);

  return (
    <canvas
      ref={canvasRef}
      width={LAYOUT_REF_W}
      height={LAYOUT_REF_H}
      style={{ width: LAYOUT_REF_W, height: LAYOUT_REF_H, display: 'block' }}
    />
  );
}

export function CompositeGaugeEditorPreview({
  layout,
  selectedElementIds,
  previewRoute,
  courseStart,
  courseFinish,
  frameShape,
  frameCornerRadius,
  previewRatio,
  config,
  onLayoutChange,
  onSelectElements,
  showGrid = true,
  snapEnabled = true,
  gridSize = 12,
  embedded = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragKind | null>(null);
  const capturePointerIdRef = useRef<number | null>(null);
  const screenDragOriginRef = useRef<XY>({ x: 0, y: 0 });
  const selectedElementIdsRef = useRef(selectedElementIds);
  selectedElementIdsRef.current = selectedElementIds;
  const marqueeRectRef = useRef<LayoutRect | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<LayoutRect | null>(null);
  const [draftLayout, setDraftLayout] = useState<GaugeLayoutConfig | null>(null);
  const draftLayoutRef = useRef<GaugeLayoutConfig | null>(null);
  const isLayoutDraggingRef = useRef(false);
  const layoutDragChangedRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [previewSize, setPreviewSize] = useState(0);
  const clipId = useId().replace(/:/g, '');

  const layoutRef = useRef(layout);
  if (!isLayoutDraggingRef.current) {
    layoutRef.current = layout;
  }
  const displayLayout = draftLayout ?? layout;
  const gaugeRect = displayLayout.gaugeRect;
  const ratio = clamp(previewRatio, 0, 1);
  const panelStyle = panelStyleFromConfig(config as AppearanceConfig);
  const panelFill = panelStyle.bgColor ?? '#0b0d10';
  const panelFillOpacity = panelStyle.opacity ?? 0.65;

  const clientToLocal = useCallback((clientX: number, clientY: number): XY => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const bounds = svg.getBoundingClientRect();
    return {
      x: ((clientX - bounds.left) / bounds.width) * PREVIEW_CANVAS_SIZE,
      y: ((clientY - bounds.top) / bounds.height) * PREVIEW_CANVAS_SIZE - LAYOUT_CANVAS_Y_OFFSET,
    };
  }, []);

  const patchLayout = useCallback(
    (fn: (prev: GaugeLayoutConfig) => GaugeLayoutConfig) => {
      if (isLayoutDraggingRef.current) {
        layoutDragChangedRef.current = true;
        const next = fn(draftLayoutRef.current ?? layoutRef.current);
        draftLayoutRef.current = next;
        layoutRef.current = next;
        setDraftLayout(next);
        return;
      }
      const next = fn(layoutRef.current);
      layoutRef.current = next;
      onLayoutChange(next);
    },
    [onLayoutChange],
  );

  const patchElement = useCallback((id: string, patch: Partial<GaugeElement>) => {
    patchLayout((prev) => ({
      ...prev,
      elements: updateElement(prev.elements, id, patch),
    }));
  }, [patchLayout]);

  const beginDrag = useCallback(
    (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => {
      e.stopPropagation();
      screenDragOriginRef.current = { x: e.clientX, y: e.clientY };
      const kind = build(clientToLocal(e.clientX, e.clientY));
      dragRef.current = kind;
      if (kind.kind === 'marquee') {
        marqueeRectRef.current = { ...clientToLocal(e.clientX, e.clientY), w: 0, h: 0 };
        setMarqueeRect(marqueeRectRef.current);
      }
    },
    [clientToLocal],
  );

  const commitLayoutDrag = useCallback(() => {
    const drag = dragRef.current;
    const draft = draftLayoutRef.current;
    if (isLayoutDraggingRef.current && draft && layoutDragChangedRef.current) {
      const final = snapEnabled && drag && drag.kind !== 'marquee'
        ? applyDragSnapCommit(draft, drag, gridSize, snapEnabled)
        : draft;
      layoutRef.current = final;
      onLayoutChange(final);
    }
    draftLayoutRef.current = null;
    setDraftLayout(null);
    isLayoutDraggingRef.current = false;
    layoutDragChangedRef.current = false;
  }, [gridSize, onLayoutChange, snapEnabled]);

  const releaseDrag = useCallback((pointerId?: number) => {
    const d = dragRef.current;
    if (d?.kind === 'marquee') {
      const current = marqueeRectRef.current;
      if (current && (current.w > 3 || current.h > 3)) {
        onSelectElements?.(
          selectInMarquee(layoutRef.current.elements, current, selectedElementIdsRef.current, d.additive),
        );
      } else if (!d.additive) {
        onSelectElements?.([]);
      }
    } else {
      commitLayoutDrag();
    }
    marqueeRectRef.current = null;
    setMarqueeRect(null);
    const svg = svgRef.current;
    const pid = pointerId ?? capturePointerIdRef.current ?? undefined;
    if (svg && pid != null) {
      try {
        if (svg.hasPointerCapture(pid)) svg.releasePointerCapture(pid);
      } catch {
        /* pointer may already be released */
      }
    }
    capturePointerIdRef.current = null;
    dragRef.current = null;
  }, [commitLayoutDrag, onSelectElements]);

  const ensurePointerCapture = useCallback((e: React.PointerEvent) => {
    const origin = screenDragOriginRef.current;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_CAPTURE_PX) return false;

    const d = dragRef.current;
    if (d && d.kind !== 'marquee' && !isLayoutDraggingRef.current) {
      isLayoutDraggingRef.current = true;
      layoutDragChangedRef.current = false;
      draftLayoutRef.current = layoutRef.current;
      setDraftLayout(layoutRef.current);
    }

    if (capturePointerIdRef.current != null) return true;
    const svg = svgRef.current;
    if (!svg) return false;
    svg.setPointerCapture(e.pointerId);
    capturePointerIdRef.current = e.pointerId;
    return true;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!ensurePointerCapture(e)) return;
    const p = clientToLocal(e.clientX, e.clientY);
    const activeLayout = draftLayoutRef.current ?? layoutRef.current;
    const snapDrag = dragUsesElementSnap(d, activeLayout, snapEnabled);

    if (d.kind === 'rect-move') {
      patchLayout((prev) => ({
        ...prev,
        gaugeRect: snapRectMoveByCenter(d.rectOrigin, d.pointerOrigin, p, gridSize, snapDrag),
      }));
      return;
    }

    if (d.kind === 'rect-resize') {
      const next = resizeLayoutRect(d.rectOrigin, d.corner, p.x - d.pointerOrigin.x, p.y - d.pointerOrigin.y, GAUGE_RECT_RESIZE_OPTIONS);
      patchLayout((prev) => ({
        ...prev,
        gaugeRect: snapLayoutRect(next, gridSize, snapDrag),
      }));
      return;
    }

    if (d.kind === 'el-slot-move') {
      const pos = snapPointToGrid(
        {
          x: clamp(d.posOrigin.x + (p.x - d.pointerOrigin.x), 0, LAYOUT_REF_W),
          y: clamp(d.posOrigin.y + (p.y - d.pointerOrigin.y), 0, LAYOUT_REF_H),
        },
        gridSize,
        snapDrag,
      );
      const slot = { ...d.slotOrigin, pos };
      patchElement(d.elementId, d.slot === 'value' ? { value: slot } : { unit: slot });
      return;
    }

    if (d.kind === 'el-point-move') {
      patchElement(d.elementId, {
        pos: snapPointToGrid(
          {
            x: clamp(d.posOrigin.x + (p.x - d.pointerOrigin.x), 0, LAYOUT_REF_W),
            y: clamp(d.posOrigin.y + (p.y - d.pointerOrigin.y), 0, LAYOUT_REF_H),
          },
          gridSize,
          snapDrag,
        ),
      });
      return;
    }

    if (d.kind === 'el-rect-move') {
      const next = snapRectMoveByCenter(
        d.rectOrigin,
        d.pointerOrigin,
        p,
        gridSize,
        snapDrag,
      );
      patchElement(d.elementId, {
        rect: {
          ...next,
          x: clamp(next.x, 0, LAYOUT_REF_W - d.rectOrigin.w),
          y: clamp(next.y, 0, LAYOUT_REF_H - d.rectOrigin.h),
        },
      } as Partial<GaugeElement>);
      return;
    }

    if (d.kind === 'el-arc-center') {
      patchElement(d.elementId, {
        center: snapPointToGrid(
          {
            x: clamp(d.centerOrigin.x + (p.x - d.pointerOrigin.x), 0, LAYOUT_REF_W),
            y: clamp(d.centerOrigin.y + (p.y - d.pointerOrigin.y), 0, LAYOUT_REF_H),
          },
          gridSize,
          snapDrag,
        ),
      });
      return;
    }

    if (d.kind === 'el-arc-radius') {
      const dx = p.x - d.centerOrigin.x;
      const dy = p.y - d.centerOrigin.y;
      patchElement(d.elementId, {
        radius: clamp(Math.sqrt(dx * dx + dy * dy), 8, MAX_ARC_RADIUS),
      });
      return;
    }

    if (d.kind === 'el-arc-start' || d.kind === 'el-arc-end') {
      const { cx, cy } = arcGeometry(d.centerOrigin, d.radius);
      const deg = Math.round(pointToDialDeg(p.x, p.y, cx, cy));
      const minGap = 30;
      if (d.kind === 'el-arc-start') {
        const ok = ((d.endDeg - deg + 360) % 360) >= minGap;
        patchElement(d.elementId, { startDeg: ok ? deg : wrap360(d.endDeg - minGap) });
      } else {
        const ok = ((deg - d.startDeg + 360) % 360) >= minGap;
        patchElement(d.elementId, { endDeg: ok ? deg : wrap360(d.startDeg + minGap) });
      }
      return;
    }

    if (d.kind === 'selection-move') {
      const union = selectionBounds(d.elementsOrigin, d.elementIds);
      if (!union) return;
      const { x: dx, y: dy } = snapBoundsCenterMoveDelta(union, d.pointerOrigin, p, gridSize, snapDrag);
      patchLayout((prev) => ({
        ...prev,
        elements: prev.elements.map((el) => {
          const idx = d.elementIds.indexOf(el.id);
          if (idx < 0) return el;
          if (isElementLocked(el)) return el;
          const origin = d.elementsOrigin[idx];
          if (!origin) return el;
          return { ...el, ...applyBoundsMove(origin, dx, dy) } as GaugeElement;
        }),
      }));
      return;
    }

    if (d.kind === 'marquee') {
      const rect = normalizeDragRect(d.pointerOrigin, p);
      marqueeRectRef.current = rect;
      setMarqueeRect(rect);
    }
  }, [clientToLocal, ensurePointerCapture, gridSize, patchElement, patchLayout, snapEnabled]);

  useEffect(() => {
    const onEnd = (e: PointerEvent) => {
      if (dragRef.current || capturePointerIdRef.current != null) {
        releaseDrag(e.pointerId);
      }
    };
    const onDownOutside = (e: PointerEvent) => {
      const svg = svgRef.current;
      if (!svg || svg.contains(e.target as Node)) return;
      if (dragRef.current || capturePointerIdRef.current != null) {
        releaseDrag(e.pointerId);
      }
    };
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('pointerdown', onDownOutside, true);
    return () => {
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('pointerdown', onDownOutside, true);
    };
  }, [releaseDrag]);

  useEffect(() => () => { releaseDrag(); }, [releaseDrag]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => setPreviewSize(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pr = panelRadius(frameShape, frameCornerRadius, gaugeRect);
  const panelEllipse = frameShape === 'ellipse' ? panelEllipseGeometry(gaugeRect) : null;
  const multiSelect = selectedElementIds.length > 1;
  const hasElementSelection = selectedElementIds.length > 0;

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    beginDrag((origin) => ({
      kind: 'marquee',
      pointerOrigin: origin,
      additive: e.shiftKey,
    }))(e);
    marqueeRectRef.current = { ...clientToLocal(e.clientX, e.clientY), w: 0, h: 0 };
    setMarqueeRect(marqueeRectRef.current);
  };

  const onElementSelect = (id: string, shiftKey: boolean, altKey: boolean) => {
    onSelectElements?.(selectElement(displayLayout.elements, id, {
      shiftKey,
      deepEdit: altKey,
      current: selectedElementIds,
    }));
  };

  const previewInner = (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${PREVIEW_CANVAS_SIZE} ${PREVIEW_CANVAS_SIZE}`}
      className="block w-full touch-none select-none"
      onPointerMove={onPointerMove}
      onPointerUp={(e) => releaseDrag(e.pointerId)}
      onPointerCancel={(e) => releaseDrag(e.pointerId)}
    >
              <g transform={`translate(0, ${LAYOUT_CANVAS_Y_OFFSET})`}>
                <CanvasHitArea onPointerDown={onCanvasPointerDown} />
                <LayoutGrid show={showGrid} gridSize={gridSize} />

                <defs>
                  <clipPath id={clipId}>
                    {frameShape === 'ellipse' && panelEllipse ? (
                      <ellipse cx={panelEllipse.cx} cy={panelEllipse.cy} rx={panelEllipse.rx} ry={panelEllipse.ry} />
                    ) : (
                      <rect x={gaugeRect.x} y={gaugeRect.y} width={gaugeRect.w} height={gaugeRect.h} rx={pr} ry={pr} />
                    )}
                  </clipPath>
                </defs>

                <g clipPath={`url(#${clipId})`}>
                  {frameShape === 'ellipse' && panelEllipse ? (
                    <ellipse
                      cx={panelEllipse.cx}
                      cy={panelEllipse.cy}
                      rx={panelEllipse.rx}
                      ry={panelEllipse.ry}
                      fill={panelFill}
                      fillOpacity={panelFillOpacity}
                      pointerEvents="none"
                    />
                  ) : (
                    <rect
                      x={gaugeRect.x}
                      y={gaugeRect.y}
                      width={gaugeRect.w}
                      height={gaugeRect.h}
                      rx={pr}
                      ry={pr}
                      fill={panelFill}
                      fillOpacity={panelFillOpacity}
                      pointerEvents="none"
                    />
                  )}
                  <foreignObject x={0} y={0} width={LAYOUT_REF_W} height={LAYOUT_REF_H} pointerEvents="none">
                    <GaugeElementsCanvas
                      layout={displayLayout}
                      config={config}
                      previewRatio={ratio}
                      previewRoute={previewRoute}
                      courseStart={courseStart}
                      courseFinish={courseFinish}
                    />
                  </foreignObject>
                </g>

                <FrameBorderDrag gaugeRect={gaugeRect} panelRadius={pr} frameShape={frameShape} hidden={embedded || hasElementSelection} />

                {[...displayLayout.elements].reverse().filter((e) => e.visible).map((el) => (
                  <ElementHitArea
                    key={`hit-${el.id}`}
                    element={el}
                    selected={isSelected(selectedElementIds, el.id)}
                    multiSelected={multiSelect}
                    selectedElementIds={selectedElementIds}
                    elements={displayLayout.elements}
                    onSelect={(shiftKey, altKey) => onElementSelect(el.id, shiftKey, altKey)}
                    beginDrag={beginDrag}
                  />
                ))}

                {hasElementSelection && displayLayout.elements.map((el) => {
                  if (!isSelected(selectedElementIds, el.id) || !el.visible || isElementLocked(el)) return null;
                  return (
                    <ElementHandles
                      key={`handles-${el.id}`}
                      element={el}
                      multiSelect={multiSelect}
                      selectedElementIds={selectedElementIds}
                      elements={displayLayout.elements}
                      beginDrag={beginDrag}
                    />
                  );
                })}

                {marqueeRect && marqueeRect.w + marqueeRect.h > 0 && (
                  <rect
                    x={marqueeRect.x}
                    y={marqueeRect.y}
                    width={marqueeRect.w}
                    height={marqueeRect.h}
                    fill="none"
                    stroke="#3ddc97"
                    strokeDasharray="4 2"
                    pointerEvents="none"
                  />
                )}

                <FrameResizeHandles
                  gaugeRect={gaugeRect}
                  frameShape={frameShape}
                  beginDrag={beginDrag}
                  hidden={embedded || hasElementSelection}
                />
              </g>
            </svg>
  );

  if (embedded) {
    return (
      <div ref={previewRef} className="absolute inset-0 overflow-hidden touch-none" style={{ backgroundColor: 'transparent' }}>
        {previewInner}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-bg-elev p-2.5">
      <div
        ref={previewRef}
        className="relative isolate aspect-square w-full overflow-hidden rounded border border-white/5"
        style={buildPreviewGridStyle()}
      >
        <div className="relative z-[1] flex h-full w-full items-center justify-center">
          <div className="shrink-0" style={{ aspectRatio: '1 / 1', width: `${zoom * 100}%`, transform: `translate(${pan.x}px, ${pan.y}px)` }}>
            {previewInner}
          </div>
        </div>
      </div>
    </div>
  );
}

const RECT_CORNERS: LayoutCorner[] = ['nw', 'ne', 'se', 'sw'];
const RECT_EDGES: LayoutCorner[] = ['n', 'e', 's', 'w'];
const RECT_RESIZE_HANDLES: LayoutCorner[] = [...RECT_CORNERS, ...RECT_EDGES];
const CIRCLE_RESIZE_CORNERS: LayoutCorner[] = ['n', 'e', 's', 'w'];

/** Dial degrees for resize handles on a circular panel (0° = bottom, clockwise). */
const CIRCLE_HANDLE_DEG: Record<LayoutCorner, number> = {
  n: 180,
  ne: 135,
  e: 90,
  se: 45,
  s: 0,
  sw: 315,
  w: 270,
  nw: 225,
};

function rectCenter(rect: LayoutRect): XY {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function circleHandlePosition(cx: number, cy: number, r: number, corner: LayoutCorner): XY {
  return dialPoint(cx, cy, r, CIRCLE_HANDLE_DEG[corner]);
}

function CircleCornerMarkers({
  cx,
  cy,
  r,
  color = SELECTION_COLOR,
}: {
  cx: number;
  cy: number;
  r: number;
  color?: string;
}) {
  const half = CORNER_MARKER_SIZE / 2;
  return (
    <g pointerEvents="none">
      {CIRCLE_RESIZE_CORNERS.map((corner) => {
        const p = circleHandlePosition(cx, cy, r, corner);
        return (
          <rect
            key={corner}
            x={p.x - half}
            y={p.y - half}
            width={CORNER_MARKER_SIZE}
            height={CORNER_MARKER_SIZE}
            fill={color}
            stroke="#0c1014"
            strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}

function layoutCornerPosition(rect: LayoutRect, corner: LayoutCorner): XY {
  const { x, y, w, h } = rect;
  if (corner === 'nw') return { x, y };
  if (corner === 'ne') return { x: x + w, y };
  if (corner === 'se') return { x: x + w, y: y + h };
  if (corner === 'sw') return { x, y: y + h };
  if (corner === 'n') return { x: x + w / 2, y };
  if (corner === 's') return { x: x + w / 2, y: y + h };
  if (corner === 'e') return { x: x + w, y: y + h / 2 };
  return { x, y: y + h / 2 };
}

function resizeHandleCursor(corner: LayoutCorner): 'move' | 'nwse-resize' | 'nesw-resize' | 'ns-resize' | 'ew-resize' {
  if (corner === 'n' || corner === 's') return 'ns-resize';
  if (corner === 'e' || corner === 'w') return 'ew-resize';
  if (corner === 'ne' || corner === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

function arcRadiusHandleCursor(midDeg: number): 'ns-resize' | 'ew-resize' | 'nwse-resize' | 'nesw-resize' {
  const radial = midDeg % 180;
  if (radial < 22.5 || radial > 157.5) return 'ns-resize';
  if (radial > 67.5 && radial < 112.5) return 'ew-resize';
  return radial < 90 ? 'nesw-resize' : 'nwse-resize';
}

function Handle({
  x,
  y,
  onPointerDown,
  cursor = 'nwse-resize',
}: {
  x: number;
  y: number;
  onPointerDown: (e: React.PointerEvent) => void;
  cursor?: 'move' | 'grab' | 'nwse-resize' | 'nesw-resize' | 'ns-resize' | 'ew-resize';
}) {
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={HANDLE_HIT_RADIUS}
        fill="transparent"
        style={{ cursor }}
        onPointerDown={onPointerDown}
      />
      <circle
        cx={x}
        cy={y}
        r={HANDLE_RADIUS}
        fill={SELECTION_COLOR}
        stroke="#0c1014"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    </g>
  );
}

function MoveHandle({
  x,
  y,
  onPointerDown,
}: {
  x: number;
  y: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return <Handle x={x} y={y} cursor="move" onPointerDown={onPointerDown} />;
}

function RectResizeHandles({
  rect,
  onResize,
}: {
  rect: LayoutRect;
  onResize: (corner: LayoutCorner) => (e: React.PointerEvent) => void;
}) {
  return (
    <g>
      {RECT_RESIZE_HANDLES.map((corner) => {
        const p = layoutCornerPosition(rect, corner);
        return (
          <Handle
            key={corner}
            x={p.x}
            y={p.y}
            cursor={resizeHandleCursor(corner)}
            onPointerDown={onResize(corner)}
          />
        );
      })}
    </g>
  );
}

function RectElementHandles({
  element,
  multiSelect,
  selectedElementIds,
  elements,
  beginDrag,
}: {
  element: Extract<GaugeElement, { kind: 'bar' | 'map' }>;
  multiSelect: boolean;
  selectedElementIds: string[];
  elements: GaugeElement[];
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const center = rectCenter(element.rect);
  const onMove = multiSelect
    ? beginDrag((o) => buildSelectionMoveDrag(selectedElementIds, elements, o))
    : beginDrag((o) => ({
      kind: 'el-rect-move',
      elementId: element.id,
      pointerOrigin: o,
      rectOrigin: { ...element.rect },
    }));
  return <MoveHandle x={center.x} y={center.y} onPointerDown={onMove} />;
}

function ArcElementHandles({
  element,
  multiSelect,
  selectedElementIds,
  elements,
  beginDrag,
}: {
  element: Extract<GaugeElement, { kind: 'arc' }>;
  multiSelect: boolean;
  selectedElementIds: string[];
  elements: GaugeElement[];
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const { cx, cy, r } = arcGeometry(element.center, element.radius);
  const startPt = dialPoint(cx, cy, r, element.startDeg);
  const endPt = dialPoint(cx, cy, r, element.endDeg);
  const sweep = ((element.endDeg - element.startDeg) + 360) % 360;
  const midDeg = (element.startDeg + sweep / 2) % 360;
  const radiusPt = dialPoint(cx, cy, r, midDeg);
  const centerOrigin = { x: cx, y: cy };

  const onMove = multiSelect
    ? beginDrag((o) => buildSelectionMoveDrag(selectedElementIds, elements, o))
    : beginDrag((o) => ({
      kind: 'el-arc-center',
      elementId: element.id,
      pointerOrigin: o,
      centerOrigin: { ...element.center },
    }));

  return (
    <g>
      <MoveHandle x={cx} y={cy} onPointerDown={onMove} />
      {!multiSelect && (
        <>
          <Handle
            x={radiusPt.x}
            y={radiusPt.y}
            cursor={arcRadiusHandleCursor(midDeg)}
            onPointerDown={beginDrag(() => ({
              kind: 'el-arc-radius',
              elementId: element.id,
              centerOrigin,
            }))}
          />
          <Handle
            x={startPt.x}
            y={startPt.y}
            onPointerDown={beginDrag(() => ({
              kind: 'el-arc-start',
              elementId: element.id,
              startDeg: element.startDeg,
              endDeg: element.endDeg,
              centerOrigin,
              radius: element.radius,
            }))}
          />
          <Handle
            x={endPt.x}
            y={endPt.y}
            onPointerDown={beginDrag(() => ({
              kind: 'el-arc-end',
              elementId: element.id,
              startDeg: element.startDeg,
              endDeg: element.endDeg,
              centerOrigin,
              radius: element.radius,
            }))}
          />
        </>
      )}
    </g>
  );
}

function TextSlotMoveHandle({
  elementId,
  slot,
  slotOrigin,
  multiSelect,
  selectedElementIds,
  elements,
  beginDrag,
}: {
  elementId: string;
  slot: 'value' | 'unit';
  slotOrigin: TextSlot;
  multiSelect: boolean;
  selectedElementIds: string[];
  elements: GaugeElement[];
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const onMove = multiSelect
    ? beginDrag((o) => buildSelectionMoveDrag(selectedElementIds, elements, o))
    : beginDrag((o) => ({
      kind: 'el-slot-move',
      elementId,
      slot,
      pointerOrigin: o,
      posOrigin: { ...slotOrigin.pos },
      slotOrigin: structuredClone(slotOrigin),
    }));
  return <MoveHandle x={slotOrigin.pos.x} y={slotOrigin.pos.y} onPointerDown={onMove} />;
}

function TextElementHandles({
  element,
  multiSelect,
  selectedElementIds,
  elements,
  beginDrag,
}: {
  element: Extract<GaugeElement, { kind: 'text' }>;
  multiSelect: boolean;
  selectedElementIds: string[];
  elements: GaugeElement[];
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const slots: { slot: 'value' | 'unit'; slotOrigin: TextSlot }[] = [];
  if (element.value.visible) slots.push({ slot: 'value', slotOrigin: element.value });
  if (element.unit.visible) slots.push({ slot: 'unit', slotOrigin: element.unit });

  return (
    <g>
      {slots.map(({ slot, slotOrigin }) => (
        <TextSlotMoveHandle
          key={slot}
          elementId={element.id}
          slot={slot}
          slotOrigin={slotOrigin}
          multiSelect={multiSelect}
          selectedElementIds={selectedElementIds}
          elements={elements}
          beginDrag={beginDrag}
        />
      ))}
    </g>
  );
}

function PointElementHandles({
  element,
  multiSelect,
  selectedElementIds,
  elements,
  beginDrag,
}: {
  element: Extract<GaugeElement, { kind: 'staticText' | 'image' }>;
  multiSelect: boolean;
  selectedElementIds: string[];
  elements: GaugeElement[];
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const onMove = multiSelect
    ? beginDrag((o) => buildSelectionMoveDrag(selectedElementIds, elements, o))
    : beginDrag((o) => ({
      kind: 'el-point-move',
      elementId: element.id,
      pointerOrigin: o,
      posOrigin: { ...element.pos },
    }));
  return <MoveHandle x={element.pos.x} y={element.pos.y} onPointerDown={onMove} />;
}

function ElementHandles({
  element,
  multiSelect,
  selectedElementIds,
  elements,
  beginDrag,
}: {
  element: GaugeElement;
  multiSelect: boolean;
  selectedElementIds: string[];
  elements: GaugeElement[];
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const shared = { multiSelect, selectedElementIds, elements, beginDrag };
  if (element.kind === 'bar' || element.kind === 'map') {
    return <RectElementHandles element={element} {...shared} />;
  }
  if (element.kind === 'arc') {
    return <ArcElementHandles element={element} {...shared} />;
  }
  if (element.kind === 'text') {
    return <TextElementHandles element={element} {...shared} />;
  }
  if (element.kind === 'staticText' || element.kind === 'image') {
    return <PointElementHandles element={element} {...shared} />;
  }
  return null;
}

/** Panel frame outline — visual only; move/resize via center and perimeter handles. */
function FrameBorderDrag({
  gaugeRect,
  panelRadius: pr,
  frameShape,
  hidden,
}: {
  gaugeRect: LayoutRect;
  panelRadius: number;
  frameShape: FrameShape;
  hidden?: boolean;
}) {
  if (hidden) return null;

  if (frameShape === 'ellipse') {
    const e = panelEllipseGeometry(gaugeRect);
    return (
      <g pointerEvents="none">
        <ellipse
          cx={e.cx}
          cy={e.cy}
          rx={e.rx}
          ry={e.ry}
          fill="none"
          stroke={PANEL_GUIDE_COLOR}
          strokeWidth={SELECTION_STROKE_WIDTH}
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }

  return (
    <g pointerEvents="none">
      <SelectionOutline rect={gaugeRect} rx={pr} color={BOUNDS_GUIDE_COLOR} />
    </g>
  );
}

function CircleResizeHandles({
  gaugeRect,
  onResize,
}: {
  gaugeRect: LayoutRect;
  onResize: (corner: LayoutCorner) => (e: React.PointerEvent) => void;
}) {
  const { cx, cy, r } = panelCircleGeometry(gaugeRect);
  return (
    <g>
      {CIRCLE_RESIZE_CORNERS.map((corner) => {
        const p = circleHandlePosition(cx, cy, r, corner);
        return <Handle key={corner} x={p.x} y={p.y} onPointerDown={onResize(corner)} />;
      })}
    </g>
  );
}

function FrameResizeHandles({
  gaugeRect,
  frameShape: _frameShape,
  beginDrag,
  hidden,
}: {
  gaugeRect: LayoutRect;
  frameShape: FrameShape;
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const onResize = (corner: LayoutCorner) => beginDrag((o) => ({
    kind: 'rect-resize',
    corner,
    pointerOrigin: o,
    rectOrigin: { ...gaugeRect },
  }));
  const onMove = beginDrag((o) => ({ kind: 'rect-move', pointerOrigin: o, rectOrigin: { ...gaugeRect } }));
  const center = rectCenter(gaugeRect);

  return (
    <g>
      <MoveHandle x={center.x} y={center.y} onPointerDown={onMove} />
      <RectResizeHandles rect={gaugeRect} onResize={onResize} />
    </g>
  );
}

function CanvasHitArea({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <rect
      x={0}
      y={0}
      width={LAYOUT_REF_W}
      height={LAYOUT_REF_H}
      fill="transparent"
      style={{ cursor: 'default' }}
      onPointerDown={onPointerDown}
    />
  );
}

function ElementHitArea({
  element,
  selected,
  multiSelected,
  selectedElementIds,
  elements,
  onSelect,
  beginDrag,
}: {
  element: GaugeElement;
  selected: boolean;
  multiSelected: boolean;
  selectedElementIds: string[];
  elements: GaugeElement[];
  onSelect: (shiftKey: boolean, altKey: boolean) => void;
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  if (isElementLocked(element)) return null;

  const onPointerDown = (e: React.PointerEvent, textSlot?: 'value' | 'unit') => {
    e.stopPropagation();
    if (e.shiftKey) {
      onSelect(e.shiftKey, e.altKey);
      return;
    }
    if (!selected) {
      onSelect(false, e.altKey);
    }
    if (multiSelected && selected) {
      beginDrag((o) => buildSelectionMoveDrag(selectedElementIds, elements, o))(e);
      return;
    }
    const drag = (origin: XY) => buildElementMoveDrag(element, origin, textSlot);
    beginDrag((o) => drag(o)!)(e);
  };

  if (element.kind === 'text') {
    const slots: { slot: 'value' | 'unit'; bounds: LayoutRect }[] = [];
    if (element.value.visible) {
      const b = textSlotBounds(element.value);
      if (b) slots.push({ slot: 'value', bounds: b });
    }
    if (element.unit.visible) {
      const b = textSlotBounds(element.unit);
      if (b) slots.push({ slot: 'unit', bounds: b });
    }

    if (slots.length === 0) return null;

    return (
      <g>
        {slots.map(({ slot, bounds }) => (
          <rect
            key={slot}
            x={bounds.x}
            y={bounds.y}
            width={bounds.w}
            height={bounds.h}
            fill="rgba(255,255,255,0.001)"
            style={{ cursor: selected ? 'move' : 'pointer' }}
            onPointerDown={(e) => onPointerDown(e, slot)}
          />
        ))}
      </g>
    );
  }

  const bounds = elementBounds(element);
  if (!bounds) return null;

  // Selected arcs are moved via the center handle; skip the bounding hit rect so
  // radius/start/end handles receive hover cursors without the move cursor underneath.
  if (element.kind === 'arc' && selected) return null;

  return (
    <rect
      x={bounds.x}
      y={bounds.y}
      width={bounds.w}
      height={bounds.h}
      fill="rgba(255,255,255,0.001)"
      style={{ cursor: selected ? 'move' : 'pointer' }}
      onPointerDown={(e) => onPointerDown(e)}
    />
  );
}
