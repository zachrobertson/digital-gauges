import type { GaugeElement, LayoutRect } from '@shared/types/gaugeElement';
import { elementBounds, expandSelectionToGroups } from './gaugeElementFactory';

export function selectOne(id: string): string[] {
  return [id];
}

/** Replace selection, expanding to full groups when the clicked element belongs to one. */
export function selectElement(
  elements: GaugeElement[],
  id: string,
  options: { shiftKey?: boolean; current?: string[] },
): string[] {
  const { shiftKey, current = [] } = options;
  if (shiftKey) return toggleInSelection(current, id);
  return expandSelectionToGroups(elements, selectOne(id));
}

export function toggleInSelection(current: string[], id: string): string[] {
  if (current.includes(id)) {
    return current.filter((x) => x !== id);
  }
  return [...current, id];
}

export function primarySelection(ids: string[]): string | null {
  return ids[0] ?? null;
}

export function isSelected(ids: string[], id: string): boolean {
  return ids.includes(id);
}

export function selectAll(elements: GaugeElement[]): string[] {
  return elements.map((e) => e.id);
}

function rectsIntersect(a: LayoutRect, b: LayoutRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Normalize a drag box to positive width/height. */
export function normalizeDragRect(a: { x: number; y: number }, b: { x: number; y: number }): LayoutRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Box-select elements whose bounds intersect the marquee. */
export function selectInMarquee(
  elements: GaugeElement[],
  marquee: LayoutRect,
  current: string[],
  additive: boolean,
): string[] {
  const hit = elements
    .filter((el) => el.visible && !el.locked)
    .filter((el) => {
      const bounds = elementBounds(el);
      return bounds != null && rectsIntersect(bounds, marquee);
    })
    .map((el) => el.id);

  if (additive) {
    const merged = new Set([...current, ...hit]);
    return [...merged];
  }
  return hit;
}
