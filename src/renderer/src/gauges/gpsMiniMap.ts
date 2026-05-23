import type { GaugePlugin } from '@shared/types';
import { appearanceDefaults, appearanceSchemaProperties } from './appearanceSchema';
import { fillPanel, panelStyleFromConfig, withGaugeBoundsClip } from './common';
import {
  DEFAULT_GPS_GAUGE_LAYOUT,
  defaultVideoRectForLayout,
  drawLayoutTextInLayoutSpace,
  mergeGaugeLayout,
  withLayoutVideoTransform,
  type GaugeLayoutConfig,
  type TextRole,
} from './gaugeEditorLayout';
import { drawGpsMapOnCanvas } from './gpsMapDraw';

export type GpsRouteScope = 'full' | 'video';

interface Config {
  trailColor: string;
  cursorColor: string;
  routeScope: GpsRouteScope;
  fullTrack?: { lat: number; lon: number }[];
  layout?: GaugeLayoutConfig;
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
  defaultRect: defaultVideoRectForLayout(DEFAULT_GPS_GAUGE_LAYOUT, 1920, 1080, 0.18, 0.78, 0.04),
  defaultConfig: {
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    routeScope: 'video',
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
    const layout = mergeGaugeLayout(config.layout, 'gps');
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
        drawLayoutTextInLayoutSpace(ctx, layout, {
          accentColor: config.trailColor,
          fontFamily: panelStyle.fontFamily,
          fontScale: panelStyle.fontScale,
          roleText: roleText,
          skipEmpty: true,
        });
        return;
      }

      drawGpsMapOnCanvas(ctx, mapRect, route, lat, lon, config.trailColor, config.cursorColor, sizeScale);
      drawLayoutTextInLayoutSpace(ctx, layout, {
        accentColor: config.trailColor,
        fontFamily: panelStyle.fontFamily,
        fontScale: panelStyle.fontScale,
        roleText: roleText,
        skipEmpty: true,
      });
    });
  });
}
