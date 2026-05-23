import type { TelemetryField } from '@shared/types';
import { hrZoneColor } from './heartRate';
import { powerZoneColor } from './power';

const KMH_TO_MPH = 0.621371;

export interface FieldMeta {
  label: string;
  unit: string;
  defaultColor: string;
  getUnit: (config: Record<string, unknown>) => string;
  getScaleMax: (config: Record<string, unknown>) => number;
  getScaleMaxRange: (config: Record<string, unknown>) => { min: number; max: number; step: number };
  patchScaleMax: (config: Record<string, unknown>, value: number) => Record<string, unknown>;
  formatValue: (raw: number, config: Record<string, unknown>) => string;
  formatScaleMaxLabel: (scaleMax: number, config: Record<string, unknown>) => string;
  getRatio: (raw: number, config: Record<string, unknown>) => number;
  getFillColor?: (
    raw: number,
    ratio: number,
    config: Record<string, unknown>,
    accent: string,
  ) => string | undefined;
  defaultConfig: Record<string, unknown>;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const FIELD_REGISTRY: Partial<Record<TelemetryField, FieldMeta>> = {
  speed: {
    label: 'Speed',
    unit: 'KM/H',
    defaultColor: '#3ddc97',
    getUnit: (c) => (c.units === 'mph' ? 'MPH' : 'KM/H'),
    getScaleMax: (c) => {
      const kmh = Number(c.maxSpeedKmh ?? c.scaleMax ?? 80);
      return c.units === 'mph' ? Math.round(kmh * KMH_TO_MPH) : kmh;
    },
    getScaleMaxRange: (c) => (
      c.units === 'mph'
        ? { min: 12, max: 155, step: 5 }
        : { min: 20, max: 250, step: 5 }
    ),
    patchScaleMax: (c, v) => (
      c.units === 'mph'
        ? { ...c, maxSpeedKmh: Math.round(v / KMH_TO_MPH), scaleMax: Math.round(v / KMH_TO_MPH) }
        : { ...c, maxSpeedKmh: v, scaleMax: v }
    ),
    formatValue: (raw, c) => {
      const val = c.units === 'mph' ? raw * 2.23693629 : raw * 3.6;
      return val < 10 ? val.toFixed(1) : String(Math.round(val));
    },
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => {
      const kmh = Number(c.maxSpeedKmh ?? c.scaleMax ?? 80);
      return clamp01((raw * 3.6) / kmh);
    },
    defaultConfig: { units: 'kmh', maxSpeedKmh: 80, scaleMax: 80, color: '#3ddc97' },
  },
  power: {
    label: 'Power',
    unit: 'W',
    defaultColor: '#f59e0b',
    getUnit: () => 'W',
    getScaleMax: (c) => Math.round(Number(c.ftp ?? 250) * 1.5),
    getScaleMaxRange: () => ({ min: 100, max: 2000, step: 25 }),
    patchScaleMax: (c, v) => ({ ...c, ftp: Math.round(v / 1.5), scaleMax: v }),
    formatValue: (raw) => String(Math.round(raw)),
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01(raw / (Number(c.ftp ?? 250) * 1.5)),
    getFillColor: (raw, _ratio, c, accent) => powerZoneColor(raw, Number(c.ftp ?? 250)) ?? accent,
    defaultConfig: { ftp: 250, color: '#f59e0b' },
  },
  hr: {
    label: 'Heart Rate',
    unit: 'BPM',
    defaultColor: '#ef4444',
    getUnit: () => 'BPM',
    getScaleMax: (c) => Number(c.maxHr ?? c.scaleMax ?? 190),
    getScaleMaxRange: () => ({ min: 120, max: 220, step: 5 }),
    patchScaleMax: (c, v) => ({ ...c, maxHr: v, scaleMax: v }),
    formatValue: (raw) => (raw > 0 ? String(Math.round(raw)) : '—'),
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01(raw / Number(c.maxHr ?? c.scaleMax ?? 190)),
    getFillColor: (raw, ratio, c, accent) => (
      raw > 0 ? hrZoneColor(ratio) : accent
    ),
    defaultConfig: { maxHr: 190, scaleMax: 190, color: '#ef4444' },
  },
  cadence: {
    label: 'Cadence',
    unit: 'RPM',
    defaultColor: '#10b981',
    getUnit: () => 'RPM',
    getScaleMax: (c) => Number(c.maxCadence ?? c.scaleMax ?? 120),
    getScaleMaxRange: () => ({ min: 60, max: 200, step: 5 }),
    patchScaleMax: (c, v) => ({ ...c, maxCadence: v, scaleMax: v }),
    formatValue: (raw) => (raw > 0 ? String(Math.round(raw)) : '—'),
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01(raw / Number(c.maxCadence ?? c.scaleMax ?? 120)),
    defaultConfig: { maxCadence: 120, scaleMax: 120, color: '#10b981' },
  },
  alt: {
    label: 'Altitude',
    unit: 'M',
    defaultColor: '#a78bfa',
    getUnit: () => 'M',
    getScaleMax: (c) => Number(c.scaleMax ?? 500),
    getScaleMaxRange: () => ({ min: 50, max: 5000, step: 50 }),
    patchScaleMax: (c, v) => ({ ...c, scaleMax: v }),
    formatValue: (raw) => String(Math.round(raw)),
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01(raw / Number(c.scaleMax ?? 500)),
    defaultConfig: { scaleMax: 500, color: '#a78bfa' },
  },
  temp: {
    label: 'Temperature',
    unit: '°C',
    defaultColor: '#f472b6',
    getUnit: () => '°C',
    getScaleMax: (c) => Number(c.scaleMax ?? 40),
    getScaleMaxRange: () => ({ min: 0, max: 60, step: 1 }),
    patchScaleMax: (c, v) => ({ ...c, scaleMax: v }),
    formatValue: (raw) => raw.toFixed(1),
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01(raw / Number(c.scaleMax ?? 40)),
    defaultConfig: { scaleMax: 40, color: '#f472b6' },
  },
  grade: {
    label: 'Grade',
    unit: '%',
    defaultColor: '#eab308',
    getUnit: () => '%',
    getScaleMax: (c) => Number(c.scaleMax ?? 15),
    getScaleMaxRange: () => ({ min: 1, max: 30, step: 1 }),
    patchScaleMax: (c, v) => ({ ...c, scaleMax: v }),
    formatValue: (raw) => `${(raw * 100).toFixed(1)}`,
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01(Math.abs(raw) / (Number(c.scaleMax ?? 15) / 100)),
    defaultConfig: { scaleMax: 15, color: '#eab308' },
  },
  distance: {
    label: 'Distance',
    unit: 'KM',
    defaultColor: '#38bdf8',
    getUnit: () => 'KM',
    getScaleMax: (c) => Number(c.scaleMax ?? 100),
    getScaleMaxRange: () => ({ min: 1, max: 500, step: 5 }),
    patchScaleMax: (c, v) => ({ ...c, scaleMax: v }),
    formatValue: (raw) => (raw / 1000).toFixed(2),
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01((raw / 1000) / Number(c.scaleMax ?? 100)),
    defaultConfig: { scaleMax: 100, color: '#38bdf8' },
  },
  distanceToFinish: {
    label: 'Distance to Finish',
    unit: 'KM',
    defaultColor: '#22d3ee',
    getUnit: () => 'KM',
    getScaleMax: (c) => Number(c.scaleMax ?? 42),
    getScaleMaxRange: () => ({ min: 1, max: 500, step: 1 }),
    patchScaleMax: (c, v) => ({ ...c, scaleMax: v }),
    formatValue: (raw) => (raw / 1000).toFixed(2),
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01((raw / 1000) / Number(c.scaleMax ?? 42)),
    defaultConfig: { scaleMax: 42, color: '#22d3ee' },
  },
  leanAngle: {
    label: 'Lean',
    unit: '°',
    defaultColor: '#fb923c',
    getUnit: () => '°',
    getScaleMax: (c) => Number(c.scaleMax ?? 45),
    getScaleMaxRange: () => ({ min: 5, max: 90, step: 5 }),
    patchScaleMax: (c, v) => ({ ...c, scaleMax: v }),
    formatValue: (raw) => `${((raw * 180) / Math.PI).toFixed(1)}`,
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01(Math.abs(raw) / ((Number(c.scaleMax ?? 45) * Math.PI) / 180)),
    defaultConfig: { scaleMax: 45, color: '#fb923c' },
  },
  accelX: genericMeta('Accel X', 'm/s²', '#94a3b8', 20),
  accelY: genericMeta('Accel Y', 'm/s²', '#64748b', 20),
  accelZ: genericMeta('Accel Z', 'm/s²', '#475569', 20),
  gyroX: genericMeta('Gyro X', 'rad/s', '#cbd5e1', 5),
  gyroY: genericMeta('Gyro Y', 'rad/s', '#94a3b8', 5),
  gyroZ: genericMeta('Gyro Z', 'rad/s', '#64748b', 5),
  lat: genericMeta('Latitude', '°', '#94a3b8', 90),
  lon: genericMeta('Longitude', '°', '#94a3b8', 180),
};

function genericMeta(label: string, unit: string, color: string, defaultMax: number): FieldMeta {
  return {
    label,
    unit,
    defaultColor: color,
    getUnit: () => unit,
    getScaleMax: (c) => Number(c.scaleMax ?? defaultMax),
    getScaleMaxRange: () => ({ min: 1, max: defaultMax * 4, step: defaultMax / 10 || 1 }),
    patchScaleMax: (c, v) => ({ ...c, scaleMax: v }),
    formatValue: (raw) => raw.toFixed(2),
    formatScaleMaxLabel: (max) => String(max),
    getRatio: (raw, c) => clamp01(Math.abs(raw) / Number(c.scaleMax ?? defaultMax)),
    defaultConfig: { scaleMax: defaultMax, color },
  };
}

export function fieldMeta(field: TelemetryField | undefined): FieldMeta | null {
  if (!field) return null;
  return FIELD_REGISTRY[field] ?? null;
}

export function fieldLabel(field: TelemetryField): string {
  return FIELD_REGISTRY[field]?.label ?? field;
}

export function defaultConfigForField(field: TelemetryField): Record<string, unknown> {
  const meta = FIELD_REGISTRY[field];
  return meta ? { ...meta.defaultConfig, field } : { field, scaleMax: 100, color: '#3ddc97' };
}

export const SCALAR_GAUGE_FIELDS: TelemetryField[] = [
  'speed', 'power', 'hr', 'cadence', 'alt', 'temp', 'grade', 'distance', 'distanceToFinish', 'leanAngle',
  'accelX', 'accelY', 'accelZ', 'gyroX', 'gyroY', 'gyroZ', 'lat', 'lon',
];

export const DATA_GAUGE_PLUGIN_ID = 'builtin:dataGauge';
