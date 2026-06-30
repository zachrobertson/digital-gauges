import type { AppSettings } from '@shared/types';
import { usePreferences } from '../store/preferences';

export type UnitPrefs = Pick<AppSettings, 'speedUnits' | 'distanceUnits'>;

/**
 * Fill `units` / `distanceUnits` from global preferences when absent on config.
 * Merge precedence is preserved: an explicit value on `config` (element/gauge
 * override) always wins; the global preference is only a default.
 */
export function withGlobalUnits(
  config: Record<string, unknown>,
  prefs: UnitPrefs,
): Record<string, unknown> {
  const out = { ...config };
  if (out.units == null) out.units = prefs.speedUnits;
  if (out.distanceUnits == null) out.distanceUnits = prefs.distanceUnits;
  return out;
}

/** Current global unit preferences (readable outside React, e.g. in canvas render). */
export function currentUnitPrefs(): UnitPrefs {
  const { speedUnits, distanceUnits } = usePreferences.getState().settings;
  return { speedUnits, distanceUnits };
}
