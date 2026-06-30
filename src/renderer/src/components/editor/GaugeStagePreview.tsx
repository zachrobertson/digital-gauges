import { useEffect, useMemo, useRef, useState } from 'react';
import type { GaugeInstance, GaugePlugin } from '@shared/types';
import { useProject } from '../../store/project';
import { appearanceDefaults } from '../../gauges/appearanceSchema';
import { resolveFrameStyle } from '../../gauges/frameStyle';
import {
  gaugeEditorKind,
  gaugeEditorMeta,
  resolveAccentColor,
  previewGaugeFillColor,
} from '../../gauges/gaugeEditorAdapter';
import { mergeGaugeLayout, type GaugeLayoutConfig } from '../../gauges/gaugeEditorLayout';
import { buildCourseMarkers, buildRoutePolyline, type RouteScope } from '../../lib/telemetry';
import type { GpsRouteScope } from '../../gauges/gpsMiniMap';
import { CompositeGaugeEditorPreview } from './CompositeGaugeEditorPreview';
import { SelectionToolbar } from './SelectionToolbar';
import { isUnsupportedGaugeConfig } from '../../lib/gaugeFactory';
import { primarySelection } from '../../lib/elementSelection';
import { useElementEditorShortcuts } from '../../lib/useElementEditorShortcuts';

interface Props {
  plugin: GaugePlugin;
  gauge: GaugeInstance;
  mergedConfig: Record<string, unknown>;
  onConfigChange: (patch: Record<string, unknown>) => void;
  selectedElementIds?: string[];
  onSelectElements?: (ids: string[]) => void;
  showGrid?: boolean;
  onShowGridChange?: (v: boolean) => void;
  snapEnabled?: boolean;
  onSnapEnabledChange?: (v: boolean) => void;
  gridSize?: number;
  showFrameBounds?: boolean;
  onShowFrameBoundsChange?: (visible: boolean) => void;
}

export function GaugeStagePreview({
  plugin,
  gauge,
  mergedConfig,
  onConfigChange,
  selectedElementIds: selectedElementIdsProp,
  onSelectElements,
  showGrid: showGridProp,
  onShowGridChange,
  snapEnabled: snapEnabledProp,
  onSnapEnabledChange,
  gridSize = 12,
  showFrameBounds: showFrameBoundsProp,
  onShowFrameBoundsChange,
}: Props) {
  const project = useProject((s) => s.project);
  const [previewRatio, setPreviewRatio] = useState(0.62);
  const [showGridLocal, setShowGridLocal] = useState(true);
  const [snapEnabledLocal, setSnapEnabledLocal] = useState(true);
  const showGrid = showGridProp ?? showGridLocal;
  const setShowGrid = onShowGridChange ?? setShowGridLocal;
  const snapEnabled = snapEnabledProp ?? snapEnabledLocal;
  const setSnapEnabled = onSnapEnabledChange ?? setSnapEnabledLocal;
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);
  const [showFrameBoundsLocal, setShowFrameBoundsLocal] = useState(true);
  const selectedElementIds = selectedElementIdsProp ?? internalSelectedIds;
  const setSelectedElementIds = onSelectElements ?? setInternalSelectedIds;
  const showFrameBounds = showFrameBoundsProp ?? showFrameBoundsLocal;
  const setShowFrameBounds = onShowFrameBoundsChange ?? setShowFrameBoundsLocal;

  const stageRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(0);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setSide(Math.max(160, Math.min(el.clientWidth, el.clientHeight - 38)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const unsupported = isUnsupportedGaugeConfig(mergedConfig);
  const meta = gaugeEditorMeta(plugin, mergedConfig);
  const editorKind = gaugeEditorKind(plugin, mergedConfig);
  const layout = mergeGaugeLayout(mergedConfig.layout as GaugeLayoutConfig | undefined);
  const primaryId = primarySelection(selectedElementIds);
  const selectedElement = layout.elements.find((e) => e.id === primaryId) ?? null;

  const previewRoute = useMemo(() => {
    const scope = ((mergedConfig.routeScope ?? 'video') as GpsRouteScope) as RouteScope;
    const route = buildRoutePolyline(project, scope);
    return route.length >= 2 ? route : null;
  }, [mergedConfig.routeScope, project]);
  const previewCourseMarkers = useMemo(() => buildCourseMarkers(project), [project]);

  const setLayout = (next: GaugeLayoutConfig) => onConfigChange({ layout: next });

  useElementEditorShortcuts({
    containerRef: stageRef,
    enabled: !unsupported && !!editorKind && !!meta,
    selectedElementIds,
    onSelectElements: setSelectedElementIds,
    showFrameBounds,
    onShowFrameBoundsChange: setShowFrameBounds,
    layout,
    onLayoutChange: setLayout,
    gridSize,
  });

  if (unsupported) {
    return (
      <div className="flex-1 flex items-center justify-center text-amber-200/80 text-sm px-8 text-center">
        This gauge uses an older format. Recreate it in the Gauges panel to edit with composite elements.
      </div>
    );
  }

  if (!editorKind || !meta) {
    return (
      <div className="flex-1 flex items-center justify-center text-textfaint text-sm">
        This gauge has no visual preview.
      </div>
    );
  }

  const accentColor = resolveAccentColor(mergedConfig, plugin, selectedElement);
  const trailColor = String(mergedConfig.trailColor ?? '#3ddc97');
  const cursorColor = String(mergedConfig.cursorColor ?? '#ffffff');
  const fontFamily = String(mergedConfig.fontFamily ?? appearanceDefaults.fontFamily);
  const frameStyle = resolveFrameStyle(mergedConfig);
  const scaleMax = meta.getScaleMax(mergedConfig);
  const gaugeFillColor = previewGaugeFillColor(plugin, mergedConfig, previewRatio, selectedElement);
  const legacyShowMarkers = mergedConfig.showCourseMarkers as boolean | undefined;
  const showCourseStart = (mergedConfig.showCourseStart as boolean | undefined) ?? legacyShowMarkers ?? true;
  const showCourseFinish = (mergedConfig.showCourseFinish as boolean | undefined) ?? legacyShowMarkers ?? true;

  return (
    <div ref={stageRef} className="flex-1 flex flex-col items-center justify-center min-h-0 p-4 gap-3">
      <div style={{ width: side, maxWidth: '100%' }} className="flex flex-col gap-2">
        <SelectionToolbar
          selectedElementIds={selectedElementIds}
          layout={layout}
          onLayoutChange={setLayout}
          onSelectElements={setSelectedElementIds}
        />
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
          frameShape={frameStyle.shape}
          frameCornerRadius={frameStyle.cornerRadius}
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
      </div>
      <div className="flex items-center gap-4 text-xs text-white/60">
        <label className="flex items-center gap-1.5">
          <input type="range" min={0} max={100} value={previewRatio * 100}
            onChange={(e) => setPreviewRatio(Number(e.target.value) / 100)} />
          Preview {Math.round(previewRatio * 100)}%
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          Grid
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
          Snap
        </label>
      </div>
    </div>
  );
}
