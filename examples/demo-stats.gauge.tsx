/**
 * Reference user gauge — demonstrates schema variety and multi-stat layout.
 *
 * Load a video + FIT file with speed/hr/cadence to see it in action.
 * See docs/writing-gauges.md for the full plugin API.
 */
import type { GaugePlugin } from 'digital-gauges';

interface Config {
  accentColor: string;
  units: 'kmh' | 'mph';
  showHr: boolean;
  fontScale: number;
  panelOpacity: number;
  panelBg: string;
  panelBorder: string;
  fontFamily: string;
  cornerStyle: 'rounded' | 'square' | 'pill';
}

const plugin: GaugePlugin<Config> = {
  id: 'user:demoStats',
  name: 'Demo Stats',
  description: 'Compact speed + HR/cadence panel — reference implementation for user gauges.',
  fields: ['speed', 'hr', 'cadence'],
  defaultRect: { x: 0.04, y: 0.04, w: 0.22, h: 0.14 },
  defaultConfig: {
    accentColor: '#38bdf8',
    units: 'kmh',
    showHr: true,
    fontScale: 1,
    panelOpacity: 0.7,
    panelBg: '#0b0d10',
    panelBorder: '#ffffff14',
    fontFamily: 'Inter',
    cornerStyle: 'rounded',
  },
  schema: {
    type: 'object',
    properties: {
      accentColor: {
        type: 'string',
        title: 'Accent color',
        format: 'color',
        default: '#38bdf8',
        group: 'Data',
      },
      units: {
        type: 'string',
        title: 'Speed units',
        enum: ['kmh', 'mph'],
        format: 'select',
        default: 'kmh',
        group: 'Data',
      },
      showHr: {
        type: 'boolean',
        title: 'Show heart rate',
        default: true,
        group: 'Data',
      },
      fontScale: {
        type: 'number',
        title: 'Font scale',
        minimum: 0.5,
        maximum: 2,
        step: 0.1,
        default: 1,
        group: 'Appearance',
      },
      panelOpacity: {
        type: 'number',
        title: 'Panel opacity',
        minimum: 0,
        maximum: 1,
        step: 0.05,
        default: 0.7,
        group: 'Appearance',
      },
      panelBg: {
        type: 'string',
        title: 'Panel background',
        format: 'color',
        default: '#0b0d10',
        group: 'Appearance',
      },
      panelBorder: {
        type: 'string',
        title: 'Panel border',
        format: 'color',
        default: '#ffffff14',
        group: 'Appearance',
      },
      fontFamily: {
        type: 'string',
        title: 'Font',
        enum: ['Inter', 'JetBrains Mono', 'system-ui'],
        format: 'font',
        default: 'Inter',
        group: 'Appearance',
      },
      cornerStyle: {
        type: 'string',
        title: 'Corner style',
        enum: ['rounded', 'square', 'pill'],
        format: 'select',
        default: 'rounded',
        group: 'Appearance',
      },
    },
  },
  renderToCanvas(ctx, frame, config, rect) {
    const radius = config.cornerStyle === 'pill'
      ? Math.min(rect.w, rect.h) / 2
      : config.cornerStyle === 'square'
        ? 0
        : Math.min(rect.h * 0.18, 18);

    ctx.beginPath();
    ctx.moveTo(rect.x + radius, rect.y);
    ctx.lineTo(rect.x + rect.w - radius, rect.y);
    ctx.quadraticCurveTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + radius);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h - radius);
    ctx.quadraticCurveTo(rect.x + rect.w, rect.y + rect.h, rect.x + rect.w - radius, rect.y + rect.h);
    ctx.lineTo(rect.x + radius, rect.y + rect.h);
    ctx.quadraticCurveTo(rect.x, rect.y + rect.h, rect.x, rect.y + rect.h - radius);
    ctx.lineTo(rect.x, rect.y + radius);
    ctx.quadraticCurveTo(rect.x, rect.y, rect.x + radius, rect.y);
    ctx.closePath();

    ctx.save();
    ctx.globalAlpha = config.panelOpacity;
    ctx.fillStyle = config.panelBg;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = config.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    const speedMs = frame?.speed ?? 0;
    const hr = frame?.hr ?? 0;
    const cadence = frame?.cadence ?? 0;
    const speed = config.units === 'mph' ? speedMs * 2.23693629 : speedMs * 3.6;
    const unit = config.units === 'mph' ? 'mph' : 'km/h';
    const scale = config.fontScale;
    const font = config.fontFamily;

    const pad = rect.h * 0.14;
    const primarySize = Math.floor(rect.h * 0.42 * scale);
    const secondarySize = Math.floor(rect.h * 0.16 * scale);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `500 ${Math.floor(rect.h * 0.12 * scale)}px ${font}, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText('SPEED', rect.x + pad, rect.y + pad);

    ctx.fillStyle = config.accentColor;
    ctx.font = `700 ${primarySize}px ${font}, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(
      speed.toFixed(speed < 10 ? 1 : 0),
      rect.x + pad,
      rect.y + rect.h * 0.48,
    );

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `500 ${secondarySize}px ${font}, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(unit, rect.x + rect.w - pad, rect.y + rect.h * 0.48);

    const stats: string[] = [];
    if (config.showHr && hr > 0) stats.push(`${Math.round(hr)} bpm`);
    if (cadence > 0) stats.push(`${Math.round(cadence)} rpm`);

    if (stats.length > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `500 ${secondarySize}px ${font}, system-ui, sans-serif`;
      ctx.textBaseline = 'bottom';
      ctx.fillText(stats.join('  ·  '), rect.x + rect.w - pad, rect.y + rect.h - pad);
    }

    ctx.textAlign = 'left';
  },
};

export default plugin;
