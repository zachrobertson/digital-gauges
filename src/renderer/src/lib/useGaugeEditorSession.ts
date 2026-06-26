import { useCallback, useEffect, useState } from 'react';

interface PerGaugeState {
  selectedElementIds: string[];
  showGrid: boolean;
  snapEnabled: boolean;
  gridSize: number;
}

interface SessionState {
  byGauge: Record<string, PerGaugeState>;
}

const STORAGE_KEY = 'dg-gauge-editor-session';

function defaultPerGauge(): PerGaugeState {
  return {
    selectedElementIds: [],
    showGrid: true,
    snapEnabled: true,
    gridSize: 12,
  };
}

function loadSession(): SessionState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SessionState;
      return {
        byGauge: parsed.byGauge ?? {},
      };
    }
  } catch {
    /* ignore corrupt session */
  }
  return { byGauge: {} };
}

function saveSession(state: SessionState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

/** Shared gauge editor UI state for Gauges tab and Edit tab (per gauge). */
export function useGaugeEditorSession(gaugeId: string | null) {
  const [session, setSession] = useState<SessionState>(loadSession);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  useEffect(() => {
    if (!gaugeId) return;
    setSession((prev) => {
      if (prev.byGauge[gaugeId]) return prev;
      return {
        ...prev,
        byGauge: { ...prev.byGauge, [gaugeId]: defaultPerGauge() },
      };
    });
  }, [gaugeId]);

  const gaugeState = gaugeId
    ? (session.byGauge[gaugeId] ?? defaultPerGauge())
    : defaultPerGauge();

  const patchGauge = useCallback((patch: Partial<PerGaugeState>) => {
    if (!gaugeId) return;
    setSession((prev) => ({
      ...prev,
      byGauge: {
        ...prev.byGauge,
        [gaugeId]: { ...(prev.byGauge[gaugeId] ?? defaultPerGauge()), ...patch },
      },
    }));
  }, [gaugeId]);

  const setSelectedElementIds = useCallback((ids: string[]) => {
    patchGauge({ selectedElementIds: ids });
  }, [patchGauge]);

  return {
    selectedElementIds: gaugeState.selectedElementIds,
    setSelectedElementIds,
    showGrid: gaugeState.showGrid,
    setShowGrid: (v: boolean) => patchGauge({ showGrid: v }),
    snapEnabled: gaugeState.snapEnabled,
    setSnapEnabled: (v: boolean) => patchGauge({ snapEnabled: v }),
    gridSize: gaugeState.gridSize,
    setGridSize: (v: number) => patchGauge({ gridSize: v }),
    clearSelection: () => patchGauge({ selectedElementIds: [] }),
  };
}
