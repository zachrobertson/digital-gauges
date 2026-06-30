/**
 * Legacy fixed-slot layout used by built-in scalar plugins (speedometer, power, etc.).
 * The composite data gauge uses `GaugeLayoutConfig.elements` instead.
 */
import type { BarConfig, LayoutRect, TextElement, TextRole, XY } from './gaugeEditorLayout';
import { DEFAULT_FONT_FAMILY } from '../lib/fonts';
import {
  DEFAULT_GAUGE_RECT,
  defaultBarConfig,
  defaultMapRect,
} from './gaugeEditorLayout';

export interface LegacyGaugeLayoutConfig {
  gaugeRect: LayoutRect;
  arcCenter: XY;
  arcRadius: number;
  arcStartDeg: number;
  arcEndDeg: number;
  text: Record<TextRole, TextElement>;
  bar: BarConfig;
  mapRect: LayoutRect;
}

const DEFAULT_ARC_CENTER: XY = {
  x: DEFAULT_GAUGE_RECT.x + DEFAULT_GAUGE_RECT.w * 0.5,
  y: DEFAULT_GAUGE_RECT.y + DEFAULT_GAUGE_RECT.h * 0.58,
};

const DEFAULT_ARC_RADIUS = Math.round(
  (Math.min(DEFAULT_GAUGE_RECT.w, DEFAULT_GAUGE_RECT.h) / 2) * 0.65,
);

function defaultTextElement(role: TextRole): TextElement {
  const r = DEFAULT_GAUGE_RECT;
  const cx = r.x + r.w * 0.5;
  const baseline = (yFrac: number) => r.y + r.h * yFrac;
  if (role === 'label') {
    return { visible: true, pos: { x: cx, y: baseline(0.2) }, textOverride: '', color: 'default', fontSize: 11 };
  }
  if (role === 'value') {
    return { visible: true, pos: { x: cx, y: baseline(0.52) }, textOverride: '', color: 'default', fontSize: 36 };
  }
  return { visible: true, pos: { x: cx, y: baseline(0.78) }, textOverride: '', color: 'default', fontSize: 12 };
}

export const DEFAULT_GPS_GAUGE_RECT = { x: 90, y: 35, w: 300, h: 200 };

function defaultGpsTextElement(role: TextRole, gaugeRect: typeof DEFAULT_GPS_GAUGE_RECT): TextElement {
  const cx = gaugeRect.x + gaugeRect.w * 0.12;
  const top = gaugeRect.y + gaugeRect.h * 0.12;
  if (role === 'label') {
    return { visible: true, pos: { x: cx, y: top }, textOverride: '', color: 'default', fontSize: 11 };
  }
  if (role === 'value') {
    return { visible: false, pos: { x: gaugeRect.x + gaugeRect.w * 0.5, y: gaugeRect.y + gaugeRect.h * 0.5 }, textOverride: '', color: 'default', fontSize: 24 };
  }
  return { visible: false, pos: { x: gaugeRect.x + gaugeRect.w * 0.5, y: gaugeRect.y + gaugeRect.h * 0.72 }, textOverride: '', color: 'default', fontSize: 11 };
}

export const LEGACY_DEFAULT_GPS_LAYOUT: LegacyGaugeLayoutConfig = (() => {
  const gaugeRect = { ...DEFAULT_GPS_GAUGE_RECT };
  return {
    gaugeRect,
    arcCenter: { x: gaugeRect.x + gaugeRect.w * 0.5, y: gaugeRect.y + gaugeRect.h * 0.58 },
    arcRadius: Math.round((Math.min(gaugeRect.w, gaugeRect.h) / 2) * 0.65),
    arcStartDeg: 30,
    arcEndDeg: 330,
    text: {
      label: defaultGpsTextElement('label', gaugeRect),
      value: defaultGpsTextElement('value', gaugeRect),
      unit: defaultGpsTextElement('unit', gaugeRect),
    },
    bar: defaultBarConfig(gaugeRect),
    mapRect: defaultMapRect(gaugeRect),
  };
})();

export const LEGACY_DEFAULT_GAUGE_LAYOUT: LegacyGaugeLayoutConfig = {
  gaugeRect: { ...DEFAULT_GAUGE_RECT },
  arcCenter: { ...DEFAULT_ARC_CENTER },
  arcRadius: DEFAULT_ARC_RADIUS,
  arcStartDeg: 30,
  arcEndDeg: 330,
  text: {
    label: defaultTextElement('label'),
    value: defaultTextElement('value'),
    unit: defaultTextElement('unit'),
  },
  bar: defaultBarConfig(DEFAULT_GAUGE_RECT),
  mapRect: defaultMapRect(DEFAULT_GAUGE_RECT),
};

export function mergeLegacyGaugeLayout(
  partial?: Partial<LegacyGaugeLayoutConfig> | null,
  template: 'telemetry' | 'gps' = 'telemetry',
): LegacyGaugeLayoutConfig {
  const base = template === 'gps' ? LEGACY_DEFAULT_GPS_LAYOUT : LEGACY_DEFAULT_GAUGE_LAYOUT;
  if (!partial) return structuredClone(base);
  const gaugeRect = { ...base.gaugeRect, ...partial.gaugeRect };
  const defaultBar = defaultBarConfig(gaugeRect);
  const defaultMap = defaultMapRect(gaugeRect);
  return {
    gaugeRect,
    arcCenter: { ...base.arcCenter, ...partial.arcCenter },
    arcRadius: partial.arcRadius ?? base.arcRadius,
    arcStartDeg: partial.arcStartDeg ?? base.arcStartDeg,
    arcEndDeg: partial.arcEndDeg ?? base.arcEndDeg,
    text: {
      label: { ...base.text.label, ...partial.text?.label },
      value: { ...base.text.value, ...partial.text?.value },
      unit: { ...base.text.unit, ...partial.text?.unit },
    },
    bar: {
      rect: { ...defaultBar.rect, ...partial.bar?.rect },
      rounded: partial.bar?.rounded ?? defaultBar.rounded,
      color: partial.bar?.color ?? defaultBar.color,
    },
    mapRect: { ...defaultMap, ...partial.mapRect },
  };
}

export function resolveBarConfig(layout: LegacyGaugeLayoutConfig): BarConfig {
  return layout.bar ?? defaultBarConfig(layout.gaugeRect);
}

export function drawLegacyLayoutTextInLayoutSpace(
  ctx: CanvasRenderingContext2D,
  layout: LegacyGaugeLayoutConfig,
  options: {
    accentColor: string;
    fontFamily?: string;
    fontScale?: number;
    roleText: (role: TextRole) => string;
    skipEmpty?: boolean;
  },
): void {
  const family = options.fontFamily ?? DEFAULT_FONT_FAMILY;
  const fontScale = options.fontScale ?? 1;
  const roles: TextRole[] = ['label', 'value', 'unit'];
  for (const role of roles) {
    const el = layout.text[role];
    if (!el.visible) continue;
    const display = el.textOverride.trim().length > 0 ? el.textOverride : options.roleText(role);
    if (options.skipEmpty && !display) continue;
    const size = el.fontSize * fontScale;
    const fill = el.color === 'default'
      ? (role === 'value' ? options.accentColor : role === 'label' ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.65)')
      : el.color;
    const weight = role === 'value' ? 700 : role === 'label' ? 600 : 500;
    ctx.fillStyle = fill;
    ctx.font = `${weight} ${Math.floor(size)}px ${family}, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(display, el.pos.x, el.pos.y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
