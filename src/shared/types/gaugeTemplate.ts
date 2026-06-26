import type { GaugeRect } from './gauge';

/** Composite gauge spec — elements live in `config.layout.elements`. */
export interface GaugeTemplateGaugeSpec {
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
  /** Bundled starter templates are tagged 'builtin' and cannot be deleted. */
  source?: 'builtin' | 'user';
}
