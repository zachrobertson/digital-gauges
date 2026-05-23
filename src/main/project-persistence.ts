import { app } from 'electron';

import { access, readFile, unlink, writeFile } from 'node:fs/promises';

import { join } from 'node:path';

import type { Project, TrackSyncSettings, GaugeInstance } from '../shared/types';
import type { RecoveryInfo } from '../shared/types/ipc';
import type { TelemetryField } from '../shared/types/telemetry';

import { DEFAULT_TRACK_SYNC } from '../shared/types/sync';

const DATA_GAUGE_PLUGIN_ID = 'builtin:dataGauge';

const LEGACY_GAUGE_MIGRATION: Record<string, { field?: TelemetryField; displayStyle?: string }> = {
  'builtin:speedometer': { field: 'speed' },
  'builtin:power': { field: 'power' },
  'builtin:hr': { field: 'hr' },
  'builtin:cadence': { field: 'cadence' },
  'builtin:gpsMiniMap': { displayStyle: 'map' },
};

function migrateGauge(g: GaugeInstance): GaugeInstance {
  const migration = LEGACY_GAUGE_MIGRATION[g.pluginId];
  if (!migration) return g;
  return {
    ...g,
    pluginId: DATA_GAUGE_PLUGIN_ID,
    config: {
      ...g.config,
      ...(migration.field ? { field: migration.field } : {}),
      ...(migration.displayStyle ? { displayStyle: migration.displayStyle } : {}),
    },
  };
}



export interface AppSettings {
  lastProjectPath: string | null;
}

function draftPath(): string {

  return join(app.getPath('userData'), 'draft.dgproj');

}



function settingsPath(): string {

  return join(app.getPath('userData'), 'settings.json');

}



async function fileExists(path: string): Promise<boolean> {

  try {

    await access(path);

    return true;

  } catch {

    return false;

  }

}



/** Migrate legacy flat offsets map to trackSync settings. */

function migrateTrackSync(raw: Record<string, unknown>): Record<string, TrackSyncSettings> {

  const legacy = raw as { trackSync?: Record<string, TrackSyncSettings>; offsets?: Record<string, number> };



  if (legacy.trackSync && typeof legacy.trackSync === 'object') {

    const out: Record<string, TrackSyncSettings> = {};

    for (const [id, sync] of Object.entries(legacy.trackSync)) {

      out[id] = normalizeTrackSyncEntry(sync);

    }

    return out;

  }



  const out: Record<string, TrackSyncSettings> = {};

  const offsets = legacy.offsets && typeof legacy.offsets === 'object' ? legacy.offsets : {};

  for (const [id, offsetMs] of Object.entries(offsets)) {

    if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs)) continue;

    out[id] = { ...DEFAULT_TRACK_SYNC, offsetMs, anchor: 'manual' };

  }

  return out;

}



function normalizeTrackSyncEntry(sync: Partial<TrackSyncSettings> | undefined): TrackSyncSettings {

  const anchor = sync?.anchor ?? DEFAULT_TRACK_SYNC.anchor;

  const validAnchor = anchor === 'videoStart' || anchor === 'videoEnd' || anchor === 'utc' || anchor === 'manual'

    ? anchor

    : DEFAULT_TRACK_SYNC.anchor;

  return {

    offsetMs: typeof sync?.offsetMs === 'number' && Number.isFinite(sync.offsetMs) ? sync.offsetMs : 0,

    playSpeedPercent: typeof sync?.playSpeedPercent === 'number' && sync.playSpeedPercent > 0

      ? sync.playSpeedPercent

      : 100,

    anchor: validAnchor,

  };

}



/** Ensure loaded/saved projects have required fields. */

export function normalizeProject(raw: unknown): Project {

  const p = raw as Project & { offsets?: Record<string, number> };

  const video = p.video

    ? {

        ...p.video,

        creationTime: typeof p.video.creationTime === 'string' ? p.video.creationTime : undefined,

      }

    : null;



  return {

    version: 1,

    id: p.id ?? crypto.randomUUID(),

    name: p.name ?? 'Untitled Ride',

    createdAt: p.createdAt ?? new Date().toISOString(),

    updatedAt: p.updatedAt ?? new Date().toISOString(),

    video,

    tracks: Array.isArray(p.tracks) ? p.tracks : [],

    trackSync: migrateTrackSync(raw as Record<string, unknown>),

    gauges: Array.isArray(p.gauges) ? p.gauges.map(migrateGauge) : [],

    export: {

      codec: p.export?.codec ?? 'h264',

      crf: p.export?.crf ?? 18,

      fps: p.export?.fps ?? 30,

      resolution: p.export?.resolution ?? 'source',

      outputPath: p.export?.outputPath ?? null,

    },

  };

}



function projectHasSessionContent(project: Project): boolean {

  return project.video !== null || project.tracks.length > 0 || project.gauges.length > 0;

}



export async function readSettings(): Promise<AppSettings> {

  try {

    const raw = await readFile(settingsPath(), 'utf8');

    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    return { lastProjectPath: parsed.lastProjectPath ?? null };

  } catch {

    return { lastProjectPath: null };

  }

}



export async function writeSettings(patch: Partial<AppSettings>): Promise<void> {

  const current = await readSettings();

  await writeFile(settingsPath(), JSON.stringify({ ...current, ...patch }, null, 2), 'utf8');

}



export async function saveDraft(project: Project): Promise<void> {

  const normalized = normalizeProject(project);

  await writeFile(draftPath(), JSON.stringify(normalized, null, 2), 'utf8');

}



export async function loadDraft(): Promise<Project | null> {

  if (!(await fileExists(draftPath()))) return null;

  const raw = await readFile(draftPath(), 'utf8');

  return normalizeProject(JSON.parse(raw));

}



export async function clearDraft(): Promise<void> {

  if (!(await fileExists(draftPath()))) return;

  await unlink(draftPath());

}



export async function getRecoveryInfo(): Promise<RecoveryInfo> {

  const settings = await readSettings();

  const draftFile = draftPath();

  const hasDraftFile = await fileExists(draftFile);

  let hasDraft = false;

  let draftUpdatedAt: string | null = null;



  if (hasDraftFile) {

    try {

      const draft = await loadDraft();

      if (draft && projectHasSessionContent(draft)) {

        hasDraft = true;

        draftUpdatedAt = draft.updatedAt;

      }

    } catch {

      hasDraft = false;

    }

  }



  const lastProjectPath = settings.lastProjectPath;

  const lastProjectExists = lastProjectPath ? await fileExists(lastProjectPath) : false;



  return { hasDraft, draftUpdatedAt, lastProjectPath, lastProjectExists };

}


