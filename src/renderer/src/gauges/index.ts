import type { GaugePlugin } from '@shared/types';
import { dataGauge } from './dataGauge';
import { speedometer } from './speedometer';
import { power } from './power';
import { heartRate } from './heartRate';
import { cadence } from './cadence';
import { gpsMiniMap } from './gpsMiniMap';

/** Primary built-in gauge — legacy plugins kept for backward-compatible load/render. */
export const BUILTIN_GAUGES: GaugePlugin[] = [
  dataGauge as unknown as GaugePlugin,
  speedometer as unknown as GaugePlugin,
  power as unknown as GaugePlugin,
  heartRate as unknown as GaugePlugin,
  cadence as unknown as GaugePlugin,
  gpsMiniMap as unknown as GaugePlugin,
];
