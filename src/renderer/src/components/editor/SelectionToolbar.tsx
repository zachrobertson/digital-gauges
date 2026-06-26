import type { GaugeElement } from '@shared/types/gaugeElement';
import type { GaugeLayoutConfig } from '../../gauges/gaugeEditorLayout';
import { alignElements, distributeElements, type AlignMode } from '../../gauges/gaugeLayoutAlign';
import {
  addElement,
  applyBoundsMove,
  duplicateElement,
  groupElements,
  patchElementsById,
  removeElement,
  ungroupElements,
} from '../../lib/gaugeElementFactory';

interface Props {
  selectedElementIds: string[];
  layout: GaugeLayoutConfig;
  onLayoutChange: (layout: GaugeLayoutConfig) => void;
  onSelectElements: (ids: string[]) => void;
}

export function SelectionToolbar({
  selectedElementIds,
  layout,
  onLayoutChange,
  onSelectElements,
}: Props) {
  if (selectedElementIds.length < 2) return null;

  const patchLayout = (next: GaugeLayoutConfig) => onLayoutChange(next);

  const align = (mode: AlignMode) => {
    patchLayout({
      ...layout,
      elements: alignElements(layout.elements, selectedElementIds, mode),
    });
  };

  const distribute = (axis: 'x' | 'y') => {
    patchLayout({
      ...layout,
      elements: distributeElements(layout.elements, selectedElementIds, axis),
    });
  };

  const duplicateSelection = () => {
    const newIds: string[] = [];
    let next = [...layout.elements];
    for (const id of selectedElementIds) {
      const el = next.find((e) => e.id === id);
      if (!el) continue;
      const dup = duplicateElement(el);
      const moved = { ...dup, ...applyBoundsMove(dup, 12, 12) } as GaugeElement;
      newIds.push(moved.id);
      next = addElement(next, moved);
    }
    patchLayout({ ...layout, elements: next });
    if (newIds.length > 0) onSelectElements(newIds);
  };

  const deleteSelection = () => {
    const maxDeletable = Math.max(0, layout.elements.length - 1);
    const toDelete = selectedElementIds.slice(0, maxDeletable);
    let next = layout.elements;
    for (const id of toDelete) {
      next = removeElement(next, id);
    }
    const remaining = selectedElementIds.filter((id) => !toDelete.includes(id));
    patchLayout({ ...layout, elements: next });
    onSelectElements(remaining.length > 0 ? remaining : [next[0]!.id]);
  };

  const toggleLock = () => {
    const allLocked = selectedElementIds.every((id) => {
      const el = layout.elements.find((e) => e.id === id);
      return el?.locked ?? false;
    });
    patchLayout({
      ...layout,
      elements: patchElementsById(layout.elements, selectedElementIds, () => ({ locked: !allLocked })),
    });
  };

  const groupSelection = () => {
    patchLayout({
      ...layout,
      elements: groupElements(layout.elements, selectedElementIds),
    });
  };

  const ungroupSelection = () => {
    patchLayout({
      ...layout,
      elements: ungroupElements(layout.elements, selectedElementIds),
    });
  };

  const hasGrouped = selectedElementIds.some((id) => {
    const el = layout.elements.find((e) => e.id === id);
    return el?.groupId != null;
  });

  const canDelete = layout.elements.length > 1;
  const canDistribute = selectedElementIds.length >= 3;

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[10px]">
      <span className="text-white/50 mr-1">{selectedElementIds.length} selected</span>
      <ToolbarGroup label="Align">
        <ToolbarButton title="Align left" onClick={() => align('left')}>⫷</ToolbarButton>
        <ToolbarButton title="Align center" onClick={() => align('center')}>⫿</ToolbarButton>
        <ToolbarButton title="Align right" onClick={() => align('right')}>⫸</ToolbarButton>
        <ToolbarButton title="Align top" onClick={() => align('top')}>⫠</ToolbarButton>
        <ToolbarButton title="Align middle" onClick={() => align('middle')}>⫟</ToolbarButton>
        <ToolbarButton title="Align bottom" onClick={() => align('bottom')}>⫡</ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup label="Distribute">
        <ToolbarButton title="Distribute horizontally" disabled={!canDistribute} onClick={() => distribute('x')}>⇹</ToolbarButton>
        <ToolbarButton title="Distribute vertically" disabled={!canDistribute} onClick={() => distribute('y')}>⇕</ToolbarButton>
      </ToolbarGroup>
      <ToolbarButton title="Toggle lock" onClick={toggleLock}>🔒</ToolbarButton>
      <ToolbarButton title="Group (Ctrl+G)" onClick={groupSelection}>⊞</ToolbarButton>
      <ToolbarButton title="Ungroup (Ctrl+Shift+G)" disabled={!hasGrouped} onClick={ungroupSelection}>⊟</ToolbarButton>
      <ToolbarButton title="Duplicate (+12 px)" onClick={duplicateSelection}>⧉</ToolbarButton>
      <ToolbarButton title="Delete selected" disabled={!canDelete} className="text-red-300" onClick={deleteSelection}>×</ToolbarButton>
    </div>
  );
}

function ToolbarGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 border-l border-white/10 pl-1 first:border-0 first:pl-0">
      <span className="text-white/35 mr-0.5 hidden sm:inline">{label}</span>
      {children}
    </div>
  );
}

function ToolbarButton({
  title,
  disabled,
  className = '',
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`btn-ghost px-1.5 py-0.5 text-[11px] disabled:opacity-30 ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
