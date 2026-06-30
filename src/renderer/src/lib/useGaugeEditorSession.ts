import { useCallback, useEffect, useState } from 'react';

interface PerGaugeState {
  selectedElementIds: string[];
  /** Panel frame outline + resize handles in the stage preview. */
  showFrameBounds: boolean;
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
    showFrameBounds: true,
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

function readPerGaugeState(gaugeId: string): PerGaugeState {
  const state = loadSession().byGauge[gaugeId];
  if (!state) return defaultPerGauge();
  return { ...defaultPerGauge(), ...state };
}

/** True when Escape should deselect the gauge (no element or frame bounds active). */
export function canCloseGaugeEditorOnEscape(gaugeId: string): boolean {
  const state = readPerGaugeState(gaugeId);
  return state.selectedElementIds.length === 0 && !state.showFrameBounds;
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
    setSession((prev) => {
      const next = {
        ...prev,
        byGauge: {
          ...prev.byGauge,
          [gaugeId]: { ...(prev.byGauge[gaugeId] ?? defaultPerGauge()), ...patch },
        },
      };
      saveSession(next);
      return next;
    });
  }, [gaugeId]);

  const setSelectedElementIds = useCallback((ids: string[]) => {
    patchGauge({ selectedElementIds: ids });
  }, [patchGauge]);

  return {
    selectedElementIds: gaugeState.selectedElementIds,
    setSelectedElementIds,
    showFrameBounds: gaugeState.showFrameBounds,
    setShowFrameBounds: (v: boolean) => patchGauge({ showFrameBounds: v }),
    showGrid: gaugeState.showGrid,
    setShowGrid: (v: boolean) => patchGauge({ showGrid: v }),
    snapEnabled: gaugeState.snapEnabled,
    setSnapEnabled: (v: boolean) => patchGauge({ snapEnabled: v }),
    gridSize: gaugeState.gridSize,
    setGridSize: (v: number) => patchGauge({ gridSize: v }),
    clearSelection: () => patchGauge({ selectedElementIds: [] }),
  };
}
