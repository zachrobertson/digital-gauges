import { useEffect, useState } from 'react';
import type { DistanceUnits, PreviewResolution, SpeedUnits } from '@shared/types';
import { MenuDropdown } from './MenuDropdown';
import { usePreferences } from '../../store/preferences';
import { useProject } from '../../store/project';
import { resetPreviewModuleCache } from '../../lib/usePreviewVideo';

const SPEED_OPTIONS: { value: SpeedUnits; label: string }[] = [
  { value: 'kmh', label: 'km/h' },
  { value: 'mph', label: 'mph' },
];

const DISTANCE_OPTIONS: { value: DistanceUnits; label: string }[] = [
  { value: 'km', label: 'km' },
  { value: 'mi', label: 'mi' },
];

const RESOLUTION_OPTIONS: { value: PreviewResolution; label: string }[] = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: 'source', label: 'Source' },
];

interface SettingsMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsMenu({ open, onOpenChange }: SettingsMenuProps) {
  const settings = usePreferences((s) => s.settings);
  const updateSettings = usePreferences((s) => s.updateSettings);
  const generatePreview = useProject((s) => s.generatePreview);

  const [speedUnits, setSpeedUnits] = useState<SpeedUnits>(settings.speedUnits);
  const [distanceUnits, setDistanceUnits] = useState<DistanceUnits>(settings.distanceUnits);
  const [previewResolution, setPreviewResolution] = useState<PreviewResolution>(settings.previewResolution);
  const [saving, setSaving] = useState(false);

  // Re-sync draft from persisted settings each time the dropdown opens so a
  // dismissed-without-saving menu doesn't keep stale edits.
  useEffect(() => {
    if (!open) return;
    setSpeedUnits(settings.speedUnits);
    setDistanceUnits(settings.distanceUnits);
    setPreviewResolution(settings.previewResolution);
  }, [open, settings]);

  const dirty =
    speedUnits !== settings.speedUnits
    || distanceUnits !== settings.distanceUnits
    || previewResolution !== settings.previewResolution;

  async function applySettings() {
    setSaving(true);
    try {
      const { previewResolutionChanged } = await updateSettings({
        speedUnits,
        distanceUnits,
        previewResolution,
      });
      if (previewResolutionChanged) {
        // Cached preview was encoded at the old resolution — discard and rebuild.
        resetPreviewModuleCache();
        if (useProject.getState().project.clips.length > 0) generatePreview();
      }
    } finally {
      setSaving(false);
      onOpenChange(false);
    }
  }

  return (
    <MenuDropdown label="Settings" open={open} onOpenChange={onOpenChange} panelClassName="w-[260px] px-3">
      <div className="flex flex-col gap-3 py-1">
        <Field label="Speed units">
          <select
            className="select-input"
            value={speedUnits}
            onChange={(e) => setSpeedUnits(e.target.value as SpeedUnits)}
          >
            {SPEED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Distance units">
          <select
            className="select-input"
            value={distanceUnits}
            onChange={(e) => setDistanceUnits(e.target.value as DistanceUnits)}
          >
            {DISTANCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Preview resolution">
          <select
            className="select-input"
            value={previewResolution}
            onChange={(e) => setPreviewResolution(e.target.value as PreviewResolution)}
          >
            {RESOLUTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>

        <button
          type="button"
          className="btn-primary w-full text-xs disabled:opacity-40"
          disabled={!dirty || saving}
          onClick={() => void applySettings()}
        >
          {saving ? 'Updating…' : 'Update Settings'}
        </button>
      </div>
    </MenuDropdown>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
