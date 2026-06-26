import type { GaugeElement } from '@shared/types/gaugeElement';
import { applyBoundsMove, elementBounds, isElementLocked, selectionBounds } from '../lib/gaugeElementFactory';

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function alignElements(
  elements: GaugeElement[],
  ids: string[],
  mode: AlignMode,
): GaugeElement[] {
  const bounds = selectionBounds(elements, ids);
  if (!bounds) return elements;

  const idSet = new Set(ids);
  return elements.map((el) => {
    if (!idSet.has(el.id) || isElementLocked(el)) return el;
    const elBounds = elementBounds(el);
    if (!elBounds) return el;

    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left':
        dx = bounds.x - elBounds.x;
        break;
      case 'right':
        dx = bounds.x + bounds.w - (elBounds.x + elBounds.w);
        break;
      case 'center':
        dx = bounds.x + bounds.w / 2 - (elBounds.x + elBounds.w / 2);
        break;
      case 'top':
        dy = bounds.y - elBounds.y;
        break;
      case 'bottom':
        dy = bounds.y + bounds.h - (elBounds.y + elBounds.h);
        break;
      case 'middle':
        dy = bounds.y + bounds.h / 2 - (elBounds.y + elBounds.h / 2);
        break;
    }
    if (dx === 0 && dy === 0) return el;
    return { ...el, ...applyBoundsMove(el, dx, dy) } as GaugeElement;
  });
}

export function distributeElements(
  elements: GaugeElement[],
  ids: string[],
  axis: 'x' | 'y',
): GaugeElement[] {
  if (ids.length < 3) return elements;

  const entries = ids
    .map((id) => {
      const el = elements.find((e) => e.id === id);
      if (!el || isElementLocked(el)) return null;
      const bounds = elementBounds(el);
      if (!bounds) return null;
      const key = axis === 'x' ? bounds.x + bounds.w / 2 : bounds.y + bounds.h / 2;
      return { id, el, key };
    })
    .filter((e): e is { id: string; el: GaugeElement; key: number } => e != null);

  if (entries.length < 3) return elements;

  entries.sort((a, b) => a.key - b.key);
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  const span = last.key - first.key;
  const step = span / (entries.length - 1);

  const idSet = new Set(ids);
  return elements.map((el) => {
    if (!idSet.has(el.id) || isElementLocked(el)) return el;
    const idx = entries.findIndex((e) => e.id === el.id);
    if (idx < 0) return el;
    const target = first.key + step * idx;
    const delta = target - entries[idx]!.key;
    if (delta === 0) return el;
    return {
      ...el,
      ...applyBoundsMove(el, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0),
    } as GaugeElement;
  });
}
