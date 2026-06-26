/**
 * Single source of truth for gauge fonts.
 *
 * Fonts are bundled (self-hosted via @fontsource woff2) so the live preview and
 * the burned-in export render with identical glyphs and metrics. Importing this
 * module registers the @font-face rules; call `ensureFontsLoaded()` before any
 * canvas text rendering that must match (notably the export frame loop).
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/roboto-condensed/400.css';
import '@fontsource/roboto-condensed/600.css';
import '@fontsource/roboto-condensed/700.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/600.css';
import '@fontsource/source-sans-3/700.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/rajdhani/400.css';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/orbitron/400.css';
import '@fontsource/orbitron/600.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/saira/400.css';
import '@fontsource/saira/600.css';
import '@fontsource/saira/700.css';
import '@fontsource/michroma/400.css';

export interface FontDef {
  /** Stored config value + CSS family name. */
  value: string;
  /** Human label for pickers. */
  label: string;
  /** Weights bundled for this family — used by the export preload. */
  weights: number[];
}

/** Every selectable gauge font. Pickers and the export preload derive from this. */
export const GAUGE_FONTS: FontDef[] = [
  { value: 'Inter', label: 'Inter', weights: [400, 500, 600, 700] },
  { value: 'JetBrains Mono', label: 'JetBrains Mono', weights: [400, 500, 700] },
  { value: 'Roboto Condensed', label: 'Roboto Condensed', weights: [400, 600, 700] },
  { value: 'Source Sans 3', label: 'Source Sans 3', weights: [400, 600, 700] },
  { value: 'Oswald', label: 'Oswald', weights: [400, 600, 700] },
  { value: 'Bebas Neue', label: 'Bebas Neue', weights: [400] },
  { value: 'Rajdhani', label: 'Rajdhani', weights: [400, 600, 700] },
  { value: 'Barlow', label: 'Barlow', weights: [400, 600, 700] },
  { value: 'Archivo', label: 'Archivo', weights: [400, 600, 700] },
  { value: 'Orbitron', label: 'Orbitron', weights: [400, 600, 700] },
  { value: 'Saira', label: 'Saira', weights: [400, 600, 700] },
  { value: 'Michroma', label: 'Michroma', weights: [400] },
];

export const DEFAULT_FONT_FAMILY = 'Inter';

/** Family names for schema enums. */
export const FONT_FAMILY_VALUES = GAUGE_FONTS.map((f) => f.value);

/** `{value,label}` options for `<select>` pickers. */
export const FONT_OPTIONS = GAUGE_FONTS.map((f) => ({ value: f.value, label: f.label }));

let loadedOnce: Promise<void> | null = null;

/**
 * Resolve once all bundled gauge font faces are ready. The browser lazy-loads
 * woff2 only when a glyph is first requested, so the export pipeline must await
 * this before rasterizing frames or the first frames fall back to a system face.
 */
export function ensureFontsLoaded(): Promise<void> {
  if (loadedOnce) return loadedOnce;
  const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fontSet) {
    loadedOnce = Promise.resolve();
    return loadedOnce;
  }
  const loads: Promise<unknown>[] = [];
  for (const font of GAUGE_FONTS) {
    for (const weight of font.weights) {
      loads.push(fontSet.load(`${weight} 32px "${font.value}"`).catch(() => undefined));
    }
  }
  loadedOnce = Promise.all(loads).then(() => fontSet.ready).then(() => undefined);
  return loadedOnce;
}
