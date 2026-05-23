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
