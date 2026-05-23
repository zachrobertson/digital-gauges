import { useEffect, useState } from 'react';
import type { GaugePlugin } from '@shared/types';

interface Props {
  open: boolean;
  plugins: GaugePlugin[];
  onConfirm: (plugin: GaugePlugin) => void;
  onCancel: () => void;
}

export function UserPluginPickerDialog({ open, plugins, onConfirm, onCancel }: Props) {
  const [selectedId, setSelectedId] = useState(plugins[0]?.id ?? '');

  useEffect(() => {
    if (open && plugins[0]) setSelectedId(plugins[0].id);
  }, [open, plugins]);

  if (!open || plugins.length === 0) return null;

  const selected = plugins.find((p) => p.id === selectedId) ?? plugins[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="panel w-full max-w-sm p-5 flex flex-col gap-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-plugin-picker-title"
      >
        <h2 id="user-plugin-picker-title" className="text-base font-semibold">
          Add user plugin gauge
        </h2>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Plugin</label>
          <select
            className="select-input"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {plugins.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {selected?.description && (
            <p className="text-xs text-white/40">{selected.description}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!selected}
            onClick={() => selected && onConfirm(selected)}
          >
            Add gauge
          </button>
        </div>
      </div>
    </div>
  );
}
