import { appearanceDefaults } from '../../gauges/appearanceSchema';
import { GAUGE_FONTS } from '../../lib/fonts';

interface Props {
  value?: string;
  onChange: (fontFamily: string) => void;
}

function fontFamilyCss(name: string): string {
  return `'${name}', sans-serif`;
}

/** Single gauge-wide font picker — all text elements inherit this family. */
export function GlobalFontPicker({ value, onChange }: Props) {
  const current = value ?? appearanceDefaults.fontFamily;
  const options = GAUGE_FONTS.some((f) => f.value === current)
    ? GAUGE_FONTS
    : [{ value: current, label: current, weights: [] as number[] }, ...GAUGE_FONTS];

  return (
    <div className="flex flex-col gap-1.5">
      <label className="field-label" htmlFor="gauge-global-font">Font</label>
      <select
        id="gauge-global-font"
        className="select-input text-sm"
        value={current}
        style={{ fontFamily: fontFamilyCss(current) }}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((f) => (
          <option key={f.value} value={f.value} style={{ fontFamily: fontFamilyCss(f.value) }}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}
