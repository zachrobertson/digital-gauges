import { useMemo, useState } from 'react';
import type { ArcElement, BarElement, GaugeElement, GaugeElementKind, MapElement, MarkerStyle, TextIcon, TextSlot } from '@shared/types/gaugeElement';
import type { FillGradientConfig } from '@shared/types/fillGradient';
import type { TelemetryField } from '@shared/types';
import { defaultConfigForField } from '../../gauges/fieldRegistry';
import {
  derivedTextForRole,
  elementEditorMeta,
  fieldLabel,
  mergeElementFieldConfig,
  previewGaugeFillColor,
  DISTANCE_UNIT_OPTIONS,
  SPEED_UNIT_OPTIONS,
} from '../../gauges/gaugeEditorAdapter';
import type { GaugeEditorMeta } from '../../gauges/gaugeEditorAdapter';
import type { GaugePlugin } from '@shared/types';
import {
  clamp,
  LAYOUT_REF_H,
  LAYOUT_REF_W,
  MAX_ARC_RADIUS,
  MAX_ARC_TRACK_WIDTH,
  MIN_ARC_TRACK_WIDTH,
  MIN_BAR_LENGTH,
  MIN_BAR_THICKNESS,
  MIN_MAP_SIZE,
  arcTrackWidth,
  resolveTextColor,
  type GaugeLayoutConfig,
} from '../../gauges/gaugeEditorLayout';
import {
  addElement,
  applyBoundsMove,
  createElement,
  duplicateElement,
  ELEMENT_KIND_LABELS,
  patchElementsById,
  removeElement,
  updateElement,
} from '../../lib/gaugeElementFactory';
import { primarySelection, selectOne } from '../../lib/elementSelection';
import { ElementLayersPanel } from './ElementLayersPanel';
import { collectFieldOptions } from '../../lib/gaugeFactory';
import { resolveShowScaleLabels, resolveArcTickCount, resolveShowArcTicks, MIN_ARC_TICK_COUNT, MAX_ARC_TICK_COUNT } from '../../gauges/barGaugeSchema';
import { defaultFillGradientForField, resolveElementFillGradient } from '../../gauges/gaugeGradient';
import { ColorInput, OptionalColorInput } from './ColorInput';
import { FillGradientEditor } from './FillGradientEditor';
import {
  DEFAULT_FINISH_MARKER_COLOR,
  DEFAULT_MARKER_LENGTH,
  DEFAULT_MARKER_WIDTH,
  DEFAULT_START_MARKER_COLOR,
} from '../../gauges/gpsMapDraw';
import { TEXT_ICON_OPTIONS } from '../../gauges/textIcons';
import type { CourseSettings } from '@shared/types';
import type { TelemetryTrack } from '@shared/types';

interface Props {
  plugin: GaugePlugin;
  layout: GaugeLayoutConfig;
  mergedConfig: Record<string, unknown>;
  selectedElementIds: string[];
  onSelectElements: (ids: string[]) => void;
  onLayoutChange: (layout: GaugeLayoutConfig) => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
  previewRatio: number;
  projectTracks: TelemetryTrack[];
  course?: CourseSettings | null;
  gpsAvailable: boolean;
}

export function ElementEditorPanel({
  plugin,
  layout,
  mergedConfig,
  selectedElementIds,
  onSelectElements,
  onLayoutChange,
  onConfigChange,
  previewRatio,
  projectTracks,
  course,
  gpsAvailable,
}: Props) {
  const fieldOptions = useMemo(
    () => collectFieldOptions(projectTracks, course),
    [projectTracks, course],
  );

  const primaryId = primarySelection(selectedElementIds);
  const selected = layout.elements.find((e) => e.id === primaryId) ?? null;
  const selectedMeta = elementEditorMeta(selected);
  const multiSelect = selectedElementIds.length > 1;

  const patchLayout = (next: GaugeLayoutConfig) => onLayoutChange(next);

  const patchElement = (id: string, patch: Partial<GaugeElement>) => {
    patchLayout({
      ...layout,
      elements: updateElement(layout.elements, id, patch),
    });
  };

  const duplicateSelection = (offset = 12) => {
    const newIds: string[] = [];
    let next = [...layout.elements];
    for (const id of selectedElementIds) {
      const el = next.find((e) => e.id === id);
      if (!el) continue;
      const dup = duplicateElement(el);
      const moved = { ...dup, ...applyBoundsMove(dup, offset, offset) } as GaugeElement;
      newIds.push(moved.id);
      next = addElement(next, moved);
    }
    patchLayout({ ...layout, elements: next });
    if (newIds.length > 0) onSelectElements(newIds);
  };

  const deleteSelection = () => {
    const maxDeletable = Math.max(0, layout.elements.length - 1);
    const toDelete = selectedElementIds.slice(0, maxDeletable);
    let next = layout.elements;
    for (const id of toDelete) {
      next = removeElement(next, id);
    }
    const remaining = selectedElementIds.filter((id) => !toDelete.includes(id));
    patchLayout({ ...layout, elements: next });
    onSelectElements(remaining.length > 0 ? remaining : [next[0]!.id]);
  };

  const setSelectionVisibility = (visible: boolean) => {
    patchLayout({
      ...layout,
      elements: patchElementsById(layout.elements, selectedElementIds, () => ({ visible })),
    });
  };

  const addKind = (kind: GaugeElementKind) => {
    const field = (selected && 'field' in selected ? selected.field : 'speed') as TelemetryField;
    const el = createElement(kind, layout.gaugeRect, field);
    const next = addElement(layout.elements, el);
    patchLayout({ ...layout, elements: next });
    onSelectElements(selectOne(el.id));
  };

  return (
    <div className="flex flex-col gap-3 relative isolate">
      {multiSelect && (
        <div className="border border-accent/40 rounded-md p-2 flex flex-wrap items-center gap-2 bg-accent/10">
          <span className="text-xs text-white/80 flex-1">{selectedElementIds.length} selected</span>
          <button type="button" className="btn-ghost text-[10px]" onClick={() => duplicateSelection()}>Duplicate</button>
          <button
            type="button"
            className="btn-ghost text-[10px] text-red-300"
            disabled={layout.elements.length - selectedElementIds.length < 1 && selectedElementIds.length >= layout.elements.length}
            onClick={deleteSelection}
          >
            Delete
          </button>
        </div>
      )}
      <ElementLayersPanel
        layout={layout}
        selectedElementIds={selectedElementIds}
        onSelectElements={onSelectElements}
        onLayoutChange={patchLayout}
        onAddKind={addKind}
        gpsAvailable={gpsAvailable}
      />

      {multiSelect ? (
        <MultiElementProperties
          count={selectedElementIds.length}
          onSetVisible={setSelectionVisibility}
          onDuplicate={() => duplicateSelection()}
          onDelete={deleteSelection}
          canDelete={layout.elements.length > 1}
        />
      ) : selected ? (
        <ElementProperties
          plugin={plugin}
          element={selected}
          meta={selectedMeta}
          mergedConfig={mergedConfig}
          course={course}
          previewRatio={previewRatio}
          gaugeFillColor={previewGaugeFillColor(plugin, mergedConfig, previewRatio, selected)}
          fieldOptions={fieldOptions}
          onPatch={(patch) => patchElement(selected.id, patch)}
          onConfigChange={onConfigChange}
        />
      ) : null}
    </div>
  );
}

function patchFieldDefaults(
  field: TelemetryField,
  onPatch: (patch: Partial<GaugeElement>) => void,
  onConfigChange: (patch: Record<string, unknown>) => void,
) {
  const defaults = defaultConfigForField(field);
  const fillGradient = defaultFillGradientForField(field);
  onPatch({
    field,
    ...(fillGradient ? { fillGradient } : {}),
  } as Partial<GaugeElement>);
  onConfigChange({
    color: defaults.color,
    scaleMax: defaults.scaleMax,
    maxSpeedKmh: defaults.maxSpeedKmh,
    maxHr: defaults.maxHr,
    maxCadence: defaults.maxCadence,
    ftp: defaults.ftp,
    units: defaults.units,
    distanceUnits: defaults.distanceUnits,
  });
}

function BarArcColorsSection({
  plugin,
  element,
  gaugeFillColor,
  fillGradient,
  onPatch,
}: {
  plugin: GaugePlugin;
  element: BarElement | ArcElement;
  gaugeFillColor: string;
  fillGradient: FillGradientConfig;
  onPatch: (patch: Partial<GaugeElement>) => void;
}) {
  const label = element.kind === 'bar' ? 'Bar color' : 'Arc color';
  const colorValue = element.kind === 'bar' ? element.color : (element.color ?? 'default');

  return (
    <>
      <OptionalColorInput
        label={label}
        value={colorValue}
        autoLabel="Auto (field color)"
        customFallback={gaugeFillColor}
        onChange={(color) => onPatch({ color })}
      />
      <FillGradientEditor
        pluginId={plugin.id}
        field={element.field}
        value={fillGradient}
        onChange={(next) => onPatch({ fillGradient: next })}
      />
    </>
  );
}

function MultiElementProperties({
  count,
  onSetVisible,
  onDuplicate,
  onDelete,
  canDelete,
}: {
  count: number;
  onSetVisible: (visible: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <div className="border border-white/10 rounded-md p-3 flex flex-col gap-3">
      <span className="text-xs font-semibold">{count} elements selected</span>
      <p className="text-[10px] text-white/45 leading-snug">
        Arrow keys nudge · Shift+arrow nudges by grid · Del removes · Ctrl+D duplicates · Esc clears selection.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => onSetVisible(true)}>Show all</button>
        <button type="button" className="btn-ghost text-xs" onClick={() => onSetVisible(false)}>Hide all</button>
        <button type="button" className="btn-ghost text-xs" onClick={onDuplicate}>Duplicate (+12 px)</button>
        <button type="button" className="btn-ghost text-xs text-red-300 disabled:opacity-40" disabled={!canDelete} onClick={onDelete}>
          Delete selected
        </button>
      </div>
    </div>
  );
}

function ElementProperties({
  plugin,
  element,
  meta,
  mergedConfig,
  course,
  previewRatio,
  gaugeFillColor,
  fieldOptions,
  onPatch,
  onConfigChange,
}: {
  plugin: GaugePlugin;
  element: GaugeElement;
  meta: GaugeEditorMeta | null;
  mergedConfig: Record<string, unknown>;
  course?: CourseSettings | null;
  previewRatio: number;
  gaugeFillColor: string;
  fieldOptions: ReturnType<typeof collectFieldOptions>;
  onPatch: (patch: Partial<GaugeElement>) => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  const fieldConfig = mergeElementFieldConfig(mergedConfig, element);
  const scaleMax = meta?.getScaleMax(fieldConfig) ?? 0;
  const showScaleLabels = resolveShowScaleLabels(mergedConfig as { showScaleLabels?: boolean });
  const showArcTicks = resolveShowArcTicks(mergedConfig as { showArcTicks?: boolean });
  const arcTickCount = resolveArcTickCount(mergedConfig as { arcTickCount?: number });
  const hasDataSection = element.kind === 'bar' || element.kind === 'arc' || element.kind === 'text';
  const fillGradient = resolveElementFillGradient(element, mergedConfig);
  const locked = element.locked ?? false;
  const snapToGrid = element.snapToGrid !== false;

  const dataSection = hasDataSection && (
    <>
      <FieldSelect
        value={element.field}
        options={fieldOptions}
        onChange={(field) => patchFieldDefaults(field, onPatch, onConfigChange)}
      />
      <SpeedUnitsRow
        element={element}
        mergedConfig={mergedConfig}
        onPatch={onPatch}
        onConfigChange={onConfigChange}
      />
      <DistanceUnitsRow
        element={element}
        mergedConfig={mergedConfig}
        onPatch={onPatch}
        onConfigChange={onConfigChange}
      />
      {meta && (element.kind === 'bar' || element.kind === 'arc' || element.kind === 'text') && (
        <ScaleMaxRow
          meta={meta}
          config={fieldConfig}
          value={scaleMax}
          onChange={(v) => onConfigChange(meta.patchScaleMax(fieldConfig, v))}
        />
      )}
    </>
  );

  const sizeSection = (
    <>
      {element.kind === 'bar' && meta && (
        <RectEditor
          label="Bar"
          rect={element.rect}
          minW={MIN_BAR_LENGTH}
          minH={MIN_BAR_THICKNESS}
          onChange={(rect) => onPatch({ rect } as Partial<GaugeElement>)}
        />
      )}
      {element.kind === 'arc' && meta && (
        <>
          <NumberRow label="Center X" value={element.center.x} min={0} max={LAYOUT_REF_W} step={1}
            onChange={(v) => onPatch({ center: { ...element.center, x: clamp(v, 0, LAYOUT_REF_W) } })} />
          <NumberRow label="Center Y" value={element.center.y} min={0} max={LAYOUT_REF_H} step={1}
            onChange={(v) => onPatch({ center: { ...element.center, y: clamp(v, 0, LAYOUT_REF_H) } })} />
          <NumberRow label="Radius" value={element.radius} min={8} max={MAX_ARC_RADIUS} step={1} suffix="px"
            onChange={(v) => onPatch({ radius: clamp(v, 8, MAX_ARC_RADIUS) })} />
          <NumberRow
            label="Track width"
            value={element.trackWidth ?? arcTrackWidth(element.radius)}
            min={MIN_ARC_TRACK_WIDTH}
            max={MAX_ARC_TRACK_WIDTH}
            step={1}
            suffix="px"
            onChange={(v) => onPatch({ trackWidth: clamp(v, MIN_ARC_TRACK_WIDTH, MAX_ARC_TRACK_WIDTH) })}
          />
          <DegreeRow label="Start" value={element.startDeg} end={element.endDeg} which="start"
            onChange={(deg) => onPatch({ startDeg: deg })} />
          <DegreeRow label="End" value={element.endDeg} end={element.startDeg} which="end"
            onChange={(deg) => onPatch({ endDeg: deg })} />
        </>
      )}
      {element.kind === 'text' && meta && (
        <div className="flex flex-col gap-2">
          <TextSlotPositionEditor role="value" slot={element.value} onChange={(s) => onPatch({ value: s })} />
          <TextSlotPositionEditor role="unit" slot={element.unit} onChange={(s) => onPatch({ unit: s })} />
        </div>
      )}
      {element.kind === 'map' && (
        <RectEditor label="Map" rect={element.rect} minW={MIN_MAP_SIZE} minH={MIN_MAP_SIZE}
          onChange={(rect) => onPatch({ rect })} />
      )}
      {element.kind === 'staticText' && (
        <>
          <NumberRow label="X" value={element.pos.x} min={0} max={LAYOUT_REF_W} step={1}
            onChange={(v) => onPatch({ pos: { ...element.pos, x: v } })} />
          <NumberRow label="Y" value={element.pos.y} min={0} max={LAYOUT_REF_H} step={1}
            onChange={(v) => onPatch({ pos: { ...element.pos, y: v } })} />
        </>
      )}
      {element.kind === 'image' && (
        <>
          <NumberRow label="X" value={element.pos.x} min={0} max={LAYOUT_REF_W} step={1}
            onChange={(v) => onPatch({ pos: { ...element.pos, x: v } })} />
          <NumberRow label="Y" value={element.pos.y} min={0} max={LAYOUT_REF_H} step={1}
            onChange={(v) => onPatch({ pos: { ...element.pos, y: v } })} />
          <NumberRow label="Size" value={element.size} min={4} max={200} step={1} suffix="px"
            onChange={(v) => onPatch({ size: v })} />
        </>
      )}
    </>
  );

  const colorsSection = (element.kind === 'bar' || element.kind === 'arc') && (
    <BarArcColorsSection
      plugin={plugin}
      element={element}
      gaugeFillColor={gaugeFillColor}
      fillGradient={fillGradient}
      onPatch={onPatch}
    />
  );

  const styleSection = (
    <>
      {element.kind === 'bar' && meta && (
        <label className="flex items-center gap-2 text-xs text-white/70">
          <input type="checkbox" checked={element.rounded} onChange={(e) => onPatch({ rounded: e.target.checked })} />
          Rounded corners
        </label>
      )}
      {element.kind === 'arc' && meta && (
        <>
          <label className="flex items-center gap-2 text-xs text-white/70">
            <input type="checkbox" checked={element.showScaleLabels ?? showScaleLabels}
              onChange={(e) => onPatch({ showScaleLabels: e.target.checked })} />
            Show scale labels
          </label>
          <label className="flex items-center gap-2 text-xs text-white/70">
            <input type="checkbox" checked={element.showArcTicks ?? showArcTicks}
              onChange={(e) => onPatch({ showArcTicks: e.target.checked })} />
            Show hash marks
          </label>
          {(element.showArcTicks ?? showArcTicks) && (
            <NumberRow label="Hash marks" value={element.arcTickCount ?? arcTickCount}
              min={MIN_ARC_TICK_COUNT} max={MAX_ARC_TICK_COUNT} step={1}
              onChange={(v) => onPatch({ arcTickCount: Math.round(v) })} />
          )}
        </>
      )}
      {element.kind === 'map' && (
        <>
          <ColorInput label="Trail color" value={element.trailColor ?? String(mergedConfig.trailColor ?? '#3ddc97')}
            onChange={(v) => onPatch({ trailColor: v })} />
          <ColorInput label="Cursor color" value={element.cursorColor ?? String(mergedConfig.cursorColor ?? '#ffffff')}
            onChange={(v) => onPatch({ cursorColor: v })} />
        </>
      )}
      {element.kind === 'staticText' && (
        <>
          <NumberRow label="Size" value={element.fontSize} min={6} max={120} step={1} suffix="px"
            onChange={(v) => onPatch({ fontSize: v })} />
          <OptionalColorInput label="Color" value={element.color} autoLabel="Default" customFallback={gaugeFillColor}
            onChange={(color) => onPatch({ color })} />
        </>
      )}
      {element.kind === 'image' && (
        <>
          {element.source.type === 'builtin' && (
            <LabeledSelect
              label="Icon"
              value={element.source.icon}
              options={TEXT_ICON_OPTIONS.filter((o) => o.value !== 'none').map((o) => ({ value: o.value, label: o.label }))}
              onChange={(v) => onPatch({ source: { type: 'builtin', icon: v as TextIcon } })}
            />
          )}
          <OptionalColorInput label="Color" value={element.color} autoLabel="Default" customFallback={gaugeFillColor}
            onChange={(color) => onPatch({ color })} />
        </>
      )}
    </>
  );

  return (
    <div className="border border-white/10 rounded-md p-3 flex flex-col gap-3 relative isolate">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{ELEMENT_KIND_LABELS[element.kind]}</span>
        <div className="flex items-center gap-3 text-xs text-white/50">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={element.visible}
              onChange={(e) => onPatch({ visible: e.target.checked })}
            />
            visible
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={locked}
              onChange={(e) => onPatch({ locked: e.target.checked })}
            />
            locked
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={(e) => onPatch({ snapToGrid: e.target.checked })}
            />
            snap
          </label>
        </div>
      </div>

      {hasDataSection && (
        <InspectorSection title="Data">{dataSection}</InspectorSection>
      )}
      {hasTextSection(element, meta) && (
        <InspectorSection title="Text">
          <ElementTextSection
            element={element}
            meta={meta}
            fieldConfig={fieldConfig}
            previewRatio={previewRatio}
            gaugeFillColor={gaugeFillColor}
            scaleMax={scaleMax}
            onPatch={onPatch}
          />
        </InspectorSection>
      )}
      {colorsSection && (
        <InspectorSection title="Colors">{colorsSection}</InspectorSection>
      )}
      <InspectorSection title="Size & position">{sizeSection}</InspectorSection>
      <InspectorSection title="Style">{styleSection}</InspectorSection>
      {element.kind === 'map' && (
        <InspectorSection title="Start & finish lines">
          <MapMarkerSection
            element={element as MapElement}
            mergedConfig={mergedConfig}
            course={course}
            onPatch={onPatch as (patch: Partial<MapElement>) => void}
          />
        </InspectorSection>
      )}
    </div>
  );
}

const MARKER_STYLE_OPTIONS: { value: MarkerStyle; label: string }[] = [
  { value: 'line', label: 'Checkered line' },
  { value: 'flag', label: 'Checkered flag' },
];

function resolveMapMarkerShow(
  element: MapElement,
  mergedConfig: Record<string, unknown>,
  which: 'start' | 'finish',
): boolean {
  const legacy = mergedConfig.showCourseMarkers as boolean | undefined;
  if (which === 'start') {
    return element.showCourseStart ?? (mergedConfig.showCourseStart as boolean | undefined) ?? legacy ?? true;
  }
  return element.showCourseFinish ?? (mergedConfig.showCourseFinish as boolean | undefined) ?? legacy ?? true;
}

function MapMarkerSection({
  element,
  mergedConfig,
  course,
  onPatch,
}: {
  element: MapElement;
  mergedConfig: Record<string, unknown>;
  course?: CourseSettings | null;
  onPatch: (patch: Partial<MapElement>) => void;
}) {
  const showStart = resolveMapMarkerShow(element, mergedConfig, 'start');
  const showFinish = resolveMapMarkerShow(element, mergedConfig, 'finish');
  const startStyle = (element.startMarkerStyle ?? mergedConfig.startMarkerStyle ?? 'line') as MarkerStyle;
  const finishStyle = (element.finishMarkerStyle ?? mergedConfig.finishMarkerStyle ?? 'line') as MarkerStyle;
  const startColor = element.startMarkerColor
    ?? String(mergedConfig.startMarkerColor ?? DEFAULT_START_MARKER_COLOR);
  const finishColor = element.finishMarkerColor
    ?? String(mergedConfig.finishMarkerColor ?? DEFAULT_FINISH_MARKER_COLOR);
  const markerLength = element.markerLength
    ?? (typeof mergedConfig.markerLength === 'number' ? mergedConfig.markerLength : DEFAULT_MARKER_LENGTH);
  const markerWidth = element.markerWidth
    ?? (typeof mergedConfig.markerWidth === 'number' ? mergedConfig.markerWidth : DEFAULT_MARKER_WIDTH);
  const hasStartPos = course?.startDistanceM != null;
  const hasFinishPos = course?.finishDistanceM != null;

  return (
    <div className="flex flex-col gap-3">
      {!hasStartPos && !hasFinishPos && (
        <p className="text-[10px] text-white/45 leading-snug">
          Set where the lines appear using the Course section on the Sync timeline (distance or playhead).
        </p>
      )}
      <MarkerEndControls
        role="Start"
        show={showStart}
        style={startStyle}
        color={startColor}
        positionSet={hasStartPos}
        onShowChange={(show) => onPatch({ showCourseStart: show })}
        onStyleChange={(style) => onPatch({ startMarkerStyle: style })}
        onColorChange={(color) => onPatch({ startMarkerColor: color })}
      />
      <MarkerEndControls
        role="Finish"
        show={showFinish}
        style={finishStyle}
        color={finishColor}
        positionSet={hasFinishPos}
        onShowChange={(show) => onPatch({ showCourseFinish: show })}
        onStyleChange={(style) => onPatch({ finishMarkerStyle: style })}
        onColorChange={(color) => onPatch({ finishMarkerColor: color })}
      />
      <NumberRow
        label="Marker length"
        value={markerLength}
        min={6}
        max={240}
        step={1}
        suffix="px"
        onChange={(v) => onPatch({ markerLength: Math.round(v) })}
      />
      <NumberRow
        label="Marker thickness"
        value={markerWidth}
        min={4}
        max={200}
        step={1}
        suffix="px"
        onChange={(v) => onPatch({ markerWidth: Math.round(v) })}
      />
    </div>
  );
}

function MarkerEndControls({
  role,
  show,
  style,
  color,
  positionSet,
  onShowChange,
  onStyleChange,
  onColorChange,
}: {
  role: 'Start' | 'Finish';
  show: boolean;
  style: MarkerStyle;
  color: string;
  positionSet: boolean;
  onShowChange: (show: boolean) => void;
  onStyleChange: (style: MarkerStyle) => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border border-white/10 rounded-md p-2">
      <label className="flex items-center gap-2 text-xs text-white/70">
        <input type="checkbox" checked={show} onChange={(e) => onShowChange(e.target.checked)} />
        Show {role.toLowerCase()} marker
      </label>
      {show && (
        <>
          <LabeledSelect
            label="Style"
            value={style}
            options={MARKER_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(v) => onStyleChange(v as MarkerStyle)}
          />
          <ColorInput label="Color" value={color} onChange={onColorChange} />
          {!positionSet && (
            <p className="text-[10px] text-amber-200/70 leading-snug">
              {role} position not set yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-white/10 rounded-md">
      <button
        type="button"
        className="w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/60"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        <span className="text-white/35">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5 flex flex-col gap-2 relative">{children}</div>}
    </div>
  );
}

function hasTextSection(element: GaugeElement, meta: GaugeEditorMeta | null): boolean {
  return element.kind === 'staticText' || (element.kind === 'text' && meta != null);
}

function SpeedUnitsRow({
  element,
  mergedConfig,
  onPatch,
  onConfigChange,
}: {
  element: GaugeElement;
  mergedConfig: Record<string, unknown>;
  onPatch: (patch: Partial<GaugeElement>) => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  if (element.kind !== 'bar' && element.kind !== 'arc' && element.kind !== 'text') return null;
  if (element.field !== 'speed') return null;
  const units = element.units ?? mergedConfig.units ?? 'kmh';
  return (
    <LabeledSelect
      label="Speed units"
      value={String(units)}
      options={SPEED_UNIT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      onChange={(v) => {
        onPatch({ units: v as 'kmh' | 'mph' } as Partial<GaugeElement>);
        onConfigChange({ units: v });
      }}
    />
  );
}

function DistanceUnitsRow({
  element,
  mergedConfig,
  onPatch,
  onConfigChange,
}: {
  element: GaugeElement;
  mergedConfig: Record<string, unknown>;
  onPatch: (patch: Partial<GaugeElement>) => void;
  onConfigChange: (patch: Record<string, unknown>) => void;
}) {
  if (element.kind !== 'bar' && element.kind !== 'arc' && element.kind !== 'text') return null;
  if (element.field !== 'distance' && element.field !== 'distanceToFinish') return null;
  const distanceUnits = element.distanceUnits ?? mergedConfig.distanceUnits ?? 'km';
  return (
    <LabeledSelect
      label="Distance units"
      value={String(distanceUnits)}
      options={DISTANCE_UNIT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      onChange={(v) => {
        onPatch({ distanceUnits: v as 'km' | 'mi' } as Partial<GaugeElement>);
        onConfigChange({ distanceUnits: v });
      }}
    />
  );
}

function ElementTextSection({
  element,
  meta,
  fieldConfig,
  previewRatio,
  gaugeFillColor,
  scaleMax,
  onPatch,
}: {
  element: GaugeElement;
  meta: GaugeEditorMeta | null;
  fieldConfig: Record<string, unknown>;
  previewRatio: number;
  gaugeFillColor: string;
  scaleMax: number;
  onPatch: (patch: Partial<GaugeElement>) => void;
}) {
  if (element.kind === 'staticText') {
    return (
      <div className="flex flex-col gap-1">
        <label className="field-label">Content</label>
        <input
          type="text"
          value={element.text}
          onChange={(e) => onPatch({ text: e.target.value })}
          className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10"
        />
      </div>
    );
  }

  if (element.kind === 'text' && meta) {
    return (
      <>
        <TextSlotStyleEditor
          role="value"
          slot={element.value}
          derived={derivedTextForRole('value', meta, scaleMax, previewRatio, fieldConfig)}
          defaultColor={resolveTextColor('default', 'value', gaugeFillColor)}
          allowTextOverride
          onChange={(s) => onPatch({ value: s })}
        />
        <TextSlotStyleEditor
          role="unit"
          slot={element.unit}
          derived={derivedTextForRole('unit', meta, scaleMax, previewRatio, fieldConfig)}
          defaultColor={resolveTextColor('default', 'unit', gaugeFillColor)}
          derivedHint="Leave blank to use the field unit (e.g. km/h, bpm)."
          onChange={(s) => onPatch({ unit: s })}
        />
      </>
    );
  }

  return null;
}

function TextSlotPositionEditor({
  role,
  slot,
  onChange,
}: {
  role: 'value' | 'unit';
  slot: TextSlot;
  onChange: (s: TextSlot) => void;
}) {
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-white/45">{roleLabel} position</span>
      <NumberRow label="X" value={slot.pos.x} min={0} max={LAYOUT_REF_W} step={1}
        onChange={(v) => onChange({ ...slot, pos: { ...slot.pos, x: v } })} />
      <NumberRow label="Y" value={slot.pos.y} min={0} max={LAYOUT_REF_H} step={1}
        onChange={(v) => onChange({ ...slot, pos: { ...slot.pos, y: v } })} />
    </div>
  );
}

function TextSlotStyleEditor({
  role,
  slot,
  derived,
  defaultColor,
  allowTextOverride,
  derivedHint,
  onChange,
}: {
  role: 'value' | 'unit';
  slot: TextSlot;
  derived: string;
  defaultColor: string;
  allowTextOverride?: boolean;
  derivedHint?: string;
  onChange: (s: TextSlot) => void;
}) {
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  return (
    <div className={`border border-white/10 rounded-md p-2 ${slot.visible ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold flex-1">{roleLabel}</span>
        <label className="flex items-center gap-1.5 text-xs text-white/50">
          <input type="checkbox" checked={slot.visible} onChange={(e) => onChange({ ...slot, visible: e.target.checked })} />
          shown
        </label>
      </div>
      {slot.visible && (
        <div className="flex flex-col gap-2">
          {allowTextOverride ? (
            <div className="flex flex-col gap-1">
              <label className="field-label">Custom text</label>
              <input type="text" placeholder={derived} value={slot.textOverride}
                onChange={(e) => onChange({ ...slot, textOverride: e.target.value })}
                className="w-full bg-white/5 rounded px-2 py-1 text-xs border border-white/10" />
            </div>
          ) : (
            <div className="text-xs text-white/60 font-mono px-2 py-1 bg-white/5 rounded border border-white/10">
              {derived || '—'}
            </div>
          )}
          {derivedHint && <p className="text-[10px] text-white/40 leading-snug">{derivedHint}</p>}
          <OptionalColorInput label="Color" value={slot.color} autoLabel="Default" customFallback={defaultColor}
            onChange={(color) => onChange({ ...slot, color })} />
          <NumberRow label="Size" value={slot.fontSize} min={1} step={1} suffix="px"
            onChange={(v) => onChange({ ...slot, fontSize: v })} />
        </div>
      )}
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
  const derived = options.filter((o) => o.group === 'derived');
  if (options.length === 0) {
    return <p className="text-xs text-white/40">Load FIT or camera telemetry to pick a field.</p>;
  }
  return (
    <div className="relative flex flex-col gap-1">
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
        {derived.length > 0 && (
          <optgroup label="Derived">
            {derived.map((o) => (
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

function RectEditor({
  label,
  rect,
  minW,
  minH,
  onChange,
}: {
  label: string;
  rect: { x: number; y: number; w: number; h: number };
  minW: number;
  minH: number;
  onChange: (rect: { x: number; y: number; w: number; h: number }) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-wider text-white/50">{label}</span>
      <NumberRow label="X" value={rect.x} min={0} max={LAYOUT_REF_W - minW} step={1}
        onChange={(v) => onChange({ ...rect, x: clamp(v, 0, LAYOUT_REF_W - rect.w) })} />
      <NumberRow label="Y" value={rect.y} min={0} max={LAYOUT_REF_H - minH} step={1}
        onChange={(v) => onChange({ ...rect, y: clamp(v, 0, LAYOUT_REF_H - rect.h) })} />
      <NumberRow label="Width" value={rect.w} min={minW} max={LAYOUT_REF_W} step={1} suffix="px"
        onChange={(v) => onChange({ ...rect, w: clamp(v, minW, LAYOUT_REF_W - rect.x) })} />
      <NumberRow label="Height" value={rect.h} min={minH} max={LAYOUT_REF_H} step={1} suffix="px"
        onChange={(v) => onChange({ ...rect, h: clamp(v, minH, LAYOUT_REF_H - rect.y) })} />
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

function ScaleMaxRow({ meta, config, value, onChange }: {
  meta: GaugeEditorMeta;
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
  const wrap360 = (v: number) => ((v % 360) + 360) % 360;
  const setDeg = (raw: number) => {
    const v = Math.round(wrap360(raw));
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
