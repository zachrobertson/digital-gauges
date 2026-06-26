import type { TelemetryField } from '@shared/types';
import type { FillGradientConfig, FillGradientStop } from '@shared/types/fillGradient';
import {
  HR_GRADIENT_PRESET,
  normalizeGradientStops,
  POWER_GRADIENT_PRESET,
  SPEED_GRADIENT_PRESET,
} from '../../gauges/gaugeGradient';
import { ColorInput } from './ColorInput';

const GRADIENT_PRESETS: {
  id: string;
  label: string;
  preset: FillGradientConfig;
  plugins?: string[];
  fields?: TelemetryField[];
}[] = [
  { id: 'hr', label: 'Heart rate', preset: HR_GRADIENT_PRESET, plugins: ['builtin:hr'], fields: ['hr'] },
  { id: 'power', label: 'Power zones', preset: POWER_GRADIENT_PRESET, plugins: ['builtin:power'], fields: ['power'] },
  { id: 'speed', label: 'Speed', preset: SPEED_GRADIENT_PRESET, plugins: ['builtin:speedometer'], fields: ['speed'] },
  {
    id: 'blue-red',
    label: 'Blue → red',
    preset: { enabled: true, stops: [{ pos: 0, color: '#3b82f6' }, { pos: 1, color: '#ef4444' }] },
  },
];

export function FillGradientEditor({
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
  const patchStops = (nextStops: FillGradientStop[]) => onChange({ ...value, stops: normalizeGradientStops(nextStops) });

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-xs text-white/70">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        Fill gradient
      </label>
      {value.enabled && (
        <>
          <p className="text-[10px] text-white/45 leading-snug">
            Gradual color along the bar or arc fill (min → max).
          </p>
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
          {stops.map((stop, index) => (
            <div key={index} className="flex items-center gap-2 border border-white/10 rounded-md p-2">
              <ColorInput
                label="Color"
                value={stop.color}
                onChange={(color) => {
                  patchStops(stops.map((s, i) => (i === index ? { ...s, color } : s)));
                }}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
