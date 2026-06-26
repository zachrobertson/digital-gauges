import type { TelemetryField } from './telemetry';
import type { FillGradientConfig } from './fillGradient';

export interface XY {
  x: number;
  y: number;
}

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextColorChoice = string | 'default';

/** Text slot within a data readout element. */
export interface TextSlot {
  visible: boolean;
  /** Absolute coords in the 480×270 reference frame. */
  pos: XY;
  textOverride: string;
  color: TextColorChoice;
  fontSize: number;
}

export type GaugeElementKind = 'arc' | 'bar' | 'text' | 'map' | 'staticText' | 'image';

export type TextIcon =
  | 'none'
  | 'checkeredFlag'
  | 'flag'
  | 'pin'
  | 'clock'
  | 'bolt'
  | 'heart'
  | 'mountain'
  | 'gauge'
  | 'cadence'
  | 'thermo'
  | 'trophy'
  | 'compass'
  | 'bike';

export type GpsRouteScope = 'full' | 'video';

export type MarkerStyle = 'flag' | 'line';

export interface GaugeElementBase {
  id: string;
  visible: boolean;
  /** When true, element cannot be moved or resized on canvas (layers panel still selects). */
  locked?: boolean;
  /** When false, this element ignores editor grid snap. Defaults to true when omitted. */
  snapToGrid?: boolean;
  /** Shared id for elements that move together as a group. */
  groupId?: string | null;
}

export interface ArcElement extends GaugeElementBase {
  kind: 'arc';
  field: TelemetryField;
  center: XY;
  radius: number;
  startDeg: number;
  endDeg: number;
  color?: TextColorChoice;
  showScaleLabels?: boolean;
  showArcTicks?: boolean;
  arcTickCount?: number;
  /** Stroke width of the arc track in layout pixels. Falls back to a radius-based default when omitted. */
  trackWidth?: number;
  scaleMax?: number;
  units?: 'kmh' | 'mph';
  distanceUnits?: 'km' | 'mi';
  ftp?: number;
  maxHr?: number;
  maxCadence?: number;
  maxSpeedKmh?: number;
  /** Gradual multi-stop fill gradient along the arc (min → max). */
  fillGradient?: FillGradientConfig;
}

export interface BarElement extends GaugeElementBase {
  kind: 'bar';
  field: TelemetryField;
  rect: LayoutRect;
  rounded: boolean;
  color: TextColorChoice;
  scaleMax?: number;
  units?: 'kmh' | 'mph';
  distanceUnits?: 'km' | 'mi';
  ftp?: number;
  maxHr?: number;
  maxCadence?: number;
  maxSpeedKmh?: number;
  /** Gradual multi-stop fill gradient along the bar (min → max). */
  fillGradient?: FillGradientConfig;
}

export interface TextReadoutElement extends GaugeElementBase {
  kind: 'text';
  field: TelemetryField;
  value: TextSlot;
  /** Position/style for the field-derived unit (text comes from telemetry formatting). */
  unit: TextSlot;
  scaleMax?: number;
  units?: 'kmh' | 'mph';
  distanceUnits?: 'km' | 'mi';
  ftp?: number;
  maxHr?: number;
  maxCadence?: number;
  maxSpeedKmh?: number;
}

export interface MapElement extends GaugeElementBase {
  kind: 'map';
  rect: LayoutRect;
  routeScope: GpsRouteScope;
  trailColor?: string;
  cursorColor?: string;
  showCourseStart?: boolean;
  showCourseFinish?: boolean;
  startMarkerStyle?: MarkerStyle;
  finishMarkerStyle?: MarkerStyle;
  startMarkerColor?: string;
  finishMarkerColor?: string;
  markerLength?: number;
  markerWidth?: number;
}

export interface StaticTextElement extends GaugeElementBase {
  kind: 'staticText';
  text: string;
  pos: XY;
  fontSize: number;
  color: TextColorChoice;
}

export interface ImageElement extends GaugeElementBase {
  kind: 'image';
  pos: XY;
  size: number;
  color: TextColorChoice;
  source:
    | { type: 'builtin'; icon: TextIcon }
    | { type: 'custom'; src: string };
}

export type GaugeElement =
  | ArcElement
  | BarElement
  | TextReadoutElement
  | MapElement
  | StaticTextElement
  | ImageElement;

export type DataGaugeElement = ArcElement | BarElement | TextReadoutElement | MapElement;

export function isDataElement(el: GaugeElement): el is DataGaugeElement {
  return el.kind === 'arc' || el.kind === 'bar' || el.kind === 'text' || el.kind === 'map';
}
