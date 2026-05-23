import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { BarGaugeDisplayStyle } from '../../gauges/barGaugeSchema';
import { resolveShowScaleLabels, resolveArcTickCount, resolveShowArcTicks } from '../../gauges/barGaugeSchema';
import type { GaugeEditorKind, GaugeEditorMeta } from '../../gauges/gaugeEditorAdapter';
import { derivedTextForRole } from '../../gauges/gaugeEditorAdapter';
import {
  colorAtGradient,
  normalizeGradientStops,
  resolveFillGradient,
  type FillGradientConfig,
} from '../../gauges/gaugeGradient';
import {
  projectRouteToMapRect,
  SAMPLE_EDITOR_ROUTE,
  sampleRouteCursor,
  type LatLon,
} from '../../gauges/gpsMapDraw';
import type { GaugeLayoutConfig, LayoutCorner, LayoutRect, TextRole, XY } from '../../gauges/gaugeEditorLayout';
import {
  arcGeometry,
  arcPath,
  clamp,
  dialPoint,
  formatScaleMaxLabel,
  LAYOUT_REF_H,
  LAYOUT_REF_W,
  MAX_ARC_RADIUS,
  MIN_BAR_LENGTH,
  MIN_BAR_THICKNESS,
  MIN_MAP_SIZE,
  panelCircleGeometry,
  panelRadius,
  pointToDialDeg,
  resolveBarConfig,
  resolveBarFillColor,
  resizeLayoutRect,
  resizeSquareLayoutRect,
  resolveTextColor,
  snapToGrid,
  TEXT_ROLES,
  wrap360,
} from '../../gauges/gaugeEditorLayout';

const PREVIEW_MIN_ZOOM = 0.25;
const PREVIEW_MAX_ZOOM = 4;
const PREVIEW_ZOOM_STEP = 1.12;
const PREVIEW_CANVAS_SIZE = LAYOUT_REF_W;
const LAYOUT_CANVAS_Y_OFFSET = (PREVIEW_CANVAS_SIZE - LAYOUT_REF_H) / 2;

function stepPreviewZoom(current: number, direction: 'in' | 'out'): number {
  const next = direction === 'in' ? current * PREVIEW_ZOOM_STEP : current / PREVIEW_ZOOM_STEP;
  return clamp(next, PREVIEW_MIN_ZOOM, PREVIEW_MAX_ZOOM);
}

const GAUGE_RECT_RESIZE_OPTIONS = { constrainToLayout: false, minW: 1, minH: 1 } as const;

function buildPreviewGridStyle(
  showGrid: boolean,
  gridSize: number,
  zoom: number,
  previewSize: number,
): React.CSSProperties {
  if (!showGrid || previewSize <= 0) {
    return { backgroundColor: '#13171c' };
  }
  const cellPx = (previewSize / PREVIEW_CANVAS_SIZE) * gridSize * zoom;
  const line = 'rgba(255,255,255,0.06)';
  return {
    backgroundColor: '#13171c',
    backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
    backgroundSize: `${cellPx}px ${cellPx}px`,
    backgroundPosition: 'center center',
  };
}

type DragKind =
  | { kind: 'rect-move'; pointerOrigin: XY; rectOrigin: LayoutRect }
  | { kind: 'rect-resize'; corner: LayoutCorner; pointerOrigin: XY; rectOrigin: LayoutRect }
  | { kind: 'bar-move'; pointerOrigin: XY; rectOrigin: LayoutRect }
  | { kind: 'bar-resize'; corner: LayoutCorner; pointerOrigin: XY; rectOrigin: LayoutRect }
  | { kind: 'map-move'; pointerOrigin: XY; rectOrigin: LayoutRect }
  | { kind: 'map-resize'; corner: LayoutCorner; pointerOrigin: XY; rectOrigin: LayoutRect }
  | { kind: 'arc-center'; pointerOrigin: XY; centerOrigin: XY }
  | { kind: 'arc-radius' }
  | { kind: 'arc-start' }
  | { kind: 'arc-end' }
  | { kind: 'text'; which: TextRole };

interface Props {
  editorKind: GaugeEditorKind;
  layout: GaugeLayoutConfig;
  displayStyle: BarGaugeDisplayStyle;
  accentColor: string;
  gaugeFillColor: string;
  trailColor: string;
  cursorColor: string;
  previewRoute: LatLon[] | null;
  fontFamily: string;
  panelShape: 'rounded' | 'square' | 'pill' | 'circle';
  previewRatio: number;
  scaleMax: number;
  meta: GaugeEditorMeta;
  config: Record<string, unknown>;
  onLayoutChange: (layout: GaugeLayoutConfig) => void;
  showGrid?: boolean;
  snapEnabled?: boolean;
  gridSize?: number;
}

export function GaugeEditorPreview({
  editorKind,
  layout,
  displayStyle,
  accentColor,
  gaugeFillColor,
  trailColor,
  cursorColor,
  previewRoute,
  fontFamily,
  panelShape,
  previewRatio,
  scaleMax,
  meta,
  config,
  onLayoutChange,
  showGrid = true,
  snapEnabled = true,
  gridSize = 12,
}: Props) {
  const isGps = editorKind === 'gps';
  const svgRef = useRef<SVGSVGElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const previewActiveRef = useRef(false);
  const dragRef = useRef<DragKind | null>(null);
  const [drag, setDrag] = useState<DragKind | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [previewSize, setPreviewSize] = useState(0);
  const gaugeRect = layout.gaugeRect;
  const ratio = clamp(previewRatio, 0, 1);
  const showScaleLabels = resolveShowScaleLabels(config as { showScaleLabels?: boolean; showMax?: boolean });
  const showArcTicks = resolveShowArcTicks(config as { showArcTicks?: boolean });
  const arcTickCount = resolveArcTickCount(config as { arcTickCount?: number });
  const fillGradient = resolveFillGradient({ fillGradient: config.fillGradient as FillGradientConfig | undefined });
  const gradientId = useId().replace(/:/g, '');

  const clientToLocal = useCallback((clientX: number, clientY: number): XY => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const bounds = svg.getBoundingClientRect();
    return {
      x: ((clientX - bounds.left) / bounds.width) * PREVIEW_CANVAS_SIZE,
      y: ((clientY - bounds.top) / bounds.height) * PREVIEW_CANVAS_SIZE - LAYOUT_CANVAS_Y_OFFSET,
    };
  }, []);

  const setPreviewActive = useCallback((active: boolean) => {
    previewActiveRef.current = active;
  }, []);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;

    const updatePreviewSize = () => {
      setPreviewSize(el.clientWidth);
    };

    updatePreviewSize();
    const ro = new ResizeObserver(updatePreviewSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;

    const zoomByWheel = (direction: 'in' | 'out') => {
      setZoom((current) => stepPreviewZoom(current, direction));
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomByWheel(e.deltaY < 0 ? 'in' : 'out');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (!previewActiveRef.current) return;

      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        zoomByWheel('in');
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        zoomByWheel('out');
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const releaseDrag = useCallback((pointerId?: number) => {
    const svg = svgRef.current;
    if (svg && pointerId != null && svg.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId);
    }
    dragRef.current = null;
    setDrag(null);
  }, []);

  useEffect(() => {
    const onWindowPointerEnd = (e: PointerEvent) => {
      if (!dragRef.current) return;
      releaseDrag(e.pointerId);
    };
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
    };
  }, [releaseDrag]);

  const beginDrag = useCallback(
    (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const next = build(clientToLocal(e.clientX, e.clientY));
      dragRef.current = next;
      setDrag(next);
      svgRef.current?.setPointerCapture(e.pointerId);
    },
    [clientToLocal],
  );

  const patchLayout = useCallback(
    (fn: (prev: GaugeLayoutConfig) => GaugeLayoutConfig) => onLayoutChange(fn(layout)),
    [layout, onLayoutChange],
  );

  const snap = useCallback((v: number) => snapToGrid(v, gridSize, snapEnabled), [gridSize, snapEnabled]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const p = clientToLocal(e.clientX, e.clientY);

      if (drag.kind === 'rect-move') {
        const dx = p.x - drag.pointerOrigin.x;
        const dy = p.y - drag.pointerOrigin.y;
        const nx = snap(drag.rectOrigin.x + dx);
        const ny = snap(drag.rectOrigin.y + dy);
        patchLayout((prev) => ({
          ...prev,
          gaugeRect: { ...prev.gaugeRect, x: nx, y: ny },
        }));
        return;
      }

      if (drag.kind === 'rect-resize') {
        const next = panelShape === 'circle'
          ? resizeSquareLayoutRect(
            drag.rectOrigin,
            drag.corner,
            p.x - drag.pointerOrigin.x,
            p.y - drag.pointerOrigin.y,
            GAUGE_RECT_RESIZE_OPTIONS,
          )
          : resizeLayoutRect(
            drag.rectOrigin,
            drag.corner,
            p.x - drag.pointerOrigin.x,
            p.y - drag.pointerOrigin.y,
            GAUGE_RECT_RESIZE_OPTIONS,
          );
        patchLayout((prev) => ({
          ...prev,
          gaugeRect: {
            ...next,
            x: snap(next.x),
            y: snap(next.y),
            w: snap(next.w),
            h: snap(next.h),
          },
        }));
        return;
      }

      if (drag.kind === 'bar-move') {
        const dx = p.x - drag.pointerOrigin.x;
        const dy = p.y - drag.pointerOrigin.y;
        const nx = snap(clamp(drag.rectOrigin.x + dx, 0, LAYOUT_REF_W - drag.rectOrigin.w));
        const ny = snap(clamp(drag.rectOrigin.y + dy, 0, LAYOUT_REF_H - drag.rectOrigin.h));
        patchLayout((prev) => ({
          ...prev,
          bar: { ...prev.bar, rect: { ...prev.bar.rect, x: nx, y: ny } },
        }));
        return;
      }

      if (drag.kind === 'bar-resize') {
        const next = resizeLayoutRect(
          drag.rectOrigin,
          drag.corner,
          p.x - drag.pointerOrigin.x,
          p.y - drag.pointerOrigin.y,
          MIN_BAR_LENGTH,
          MIN_BAR_THICKNESS,
        );
        patchLayout((prev) => ({
          ...prev,
          bar: {
            ...prev.bar,
            rect: {
              ...next,
              x: snap(next.x),
              y: snap(next.y),
              w: snap(next.w),
              h: snap(next.h),
            },
          },
        }));
        return;
      }

      if (drag.kind === 'map-move') {
        const dx = p.x - drag.pointerOrigin.x;
        const dy = p.y - drag.pointerOrigin.y;
        const nx = snap(clamp(drag.rectOrigin.x + dx, 0, LAYOUT_REF_W - drag.rectOrigin.w));
        const ny = snap(clamp(drag.rectOrigin.y + dy, 0, LAYOUT_REF_H - drag.rectOrigin.h));
        patchLayout((prev) => ({
          ...prev,
          mapRect: { ...prev.mapRect, x: nx, y: ny },
        }));
        return;
      }

      if (drag.kind === 'map-resize') {
        const next = resizeLayoutRect(
          drag.rectOrigin,
          drag.corner,
          p.x - drag.pointerOrigin.x,
          p.y - drag.pointerOrigin.y,
          MIN_MAP_SIZE,
          MIN_MAP_SIZE,
        );
        patchLayout((prev) => ({
          ...prev,
          mapRect: {
            ...next,
            x: snap(next.x),
            y: snap(next.y),
            w: snap(next.w),
            h: snap(next.h),
          },
        }));
        return;
      }

      if (drag.kind === 'arc-center') {
        const dx = p.x - drag.pointerOrigin.x;
        const dy = p.y - drag.pointerOrigin.y;
        patchLayout((prev) => ({
          ...prev,
          arcCenter: {
            x: snap(clamp(drag.centerOrigin.x + dx, 0, LAYOUT_REF_W)),
            y: snap(clamp(drag.centerOrigin.y + dy, 0, LAYOUT_REF_H)),
          },
        }));
        return;
      }

      if (drag.kind === 'arc-radius') {
        const dx = p.x - layout.arcCenter.x;
        const dy = p.y - layout.arcCenter.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        patchLayout((prev) => ({ ...prev, arcRadius: snap(clamp(dist, 8, MAX_ARC_RADIUS)) }));
        return;
      }

      if (drag.kind === 'arc-start' || drag.kind === 'arc-end') {
        const geom = arcGeometry(layout.arcCenter, layout.arcRadius);
        const deg = Math.round(pointToDialDeg(p.x, p.y, geom.cx, geom.cy));
        const which = drag.kind === 'arc-start' ? 'start' : 'end';
        patchLayout((prev) => {
          const minGap = 30;
          if (which === 'start') {
            const ok = ((prev.arcEndDeg - deg + 360) % 360) >= minGap;
            return { ...prev, arcStartDeg: ok ? deg : wrap360(prev.arcEndDeg - minGap) };
          }
          const ok = ((deg - prev.arcStartDeg + 360) % 360) >= minGap;
          return { ...prev, arcEndDeg: ok ? deg : wrap360(prev.arcStartDeg + minGap) };
        });
        return;
      }

      if (drag.kind === 'text') {
        patchLayout((prev) => ({
          ...prev,
          text: {
            ...prev.text,
            [drag.which]: {
              ...prev.text[drag.which],
              pos: {
                x: snap(clamp(p.x, 0, LAYOUT_REF_W)),
                y: snap(clamp(p.y, 0, LAYOUT_REF_H)),
              },
            },
          },
        }));
      }
    },
    [clientToLocal, layout.arcCenter, layout.arcRadius, patchLayout, panelShape, snap],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      releaseDrag(e.pointerId);
    },
    [releaseDrag],
  );

  const { cx, cy, r } = arcGeometry(layout.arcCenter, layout.arcRadius);
  const sweep = ((layout.arcEndDeg - layout.arcStartDeg) + 360) % 360;
  const valueDeg = (layout.arcStartDeg + sweep * ratio) % 360;
  const trackW = Math.max(6, r * 0.16);
  const pr = panelRadius(panelShape, gaugeRect);
  const panelCircle = panelShape === 'circle' ? panelCircleGeometry(gaugeRect) : null;
  const frameBoundsClipId = `${gradientId}-frame-bounds`;
  const dragKind = drag?.kind ?? null;

  return (
    <div className="rounded-lg border border-white/10 bg-bg-elev p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2 text-[10px] text-white/40">
        <span>Ctrl+scroll or Ctrl+± to zoom</span>
        <span className="font-mono tabular-nums">{Math.round(zoom * 100)}%</span>
      </div>
      <div
        ref={previewRef}
        tabIndex={0}
        className="relative isolate aspect-square w-full overflow-hidden rounded border border-white/5 outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
        onMouseEnter={() => setPreviewActive(true)}
        onMouseLeave={() => setPreviewActive(false)}
        onFocus={() => setPreviewActive(true)}
        onBlur={() => setPreviewActive(false)}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={buildPreviewGridStyle(showGrid, gridSize, zoom, previewSize)}
        />
        <div className="relative z-[1] flex h-full w-full items-center justify-center">
          <div
            className="shrink-0"
            style={{
              aspectRatio: '1 / 1',
              width: `${zoom * 100}%`,
            }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${PREVIEW_CANVAS_SIZE} ${PREVIEW_CANVAS_SIZE}`}
              preserveAspectRatio="xMidYMid meet"
              overflow="visible"
              className="block w-full touch-none select-none"
              style={{
                cursor: drag ? 'grabbing' : 'default',
                height: 'auto',
                aspectRatio: `${PREVIEW_CANVAS_SIZE} / ${PREVIEW_CANVAS_SIZE}`,
              }}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={() => releaseDrag()}
          >
        <g transform={`translate(0, ${LAYOUT_CANVAS_Y_OFFSET})`}>
        <FrameOverlay rect={gaugeRect} />

        <defs>
          <clipPath id={frameBoundsClipId}>
            <rect x={gaugeRect.x} y={gaugeRect.y} width={gaugeRect.w} height={gaugeRect.h} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${frameBoundsClipId})`}>
          {panelShape === 'circle' && panelCircle ? (
            <circle cx={panelCircle.cx} cy={panelCircle.cy} r={panelCircle.r} fill="#1a2027" pointerEvents="none" />
          ) : (
            <rect
              x={gaugeRect.x} y={gaugeRect.y} width={gaugeRect.w} height={gaugeRect.h}
              rx={pr} ry={pr}
              fill="#1a2027"
              pointerEvents="none"
            />
          )}

        {isGps && (
          <MapLayer
            mapRect={layout.mapRect}
            route={previewRoute ?? SAMPLE_EDITOR_ROUTE}
            previewRatio={ratio}
            trailColor={trailColor}
            cursorColor={cursorColor}
          />
        )}
        {!isGps && displayStyle === 'bar' && (
          <BarVisual layout={layout} ratio={ratio} gaugeFillColor={gaugeFillColor} fillGradient={fillGradient} gradientId={gradientId} />
        )}
        {!isGps && displayStyle === 'arc' && (
          <g style={{ pointerEvents: 'none' }}>
            <path d={arcPath(cx, cy, r, layout.arcStartDeg, layout.arcEndDeg)} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={trackW} strokeLinecap="round" />
            {ratio > 0.001 && (
              fillGradient.enabled
                ? (
                  <ArcGradientVisual
                    cx={cx}
                    cy={cy}
                    r={r}
                    startDeg={layout.arcStartDeg}
                    endDeg={layout.arcEndDeg}
                    ratio={ratio}
                    trackW={trackW}
                    stops={fillGradient.stops}
                  />
                )
                : (
                  <path d={arcPath(cx, cy, r, layout.arcStartDeg, valueDeg)} fill="none" stroke={gaugeFillColor} strokeWidth={trackW} strokeLinecap="round" />
                )
            )}
            {showArcTicks && (
              <ArcHashMarksVisual
                cx={cx}
                cy={cy}
                r={r}
                trackW={trackW}
                startDeg={layout.arcStartDeg}
                sweep={sweep}
                tickCount={arcTickCount}
              />
            )}
            <text x={dialPoint(cx, cy, r - trackW * 1.6, layout.arcStartDeg).x}
              y={dialPoint(cx, cy, r - trackW * 1.6, layout.arcStartDeg).y}
              fontSize={9} fill="rgba(255,255,255,0.4)" textAnchor="middle" dominantBaseline="middle">
              {showScaleLabels ? '0' : ''}
            </text>
            <text x={dialPoint(cx, cy, r - trackW * 1.6, layout.arcEndDeg).x}
              y={dialPoint(cx, cy, r - trackW * 1.6, layout.arcEndDeg).y}
              fontSize={9} fill="rgba(255,255,255,0.4)" textAnchor="middle" dominantBaseline="middle">
              {showScaleLabels ? formatScaleMaxLabel(scaleMax) : ''}
            </text>
          </g>
        )}

        <RectMoveBody
          rect={gaugeRect}
          panelShape={panelShape}
          beginDrag={beginDrag}
          dragKind={dragKind}
        />

        <TextLayer
          layout={layout} meta={meta} ratio={ratio} scaleMax={scaleMax} config={config}
          accentColor={accentColor}
          gaugeFillColor={gaugeFillColor}
          fontFamily={fontFamily}
          dragKind={drag?.kind === 'text' ? drag.which : null}
          hover={hover} setHover={setHover} beginDrag={beginDrag}
        />
        </g>

        <RectFrameOverlay
          rect={gaugeRect}
          panelShape={panelShape}
          accent={accentColor}
          dragKind={dragKind}
          beginDrag={beginDrag}
        />

        {!isGps && displayStyle === 'arc' && (
          <ArcHandles
            layout={layout} accent={accentColor}
            dragKind={dragKind} hover={hover} setHover={setHover} beginDrag={beginDrag}
          />
        )}

        {!isGps && displayStyle === 'bar' && (
          <BarHandles
            layout={layout}
            accent={gaugeFillColor}
            dragKind={dragKind}
            hover={hover}
            setHover={setHover}
            beginDrag={beginDrag}
          />
        )}

        {isGps && (
          <>
            <rect
              x={layout.mapRect.x}
              y={layout.mapRect.y}
              width={layout.mapRect.w}
              height={layout.mapRect.h}
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeDasharray="3 3"
              pointerEvents="none"
            />
            <MapHandles
              layout={layout}
              accent={trailColor}
              dragKind={dragKind}
              hover={hover}
              setHover={setHover}
              beginDrag={beginDrag}
            />
          </>
        )}
        </g>
          </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function FrameOverlay({ rect }: { rect: LayoutRect }) {
  const coversLayout =
    rect.x <= 0
    && rect.y <= 0
    && rect.x + rect.w >= LAYOUT_REF_W
    && rect.y + rect.h >= LAYOUT_REF_H;
  if (coversLayout) return null;

  const topH = Math.max(0, Math.min(rect.y, LAYOUT_REF_H));
  const bottomY = Math.min(rect.y + rect.h, LAYOUT_REF_H);
  const bottomH = Math.max(0, LAYOUT_REF_H - bottomY);
  const leftW = Math.max(0, Math.min(rect.x, LAYOUT_REF_W));
  const rightX = Math.min(rect.x + rect.w, LAYOUT_REF_W);
  const rightW = Math.max(0, LAYOUT_REF_W - rightX);
  const bandTop = Math.max(0, rect.y);
  const bandBottom = Math.min(rect.y + rect.h, LAYOUT_REF_H);
  const bandH = Math.max(0, bandBottom - bandTop);

  return (
    <g pointerEvents="none">
      {topH > 0 && (
        <rect x={0} y={0} width={LAYOUT_REF_W} height={topH} fill="#000" fillOpacity={0.22} />
      )}
      {bottomH > 0 && (
        <rect x={0} y={bottomY} width={LAYOUT_REF_W} height={bottomH} fill="#000" fillOpacity={0.22} />
      )}
      {leftW > 0 && bandH > 0 && (
        <rect x={0} y={bandTop} width={leftW} height={bandH} fill="#000" fillOpacity={0.22} />
      )}
      {rightW > 0 && bandH > 0 && (
        <rect x={rightX} y={bandTop} width={rightW} height={bandH} fill="#000" fillOpacity={0.22} />
      )}
    </g>
  );
}

function RectMoveBody({
  rect, panelShape, beginDrag, dragKind,
}: {
  rect: LayoutRect;
  panelShape: 'rounded' | 'square' | 'pill' | 'circle';
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
  dragKind: DragKind['kind'] | null;
}) {
  const moving = dragKind === 'rect-move';
  const onDown = beginDrag((origin) => ({
    kind: 'rect-move',
    pointerOrigin: origin,
    rectOrigin: { ...rect },
  }));

  if (panelShape === 'circle') {
    const { cx, cy, r } = panelCircleGeometry(rect);
    return (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="transparent"
        style={{ cursor: moving ? 'grabbing' : 'grab', pointerEvents: 'all' }}
        onPointerDown={onDown}
      />
    );
  }

  return (
    <rect
      x={rect.x} y={rect.y} width={rect.w} height={rect.h}
      fill="transparent"
      style={{ cursor: moving ? 'grabbing' : 'grab', pointerEvents: 'all' }}
      onPointerDown={onDown}
    />
  );
}

function RectFrameOverlay({
  rect, panelShape, accent, dragKind, beginDrag,
}: {
  rect: LayoutRect;
  panelShape: 'rounded' | 'square' | 'pill' | 'circle';
  accent: string;
  dragKind: DragKind['kind'] | null;
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const moving = dragKind === 'rect-move';
  const resizing = dragKind === 'rect-resize';
  const stroke = moving || resizing ? accent : 'rgba(255,255,255,0.35)';

  if (panelShape === 'circle') {
    const { cx, cy, r } = panelCircleGeometry(rect);
    const handles: Array<{ corner: LayoutCorner; x: number; y: number; cursor: string }> = [
      { corner: 'n', x: cx, y: cy - r, cursor: 'ns-resize' },
      { corner: 'e', x: cx + r, y: cy, cursor: 'ew-resize' },
      { corner: 's', x: cx, y: cy + r, cursor: 'ns-resize' },
      { corner: 'w', x: cx - r, y: cy, cursor: 'ew-resize' },
    ];
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="transparent"
          stroke={stroke}
          strokeDasharray="4 3"
          strokeWidth={1.2}
          pointerEvents="none"
        />
        {handles.map(({ corner, x, y, cursor }) => {
          const size = 8;
          return (
            <rect
              key={corner}
              x={x - size / 2}
              y={y - size / 2}
              width={size}
              height={size}
              fill="#1a2027"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={1.5}
              rx={1}
              style={{ cursor }}
              onPointerDown={beginDrag((origin) => ({
                kind: 'rect-resize',
                corner,
                pointerOrigin: origin,
                rectOrigin: { ...rect },
              }))}
            />
          );
        })}
      </g>
    );
  }

  const corners: Array<{ corner: LayoutCorner; x: number; y: number; cursor: string }> = [
    { corner: 'nw', x: rect.x, y: rect.y, cursor: 'nwse-resize' },
    { corner: 'n', x: rect.x + rect.w / 2, y: rect.y, cursor: 'ns-resize' },
    { corner: 'ne', x: rect.x + rect.w, y: rect.y, cursor: 'nesw-resize' },
    { corner: 'e', x: rect.x + rect.w, y: rect.y + rect.h / 2, cursor: 'ew-resize' },
    { corner: 'se', x: rect.x + rect.w, y: rect.y + rect.h, cursor: 'nwse-resize' },
    { corner: 's', x: rect.x + rect.w / 2, y: rect.y + rect.h, cursor: 'ns-resize' },
    { corner: 'sw', x: rect.x, y: rect.y + rect.h, cursor: 'nesw-resize' },
    { corner: 'w', x: rect.x, y: rect.y + rect.h / 2, cursor: 'ew-resize' },
  ];

  return (
    <g>
      <rect
        x={rect.x} y={rect.y} width={rect.w} height={rect.h}
        fill="transparent"
        stroke={stroke}
        strokeDasharray="4 3"
        strokeWidth={1.2}
        pointerEvents="none"
      />
      {corners.map(({ corner, x, y, cursor }) => {
        const size = 8;
        return (
          <rect
            key={corner}
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            fill="#1a2027"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={1.5}
            rx={1}
            style={{ cursor }}
            onPointerDown={beginDrag((origin) => ({
              kind: 'rect-resize',
              corner,
              pointerOrigin: origin,
              rectOrigin: { ...rect },
            }))}
          />
        );
      })}
    </g>
  );
}

function MapLayer({
  mapRect,
  route,
  previewRatio,
  trailColor,
  cursorColor,
}: {
  mapRect: LayoutRect;
  route: LatLon[];
  previewRatio: number;
  trailColor: string;
  cursorColor: string;
}) {
  const cursor = sampleRouteCursor(route, previewRatio);
  const { trail, cursor: cursorPt } = projectRouteToMapRect(route, mapRect, cursor.lat, cursor.lon);
  const trailPath = trail.length >= 2
    ? `M ${trail.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`
    : '';
  const strokeW = Math.max(2, mapRect.h * 0.025);
  const cursorR = Math.max(4, mapRect.h * 0.045);

  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={mapRect.x}
        y={mapRect.y}
        width={mapRect.w}
        height={mapRect.h}
        fill="rgba(0,0,0,0.22)"
        rx={4}
      />
      {trailPath && (
        <path d={trailPath} fill="none" stroke={trailColor} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {cursorPt && (
        <>
          <circle cx={cursorPt.x} cy={cursorPt.y} r={cursorR} fill={cursorColor} stroke="#000" strokeWidth={1.2} />
        </>
      )}
    </g>
  );
}

function BarVisual({
  layout,
  ratio,
  gaugeFillColor,
  fillGradient,
  gradientId,
}: {
  layout: GaugeLayoutConfig;
  ratio: number;
  gaugeFillColor: string;
  fillGradient: FillGradientConfig;
  gradientId: string;
}) {
  const bar = resolveBarConfig(layout);
  const fill = resolveBarFillColor(bar, gaugeFillColor);
  const { x: barX, y: barY, w: barW, h: barH } = bar.rect;
  const cornerR = bar.rounded ? barH / 2 : 0;
  const fillW = Math.max(1, barW * ratio);
  const useGradient = fillGradient.enabled && bar.color === 'default';

  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={barX} y={barY} width={barW} height={barH} rx={cornerR} ry={cornerR} fill="rgba(255,255,255,0.08)" />
      {useGradient ? (
        <>
          <defs>
            <linearGradient id={`${gradientId}-bar`} x1={barX} y1={barY} x2={barX + barW} y2={barY} gradientUnits="userSpaceOnUse">
              {normalizeGradientStops(fillGradient.stops).map((stop, i) => (
                <stop key={i} offset={`${stop.pos * 100}%`} stopColor={stop.color} />
              ))}
            </linearGradient>
            <clipPath id={`${gradientId}-bar-clip`}>
              <rect x={barX} y={barY} width={fillW} height={barH} rx={cornerR} ry={cornerR} />
            </clipPath>
          </defs>
          <rect
            x={barX}
            y={barY}
            width={barW}
            height={barH}
            rx={cornerR}
            ry={cornerR}
            fill={`url(#${gradientId}-bar)`}
            clipPath={`url(#${gradientId}-bar-clip)`}
          />
        </>
      ) : (
        <rect x={barX} y={barY} width={fillW} height={barH} rx={cornerR} ry={cornerR} fill={fill} />
      )}
    </g>
  );
}

function ArcHashMarksVisual({
  cx,
  cy,
  r,
  trackW,
  startDeg,
  sweep,
  tickCount,
}: {
  cx: number;
  cy: number;
  r: number;
  trackW: number;
  startDeg: number;
  sweep: number;
  tickCount: number;
}) {
  const count = resolveArcTickCount({ arcTickCount: tickCount });
  const majorEvery = Math.max(1, Math.round(count / 2));
  const marks: React.ReactNode[] = [];
  for (let i = 0; i <= count; i++) {
    const td = startDeg + (sweep * i) / count;
    const inner = dialPoint(cx, cy, r - trackW * 0.8, td);
    const outer = dialPoint(cx, cy, r + trackW * 0.55, td);
    const major = i % majorEvery === 0;
    marks.push(
      <line
        key={i}
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
        stroke={major ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.25)'}
        strokeWidth={major ? 1.4 : 0.8}
      />,
    );
  }
  return <g>{marks}</g>;
}

function ArcGradientVisual({
  cx,
  cy,
  r,
  startDeg,
  endDeg,
  ratio,
  trackW,
  stops,
}: {
  cx: number;
  cy: number;
  r: number;
  startDeg: number;
  endDeg: number;
  ratio: number;
  trackW: number;
  stops: FillGradientConfig['stops'];
}) {
  const maxT = clamp(ratio, 0, 1);
  const sweep = ((endDeg - startDeg) + 360) % 360;
  const steps = Math.max(24, Math.ceil(sweep / 3));
  const segments: React.ReactNode[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = (i / steps) * maxT;
    const t1 = Math.min(((i + 1) / steps) * maxT, maxT);
    if (t0 >= maxT) break;
    const d0 = startDeg + sweep * t0;
    const d1 = startDeg + sweep * t1;
    const isFirst = i === 0;
    const isLast = t1 >= maxT - 1e-9;
    segments.push(
      <path
        key={i}
        d={arcPath(cx, cy, r, d0, d1)}
        fill="none"
        stroke={colorAtGradient(stops, (t0 + t1) / 2)}
        strokeWidth={trackW}
        strokeLinecap={isFirst || isLast ? 'round' : 'butt'}
      />,
    );
  }
  return <g>{segments}</g>;
}

function BarHandles({
  layout,
  accent,
  dragKind,
  hover,
  setHover,
  beginDrag,
}: {
  layout: GaugeLayoutConfig;
  accent: string;
  dragKind: DragKind['kind'] | null;
  hover: string | null;
  setHover: (h: string | null) => void;
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const bar = resolveBarConfig(layout);
  const rect = bar.rect;
  const moving = dragKind === 'bar-move';
  const resizing = dragKind === 'bar-resize';
  const isHover = hover === 'bar';
  const corners: Array<{ corner: LayoutCorner; x: number; y: number; cursor: string }> = [
    { corner: 'nw', x: rect.x, y: rect.y, cursor: 'nwse-resize' },
    { corner: 'n', x: rect.x + rect.w / 2, y: rect.y, cursor: 'ns-resize' },
    { corner: 'ne', x: rect.x + rect.w, y: rect.y, cursor: 'nesw-resize' },
    { corner: 'e', x: rect.x + rect.w, y: rect.y + rect.h / 2, cursor: 'ew-resize' },
    { corner: 'se', x: rect.x + rect.w, y: rect.y + rect.h, cursor: 'nwse-resize' },
    { corner: 's', x: rect.x + rect.w / 2, y: rect.y + rect.h, cursor: 'ns-resize' },
    { corner: 'sw', x: rect.x, y: rect.y + rect.h, cursor: 'nesw-resize' },
    { corner: 'w', x: rect.x, y: rect.y + rect.h / 2, cursor: 'ew-resize' },
  ];

  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        fill="transparent"
        style={{ cursor: moving ? 'grabbing' : 'grab', pointerEvents: 'all' }}
        onPointerDown={beginDrag((origin) => ({
          kind: 'bar-move',
          pointerOrigin: origin,
          rectOrigin: { ...rect },
        }))}
        onPointerEnter={() => setHover('bar')}
        onPointerLeave={() => setHover(null)}
      />
      {(moving || resizing || isHover) && (
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          fill="none"
          stroke={accent}
          strokeWidth={1.2}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
      {corners.map(({ corner, x, y, cursor }) => {
        const size = 8;
        return (
          <rect
            key={corner}
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            fill="#1a2027"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={1.5}
            rx={1}
            style={{ cursor }}
            onPointerDown={beginDrag((origin) => ({
              kind: 'bar-resize',
              corner,
              pointerOrigin: origin,
              rectOrigin: { ...rect },
            }))}
            onPointerEnter={() => setHover('bar')}
            onPointerLeave={() => setHover(null)}
          />
        );
      })}
    </g>
  );
}

function MapHandles({
  layout,
  accent,
  dragKind,
  hover,
  setHover,
  beginDrag,
}: {
  layout: GaugeLayoutConfig;
  accent: string;
  dragKind: DragKind['kind'] | null;
  hover: string | null;
  setHover: (h: string | null) => void;
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const rect = layout.mapRect;
  const moving = dragKind === 'map-move';
  const resizing = dragKind === 'map-resize';
  const isHover = hover === 'map';
  const corners: Array<{ corner: LayoutCorner; x: number; y: number; cursor: string }> = [
    { corner: 'nw', x: rect.x, y: rect.y, cursor: 'nwse-resize' },
    { corner: 'n', x: rect.x + rect.w / 2, y: rect.y, cursor: 'ns-resize' },
    { corner: 'ne', x: rect.x + rect.w, y: rect.y, cursor: 'nesw-resize' },
    { corner: 'e', x: rect.x + rect.w, y: rect.y + rect.h / 2, cursor: 'ew-resize' },
    { corner: 'se', x: rect.x + rect.w, y: rect.y + rect.h, cursor: 'nwse-resize' },
    { corner: 's', x: rect.x + rect.w / 2, y: rect.y + rect.h, cursor: 'ns-resize' },
    { corner: 'sw', x: rect.x, y: rect.y + rect.h, cursor: 'nesw-resize' },
    { corner: 'w', x: rect.x, y: rect.y + rect.h / 2, cursor: 'ew-resize' },
  ];

  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        fill="transparent"
        style={{ cursor: moving ? 'grabbing' : 'grab', pointerEvents: 'all' }}
        onPointerDown={beginDrag((origin) => ({
          kind: 'map-move',
          pointerOrigin: origin,
          rectOrigin: { ...rect },
        }))}
        onPointerEnter={() => setHover('map')}
        onPointerLeave={() => setHover(null)}
      />
      {(moving || resizing || isHover) && (
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          fill="none"
          stroke={accent}
          strokeWidth={1.2}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
      {corners.map(({ corner, x, y, cursor }) => {
        const size = 8;
        return (
          <rect
            key={corner}
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            fill="#1a2027"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={1.5}
            rx={1}
            style={{ cursor, pointerEvents: 'all' }}
            onPointerDown={beginDrag((origin) => ({
              kind: 'map-resize',
              corner,
              pointerOrigin: origin,
              rectOrigin: { ...rect },
            }))}
            onPointerEnter={() => setHover('map')}
            onPointerLeave={() => setHover(null)}
          />
        );
      })}
    </g>
  );
}

function TextLayer({
  layout, meta, ratio, scaleMax, config, accentColor, gaugeFillColor, fontFamily,
  dragKind, hover, setHover, beginDrag,
}: {
  layout: GaugeLayoutConfig;
  meta: GaugeEditorMeta;
  ratio: number;
  scaleMax: number;
  config: Record<string, unknown>;
  accentColor: string;
  gaugeFillColor: string;
  fontFamily: string;
  dragKind: TextRole | null;
  hover: string | null;
  setHover: (h: string | null) => void;
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  return (
    <g>
      {TEXT_ROLES.map((role) => {
        const el = layout.text[role];
        if (!el.visible) return null;
        const display = el.textOverride.trim().length > 0
          ? el.textOverride
          : derivedTextForRole(role, meta, scaleMax, ratio, config);
        const fill = resolveTextColor(el.color, role, gaugeFillColor);
        const active = dragKind === role;
        const isHover = hover === `text-${role}`;
        const weight = role === 'value' ? 700 : role === 'label' ? 600 : 500;
        const hitW = Math.max(24, display.length * el.fontSize * 0.55) + 8;
        const hitH = el.fontSize * 1.25 + 6;
        const hitX = el.pos.x - hitW / 2;
        const hitY = el.pos.y - el.fontSize * 0.625 - 3;
        return (
          <g key={role}
            style={{ cursor: active ? 'grabbing' : 'grab' }}
            onPointerDown={beginDrag(() => ({ kind: 'text', which: role }))}
            onPointerEnter={() => setHover(`text-${role}`)}
            onPointerLeave={() => setHover(null)}
          >
            <rect x={hitX} y={hitY} width={hitW} height={hitH} fill="transparent" />
            <text x={el.pos.x} y={el.pos.y} fontSize={el.fontSize} fill={fill} fontWeight={weight}
              pointerEvents="none"
              textAnchor="middle" dominantBaseline="middle"
              style={{ fontFamily: `${fontFamily}, system-ui, sans-serif`, fontVariantNumeric: 'tabular-nums' }}>
              {display}
            </text>
            {(active || isHover) && (
              <rect
                x={el.pos.x - Math.max(24, display.length * el.fontSize * 0.55) / 2 - 4}
                y={el.pos.y - el.fontSize * 0.625 - 3}
                width={Math.max(24, display.length * el.fontSize * 0.55) + 8}
                height={el.fontSize * 1.25 + 6}
                rx={3} fill="none" stroke={accentColor} strokeWidth={1} strokeDasharray="3 3"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

function ArcHandles({
  layout, accent, dragKind, hover, setHover, beginDrag,
}: {
  layout: GaugeLayoutConfig;
  accent: string;
  dragKind: DragKind['kind'] | null;
  hover: string | null;
  setHover: (h: string | null) => void;
  beginDrag: (build: (origin: XY) => DragKind) => (e: React.PointerEvent) => void;
}) {
  const { cx, cy, r } = arcGeometry(layout.arcCenter, layout.arcRadius);
  const sweep = ((layout.arcEndDeg - layout.arcStartDeg) + 360) % 360;
  const midDeg = (layout.arcStartDeg + sweep / 2) % 360;
  const startPt = dialPoint(cx, cy, r, layout.arcStartDeg);
  const endPt = dialPoint(cx, cy, r, layout.arcEndDeg);
  const radiusPt = dialPoint(cx, cy, r, midDeg);

  return (
    <g>
      <HandleCrosshair cx={cx} cy={cy} accent={accent} active={dragKind === 'arc-center'} hover={hover === 'arc-center'}
        setHover={setHover} onPointerDown={beginDrag((origin) => ({ kind: 'arc-center', pointerOrigin: origin, centerOrigin: { ...layout.arcCenter } }))} />
      <HandleSquare point={radiusPt} accent={accent} active={dragKind === 'arc-radius'} hover={hover === 'arc-radius'}
        setHover={setHover} onPointerDown={beginDrag(() => ({ kind: 'arc-radius' }))} />
      <HandleRing point={startPt} accent={accent} active={dragKind === 'arc-start'} hover={hover === 'arc-start'}
        setHover={setHover} onPointerDown={beginDrag(() => ({ kind: 'arc-start' }))} id="arc-start" />
      <HandleRing point={endPt} accent={accent} active={dragKind === 'arc-end'} hover={hover === 'arc-end'}
        setHover={setHover} onPointerDown={beginDrag(() => ({ kind: 'arc-end' }))} id="arc-end" />
    </g>
  );
}

function HandleCrosshair({ cx, cy, accent, active, hover, setHover, onPointerDown }: {
  cx: number; cy: number; accent: string; active: boolean; hover: boolean;
  setHover: (s: string | null) => void; onPointerDown: (e: React.PointerEvent) => void;
}) {
  const reach = 7;
  const color = active || hover ? accent : 'rgba(255,255,255,0.5)';
  return (
    <g style={{ cursor: active ? 'grabbing' : 'grab' }} onPointerDown={onPointerDown}
      onPointerEnter={() => setHover('arc-center')} onPointerLeave={() => setHover(null)}>
      <circle cx={cx} cy={cy} r={reach + 4} fill="transparent" />
      <line x1={cx - reach} y1={cy} x2={cx + reach} y2={cy} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <line x1={cx} y1={cy - reach} x2={cx} y2={cy + reach} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={2} fill={color} />
    </g>
  );
}

function HandleSquare({ point, accent, active, hover, setHover, onPointerDown }: {
  point: XY; accent: string; active: boolean; hover: boolean;
  setHover: (s: string | null) => void; onPointerDown: (e: React.PointerEvent) => void;
}) {
  const size = active || hover ? 8 : 6;
  const color = active || hover ? accent : 'rgba(255,255,255,0.5)';
  return (
    <g style={{ cursor: active ? 'grabbing' : 'grab' }} onPointerDown={onPointerDown}
      onPointerEnter={() => setHover('arc-radius')} onPointerLeave={() => setHover(null)}>
      <rect x={point.x - size - 6} y={point.y - size - 6} width={size * 2 + 12} height={size * 2 + 12} fill="transparent" />
      <rect x={point.x - size} y={point.y - size} width={size * 2} height={size * 2}
        fill={active || hover ? accent : '#1a2027'} stroke={color} strokeWidth={1.6} rx={2} />
    </g>
  );
}

function HandleRing({ point, accent, active, hover, setHover, onPointerDown, id }: {
  point: XY; accent: string; active: boolean; hover: boolean;
  setHover: (s: string | null) => void; onPointerDown: (e: React.PointerEvent) => void; id: string;
}) {
  const ringR = active || hover ? 9 : 7;
  return (
    <g style={{ cursor: active ? 'grabbing' : 'grab' }} onPointerDown={onPointerDown}
      onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)}>
      <circle cx={point.x} cy={point.y} r={ringR + 4} fill="transparent" />
      <circle cx={point.x} cy={point.y} r={ringR} fill="#1a2027" stroke={active || hover ? accent : 'rgba(255,255,255,0.5)'} strokeWidth={2} />
      <circle cx={point.x} cy={point.y} r={2.5} fill={accent} />
    </g>
  );
}
