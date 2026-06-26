import { useEffect, type RefObject } from 'react';
import type { GaugeElement } from '@shared/types/gaugeElement';
import type { GaugeLayoutConfig } from '../gauges/gaugeEditorLayout';
import {
  addElement,
  applyBoundsMove,
  applyBoundsMoveMany,
  duplicateElement,
  findElement,
  groupElements,
  isElementLocked,
  removeElement,
  ungroupElements,
} from './gaugeElementFactory';
import { selectAll } from './elementSelection';

interface Options {
  containerRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
  selectedElementIds: string[];
  onSelectElements: (ids: string[]) => void;
  layout: GaugeLayoutConfig;
  onLayoutChange: (layout: GaugeLayoutConfig) => void;
  gridSize?: number;
}

function duplicateSelected(
  elements: GaugeElement[],
  ids: string[],
  offset = 12,
): { elements: GaugeElement[]; newIds: string[] } {
  const newIds: string[] = [];
  let next = [...elements];
  for (const id of ids) {
    const el = findElement(next, id);
    if (!el) continue;
    const dup = duplicateElement(el);
    const moved = { ...dup, ...applyBoundsMove(dup, offset, offset) } as GaugeElement;
    newIds.push(moved.id);
    next = addElement(next, moved);
  }
  return { elements: next, newIds };
}

function deleteSelected(
  elements: GaugeElement[],
  ids: string[],
): { elements: GaugeElement[]; remainingIds: string[] } {
  const maxDeletable = Math.max(0, elements.length - 1);
  const toDelete = ids.slice(0, maxDeletable);
  let next = elements;
  for (const id of toDelete) {
    next = removeElement(next, id);
  }
  const remainingIds = ids.filter((id) => !toDelete.includes(id));
  return { elements: next, remainingIds };
}

export function useElementEditorShortcuts({
  containerRef,
  enabled = true,
  selectedElementIds,
  onSelectElements,
  layout,
  onLayoutChange,
  gridSize = 12,
}: Options) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.tagName === 'SELECT'
        || target?.isContentEditable
      ) {
        return;
      }

      if (containerRef?.current && !containerRef.current.contains(document.activeElement)) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'BODY' && tag !== 'HTML') return;
      }

      const mod = e.metaKey || e.ctrlKey;

      if (e.key === 'Escape') {
        e.preventDefault();
        onSelectElements([]);
        return;
      }

      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        onSelectElements(selectAll(layout.elements));
        return;
      }

      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedElementIds.length === 0) return;
        const { elements, newIds } = duplicateSelected(layout.elements, selectedElementIds);
        onLayoutChange({ ...layout, elements });
        onSelectElements(newIds);
        return;
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (selectedElementIds.length === 0) return;
        onLayoutChange({
          ...layout,
          elements: ungroupElements(layout.elements, selectedElementIds),
        });
        return;
      }

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (selectedElementIds.length < 2) return;
        onLayoutChange({
          ...layout,
          elements: groupElements(layout.elements, selectedElementIds),
        });
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementIds.length > 0) {
        e.preventDefault();
        const { elements, remainingIds } = deleteSelected(layout.elements, selectedElementIds);
        onLayoutChange({ ...layout, elements });
        onSelectElements(remainingIds.length > 0 ? remainingIds : [elements[0]!.id]);
        return;
      }

      if (selectedElementIds.length === 0) return;

      const step = e.shiftKey ? gridSize : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;

      e.preventDefault();
      const movableIds = selectedElementIds.filter((id) => {
        const el = findElement(layout.elements, id);
        return el && !isElementLocked(el);
      });
      if (movableIds.length === 0) return;
      onLayoutChange({
        ...layout,
        elements: applyBoundsMoveMany(layout.elements, movableIds, dx, dy),
      });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    containerRef,
    enabled,
    gridSize,
    layout,
    onLayoutChange,
    onSelectElements,
    selectedElementIds,
  ]);
}
