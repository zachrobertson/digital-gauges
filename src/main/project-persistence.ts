import { app } from 'electron';
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  MediaSource,
  Project,
  TimelineClip,
  TrackSyncSettings,
  GaugeInstance,
  VideoOverlayClip,
} from '../shared/types';
import type { TelemetryTrack } from '../shared/types/telemetry';
import type { RecoveryInfo } from '../shared/types/ipc';
import { assignClipTimelinePositions } from '../shared/timeline';
import { DEFAULT_TRACK_SYNC } from '../shared/types/sync';

const DATA_GAUGE_PLUGIN_ID = 'builtin:dataGauge';

const LEGACY_GAUGE_MIGRATION: Record<string, { field?: TelemetryField; displayStyle?: string }> = {
  'builtin:speedometer': { field: 'speed' },
  'builtin:power': { field: 'power' },
  'builtin:hr': { field: 'hr' },
  'builtin:cadence': { field: 'cadence' },
  'builtin:gpsMiniMap': { displayStyle: 'map' },
};

type TelemetryField = import('../shared/types/telemetry').TelemetryField;

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

function normalizeMediaSource(raw: unknown): MediaSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as MediaSource;
  if (typeof m.path !== 'string' || typeof m.durationMs !== 'number') return null;
  return {
    ...m,
    creationTime: typeof m.creationTime === 'string' ? m.creationTime : undefined,
  };
}

function normalizeClip(raw: unknown): TimelineClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as TimelineClip;
  const media = normalizeMediaSource(c.media);
  if (!media) return null;
  // Video telemetry was removed: keep only FIT local tracks; legacy camera
  // tracks from older projects are discarded.
  const localTracks = (Array.isArray(c.localTracks) ? c.localTracks : []).filter(
    (t) => t.source === 'fit',
  );
  const keptTrackIds = new Set(localTracks.map((t) => t.id));
  const localTrackSync: Record<string, TrackSyncSettings> = {};
  if (c.localTrackSync && typeof c.localTrackSync === 'object') {
    for (const [id, sync] of Object.entries(c.localTrackSync)) {
      if (!keptTrackIds.has(id)) continue;
      localTrackSync[id] = normalizeTrackSyncEntry(sync);
    }
  }
  const sharedTrackSync: Record<string, TrackSyncSettings> = {};
  if (c.sharedTrackSync && typeof c.sharedTrackSync === 'object') {
    for (const [id, sync] of Object.entries(c.sharedTrackSync)) {
      sharedTrackSync[id] = normalizeTrackSyncEntry(sync);
    }
  }
  const dur = media.durationMs;
  const rawIn = typeof c.inMs === 'number' && Number.isFinite(c.inMs) ? c.inMs : 0;
  const rawOut = typeof c.outMs === 'number' && Number.isFinite(c.outMs) ? c.outMs : dur;
  const inMs = Math.max(0, Math.min(rawIn, dur));
  const outMs = Math.max(inMs, Math.min(rawOut, dur));
  const startGlobalMs = typeof c.startGlobalMs === 'number' && Number.isFinite(c.startGlobalMs)
    ? Math.max(0, c.startGlobalMs)
    : undefined;
  return {
    id: typeof c.id === 'string' ? c.id : crypto.randomUUID(),
    media,
    localTracks,
    localTrackSync,
    sharedTrackSync,
    inMs,
    outMs,
    startGlobalMs,
  };
}

function normalizeOverlay(raw: unknown): VideoOverlayClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as VideoOverlayClip;
  const media = normalizeMediaSource(o.media);
  if (!media) return null;
  const dur = media.durationMs;
  const rawIn = typeof o.inMs === 'number' && Number.isFinite(o.inMs) ? o.inMs : 0;
  const rawOut = typeof o.outMs === 'number' && Number.isFinite(o.outMs) ? o.outMs : dur;
  const inMs = Math.max(0, Math.min(rawIn, dur));
  const outMs = Math.max(inMs, Math.min(rawOut, dur));
  const startGlobalMs = typeof o.startGlobalMs === 'number' && Number.isFinite(o.startGlobalMs)
    ? Math.max(0, o.startGlobalMs)
    : 0;
  const endGlobalMs = typeof o.endGlobalMs === 'number' && Number.isFinite(o.endGlobalMs)
    ? Math.max(startGlobalMs + 100, o.endGlobalMs)
    : startGlobalMs + Math.max(100, outMs - inMs);
  const alignMode = o.alignMode === 'timestamp' ? 'timestamp' : 'manual';
  const rect = o.rect && typeof o.rect === 'object'
    ? {
        x: clamp01((o.rect as VideoOverlayClip['rect']).x, 0.65),
        y: clamp01((o.rect as VideoOverlayClip['rect']).y, 0.65),
        w: clamp01((o.rect as VideoOverlayClip['rect']).w, 0.3),
        h: clamp01((o.rect as VideoOverlayClip['rect']).h, 0.3),
      }
    : { x: 0.65, y: 0.65, w: 0.3, h: 0.3 };
  return {
    id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
    media,
    startGlobalMs,
    endGlobalMs,
    inMs,
    outMs,
    alignMode,
    offsetMs: typeof o.offsetMs === 'number' && Number.isFinite(o.offsetMs) ? o.offsetMs : 0,
    rect,
    z: typeof o.z === 'number' && Number.isFinite(o.z) ? o.z : 0,
    includeAudio: o.includeAudio === true,
    opacity: typeof o.opacity === 'number' && Number.isFinite(o.opacity)
      ? Math.max(0, Math.min(1, o.opacity))
      : 1,
  };
}

function clamp01(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

/** v1 { video, tracks, trackSync } → v2 single clip + shared FIT tracks. */
function migrateV1ToV2(raw: Record<string, unknown>): Omit<Project, 'export'> & { export?: Project['export'] } {
  const p = raw as {
    id?: string;
    name?: string;
    createdAt?: string;
    updatedAt?: string;
    video?: MediaSource | null;
    tracks?: TelemetryTrack[];
    trackSync?: Record<string, TrackSyncSettings>;
    gauges?: GaugeInstance[];
    course?: Project['course'];
    export?: Project['export'];
  };

  const video = normalizeMediaSource(p.video);
  const tracks = Array.isArray(p.tracks) ? p.tracks : [];
  const trackSync = migrateTrackSync(raw);

  const localTracks: TelemetryTrack[] = [];
  const sharedTracks: TelemetryTrack[] = [];
  const localTrackSync: Record<string, TrackSyncSettings> = {};
  const sharedTrackSync: Record<string, TrackSyncSettings> = {};

  // Video telemetry was removed: only FIT tracks survive migration; legacy
  // camera tracks are discarded.
  for (const t of tracks) {
    if (t.source !== 'fit') continue;
    sharedTracks.push(t);
    if (trackSync[t.id]) sharedTrackSync[t.id] = trackSync[t.id]!;
  }

  const clips: TimelineClip[] = video
    ? [{
        id: crypto.randomUUID(),
        media: video,
        localTracks,
        localTrackSync,
        sharedTrackSync,
        inMs: 0,
        outMs: video.durationMs,
      }]
    : [];

  return {
    version: 5,
    id: p.id ?? crypto.randomUUID(),
    name: p.name ?? 'Untitled Ride',
    createdAt: p.createdAt ?? new Date().toISOString(),
    updatedAt: p.updatedAt ?? new Date().toISOString(),
    clips,
    overlays: [],
    sharedTracks,
    gauges: Array.isArray(p.gauges) ? p.gauges.map(migrateGauge) : [],
    course: p.course,
    export: p.export,
  };
}

/** Ensure loaded/saved projects have required fields (always v5). */
export function normalizeProject(raw: unknown): Project {
  const r = raw as Record<string, unknown>;
  const version = r.version;

  let base: Omit<Project, 'export'> & { export?: Project['export'] };

  if ((version === 2 || version === 3 || version === 4 || version === 5) && Array.isArray(r.clips)) {
    const p = r as unknown as Project;
    const overlaysRaw = version === 5 && Array.isArray(p.overlays) ? p.overlays : [];
    base = {
      version: 5,
      id: p.id ?? crypto.randomUUID(),
      name: p.name ?? 'Untitled Ride',
      createdAt: p.createdAt ?? new Date().toISOString(),
      updatedAt: p.updatedAt ?? new Date().toISOString(),
      clips: assignClipTimelinePositions(
        (Array.isArray(p.clips) ? p.clips : [])
          .map(normalizeClip)
          .filter((c): c is TimelineClip => c !== null),
      ),
      overlays: overlaysRaw
        .map(normalizeOverlay)
        .filter((o): o is VideoOverlayClip => o !== null),
      sharedTracks: Array.isArray(p.sharedTracks) ? p.sharedTracks : [],
      gauges: Array.isArray(p.gauges) ? p.gauges.map(migrateGauge) : [],
      course: p.course,
      export: p.export,
    };
  } else {
    base = migrateV1ToV2(r);
  }

  return {
    ...base,
    version: 5,
    overlays: base.overlays ?? [],
    export: {
      codec: base.export?.codec ?? 'h264',
      crf: base.export?.crf ?? 18,
      fps: base.export?.fps ?? 30,
      resolution: base.export?.resolution ?? 'source',
      includeAudio: base.export?.includeAudio !== false,
      outputPath: base.export?.outputPath ?? null,
    },
  };
}

function projectHasSessionContent(project: Project): boolean {
  return project.clips.length > 0
    || project.overlays.length > 0
    || project.sharedTracks.length > 0
    || project.gauges.length > 0;
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
