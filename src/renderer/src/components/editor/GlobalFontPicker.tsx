import { appearanceDefaults } from '../../gauges/appearanceSchema';
import { GAUGE_FONTS } from '../../lib/fonts';

interface Props {
  value?: string;
  onChange: (fontFamily: string) => void;
}

/** Single gauge-wide font picker — all text elements inherit this family. */
export function GlobalFontPicker({ value, onChange }: Props) {
  const current = value ?? appearanceDefaults.fontFamily;

  return (
    <div className="border border-white/10 rounded-md p-3 flex flex-col gap-2">
      <div className="field-label text-[10px] uppercase tracking-wider">Font</div>
      <p className="text-[10px] text-white/45 leading-snug">
        Applies to all text on this gauge.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {GAUGE_FONTS.map((f) => {
          const on = f.value === current;
          return (
            <button
              key={f.value}
              type="button"
              className={`text-left rounded-md p-2 border transition-colors ${
                on ? 'bg-bg-hover border-accent' : 'bg-bg border-white/[0.07] hover:bg-bg-elev'
              }`}
              onClick={() => onChange(f.value)}
            >
              <div
                className="text-xl font-bold leading-none truncate"
                style={{ fontFamily: `'${f.value}', sans-serif` }}
              >
                42
              </div>
              <div
                className="mt-1 text-[10px] text-textdim truncate"
                style={{ fontFamily: `'${f.value}', sans-serif` }}
              >
                {f.label}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
