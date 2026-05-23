import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GaugeInstance, GaugePlugin, JSONSchemaProperty } from '@shared/types';
import { appearanceDefaults } from '../../gauges/appearanceSchema';
import { ColorInput, OptionalColorInput } from './ColorInput';
import {
  dataSchemaKeys,
  derivedTextForRole,
  DISPLAY_STYLE_OPTIONS,
  fieldLabel,
  FONT_OPTIONS,
  gaugeEditorKind,
  gaugeEditorMeta,
  previewGaugeFillColor,
  resolveAccentColor,
  resolveDataDisplayStyle,
  resolveDisplayStyle,
  SPEED_UNIT_OPTIONS,
} from '../../gauges/gaugeEditorAdapter';
import { isDataGaugePlugin } from '../../gauges/dataGauge';
import { defaultConfigForField } from '../../gauges/fieldRegistry';
import type { TelemetryField } from '@shared/types';
import { collectFieldOptions, hasGpsData, availableFields } from '../../lib/gaugeFactory';
import { resolveShowScaleLabels, resolveArcTickCount, resolveShowArcTicks, MIN_ARC_TICK_COUNT, MAX_ARC_TICK_COUNT } from '../../gauges/barGaugeSchema';
import type { FillGradientConfig, FillGradientStop } from '../../gauges/gaugeGradient';
import {
  HR_GRADIENT_PRESET,
  mergeFillGradient,
  normalizeGradientStops,
  POWER_GRADIENT_PRESET,
  SPEED_GRADIENT_PRESET,
} from '../../gauges/gaugeGradient';
import type { GaugeLayoutConfig, GaugeLayoutTemplate, TextElement, TextRole } from '../../gauges/gaugeEditorLayout';
import {
  clamp,
  defaultLayoutForTemplate,
  LAYOUT_REF_H,
  LAYOUT_REF_W,
  MAX_ARC_RADIUS,
  mergeGaugeLayout,
  MIN_BAR_LENGTH,
  MIN_BAR_THICKNESS,
  MIN_MAP_SIZE,
  MIN_RECT_H,
  MIN_RECT_W,
  normalizeSquareGaugeRect,
  resolveTextColor,
  syncGaugeVideoRectHeight,
  TEXT_ROLES,
  wrap360,
} from '../../gauges/gaugeEditorLayout';
import { buildRoutePolyline, type RouteScope } from '../../lib/telemetry';
import type { GpsRouteScope } from '../../gauges/gpsMiniMap';
import { useProject } from '../../store/project';
import { GaugeEditorPreview } from './GaugeEditorPreview';
import { videoGaugeDragActive } from '../player/useVideoGaugeDrag';

interface Props {
  plugin: GaugePlugin;
  gauge: GaugeInstance;
  mergedConfig: Record<string, unknown>;
  onConfigChange: (patch: Record<string, unknown>) => void;
  onRectChange: (rect: GaugeInstance['rect']) => void;
  onRemove: () => void;
  renderDataField: (key: string, prop: JSONSchemaProperty, value: unknown, onChange: (v: unknown) => void) => React.ReactNode;
  onSaveTemplate?: () => void;
}

export function GaugeEditor({
  plugin,
  gauge,
  mergedConfig,
  onConfigChange,
  onRectChange,
  onRemove,
  renderDataField,
  onSaveTemplate,
}: Props) {
  const meta = gaugeEditorMeta(plugin, mergedConfig);
  const editorKind = gaugeEditorKind(plugin, mergedConfig);
  const layoutTemplate: GaugeLayoutTemplate = editorKind === 'gps' ? 'gps' : 'telemetry';
  const video = useProject((s) => s.project.video);
  const project = useProject((s) => s.project);
  const [previewRatio, setPreviewRatio] = useState(0.62);
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridSize, setGridSize] = useState(12);

  const layout = mergeGaugeLayout(mergedConfig.layout as GaugeLayoutConfig | undefined, layoutTemplate);
  const isGps = editorKind === 'gps';
  const dataDisplayStyle = resolveDataDisplayStyle(mergedConfig);
  const displayStyle = isGps ? 'bar' as const : resolveDisplayStyle(mergedConfig);
  const isText = !isGps && dataDisplayStyle === 'text';
  const fieldOptions = useMemo(() => collectFieldOptions(project.tracks), [project.tracks]);
  const fieldsAvailable = useMemo(() => availableFields(project.tracks), [project.tracks]);
  const gpsAvailable = hasGpsData(fieldsAvailable);
  const currentField = (mergedConfig.field as TelemetryField | undefined) ?? 'speed';
  const accentColor = resolveAccentColor(mergedConfig, plugin);
  const trailColor = String(mergedConfig.trailColor ?? '#3ddc97');
  const cursorColor = String(mergedConfig.cursorColor ?? '#ffffff');
  const gaugeFillColor = previewGaugeFillColor(plugin, mergedConfig, previewRatio);
  const fillGradient = mergeFillGradient(mergedConfig.fillGradient as FillGradientConfig | undefined);
  const fontFamily = String(mergedConfig.fontFamily ?? appearanceDefaults.fontFamily);
  const panelShape = (mergedConfig.cornerStyle ?? appearanceDefaults.cornerStyle) as 'rounded' | 'square' | 'pill' | 'circle';
  const scaleMax = meta?.getScaleMax(mergedConfig) ?? 0;
  const showScaleLabels = resolveShowScaleLabels(mergedConfig as { showScaleLabels?: boolean; showMax?: boolean });
  const showArcTicks = resolveShowArcTicks(mergedConfig as { showArcTicks?: boolean });
  const arcTickCount = resolveArcTickCount(mergedConfig as { arcTickCount?: number });
  const previewRoute = useMemo(() => {
    const scope = ((mergedConfig.routeScope ?? 'video') as GpsRouteScope) as RouteScope;
    const route = buildRoutePolyline(project, scope);
    return route.length >= 2 ? route : null;
  }, [mergedConfig.routeScope, project]);

  const gaugeRectRef = useRef(gauge.rect);
  gaugeRectRef.current = gauge.rect;

  const syncVideoRectAspect = useCallback((nextLayout: GaugeLayoutConfig, rect = gaugeRectRef.current) => {
    if (!video?.width || !video?.height) return;
    const synced = syncGaugeVideoRectHeight(
      rect,
      nextLayout,
      video.width,
      video.height,
      panelShape,
    );
    if (
      Math.abs(synced.w - rect.w) > 0.0005
      || Math.abs(synced.h - rect.h) > 0.0005
    ) {
      onRectChange(synced);
    }
  }, [onRectChange, panelShape, video?.width, video?.height]);

  const setVideoRect = useCallback((patch: Partial<GaugeInstance['rect']>) => {
    const next = { ...gaugeRectRef.current, ...patch };
    if (!video?.width || !video?.height) {
      onRectChange(next);
      return;
    }
    const synced = syncGaugeVideoRectHeight(
      next,
      layout,
      video.width,
      video.height,
      panelShape,
    );
    onRectChange(synced);
  }, [layout, onRectChange, panelShape, video?.width, video?.height]);

  useEffect(() => {
    if (!mergedConfig.layout) {
      onConfigChange({ layout: defaultLayoutForTemplate(layoutTemplate) });
    }
  }, [mergedConfig.layout, layoutTemplate, onConfigChange]);

  useEffect(() => {
    if (isGps) return;
    const stored = gauge.config?.color;
    if (stored == null || stored === '') {
      onConfigChange({ color: accentColor });
    }
  }, [gauge.id, gauge.config?.color, accentColor, isGps, onConfigChange]);

  useEffect(() => {
    if (videoGaugeDragActive) return;
    if (mergedConfig.layout && video) {
      syncVideoRectAspect(layout);
    }
  }, [
    mergedConfig.layout,
    video?.width,
    video?.height,
    layout.gaugeRect.w,
    layout.gaugeRect.h,
    gauge.rect.w,
    panelShape,
    syncVideoRectAspect,
  ]);

  const setLayout = useCallback(
    (next: GaugeLayoutConfig) => {
      onConfigChange({ layout: next });
      syncVideoRectAspect(next);
    },
    [onConfigChange, syncVideoRectAspect],
  );

  useEffect(() => {
    if (panelShape !== 'circle') return;
    const gr = layout.gaugeRect;
    if (Math.abs(gr.w - gr.h) <= 0.5) return;
    setLayout({ ...layout, gaugeRect: normalizeSquareGaugeRect(gr) });
  }, [panelShape, layout.gaugeRect.w, layout.gaugeRect.h, setLayout]);

  const onResetLayout = () => setLayout(defaultLayoutForTemplate(layoutTemplate));

  const ensureLayout = () => {
    if (!mergedConfig.layout) onConfigChange({ layout: defaultLayoutForTemplate(layoutTemplate) });
  };

  const patchConfig = (patch: Record<string, unknown>) => {
    ensureLayout();
    onConfigChange(patch);
  };

  const onDisplayKindChange = (kind: string) => {
    if (kind === 'map') {
      onConfigChange({
        displayStyle: 'map',
        layout: defaultLayoutForTemplate('gps'),
      });
      return;
    }
    const nextTemplate = 'telemetry';
    const needsLayoutReset = isGps;
    onConfigChange({
      displayStyle: kind,
      ...(needsLayoutReset ? { layout: defaultLayoutForTemplate(nextTemplate) } : {}),
    });
  };

  const onFieldChange = (field: TelemetryField) => {
    const defaults = defaultConfigForField(field);
    onConfigChange({
      field,
      color: defaults.color,
      scaleMax: defaults.scaleMax,
      maxSpeedKmh: defaults.maxSpeedKmh,
      maxHr: defaults.maxHr,
      maxCadence: defaults.maxCadence,
      ftp: defaults.ftp,
      units: defaults.units,
    });
  };

  if (!editorKind || !meta) return null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="text-sm font-semibold">{isDataGaugePlugin(plugin.id) ? 'Gauge' : plugin.name}</div>
        {plugin.description && !isDataGaugePlugin(plugin.id) && (
          <div className="text-xs text-white/40">{plugin.description}</div>
        )}
      </div>

      {isDataGaugePlugin(plugin.id) && (
        <div className="flex flex-col gap-3 border border-white/10 rounded-md p-3">
          <div className="field-label text-[10px] uppercase tracking-wider">Data</div>
          <div className="flex flex-col gap-1">
            <label className="field-label">Display kind</label>
            <div className="grid grid-cols-4 gap-1">
              {DISPLAY_STYLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={opt.value === 'map' && !gpsAvailable}
                  title={opt.value === 'map' && !gpsAvailable ? 'Requires lat/lon telemetry' : undefined}
                  className={`text-xs py-1.5 rounded border transition-colors ${
                    dataDisplayStyle === opt.value
                      ? 'border-accent bg-accent/20 text-white'
                      : opt.value === 'map' && !gpsAvailable
                        ? 'border-white/5 text-white/25 cursor-not-allowed'
                        : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                  onClick={() => onDisplayKindChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {!isGps ? (
            <FieldSelect
              value={currentField}
              options={fieldOptions}
              onChange={onFieldChange}
            />
          ) : (
            <p className="text-xs text-white/50">
              {gpsAvailable ? 'Uses lat/lon from merged telemetry at playhead.' : 'No GPS data loaded.'}
            </p>
          )}
        </div>
      )}

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
        {isGps
          ? 'Drag the frame to adjust padding around the map and label. Resize the map area independently. Use the video overlay to reposition the gauge on screen; adjust on-video size below.'
          : 'Drag the frame to reposition padding around fixed content; resize from a corner or edge to adjust padding without moving arc and text. Use the video overlay to reposition the gauge on screen; adjust on-video size below.'}
      </p>

      <GaugeEditorPreview
        editorKind={editorKind}
        layout={layout}
        displayStyle={displayStyle}
        accentColor={accentColor}
        gaugeFillColor={gaugeFillColor}
        trailColor={trailColor}
        cursorColor={cursorColor}
        previewRoute={previewRoute}
        fontFamily={fontFamily}
        panelShape={panelShape}
        previewRatio={previewRatio}
        scaleMax={scaleMax}
        meta={meta}
        config={mergedConfig}
        onLayoutChange={setLayout}
        showGrid={showGrid}
        snapEnabled={snapEnabled}
        gridSize={gridSize}
      />

      <LabeledSelect
        label="Grid size"
        value={String(gridSize)}
        options={[
          { value: '8', label: '8 px' },
          { value: '12', label: '12 px' },
          { value: '16', label: '16 px' },
        ]}
        onChange={(v) => setGridSize(Number(v))}
      />

      <NumberRow
        label={isGps ? 'Preview position' : 'Preview value'}
        value={previewRatio * 100}
        min={0}
        max={100}
        step={1}
        suffix="%"
        onChange={(v) => setPreviewRatio(v / 100)}
      />

      <hr className="border-white/10" />

      {!isGps && (
        <div className="flex flex-col gap-3">
          {(mergedConfig.field === 'speed' || plugin.id === 'builtin:speedometer') && (
            <LabeledSelect
              label="Speed units"
              value={String(mergedConfig.units ?? 'kmh')}
              options={SPEED_UNIT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(v) => patchConfig({ units: v })}
            />
          )}
          <ScaleMaxRow meta={meta} config={mergedConfig} value={scaleMax}
            onChange={(v) => onConfigChange(meta.patchScaleMax(mergedConfig, v))} />
          {displayStyle === 'arc' && (
            <>
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={showScaleLabels}
                  onChange={(e) => patchConfig({ showScaleLabels: e.target.checked })}
                />
                Show scale labels (min/max)
              </label>
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input
                  type="checkbox"
                  checked={showArcTicks}
                  onChange={(e) => patchConfig({ showArcTicks: e.target.checked })}
                />
                Show hash marks
              </label>
              {showArcTicks && (
                <NumberRow
                  label="Hash marks"
                  value={arcTickCount}
                  min={MIN_ARC_TICK_COUNT}
                  max={MAX_ARC_TICK_COUNT}
                  step={1}
                  onChange={(v) => patchConfig({ arcTickCount: Math.round(v) })}
                />
              )}
            </>
          )}
          {!isText && (
            <FillGradientEditor
              pluginId={plugin.id}
              field={currentField}
              value={fillGradient}
              onChange={(next) => patchConfig({ fillGradient: next })}
            />
          )}
        </div>
      )}

      {dataSchemaKeys(plugin).map((key) => {
        const prop = plugin.schema.properties[key];
        if (!prop) return null;
        return (
          <div key={key}>
            {renderDataField(key, prop, mergedConfig[key], (v) => onConfigChange({ [key]: v }))}
          </div>
        );
      })}

      {isGps && (
        <Collapsible
          title="Map"
          trailing={`${Math.round(layout.mapRect.w)} × ${Math.round(layout.mapRect.h)}`}
        >
          <div className="flex flex-col gap-2 pt-2">
            <NumberRow label="X" value={layout.mapRect.x} min={0} max={LAYOUT_REF_W - MIN_MAP_SIZE} step={1}
              onChange={(v) => setLayout({
                ...layout,
                mapRect: { ...layout.mapRect, x: clamp(v, 0, LAYOUT_REF_W - layout.mapRect.w) },
              })} />
            <NumberRow label="Y" value={layout.mapRect.y} min={0} max={LAYOUT_REF_H - MIN_MAP_SIZE} step={1}
              onChange={(v) => setLayout({
                ...layout,
                mapRect: { ...layout.mapRect, y: clamp(v, 0, LAYOUT_REF_H - layout.mapRect.h) },
              })} />
            <NumberRow label="Width" value={layout.mapRect.w} min={MIN_MAP_SIZE} max={LAYOUT_REF_W} step={1}
              suffix="px"
              onChange={(v) => setLayout({
                ...layout,
                mapRect: { ...layout.mapRect, w: clamp(v, MIN_MAP_SIZE, LAYOUT_REF_W - layout.mapRect.x) },
              })} />
            <NumberRow label="Height" value={layout.mapRect.h} min={MIN_MAP_SIZE} max={LAYOUT_REF_H} step={1}
              suffix="px"
              onChange={(v) => setLayout({
                ...layout,
                mapRect: { ...layout.mapRect, h: clamp(v, MIN_MAP_SIZE, LAYOUT_REF_H - layout.mapRect.y) },
              })} />
          </div>
        </Collapsible>
      )}

      {!isGps && displayStyle === 'arc' && (
        <Collapsible title="Arc">
          <div className="flex flex-col gap-2 pt-2">
            <NumberRow label="Center X" value={layout.arcCenter.x} min={0} max={LAYOUT_REF_W} step={1}
              onChange={(v) => setLayout({ ...layout, arcCenter: { ...layout.arcCenter, x: clamp(v, 0, LAYOUT_REF_W) } })} />
            <NumberRow label="Center Y" value={layout.arcCenter.y} min={0} max={LAYOUT_REF_H} step={1}
              onChange={(v) => setLayout({ ...layout, arcCenter: { ...layout.arcCenter, y: clamp(v, 0, LAYOUT_REF_H) } })} />
            <NumberRow label="Radius" value={layout.arcRadius} min={8} max={MAX_ARC_RADIUS} step={1}
              suffix="px"
              onChange={(v) => setLayout({ ...layout, arcRadius: clamp(v, 8, MAX_ARC_RADIUS) })} />
            <DegreeRow label="Start" value={layout.arcStartDeg} end={layout.arcEndDeg} which="start"
              onChange={(deg) => setLayout({ ...layout, arcStartDeg: deg })} />
            <DegreeRow label="End" value={layout.arcEndDeg} end={layout.arcStartDeg} which="end"
              onChange={(deg) => setLayout({ ...layout, arcEndDeg: deg })} />
          </div>
        </Collapsible>
      )}

      {!isGps && displayStyle === 'bar' && !isText && (
        <Collapsible
          title="Bar"
          trailing={`${Math.round(layout.bar.rect.w)} × ${Math.round(layout.bar.rect.h)}`}
        >
          <div className="flex flex-col gap-2 pt-2">
            <NumberRow label="X" value={layout.bar.rect.x} min={0} max={LAYOUT_REF_W - MIN_BAR_LENGTH} step={1}
              onChange={(v) => setLayout({
                ...layout,
                bar: {
                  ...layout.bar,
                  rect: {
                    ...layout.bar.rect,
                    x: clamp(v, 0, LAYOUT_REF_W - layout.bar.rect.w),
                  },
                },
              })} />
            <NumberRow label="Y" value={layout.bar.rect.y} min={0} max={LAYOUT_REF_H - MIN_BAR_THICKNESS} step={1}
              onChange={(v) => setLayout({
                ...layout,
                bar: {
                  ...layout.bar,
                  rect: {
                    ...layout.bar.rect,
                    y: clamp(v, 0, LAYOUT_REF_H - layout.bar.rect.h),
                  },
                },
              })} />
            <NumberRow label="Length" value={layout.bar.rect.w} min={MIN_BAR_LENGTH} max={LAYOUT_REF_W} step={1}
              suffix="px"
              onChange={(v) => setLayout({
                ...layout,
                bar: {
                  ...layout.bar,
                  rect: {
                    ...layout.bar.rect,
                    w: clamp(v, MIN_BAR_LENGTH, LAYOUT_REF_W - layout.bar.rect.x),
                  },
                },
              })} />
            <NumberRow label="Thickness" value={layout.bar.rect.h} min={MIN_BAR_THICKNESS} max={48} step={1}
              suffix="px"
              onChange={(v) => setLayout({
                ...layout,
                bar: {
                  ...layout.bar,
                  rect: {
                    ...layout.bar.rect,
                    h: clamp(v, MIN_BAR_THICKNESS, LAYOUT_REF_H - layout.bar.rect.y),
                  },
                },
              })} />
            <span className="text-[10px] text-white/35">Drag the bar in the preview to reposition; use handles to resize</span>
            <label className="flex items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={layout.bar.rounded}
                onChange={(e) => setLayout({ ...layout, bar: { ...layout.bar, rounded: e.target.checked } })}
              />
              Rounded corners
            </label>
            <OptionalColorInput
              label="Bar color"
              value={layout.bar.color}
              autoLabel="Auto (gauge color)"
              customFallback={gaugeFillColor}
              onChange={(color) => setLayout({ ...layout, bar: { ...layout.bar, color } })}
            />
          </div>
        </Collapsible>
      )}

      <Collapsible title="Text" count={TEXT_ROLES.filter((r) => layout.text[r].visible).length}>
        <div className="flex flex-col gap-2 pt-2">
          {TEXT_ROLES.map((role) => (
            <TextRoleEditor
              key={role}
              role={role}
              element={layout.text[role]}
              derived={derivedTextForRole(role, meta, scaleMax, previewRatio, mergedConfig)}
              defaultColor={resolveTextColor('default', role, gaugeFillColor)}
              onChange={(el) => setLayout({ ...layout, text: { ...layout.text, [role]: el } })}
            />
          ))}
        </div>
      </Collapsible>

      <Collapsible
        title="Frame"
        trailing={panelShape === 'circle'
          ? `⌀ ${Math.round(layout.gaugeRect.w)}`
          : `${Math.round(layout.gaugeRect.w)} × ${Math.round(layout.gaugeRect.h)}`}
      >
        <div className="flex flex-col gap-2 pt-2">
          <NumberRow label="X" value={layout.gaugeRect.x} min={0} max={LAYOUT_REF_W - MIN_RECT_W} step={1}
            onChange={(v) => setLayout({
              ...layout,
              gaugeRect: { ...layout.gaugeRect, x: clamp(v, 0, LAYOUT_REF_W - layout.gaugeRect.w) },
            })} />
          <NumberRow label="Y" value={layout.gaugeRect.y} min={0} max={LAYOUT_REF_H - MIN_RECT_H} step={1}
            onChange={(v) => setLayout({
              ...layout,
              gaugeRect: { ...layout.gaugeRect, y: clamp(v, 0, LAYOUT_REF_H - layout.gaugeRect.h) },
            })} />
          {panelShape === 'circle' ? (
            <NumberRow
              label="Diameter"
              value={layout.gaugeRect.w}
              min={MIN_RECT_W}
              max={Math.min(LAYOUT_REF_W, LAYOUT_REF_H)}
              step={1}
              suffix="px"
              onChange={(v) => {
                const size = clamp(v, MIN_RECT_W, Math.min(LAYOUT_REF_W, LAYOUT_REF_H));
                setLayout({
                  ...layout,
                  gaugeRect: normalizeSquareGaugeRect({ ...layout.gaugeRect, w: size, h: size }),
                });
              }}
            />
          ) : (
            <>
              <NumberRow label="Width" value={layout.gaugeRect.w} min={MIN_RECT_W} max={LAYOUT_REF_W} step={1}
                suffix="px"
                onChange={(v) => setLayout({
                  ...layout,
                  gaugeRect: { ...layout.gaugeRect, w: clamp(v, MIN_RECT_W, LAYOUT_REF_W - layout.gaugeRect.x) },
                })} />
              <NumberRow label="Height" value={layout.gaugeRect.h} min={MIN_RECT_H} max={LAYOUT_REF_H} step={1}
                suffix="px"
                onChange={(v) => setLayout({
                  ...layout,
                  gaugeRect: { ...layout.gaugeRect, h: clamp(v, MIN_RECT_H, LAYOUT_REF_H - layout.gaugeRect.y) },
                })} />
            </>
          )}
          <LabeledSelect
            label="Frame shape"
            value={panelShape === 'pill' ? 'rounded' : panelShape}
            options={FRAME_SHAPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => {
              if (v === 'circle') {
                setLayout({ ...layout, gaugeRect: normalizeSquareGaugeRect(layout.gaugeRect) });
              }
              patchConfig({ cornerStyle: v });
            }}
          />
          <button type="button" className="btn-ghost text-xs self-start" onClick={onResetLayout}>
            Reset layout
          </button>
          <span className="text-[10px] text-white/35">
            {isGps ? 'Restores frame, map area, and text positions' : 'Restores frame, arc geometry, and text positions'}
          </span>
        </div>
      </Collapsible>

      <Collapsible
        title="Video size"
        trailing={`${Math.round(gauge.rect.w * 100)}% × ${Math.round(gauge.rect.h * 100)}%`}
      >
        <div className="flex flex-col gap-2 pt-2">
          <NumberRow
            label="Width"
            value={gauge.rect.w * 100}
            min={4}
            max={100}
            step={0.5}
            suffix="%"
            onChange={(v) => setVideoRect({ w: clamp(v / 100, 0.04, 1 - gauge.rect.x) })}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/50 w-16 shrink-0">Height</span>
            <span className="flex-1 text-xs font-mono text-white/60">
              {Number((gauge.rect.h * 100).toFixed(1))}%
            </span>
          </div>
          <span className="text-[10px] text-white/35">Height is derived from width and layout aspect.</span>
          <NumberRow
            label="X"
            value={gauge.rect.x * 100}
            min={0}
            max={100}
            step={0.5}
            suffix="%"
            onChange={(v) => setVideoRect({ x: clamp(v / 100, 0, 1 - gauge.rect.w) })}
          />
          <NumberRow
            label="Y"
            value={gauge.rect.y * 100}
            min={0}
            max={100}
            step={0.5}
            suffix="%"
            onChange={(v) => setVideoRect({ y: clamp(v / 100, 0, 1 - gauge.rect.h) })}
          />
        </div>
      </Collapsible>

      <Collapsible title="Appearance">
        <div className="flex flex-col gap-3 pt-2">
          {isGps ? (
            <>
              <ColorInput label="Trail color" value={trailColor} onChange={(v) => patchConfig({ trailColor: v })} />
              <ColorInput label="Cursor color" value={cursorColor} onChange={(v) => patchConfig({ cursorColor: v })} />
            </>
          ) : (
            <ColorInput label="Accent color" value={accentColor} onChange={(v) => patchConfig({ color: v })} />
          )}
          <LabeledSelect label="Font" value={fontFamily} options={FONT_OPTIONS}
            onChange={(v) => patchConfig({ fontFamily: v })} />
          <NumberRow label="Panel opacity" value={Number(mergedConfig.panelOpacity ?? 0.65)}
            min={0} max={1} step={0.05}
            onChange={(v) => patchConfig({ panelOpacity: v })} />
        </div>
      </Collapsible>

      <hr className="border-white/10" />
      {onSaveTemplate && isDataGaugePlugin(plugin.id) && (
        <button type="button" className="btn-ghost text-xs" onClick={onSaveTemplate}>
          Save as template…
        </button>
      )}
      <button type="button" className="btn-ghost text-red-300 hover:text-red-200" onClick={onRemove}>
        Remove gauge
      </button>
    </div>
  );
}

function FieldSelect({
  value,
  options,
  onChange,
}: {
  value: TelemetryField;
  options: ReturnType<typeof collectFieldOptions>;
  onChange: (field: TelemetryField) => void;
}) {
  const fit = options.filter((o) => o.group === 'fit');
  const camera = options.filter((o) => o.group === 'camera');
  if (options.length === 0) {
    return <p className="text-xs text-white/40">Load FIT or camera telemetry to pick a field.</p>;
  }
  return (
    <div className="relative z-20 flex flex-col gap-1">
      <label className="field-label">Data field</label>
      <select className="select-input" value={value} onChange={(e) => onChange(e.target.value as TelemetryField)}>
        {fit.length > 0 && (
          <optgroup label="FIT">
            {fit.map((o) => (
              <option key={`${o.field}-${o.trackId}`} value={o.field}>
                {fieldLabel(o.field)} — {o.trackLabel}
              </option>
            ))}
          </optgroup>
        )}
        {camera.length > 0 && (
          <optgroup label="Camera">
            {camera.map((o) => (
              <option key={`${o.field}-${o.trackId}`} value={o.field}>
                {fieldLabel(o.field)} — {o.trackLabel}
              </option>
            ))}
          </optgroup>
        )}
      </select>
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
    <div className="relative z-20 flex flex-col gap-1">
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
  const decimals = step < 1 ? (String(step).includes('.') ? String(step).split('.')[1]!.length : 2) : 0;
  const display = decimals > 0 ? Number(value.toFixed(decimals)) : Math.round(value);
  const apply = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    onChange(max != null ? clamp(parsed, min, max) : Math.max(min, parsed));
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-white/50 w-16 shrink-0">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={display}
        onChange={(e) => apply(e.target.value)}
        className="flex-1 min-w-0 bg-white/5 rounded px-2 py-1 text-xs border border-white/10 font-mono"
      />
      {suffix && <span className="text-xs text-white/40 shrink-0">{suffix}</span>}
    </div>
  );
}

function ScaleMaxRow({ meta, config, value, onChange }: {
  meta: NonNullable<ReturnType<typeof gaugeEditorMeta>>;
  config: Record<string, unknown>;
  value: number;
  onChange: (v: number) => void;
}) {
  const range = meta.getScaleMaxRange?.(config) ?? meta.scaleMaxRange;
  const unitLabel = meta.getUnit?.(config) ?? meta.unit;
  const decimals = range.step < 1 ? 1 : 0;
  return (
    <div className="flex flex-col gap-1">
      <label className="field-label">Max value</label>
      <div className="flex items-center gap-2">
        <input type="number" min={0} step={range.step}
          value={Number(value.toFixed(decimals))}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="flex-1 min-w-0 bg-white/5 rounded px-2 py-1 text-xs border border-white/10 font-mono" />
        <span className="text-xs text-white/40 shrink-0">{unitLabel}</span>
      </div>
    </div>
  );
}

function DegreeRow({ label, value, end, which, onChange }: {
  label: string; value: number; end: number; which: 'start' | 'end';
  onChange: (deg: number) => void;
}) {
  const setDeg = (raw: number) => {
    const v = wrap360(raw);
    const minGap = 30;
    if (which === 'start') {
      const ok = ((end - v + 360) % 360) >= minGap;
      onChange(ok ? v : wrap360(end - minGap));
    } else {
      const ok = ((v - end + 360) % 360) >= minGap;
      onChange(ok ? v : wrap360(end + minGap));
    }
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-white/50 w-16">{label}</span>
      <input type="number" min={0} max={359} step={1} value={Math.round(value)}
        onChange={(e) => setDeg(Number(e.target.value))}
        className="flex-1 min-w-0 bg-white/5 rounded px-2 py-1 text-xs border border-white/10 font-mono" />
    </div>
  );
}


function TextRoleEditor({ role, element, derived, defaultColor, onChange }: {
  role: TextRole; element: TextElement; derived: string; defaultColor: string;
  onChange: (el: TextElement) => void;
}) {
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  return (
    <div className={`border border-white/10 rounded-md p-2 ${element.visible ? '' : 'opacity-60 bg-white/[0.02]'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold flex-1">{roleLabel}</span>
        <label className="flex items-center gap-1.5 text-xs text-white/50">
          <input type="checkbox" checked={element.visible}
            onChange={(e) => onChange({ ...element, visible: e.target.checked })} />
          shown
        </label>
      </div>
      {element.visible && (
        <div className="flex flex-col gap-2">
          <input type="text" placeholder={derived} value={element.textOverride}
            onChange={(e) => onChange({ ...element, textOverride: e.target.value })}
            className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10" />
          <OptionalColorInput
            label="Color"
            value={element.color}
            autoLabel="Default"
            customFallback={defaultColor}
            onChange={(color) => onChange({ ...element, color })}
          />
          <NumberRow label="Size" value={element.fontSize}
            min={1} step={1}
            suffix="px"
            onChange={(v) => onChange({ ...element, fontSize: v })} />
          <span className="text-[10px] text-white/35 font-mono">
            x: {Math.round(element.pos.x)} · y: {Math.round(element.pos.y)}
          </span>
        </div>
      )}
    </div>
  );
}

const FRAME_SHAPE_OPTIONS = [
  { value: 'rounded', label: 'Rounded rectangle' },
  { value: 'square', label: 'Square' },
  { value: 'circle', label: 'Circle' },
] as const;

const GRADIENT_PRESETS: { id: string; label: string; preset: FillGradientConfig; plugins?: string[]; fields?: TelemetryField[] }[] = [
  { id: 'hr', label: 'Heart rate', preset: HR_GRADIENT_PRESET, plugins: ['builtin:hr'], fields: ['hr'] },
  { id: 'power', label: 'Power zones', preset: POWER_GRADIENT_PRESET, plugins: ['builtin:power'], fields: ['power'] },
  { id: 'speed', label: 'Speed', preset: SPEED_GRADIENT_PRESET, plugins: ['builtin:speedometer'], fields: ['speed'] },
  {
    id: 'blue-red',
    label: 'Blue → red',
    preset: {
      enabled: true,
      stops: [{ pos: 0, color: '#3b82f6' }, { pos: 1, color: '#ef4444' }],
    },
  },
];

function FillGradientEditor({
  pluginId,
  field,
  value,
  onChange,
}: {
  pluginId: string;
  field?: TelemetryField;
  value: FillGradientConfig;
  onChange: (next: FillGradientConfig) => void;
}) {
  const stops = normalizeGradientStops(value.stops);
  const sortedPresets = [
    ...GRADIENT_PRESETS.filter((p) => p.plugins?.includes(pluginId) || (field && p.fields?.includes(field))),
    ...GRADIENT_PRESETS.filter((p) => !p.plugins?.includes(pluginId) && !(field && p.fields?.includes(field))),
  ];

  const patchStops = (nextStops: FillGradientStop[]) => {
    onChange({ ...value, stops: normalizeGradientStops(nextStops) });
  };

  const updateStop = (index: number, patch: Partial<FillGradientStop>) => {
    const next = stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
    patchStops(next);
  };

  const addStop = () => {
    const pos = stops.length >= 2
      ? (stops[stops.length - 2].pos + stops[stops.length - 1].pos) / 2
      : 0.5;
    patchStops([...stops, { pos, color: '#ffffff' }].sort((a, b) => a.pos - b.pos));
  };

  const removeStop = (index: number) => {
    if (stops.length <= 2) return;
    patchStops(stops.filter((_, i) => i !== index));
  };

  return (
    <Collapsible title="Fill gradient" trailing={value.enabled ? `${stops.length} stops` : 'Off'}>
      <div className="flex flex-col gap-3 pt-2">
        <label className="flex items-center gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          />
          Use gradual color gradient on bar/arc fill
        </label>
        <p className="text-[10px] text-white/35 leading-relaxed">
          Colors blend smoothly from min (left/start) to max (right/end). Value text follows the color at the current reading.
        </p>
        {value.enabled && (
          <>
            <div
              className="h-3 rounded-full border border-white/10"
              style={{
                background: `linear-gradient(to right, ${stops.map((s) => `${s.color} ${s.pos * 100}%`).join(', ')})`,
              }}
            />
            <div className="flex flex-wrap gap-1.5">
              {sortedPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="btn-ghost text-[10px] px-2 py-0.5"
                  onClick={() => onChange({ ...preset.preset, enabled: true })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {stops.map((stop, index) => (
                <div key={index} className="flex items-center gap-2 border border-white/10 rounded-md p-2">
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/45 w-8 shrink-0">Pos</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(stop.pos * 100)}
                        onChange={(e) => {
                          const pct = Number(e.target.value);
                          if (Number.isNaN(pct)) return;
                          updateStop(index, { pos: clamp(pct, 0, 100) / 100 });
                        }}
                        className="flex-1 min-w-0 bg-white/5 rounded px-2 py-1 text-xs border border-white/10 font-mono"
                      />
                      <span className="text-xs text-white/40 shrink-0">%</span>
                    </div>
                    <ColorInput
                      label="Color"
                      value={stop.color}
                      onChange={(color) => updateStop(index, { color })}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-ghost text-[10px] text-red-300 shrink-0 self-start"
                    disabled={stops.length <= 2}
                    onClick={() => removeStop(index)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost text-xs self-start" onClick={addStop}>
              Add color stop
            </button>
          </>
        )}
      </div>
    </Collapsible>
  );
}
