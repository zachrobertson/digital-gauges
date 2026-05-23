import { colorToPickerHex } from '../../lib/colorInput';
import type { TextColorChoice } from '../../gauges/gaugeEditorLayout';

interface ColorInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ColorInput({
  label,
  value,
  onChange,
  placeholder = '#rrggbb or rgba(r, g, b, a)',
  disabled = false,
}: ColorInputProps) {
  return (
    <div className={label ? 'flex flex-col gap-1' : undefined}>
      {label && <label className="field-label">{label}</label>}
      <div className={`flex items-center gap-2 ${label ? '' : 'flex-1'}`}>
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 bg-white/5 rounded-md px-2 py-1 text-xs border border-white/10 font-mono disabled:opacity-40"
        />
        <input
          type="color"
          value={colorToPickerHex(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-8 shrink-0 rounded border border-white/10 bg-transparent disabled:opacity-40"
        />
      </div>
    </div>
  );
}

interface OptionalColorInputProps {
  label: string;
  value: TextColorChoice;
  onChange: (value: TextColorChoice) => void;
  autoLabel?: string;
  /** Hex/rgba used when switching off Auto. */
  customFallback?: string;
}

export function OptionalColorInput({
  label,
  value,
  onChange,
  autoLabel = 'Auto',
  customFallback = '#ffffff',
}: OptionalColorInputProps) {
  const isAuto = value === 'default';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="field-label">{label}</label>
        <label className="flex items-center gap-1.5 text-xs text-white/50 shrink-0">
          <input
            type="checkbox"
            checked={isAuto}
            onChange={(e) => onChange(e.target.checked ? 'default' : customFallback)}
          />
          {autoLabel}
        </label>
      </div>
      <ColorInput
        value={isAuto ? customFallback : value}
        onChange={(c) => onChange(c)}
        disabled={isAuto}
      />
    </div>
  );
}
