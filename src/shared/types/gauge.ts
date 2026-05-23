import type { TelemetryFrame, TelemetryField } from './telemetry';

/** JSON Schema subset (Draft-7) the gauge editor knows how to render. */
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  step?: number;
  /** UI hint: 'color', 'range', 'select', 'text', 'toggle', 'font', 'number' */
  format?: string;
  /** Optional section header in the config panel. */
  group?: string;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
}

export interface JSONSchema {
  type: 'object';
  title?: string;
  description?: string;
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface GaugeRect {
  /** Relative to overlay canvas, 0..1 — keeps gauges resolution-independent. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GaugeContext {
  /** Pixel rect on the current canvas after relative→absolute conversion. */
  rect: { x: number; y: number; w: number; h: number };
  /** Frame at current playhead, with all available fields merged. */
  frame: TelemetryFrame | null;
  /** Whether we're rendering for export (off-screen) vs. live preview. */
  forExport: boolean;
  /** Device-pixel-ratio scaling factor. */
  dpr: number;
}

export interface GaugeProps {
  config: Record<string, unknown>;
  ctx: GaugeContext;
}

export interface GaugePlugin<
  Config extends object = Record<string, unknown>,
> {
  id: string;
  name: string;
  description?: string;
  /** Telemetry fields the gauge consumes — used to gray out gauges with no data. */
  fields: TelemetryField[];
  schema: JSONSchema;
  defaultConfig: Config;
  /** Default size in relative units, used when dropping a fresh gauge. */
  defaultRect: GaugeRect;
  /**
   * Canvas-based render — single source of truth.
   * The React preview is just a wrapper that drives the same render fn.
   */
  renderToCanvas: (
    canvasCtx: CanvasRenderingContext2D,
    frame: TelemetryFrame | null,
    config: Config,
    rect: { x: number; y: number; w: number; h: number },
    dpr: number,
  ) => void;
}

/** A placed instance of a gauge inside a Project layout. */
export interface GaugeInstance {
  /** Stable instance id (uuid). */
  id: string;
  /** Reference into the gauge registry. */
  pluginId: string;
  /** Z-order — higher renders on top. */
  z: number;
  rect: GaugeRect;
  config: Record<string, unknown>;
}
