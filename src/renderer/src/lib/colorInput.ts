/** Convert hex/rgb/rgba to #rrggbb for native color inputs. */
export function colorToPickerHex(color: string, fallback = '#000000'): string {
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    const r = c[1];
    const g = c[2];
    const b = c[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-f]{8}$/i.test(c)) return c.slice(0, 7).toLowerCase();
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) {
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${hex(Number(rgb[1]))}${hex(Number(rgb[2]))}${hex(Number(rgb[3]))}`;
  }
  if (c === 'transparent') return fallback;
  return fallback;
}

function rgbaAlpha(color: string): number | null {
  const match = color.trim().match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/i);
  if (!match) return null;
  return Number(match[1]);
}

/** True when a user-entered color matches the inherited default (stores as `default`). */
export function colorMatchesDefault(chosen: string, defaultColor: string): boolean {
  const c = chosen.trim();
  const d = defaultColor.trim();
  if (!c) return true;
  if (c.toLowerCase() === d.toLowerCase()) return true;
  const cAlpha = rgbaAlpha(c);
  const dAlpha = rgbaAlpha(d);
  if (cAlpha != null && cAlpha < 1) return false;
  if (dAlpha != null && dAlpha < 1) return false;
  return colorToPickerHex(c, '') === colorToPickerHex(d, '');
}
