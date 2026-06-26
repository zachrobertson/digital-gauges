import type {
  ArcElement,
  BarElement,
  GaugeElement,
  GaugeElementKind,
  ImageElement,
  LayoutRect,
  MapElement,
  StaticTextElement,
  TextReadoutElement,
  TextSlot,
  XY,
} from '@shared/types/gaugeElement';
import type { TelemetryField } from '@shared/types';
import {
  arcSelectionBounds,
  DEFAULT_GAUGE_RECT,
  LAYOUT_REF_H,
  LAYOUT_REF_W,
  MIN_BAR_LENGTH,
  defaultBarConfig,
  defaultMapRect,
} from '../gauges/gaugeEditorLayout';

export const ELEMENT_KIND_LABELS: Record<GaugeElementKind, string> = {
  arc: 'Arc dial',
  bar: 'Bar gauge',
  text: 'Data readout',
  map: 'Route map',
  staticText: 'Text',
  image: 'Image',
};

export const DATA_ELEMENT_KINDS: GaugeElementKind[] = ['arc', 'bar', 'text', 'map'];

function newId(): string {
  return crypto.randomUUID();
}

function defaultArcCenter(gaugeRect: LayoutRect): XY {
  return {
    x: Math.round(gaugeRect.x + gaugeRect.w / 2),
    y: Math.round(gaugeRect.y + gaugeRect.h / 2),
  };
}

function defaultArcRadius(gaugeRect: LayoutRect): number {
  return Math.round((Math.min(gaugeRect.w, gaugeRect.h) / 2) * 0.65);
}

export function defaultTextSlot(
  role: 'value' | 'unit',
  gaugeRect: LayoutRect,
): TextSlot {
  const cx = gaugeRect.x + gaugeRect.w * 0.5;
  const baseline = (yFrac: number) => gaugeRect.y + gaugeRect.h * yFrac;
  if (role === 'value') {
    return { visible: true, pos: { x: cx, y: baseline(0.52) }, textOverride: '', color: 'default', fontSize: 36 };
  }
  return { visible: true, pos: { x: cx, y: baseline(0.78) }, textOverride: '', color: 'default', fontSize: 12 };
}

/** Strip legacy label slot and ensure unit exists on saved readouts. */
export function normalizeTextReadout(element: TextReadoutElement, gaugeRect: LayoutRect): TextReadoutElement {
  const legacy = element as TextReadoutElement & { label?: TextSlot };
  const { label: _label, ...rest } = legacy;
  return {
    ...rest,
    unit: rest.unit ?? defaultTextSlot('unit', gaugeRect),
  };
}

export function normalizeGaugeElements(elements: GaugeElement[], gaugeRect: LayoutRect): GaugeElement[] {
  return elements.map((el) => {
    const normalized = el.kind === 'text' ? normalizeTextReadout(el, gaugeRect) : el;
    return {
      ...normalized,
      locked: normalized.locked ?? false,
      snapToGrid: normalized.snapToGrid ?? true,
      groupId: normalized.groupId ?? null,
    };
  });
}

export function groupElements(elements: GaugeElement[], ids: string[]): GaugeElement[] {
  if (ids.length < 2) return elements;
  const groupId = crypto.randomUUID();
  const idSet = new Set(ids);
  return elements.map((e) => (idSet.has(e.id) ? { ...e, groupId } : e));
}

export function ungroupElements(elements: GaugeElement[], ids: string[]): GaugeElement[] {
  const idSet = new Set(ids);
  const groupIds = new Set(
    elements.filter((e) => idSet.has(e.id) && e.groupId).map((e) => e.groupId!),
  );
  if (groupIds.size === 0) return elements;
  return elements.map((e) => (e.groupId && groupIds.has(e.groupId) ? { ...e, groupId: null } : e));
}

/** Include all members sharing a groupId with any selected element. */
export function expandSelectionToGroups(elements: GaugeElement[], ids: string[]): string[] {
  const expanded = new Set(ids);
  const groupIds = new Set<string>();
  for (const id of ids) {
    const el = elements.find((e) => e.id === id);
    if (el?.groupId) groupIds.add(el.groupId);
  }
  if (groupIds.size === 0) return ids;
  for (const el of elements) {
    if (el.groupId && groupIds.has(el.groupId)) expanded.add(el.id);
  }
  return [...expanded];
}

export function isElementLocked(element: GaugeElement): boolean {
  return element.locked ?? false;
}

/** True when omitted — element participates in editor grid snap. */
export function elementSnapsToGrid(element: GaugeElement): boolean {
  return element.snapToGrid !== false;
}

export function shouldSnapElement(element: GaugeElement, editorSnapEnabled: boolean): boolean {
  return editorSnapEnabled && elementSnapsToGrid(element);
}

export function createBarElement(
  gaugeRect: LayoutRect = DEFAULT_GAUGE_RECT,
  field: TelemetryField = 'speed',
): BarElement {
  const bar = defaultBarConfig(gaugeRect);
  return {
    id: newId(),
    visible: true,
    kind: 'bar',
    field,
    rect: { ...bar.rect },
    rounded: bar.rounded,
    color: bar.color,
  };
}

export function createArcElement(
  gaugeRect: LayoutRect = DEFAULT_GAUGE_RECT,
  field: TelemetryField = 'speed',
): ArcElement {
  return {
    id: newId(),
    visible: true,
    kind: 'arc',
    field,
    center: defaultArcCenter(gaugeRect),
    radius: defaultArcRadius(gaugeRect),
    startDeg: 30,
    endDeg: 330,
    color: 'default',
    showScaleLabels: true,
    showArcTicks: true,
    arcTickCount: 8,
  };
}

export function createTextReadoutElement(
  gaugeRect: LayoutRect = DEFAULT_GAUGE_RECT,
  field: TelemetryField = 'speed',
): TextReadoutElement {
  return {
    id: newId(),
    visible: true,
    kind: 'text',
    field,
    value: defaultTextSlot('value', gaugeRect),
    unit: defaultTextSlot('unit', gaugeRect),
  };
}

export function createMapElement(gaugeRect: LayoutRect = DEFAULT_GAUGE_RECT): MapElement {
  return {
    id: newId(),
    visible: true,
    kind: 'map',
    rect: defaultMapRect(gaugeRect),
    routeScope: 'video',
    trailColor: '#3ddc97',
    cursorColor: '#ffffff',
    showCourseStart: true,
    showCourseFinish: true,
    startMarkerStyle: 'line',
    finishMarkerStyle: 'line',
    startMarkerColor: '#22c55e',
    finishMarkerColor: '#111111',
    markerLength: 56,
    markerWidth: 30,
  };
}

export function createStaticTextElement(gaugeRect: LayoutRect = DEFAULT_GAUGE_RECT): StaticTextElement {
  return {
    id: newId(),
    visible: true,
    kind: 'staticText',
    text: 'Label',
    pos: { x: gaugeRect.x + gaugeRect.w * 0.5, y: gaugeRect.y + gaugeRect.h * 0.3 },
    fontSize: 14,
    color: 'default',
  };
}

export function createImageElement(gaugeRect: LayoutRect = DEFAULT_GAUGE_RECT): ImageElement {
  return {
    id: newId(),
    visible: true,
    kind: 'image',
    pos: { x: gaugeRect.x + gaugeRect.w * 0.5, y: gaugeRect.y + gaugeRect.h * 0.32 },
    size: Math.max(12, Math.round(gaugeRect.h * 0.16)),
    color: 'default',
    source: { type: 'builtin', icon: 'checkeredFlag' },
  };
}

export function createElement(
  kind: GaugeElementKind,
  gaugeRect: LayoutRect = DEFAULT_GAUGE_RECT,
  field: TelemetryField = 'speed',
): GaugeElement {
  switch (kind) {
    case 'arc': return createArcElement(gaugeRect, field);
    case 'bar': return createBarElement(gaugeRect, field);
    case 'text': return createTextReadoutElement(gaugeRect, field);
    case 'map': return createMapElement(gaugeRect);
    case 'staticText': return createStaticTextElement(gaugeRect);
    case 'image': return createImageElement(gaugeRect);
  }
}

export function defaultGaugeElements(
  gaugeRect: LayoutRect = DEFAULT_GAUGE_RECT,
  field: TelemetryField = 'speed',
): GaugeElement[] {
  return [createBarElement(gaugeRect, field)];
}

export function defaultMapGaugeElements(gaugeRect: LayoutRect): GaugeElement[] {
  return [
    createMapElement(gaugeRect),
    {
      ...createStaticTextElement(gaugeRect),
      text: 'ROUTE',
      fontSize: 11,
      pos: { x: gaugeRect.x + gaugeRect.w * 0.12, y: gaugeRect.y + gaugeRect.h * 0.12 },
    },
  ];
}

export function duplicateElement(element: GaugeElement): GaugeElement {
  const clone = structuredClone(element);
  clone.id = newId();
  clone.groupId = null;
  return clone;
}

export function findElement(elements: GaugeElement[], id: string): GaugeElement | undefined {
  return elements.find((e) => e.id === id);
}

export function updateElement<T extends GaugeElement>(
  elements: GaugeElement[],
  id: string,
  patch: Partial<T>,
): GaugeElement[] {
  return elements.map((e) => (e.id === id ? { ...e, ...patch } as GaugeElement : e));
}

export function addElement(elements: GaugeElement[], element: GaugeElement): GaugeElement[] {
  return [...elements, element];
}

export function removeElement(elements: GaugeElement[], id: string): GaugeElement[] {
  return elements.filter((e) => e.id !== id);
}

export function reorderElement(
  elements: GaugeElement[],
  id: string,
  direction: 'up' | 'down',
): GaugeElement[] {
  const idx = elements.findIndex((e) => e.id === id);
  if (idx < 0) return elements;
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= elements.length) return elements;
  const next = [...elements];
  [next[idx], next[swap]] = [next[swap]!, next[idx]!];
  return next;
}

/** Hit-test area for a text slot derived from its font size. */
function defaultTextSlotBoxSize(fontSize: number): { w: number; h: number } {
  return { w: fontSize * 6, h: fontSize * 1.2 };
}

/** Hit-test area for static text derived from content metrics. */
function defaultStaticTextBoxSize(text: string, fontSize: number): { w: number; h: number } {
  return {
    w: fontSize * (text.length * 0.35 + 1) * 2,
    h: fontSize * 1.2,
  };
}

/** Layout rect for hit-testing a single text slot (value or unit). */
export function textSlotBounds(slot: TextSlot): LayoutRect | null {
  if (!slot.visible) return null;
  const { w, h } = defaultTextSlotBoxSize(slot.fontSize);
  return {
    x: slot.pos.x - w / 2,
    y: slot.pos.y - h / 2,
    w,
    h,
  };
}

/** Point used for grid snap and the center move handle. */
export function elementSnapCenter(element: GaugeElement): XY | null {
  switch (element.kind) {
    case 'bar':
    case 'map':
      return { x: element.rect.x + element.rect.w / 2, y: element.rect.y + element.rect.h / 2 };
    case 'arc':
      return { ...element.center };
    case 'staticText':
    case 'image':
      return { ...element.pos };
    case 'text': {
      const bounds = elementBounds(element);
      if (!bounds) return null;
      return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    }
    default:
      return null;
  }
}

/** Layout rect in layout coords for hit-testing and multi-select union. */
export function elementBounds(element: GaugeElement): LayoutRect | null {
  switch (element.kind) {
    case 'bar':
    case 'map':
      return { ...element.rect };
    case 'arc':
      return arcSelectionBounds(element.center, element.radius, element.trackWidth);
    case 'text': {
      const slotBounds = [element.value, element.unit]
        .map((s) => textSlotBounds(s))
        .filter((b): b is LayoutRect => b != null);
      if (slotBounds.length === 0) return null;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const b of slotBounds) {
        minX = Math.min(minX, b.x);
        maxX = Math.max(maxX, b.x + b.w);
        minY = Math.min(minY, b.y);
        maxY = Math.max(maxY, b.y + b.h);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'staticText': {
      const { w, h } = defaultStaticTextBoxSize(element.text, element.fontSize);
      return {
        x: element.pos.x - w / 2,
        y: element.pos.y - h / 2,
        w,
        h,
      };
    }
    case 'image': {
      const h = element.size;
      const w = h * 1.1;
      return {
        x: element.pos.x - w / 2,
        y: element.pos.y - h / 2,
        w,
        h,
      };
    }
    default:
      return null;
  }
}

/** Move an element by a layout-space delta. */
export function applyBoundsMove(element: GaugeElement, dx: number, dy: number): Partial<GaugeElement> {
  switch (element.kind) {
    case 'bar':
    case 'map':
      return { rect: { ...element.rect, x: element.rect.x + dx, y: element.rect.y + dy } };
    case 'arc':
      return { center: { x: element.center.x + dx, y: element.center.y + dy } };
    case 'text':
      return {
        value: { ...element.value, pos: { x: element.value.pos.x + dx, y: element.value.pos.y + dy } },
        unit: { ...element.unit, pos: { x: element.unit.pos.x + dx, y: element.unit.pos.y + dy } },
      };
    case 'staticText':
      return { pos: { x: element.pos.x + dx, y: element.pos.y + dy } };
    case 'image':
      return { pos: { x: element.pos.x + dx, y: element.pos.y + dy } };
    default:
      return {};
  }
}

/** Union bounding box for a set of element ids. */
export function selectionBounds(elements: GaugeElement[], ids: string[]): LayoutRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const id of ids) {
    const el = elements.find((e) => e.id === id);
    if (!el) continue;
    const bounds = elementBounds(el);
    if (!bounds) continue;
    found = true;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
  }
  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Move many elements by a layout-space delta. */
export function applyBoundsMoveMany(
  elements: GaugeElement[],
  ids: string[],
  dx: number,
  dy: number,
): GaugeElement[] {
  if (dx === 0 && dy === 0) return elements;
  const idSet = new Set(ids);
  return elements.map((e) => {
    if (!idSet.has(e.id)) return e;
    return { ...e, ...applyBoundsMove(e, dx, dy) } as GaugeElement;
  });
}

/** Apply a per-element patch to all ids in the set. */
export function patchElementsById(
  elements: GaugeElement[],
  ids: string[],
  patchFn: (el: GaugeElement) => Partial<GaugeElement>,
): GaugeElement[] {
  const idSet = new Set(ids);
  return elements.map((e) => (idSet.has(e.id) ? { ...e, ...patchFn(e) } as GaugeElement : e));
}

export function pointInElement(element: GaugeElement, point: XY, padding = 6): boolean {
  const bounds = elementBounds(element);
  if (!bounds) return false;
  return (
    point.x >= bounds.x - padding
    && point.x <= bounds.x + bounds.w + padding
    && point.y >= bounds.y - padding
    && point.y <= bounds.y + bounds.h + padding
  );
}

export function elementLabel(element: GaugeElement): string {
  const kind = ELEMENT_KIND_LABELS[element.kind];
  if (element.kind === 'staticText') return `${kind}: ${element.text.slice(0, 20)}`;
  if (element.kind === 'image') {
    const src = element.source.type === 'builtin' ? element.source.icon : 'custom';
    return `${kind} (${src})`;
  }
  if (element.kind === 'map') return kind;
  return `${kind} · ${element.field}`;
}

export function hasCompositeLayout(layout: unknown): boolean {
  return layout != null
    && typeof layout === 'object'
    && 'elements' in layout
    && Array.isArray((layout as { elements: unknown }).elements);
}

export function isCompositeGaugeConfig(config: Record<string, unknown>): boolean {
  return hasCompositeLayout(config.layout);
}
