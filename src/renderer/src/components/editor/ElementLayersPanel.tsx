import type { GaugeElement, GaugeElementKind } from '@shared/types/gaugeElement';
import type { GaugeLayoutConfig } from '../../gauges/gaugeEditorLayout';
import { fieldLabel } from '../../gauges/fieldRegistry';
import {
  addElement,
  duplicateElement,
  ELEMENT_KIND_LABELS,
  elementLabel,
  removeElement,
  reorderElement,
  updateElement,
} from '../../lib/gaugeElementFactory';
import { isSelected, selectElement, selectOne } from '../../lib/elementSelection';

/** Generic element types users can add from the layers panel. */
const ADD_LAYER_KINDS: GaugeElementKind[] = ['bar', 'arc', 'text', 'map', 'staticText', 'image'];

interface Props {
  layout: GaugeLayoutConfig;
  selectedElementIds: string[];
  onSelectElements: (ids: string[]) => void;
  onLayoutChange: (layout: GaugeLayoutConfig) => void;
  onAddKind: (kind: GaugeElementKind) => void;
  gpsAvailable: boolean;
}

export function ElementLayersPanel({
  layout,
  selectedElementIds,
  onSelectElements,
  onLayoutChange,
  onAddKind,
  gpsAvailable,
}: Props) {
  const patchLayout = (next: GaugeLayoutConfig) => onLayoutChange(next);

  const patchElement = (id: string, patch: Partial<GaugeElement>) => {
    patchLayout({
      ...layout,
      elements: updateElement(layout.elements, id, patch),
    });
  };

  const onRowClick = (id: string, e: React.MouseEvent) => {
    onSelectElements(selectElement(layout.elements, id, {
      shiftKey: e.shiftKey || e.ctrlKey || e.metaKey,
      deepEdit: e.altKey,
      current: selectedElementIds,
    }));
  };

  const deleteLayer = (id: string) => {
    if (layout.elements.length <= 1) return;
    const next = removeElement(layout.elements, id);
    patchLayout({ ...layout, elements: next });
    if (isSelected(selectedElementIds, id)) {
      const remaining = selectedElementIds.filter((sid) => sid !== id);
      onSelectElements(remaining.length > 0 ? remaining : [next[0]!.id]);
    }
  };

  /** Top-most canvas layer first (last in paint order). */
  const layersTopFirst = [...layout.elements].reverse();

  return (
    <div className="border border-white/10 rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="field-label text-[10px] uppercase tracking-wider">Layers</div>
        <span className="text-[10px] text-white/40">{layout.elements.length}</span>
      </div>
      {layout.elements.length === 0 ? (
        <p className="text-xs text-white/40">No elements yet — add one below.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {layersTopFirst.map((el) => {
            const idx = layout.elements.findIndex((e) => e.id === el.id);
            const on = isSelected(selectedElementIds, el.id);
            const locked = el.locked ?? false;
            const grouped = el.groupId ? ' · group' : '';
            return (
              <li key={el.id} className="flex items-center gap-1">
                <button
                  type="button"
                  className={`btn-ghost text-[10px] px-1 shrink-0 ${el.visible ? 'text-white/70' : 'text-white/30'}`}
                  title={el.visible ? 'Hide layer' : 'Show layer'}
                  onClick={() => patchElement(el.id, { visible: !el.visible })}
                >
                  {el.visible ? '◉' : '○'}
                </button>
                <button
                  type="button"
                  className={`btn-ghost text-[10px] px-1 shrink-0 ${locked ? 'text-amber-300/90' : 'text-white/40'}`}
                  title={locked ? 'Unlock layer' : 'Lock layer'}
                  onClick={() => patchElement(el.id, { locked: !locked })}
                >
                  {locked ? '🔒' : '🔓'}
                </button>
                <button
                  type="button"
                  className={`flex-1 text-left rounded px-2 py-1.5 text-xs border transition-colors ${
                    on ? 'border-accent bg-accent/15 text-white' : 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10'
                  } ${!el.visible ? 'opacity-50' : ''} ${locked ? 'italic' : ''}`}
                  onClick={(e) => onRowClick(el.id, e)}
                >
                  {layerLabel(el)}{grouped}
                </button>
                <button
                  type="button"
                  className="btn-ghost text-[10px] px-1"
                  disabled={idx === layout.elements.length - 1}
                  title="Move forward"
                  onClick={() => patchLayout({ ...layout, elements: reorderElement(layout.elements, el.id, 'down') })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-ghost text-[10px] px-1"
                  disabled={idx === 0}
                  title="Move backward"
                  onClick={() => patchLayout({ ...layout, elements: reorderElement(layout.elements, el.id, 'up') })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn-ghost text-[10px] px-1"
                  title="Duplicate"
                  onClick={() => {
                    const dup = duplicateElement(el);
                    patchLayout({ ...layout, elements: addElement(layout.elements, dup) });
                    onSelectElements(selectOne(dup.id));
                  }}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="btn-ghost text-[10px] px-1 text-red-300 disabled:opacity-30"
                  title={layout.elements.length <= 1 ? 'At least one element is required' : 'Delete layer'}
                  disabled={layout.elements.length <= 1}
                  onClick={() => deleteLayer(el.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-white/10">
        <div className="field-label text-[10px] uppercase tracking-wider text-white/45">Add layer</div>
        <div className="flex flex-wrap gap-1">
          {ADD_LAYER_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={kind === 'map' && !gpsAvailable}
              title={kind === 'map' && !gpsAvailable ? 'Requires lat/lon telemetry' : undefined}
              className="text-[10px] px-2 py-1 rounded border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-30"
              onClick={() => onAddKind(kind)}
            >
              + {ELEMENT_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function layerLabel(element: GaugeElement): string {
  if (element.kind === 'text') {
    return `${ELEMENT_KIND_LABELS.text} · ${fieldLabel(element.field)}`;
  }
  if (element.kind === 'bar' || element.kind === 'arc') {
    return `${ELEMENT_KIND_LABELS[element.kind]} · ${fieldLabel(element.field)}`;
  }
  return elementLabel(element);
}
