import { colorMatchesDefault, colorToPickerHex } from '../../lib/colorInput';
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
  /** Inherited color shown in the picker when value is `default`. */
  defaultColor: string;
}

/** Color picker that shows the inherited default and stores `default` until overridden. */
export function OptionalColorInput({
  label,
  value,
  onChange,
  defaultColor,
}: OptionalColorInputProps) {
  const display = value === 'default' ? defaultColor : value;

  return (
    <ColorInput
      label={label}
      value={display}
      onChange={(next) => onChange(colorMatchesDefault(next, defaultColor) ? 'default' : next)}
    />
  );
}
