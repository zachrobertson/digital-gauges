import type { GaugeRect } from './gauge';
import type { TelemetryField } from './telemetry';

export type DataGaugeDisplayStyle = 'bar' | 'arc' | 'text' | 'map';

export interface GaugeTemplateGaugeSpec {
  displayStyle: DataGaugeDisplayStyle;
  field?: TelemetryField;
  config: Record<string, unknown>;
  rect?: GaugeRect;
  z?: number;
}

export interface GaugeTemplateFile {
  version: 1;
  id: string;
  name: string;
  type: 'single' | 'layout';
  createdAt: string;
  updatedAt: string;
  gauge?: GaugeTemplateGaugeSpec;
  gauges?: GaugeTemplateGaugeSpec[];
}

export interface GaugeTemplateSummary {
  id: string;
  name: string;
  type: 'single' | 'layout';
  updatedAt: string;
  filePath: string;
}
