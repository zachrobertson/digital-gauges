import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GaugeInstance, GaugePlugin, JSONSchemaProperty } from '@shared/types';
import { appearanceDefaults } from '../../gauges/appearanceSchema';
import { ColorInput } from './ColorInput';
import {
  dataSchemaKeys,
  elementEditorMeta,
  gaugeEditorKind,
  gaugeEditorMeta,
  previewGaugeFillColor,
  resolveAccentColor,
} from '../../gauges/gaugeEditorAdapter';
import { isDataGaugePlugin } from '../../gauges/dataGauge';
import { hasGpsData, availableFields, isUnsupportedGaugeConfig } from '../../lib/gaugeFactory';
import type { GaugeLayoutConfig } from '../../gauges/gaugeEditorLayout';
import {
  clamp,
  defaultLayoutForTemplate,
  LAYOUT_REF_H,
  LAYOUT_REF_W,
  mergeGaugeLayout,
  MIN_RECT_H,
  MIN_RECT_W,
  syncGaugeVideoRectHeight,
} from '../../gauges/gaugeEditorLayout';
import { buildCourseMarkers, buildRoutePolyline, type RouteScope } from '../../lib/telemetry';
import type { GpsRouteScope } from '../../gauges/gpsMiniMap';
import { useProject } from '../../store/project';
import { firstClipMedia } from '@shared/timeline';
import { allProjectTracks } from '../../lib/telemetry';
import { CompositeGaugeEditorPreview } from './CompositeGaugeEditorPreview';
import { ElementEditorPanel } from './ElementEditorPanel';
import { GlobalFontPicker } from './GlobalFontPicker';
import { videoGaugeDragActive } from '../player/useVideoGaugeDrag';
import { resolveFrameStyle, type FrameShape } from '../../gauges/frameStyle';
import { isCompositeGaugeConfig } from '../../lib/gaugeElementFactory';
import { primarySelection } from '../../lib/elementSelection';
import { useElementEditorShortcuts } from '../../lib/useElementEditorShortcuts';

interface Props {
  plugin: GaugePlugin;
  gauge: GaugeInstance;
  mergedConfig: Record<string, unknown>;
  onConfigChange: (patch: Record<string, unknown>) => void;
  onRectChange: (rect: GaugeInstance['rect']) => void;
  renderDataField: (key: string, prop: JSONSchemaProperty, value: unknown, onChange: (v: unknown) => void) => React.ReactNode;
  onSaveTemplate?: () => void;
  showPreview?: boolean;
  selectedElementIds?: string[];
  onSelectElements?: (ids: string[]) => void;
}

export function GaugeEditor({
  plugin,
  gauge,
  mergedConfig,
  onConfigChange,
  onRectChange,
  renderDataField,
  onSaveTemplate,
  showPreview = true,
  selectedElementIds: selectedElementIdsProp,
  onSelectElements,
}: Props) {
  const video = firstClipMedia(useProject((s) => s.project));
  const project = useProject((s) => s.project);
  const projectTracks = useMemo(() => allProjectTracks(project), [project]);
  const [previewRatio, setPreviewRatio] = useState(0.62);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridSize, setGridSize] = useState(12);
  const [showFrameBounds, setShowFrameBounds] = useState(true);
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);
  const selectedElementIds = selectedElementIdsProp ?? internalSelectedIds;
  const setSelectedElementIds = onSelectElements ?? setInternalSelectedIds;

  if (isDataGaugePlugin(plugin.id) && isUnsupportedGaugeConfig(mergedConfig)) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100/90">
          This gauge uses an older format that is no longer supported. Create a new gauge to use composite elements (multiple bars, arcs, maps, and text in one panel).
        </div>
      </div>
    );
  }

  const editorKind = gaugeEditorKind(plugin, mergedConfig);
  const layout = mergeGaugeLayout(mergedConfig.layout as GaugeLayoutConfig | undefined);
  const primaryId = primarySelection(selectedElementIds);
  const selectedElement = layout.elements.find((e) => e.id === primaryId) ?? null;
  const meta = gaugeEditorMeta(plugin, mergedConfig, selectedElement);
  const fieldsAvailable = useMemo(() => availableFields(projectTracks), [projectTracks]);
  const gpsAvailable = hasGpsData(fieldsAvailable);
  const accentColor = resolveAccentColor(mergedConfig, plugin, selectedElement);
  const trailColor = String(mergedConfig.trailColor ?? '#3ddc97');
  const cursorColor = String(mergedConfig.cursorColor ?? '#ffffff');
  const backgroundColor = String(mergedConfig.panelBg ?? appearanceDefaults.panelBg);
  const gaugeFillColor = previewGaugeFillColor(plugin, mergedConfig, previewRatio, selectedElement);
  const fontFamily = String(mergedConfig.fontFamily ?? appearanceDefaults.fontFamily);
  const frameStyle = resolveFrameStyle(mergedConfig);
  const frameShape = frameStyle.shape;
  const frameCornerRadius = frameStyle.cornerRadius;
  const scaleMax = meta?.getScaleMax(mergedConfig) ?? 0;
  const previewRoute = useMemo(() => {
    const scope = ((mergedConfig.routeScope ?? 'video') as GpsRouteScope) as RouteScope;
    const route = buildRoutePolyline(project, scope);
    return route.length >= 2 ? route : null;
  }, [mergedConfig.routeScope, project]);
  const previewCourseMarkers = useMemo(() => buildCourseMarkers(project), [project]);
  const legacyShowMarkers = mergedConfig.showCourseMarkers as boolean | undefined;
  const showCourseStart = (mergedConfig.showCourseStart as boolean | undefined) ?? legacyShowMarkers ?? true;
  const showCourseFinish = (mergedConfig.showCourseFinish as boolean | undefined) ?? legacyShowMarkers ?? true;

  const gaugeRectRef = useRef(gauge.rect);
  gaugeRectRef.current = gauge.rect;

  const syncVideoRectAspect = useCallback((nextLayout: GaugeLayoutConfig, rect = gaugeRectRef.current) => {
    if (!video?.width || !video?.height) return;
    const synced = syncGaugeVideoRectHeight(rect, nextLayout, video.width, video.height);
    if (Math.abs(synced.w - rect.w) > 0.0005 || Math.abs(synced.h - rect.h) > 0.0005) {
      onRectChange(synced);
    }
  }, [onRectChange, video?.width, video?.height]);

  const setLayout = useCallback((next: GaugeLayoutConfig) => {
    onConfigChange({ layout: next });
    syncVideoRectAspect(next);
  }, [onConfigChange, syncVideoRectAspect]);

  useEffect(() => {
    if (!mergedConfig.layout || !isCompositeGaugeConfig(mergedConfig)) {
      onConfigChange({ layout: defaultLayoutForTemplate('telemetry') });
    }
  }, [mergedConfig.layout, onConfigChange]);

  useElementEditorShortcuts({
    enabled: showPreview,
    selectedElementIds,
    onSelectElements: setSelectedElementIds,
    showFrameBounds,
    onShowFrameBoundsChange: setShowFrameBounds,
    layout,
    onLayoutChange: setLayout,
    gridSize,
  });

  useEffect(() => {
    if (videoGaugeDragActive) return;
    if (mergedConfig.layout && video) syncVideoRectAspect(layout);
  }, [mergedConfig.layout, video?.width, video?.height, layout.gaugeRect.w, layout.gaugeRect.h, gauge.rect.w, syncVideoRectAspect]);

  if (!editorKind) return null;
  if (!meta && showPreview) return null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="text-sm font-semibold">{isDataGaugePlugin(plugin.id) ? 'Gauge' : plugin.name}</div>
      </div>

      <GlobalFontPicker
        value={fontFamily}
        onChange={(v) => onConfigChange({ fontFamily: v })}
      />

      {isDataGaugePlugin(plugin.id) && (
        <ElementEditorPanel
          plugin={plugin}
          layout={layout}
          mergedConfig={mergedConfig}
          selectedElementIds={selectedElementIds}
          onSelectElements={setSelectedElementIds}
          onLayoutChange={setLayout}
          onConfigChange={onConfigChange}
          previewRatio={previewRatio}
          projectTracks={projectTracks}
          course={project.course}
          gpsAvailable={gpsAvailable}
        />
      )}

      {showPreview && meta && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              Show grid
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
              Snap to grid
            </label>
          </div>
          <p className="text-xs text-white/50 leading-relaxed">
            Click to select · Shift+click to multi-select · drag empty area to box-select · arrow keys to nudge.
          </p>
          <CompositeGaugeEditorPreview
            layout={layout}
            selectedElementIds={selectedElementIds}
            accentColor={accentColor}
            gaugeFillColor={gaugeFillColor}
            trailColor={trailColor}
            cursorColor={cursorColor}
            previewRoute={previewRoute}
            courseStart={showCourseStart ? previewCourseMarkers.start : null}
            courseFinish={showCourseFinish ? previewCourseMarkers.finish : null}
            fontFamily={fontFamily}
            frameShape={frameShape}
            frameCornerRadius={frameCornerRadius}
            previewRatio={previewRatio}
            scaleMax={scaleMax}
            meta={meta}
            config={mergedConfig}
            onLayoutChange={setLayout}
            onSelectElements={setSelectedElementIds}
            showGrid={showGrid}
            snapEnabled={snapEnabled}
            gridSize={gridSize}
            showFrameBounds={showFrameBounds}
          />
          <LabeledSelect
            label="Grid size"
            value={String(gridSize)}
            options={[{ value: '8', label: '8 px' }, { value: '12', label: '12 px' }, { value: '16', label: '16 px' }]}
            onChange={(v) => setGridSize(Number(v))}
          />
          <NumberRow
            label="Preview value"
            value={previewRatio * 100}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => setPreviewRatio(v / 100)}
          />
        </>
      )}

      <hr className="border-white/10" />

      {dataSchemaKeys(plugin).map((key) => {
        const prop = plugin.schema.properties[key];
        if (!prop) return null;
        return (
          <div key={key}>
            {renderDataField(key, prop, mergedConfig[key], (v) => onConfigChange({ [key]: v }))}
          </div>
        );
      })}

      <Collapsible
        title="Frame"
        trailing={`${Math.round(layout.gaugeRect.w)} × ${Math.round(layout.gaugeRect.h)}`}
      >
        <div className="flex flex-col gap-2 pt-2">
          <LabeledSelect
            label="Frame shape"
            value={frameShape}
            options={FRAME_SHAPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => onConfigChange({
              frameShape: v as FrameShape,
              cornerStyle: undefined,
            })}
          />
          <NumberRow label="X" value={layout.gaugeRect.x} min={0} max={LAYOUT_REF_W - MIN_RECT_W} step={1}
            onChange={(v) => setLayout({ ...layout, gaugeRect: { ...layout.gaugeRect, x: clamp(v, 0, LAYOUT_REF_W - layout.gaugeRect.w) } })} />
          <NumberRow label="Y" value={layout.gaugeRect.y} min={0} max={LAYOUT_REF_H - MIN_RECT_H} step={1}
            onChange={(v) => setLayout({ ...layout, gaugeRect: { ...layout.gaugeRect, y: clamp(v, 0, LAYOUT_REF_H - layout.gaugeRect.h) } })} />
          <NumberRow label="Width" value={layout.gaugeRect.w} min={MIN_RECT_W} max={LAYOUT_REF_W} step={1} suffix="px"
            onChange={(v) => setLayout({ ...layout, gaugeRect: { ...layout.gaugeRect, w: clamp(v, MIN_RECT_W, LAYOUT_REF_W - layout.gaugeRect.x) } })} />
          <NumberRow label="Height" value={layout.gaugeRect.h} min={MIN_RECT_H} max={LAYOUT_REF_H} step={1} suffix="px"
            onChange={(v) => setLayout({ ...layout, gaugeRect: { ...layout.gaugeRect, h: clamp(v, MIN_RECT_H, LAYOUT_REF_H - layout.gaugeRect.y) } })} />
          {frameShape === 'rectangle' && (
            <NumberRow
              label="Corner radius"
              value={frameCornerRadius}
              min={0}
              max={240}
              step={1}
              suffix="px"
              onChange={(v) => onConfigChange({ frameCornerRadius: Math.round(v), cornerStyle: undefined })}
            />
          )}
          <button type="button" className="btn-ghost text-xs self-start"
            onClick={() => setLayout(defaultLayoutForTemplate('telemetry'))}>
            Reset layout
          </button>
        </div>
      </Collapsible>

      <Collapsible title="Appearance">
        <div className="flex flex-col gap-3 pt-2">
          <ColorInput label="Background color" value={backgroundColor} onChange={(v) => onConfigChange({ panelBg: v })} />
          <NumberRow label="Panel opacity" value={Number(mergedConfig.panelOpacity ?? 0.65)}
            min={0} max={1} step={0.05} onChange={(v) => onConfigChange({ panelOpacity: v })} />
        </div>
      </Collapsible>

      <hr className="border-white/10" />
      {onSaveTemplate && isDataGaugePlugin(plugin.id) && (
        <button type="button" className="btn-ghost text-xs" onClick={onSaveTemplate}>Save as template…</button>
      )}
    </div>
  );
}

function Collapsible({ title, count, trailing, children }: {
  title: string; count?: number; trailing?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-white/10 rounded-md">
      <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/70"
        onClick={() => setOpen((o) => !o)}>
        <span>{title}{count != null ? ` (${count})` : ''}</span>
        <span className="flex items-center gap-2 text-white/40">
          {trailing && <span className="font-mono normal-case tracking-normal">{trailing}</span>}
          {open ? '−' : '+'}
        </span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function LabeledSelect({ label, value, options, onChange }: {
  label: string; value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative flex flex-col gap-1">
      <label className="field-label">{label}</label>
      <select className="select-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function NumberRow({ label, value, min, max, step, suffix, onChange }: {
  label: string; value: number; min: number; max?: number; step: number;
  suffix?: string; onChange: (v: number) => void;
}) {
  const decimals = step < 1 ? 2 : 0;
  const display = decimals > 0 ? Number(value.toFixed(decimals)) : Math.round(value);
  const apply = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    onChange(max != null ? clamp(parsed, min, max) : Math.max(min, parsed));
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-white/50 w-16 shrink-0">{label}</span>
      <input type="number" min={min} max={max} step={step} value={display}
        onChange={(e) => apply(e.target.value)}
        className="flex-1 min-w-0 bg-white/5 rounded px-2 py-1 text-xs border border-white/10 font-mono" />
      {suffix && <span className="text-xs text-white/40 shrink-0">{suffix}</span>}
    </div>
  );
}

const FRAME_SHAPE_OPTIONS = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'ellipse', label: 'Ellipse' },
] as const;
