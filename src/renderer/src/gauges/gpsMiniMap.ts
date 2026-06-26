import type { GaugePlugin } from '@shared/types';
import { appearanceDefaults, appearanceSchemaProperties } from './appearanceSchema';
import { fillPanel, panelStyleFromConfig, withGaugeBoundsClip } from './common';
import { defaultVideoRectForLayout, withLayoutVideoTransform, type TextRole } from './gaugeEditorLayout';
import {
  drawLegacyLayoutTextInLayoutSpace,
  LEGACY_DEFAULT_GPS_LAYOUT,
  mergeLegacyGaugeLayout,
  type LegacyGaugeLayoutConfig,
} from './barGaugeLegacyLayout';
import type { MarkerStyle } from '@shared/types/gaugeElement';
import { drawGpsMapOnCanvas, resolveCourseMarkerOverlay } from './gpsMapDraw';

export type GpsRouteScope = 'full' | 'video';

interface Config {
  trailColor: string;
  cursorColor: string;
  routeScope: GpsRouteScope;
  fullTrack?: { lat: number; lon: number }[];
  /** @deprecated split into showCourseStart / showCourseFinish */
  showCourseMarkers?: boolean;
  showCourseStart?: boolean;
  showCourseFinish?: boolean;
  startMarkerStyle?: MarkerStyle;
  finishMarkerStyle?: MarkerStyle;
  startMarkerColor?: string;
  finishMarkerColor?: string;
  /** @deprecated replaced by markerLength / markerWidth */
  markerScale?: number;
  markerLength?: number;
  markerWidth?: number;
  courseStart?: { lat: number; lon: number } | null;
  courseFinish?: { lat: number; lon: number } | null;
  layout?: LegacyGaugeLayoutConfig;
  panelOpacity?: number;
  panelBg?: string;
  panelBorder?: string;
  fontScale?: number;
  fontFamily?: string;
  cornerStyle?: 'rounded' | 'square' | 'pill' | 'circle';
}

export const gpsMiniMap: GaugePlugin<Config> = {
  id: 'builtin:gpsMiniMap',
  name: 'GPS / Route',
  description: 'Route map with a moving position cursor along your track.',
  fields: ['lat', 'lon'],
  defaultRect: defaultVideoRectForLayout(
    { gaugeRect: LEGACY_DEFAULT_GPS_LAYOUT.gaugeRect, elements: [] },
    1920,
    1080,
    0.18,
    0.78,
    0.04,
  ),
  defaultConfig: {
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    routeScope: 'video',
    showCourseStart: true,
    showCourseFinish: true,
    startMarkerStyle: 'line',
    finishMarkerStyle: 'line',
    startMarkerColor: '#22c55e',
    finishMarkerColor: '#111111',
    markerLength: 56,
    markerWidth: 30,
    ...appearanceDefaults,
  },
  schema: {
    type: 'object',
    properties: {
      routeScope: {
        type: 'string',
        title: 'Route scope',
        enum: ['video', 'full'],
        format: 'select',
        default: 'video',
        group: 'Data',
        description: 'Video — route within the clip. Full — entire imported track.',
      },
      trailColor: {
        type: 'string',
        title: 'Trail color',
        format: 'color',
        default: '#3ddc97',
        group: 'Data',
      },
      cursorColor: {
        type: 'string',
        title: 'Cursor color',
        format: 'color',
        default: '#ffffff',
        group: 'Data',
      },
      showCourseStart: {
        type: 'boolean',
        title: 'Show start marker',
        default: true,
        group: 'Data',
        description: 'Mark the course start on the route (set in the Course panel).',
      },
      showCourseFinish: {
        type: 'boolean',
        title: 'Show finish marker',
        default: true,
        group: 'Data',
        description: 'Mark the course finish on the route (set in the Course panel).',
      },
      startMarkerStyle: {
        type: 'string',
        title: 'Start marker style',
        enum: ['flag', 'line'],
        format: 'select',
        default: 'flag',
        group: 'Data',
      },
      finishMarkerStyle: {
        type: 'string',
        title: 'Finish marker style',
        enum: ['flag', 'line'],
        format: 'select',
        default: 'flag',
        group: 'Data',
      },
      startMarkerColor: {
        type: 'string',
        title: 'Start marker color',
        format: 'color',
        default: '#22c55e',
        group: 'Data',
      },
      finishMarkerColor: {
        type: 'string',
        title: 'Finish marker color',
        format: 'color',
        default: '#111111',
        group: 'Data',
      },
      markerLength: {
        type: 'number',
        title: 'Marker length (px)',
        minimum: 6,
        maximum: 240,
        step: 1,
        default: 56,
        group: 'Data',
      },
      markerWidth: {
        type: 'number',
        title: 'Marker width (px)',
        minimum: 4,
        maximum: 200,
        step: 1,
        default: 30,
        group: 'Data',
      },
      ...appearanceSchemaProperties,
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const panelStyle = panelStyleFromConfig(config);
    const route = config.fullTrack ?? [];
    const lat = frame?.lat as number | undefined;
    const lon = frame?.lon as number | undefined;
    renderCustomGpsGauge(ctx, config, rect, panelStyle, route, lat, lon);
  },
};

function roleText(role: TextRole): string {
  if (role === 'label') return 'ROUTE';
  return '';
}

function renderCustomGpsGauge(
  ctx: CanvasRenderingContext2D,
  config: Config,
  rect: { x: number; y: number; w: number; h: number },
  panelStyle: ReturnType<typeof panelStyleFromConfig>,
  route: { lat: number; lon: number }[],
  lat: number | undefined,
  lon: number | undefined,
): void {
  withGaugeBoundsClip(ctx, rect, () => {
    const layout = mergeLegacyGaugeLayout(config.layout, 'gps');
    withLayoutVideoTransform(ctx, layout, rect, () => {
      fillPanel(ctx, layout.gaugeRect, panelStyle);

      const mapRect = layout.mapRect;
      const sizeScale = Math.min(layout.mapRect.w, layout.mapRect.h);

      if (route.length < 2 && lat === undefined) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = `500 ${Math.floor(sizeScale * 0.11 * (panelStyle.fontScale ?? 1))}px ${panelStyle.fontFamily ?? 'Inter'}, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('no GPS', mapRect.x + mapRect.w / 2, mapRect.y + mapRect.h / 2);
        ctx.textAlign = 'left';
        drawLegacyLayoutTextInLayoutSpace(ctx, layout, {
          accentColor: config.trailColor,
          fontFamily: panelStyle.fontFamily,
          fontScale: panelStyle.fontScale,
          roleText: roleText,
          skipEmpty: true,
        });
        return;
      }

      drawGpsMapOnCanvas(ctx, mapRect, route, lat, lon, config.trailColor, config.cursorColor, sizeScale,
        resolveCourseMarkerOverlay(
          config as unknown as Record<string, unknown>,
          config.courseStart,
          config.courseFinish,
        ));
      drawLegacyLayoutTextInLayoutSpace(ctx, layout, {
        accentColor: config.trailColor,
        fontFamily: panelStyle.fontFamily,
        fontScale: panelStyle.fontScale,
        roleText: roleText,
        skipEmpty: true,
      });
    });
  });
}
