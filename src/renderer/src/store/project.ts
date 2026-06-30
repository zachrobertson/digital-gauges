import { create } from 'zustand';
import type {
  GaugeInstance,
  MediaSource,
  PreviewProgress,
  Project,
  SyncAnchor,
  TelemetryTrack,
  TimelineClip,
  VideoOverlayAlignMode,
  VideoOverlayClip,
} from '@shared/types';
import {
  assignClipTimelinePositions,
  clampClipStartGlobalMs,
  clipAtGlobalTime,
  clipDurationMs,
  clipEndGlobalMs,
  clipInMs,
  clipOutMs,
  clipStartGlobalMs,
  globalTimeFromClipLocal,
  isPreviewStale,
  projectDurationMs,
  resolveClipOverlaps,
  timelineEndMs,
} from '@shared/timeline';
import { frameAtGlobalTime } from '../lib/telemetry';
import {
  applySharedFitAnchorToAllClips,
  computeOffsetFromAnchor,
  computeTimestampOverlayOffset,
  defaultFitTrackSync,
  defaultFitTrackSyncForClip,
  effectiveSharedFitOffsetMs,
  repairSharedFitSync,
  rechainedSharedFitSyncFrom,
  videoUtcMs,
} from '@shared/sync';
import { DEFAULT_PROJECT_NAME } from '../lib/projectSession';

const newId = () => crypto.randomUUID();

/** UI-only workspace tabs. Not part of the serialized Project. */
export type WorkspaceMode = 'edit' | 'sync' | 'gauges' | 'export';

function emptyProject(): Project {
  return {
    version: 5,
    id: newId(),
    name: DEFAULT_PROJECT_NAME,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    clips: [],
    overlays: [],
    sharedTracks: [],
    gauges: [],
    export: { codec: 'h264', crf: 18, fps: 30, resolution: 'source', includeAudio: true, outputPath: null },
  };
}

function emptyClip(media: MediaSource): TimelineClip {
  return {
    id: newId(),
    media,
    localTracks: [],
    localTrackSync: {},
    sharedTrackSync: {},
    inMs: 0,
    outMs: media.durationMs,
  };
}

/** Recompute chained shared-FIT offsets for every FIT track from a clip onward. */
function rechainAllSharedFit(
  clips: TimelineClip[],
  sharedTracks: TelemetryTrack[],
  fromClipIndex: number,
): TimelineClip[] {
  let next = clips;
  for (const t of sharedTracks) {
    if (t.source !== 'fit') continue;
    next = rechainedSharedFitSyncFrom(next, t.id, fromClipIndex);
  }
  return next;
}

function seedSharedSyncForClip(
  clip: TimelineClip,
  clipIndex: number,
  allClips: TimelineClip[],
  sharedTracks: TelemetryTrack[],
): TimelineClip {
  const sharedTrackSync = { ...clip.sharedTrackSync };
  for (const t of sharedTracks) {
    if (t.source !== 'fit') continue;
    if (!sharedTrackSync[t.id]) {
      sharedTrackSync[t.id] = defaultFitTrackSyncForClip(allClips, clipIndex, t);
    }
  }
  return { ...clip, sharedTrackSync };
}

function updateClip(
  clips: TimelineClip[],
  clipId: string,
  patch: Partial<TimelineClip> | ((c: TimelineClip) => TimelineClip),
): TimelineClip[] {
  return clips.map((c) => {
    if (c.id !== clipId) return c;
    return typeof patch === 'function' ? patch(c) : { ...c, ...patch };
  });
}

function updateOverlay(
  overlays: VideoOverlayClip[],
  overlayId: string,
  patch: Partial<VideoOverlayClip> | ((o: VideoOverlayClip) => VideoOverlayClip),
): VideoOverlayClip[] {
  return overlays.map((o) => {
    if (o.id !== overlayId) return o;
    return typeof patch === 'function' ? patch(o) : { ...o, ...patch };
  });
}

function defaultOverlayRect(): VideoOverlayClip['rect'] {
  return { x: 0.65, y: 0.65, w: 0.3, h: 0.3 };
}

function nextOverlayZ(overlays: VideoOverlayClip[]): number {
  if (overlays.length === 0) return 0;
  return Math.max(...overlays.map((o) => o.z)) + 1;
}

interface ProjectState {
  project: Project;
  projectFilePath: string | null;
  selectedGaugeId: string | null;
  /** Selected clip for sync editing. Defaults to first clip. */
  selectedClipId: string | null;
  /** Selected overlay for edit timeline / inspector. */
  selectedOverlayId: string | null;
  playhead: number;
  playing: boolean;
  /** UI-only active workspace tab — never serialized into a project file. */
  workspaceMode: WorkspaceMode;
  /** UI-only global "processing…" message (probing, parsing FIT, etc). */
  busyMessage: string | null;
  /** True when clip concat differs from the last successfully built preview. */
  previewStale: boolean;
  /** True while dragging a base-clip trim handle. */
  trimInProgress: boolean;
  /** True while an ffmpeg preview build is in flight. */
  previewBuilding: boolean;
  /** Live progress for the in-flight preview build. */
  previewProgress: PreviewProgress | null;
  /** clipKey of the last successfully built preview concat. */
  lastPreviewClipKey: string;
  /** Incremented to trigger a manual preview rebuild from usePreviewVideo. */
  previewGeneration: number;

  setWorkspaceMode(mode: WorkspaceMode): void;
  setBusyMessage(message: string | null): void;
  setProject(p: Project): void;
  setProjectFilePath(path: string | null): void;
  setProjectName(name: string): void;
  resetProject(): void;

  addClip(media: MediaSource): void;
  removeClip(id: string): void;
  reorderClips(ids: string[]): void;
  selectClip(id: string | null): void;

  /** Set trim in/out (source ms) for a clip. */
  setClipTrim(clipId: string, inMs: number, outMs: number): void;
  /** Move a clip along the global timeline without changing trim or order. */
  setClipStartGlobalMs(clipId: string, startGlobalMs: number): void;
  markPreviewStale(): void;
  beginTrim(): void;
  endTrim(): void;
  generatePreview(): void;
  setPreviewProgress(progress: PreviewProgress | null): void;
  completePreviewBuild(clipKey: string): void;
  failPreviewBuild(): void;
  /** Split the clip under the global playhead into two clips. */
  splitClipAtPlayhead(): void;
  /** Remove a clip and pull later clips earlier (ripple). */
  rippleDeleteClip(clipId: string): void;

  addOverlay(media: MediaSource, startGlobalMs?: number): void;
  removeOverlay(id: string): void;
  selectOverlay(id: string | null): void;
  setOverlayWindow(id: string, startGlobalMs: number, endGlobalMs: number): void;
  setOverlaySourceTrim(id: string, inMs: number, outMs: number): void;
  setOverlayAlignMode(id: string, mode: VideoOverlayAlignMode): void;
  setOverlayOffset(id: string, offsetMs: number): void;
  autoAlignOverlayTimestamps(id: string): void;
  setOverlayRect(id: string, rect: VideoOverlayClip['rect']): void;
  setOverlayZ(id: string, z: number): void;
  moveOverlayZ(id: string, direction: 'up' | 'down'): void;
  setOverlayIncludeAudio(id: string, include: boolean): void;

  addSharedTrack(t: TelemetryTrack): void;
  removeSharedTrack(id: string): void;
  addClipLocalTrack(clipId: string, t: TelemetryTrack): void;
  removeClipLocalTrack(clipId: string, trackId: string): void;

  setClipOffset(clipId: string, trackId: string, ms: number, scope: 'local' | 'shared'): void;
  setClipTrackAnchor(clipId: string, trackId: string, anchor: SyncAnchor, scope: 'local' | 'shared'): void;

  addGauge(g: GaugeInstance): void;
  updateGauge(id: string, patch: Partial<GaugeInstance>): void;
  removeGauge(id: string): void;
  selectGauge(id: string | null): void;

  setPlayhead(ms: number): void;
  setPlaying(playing: boolean): void;

  setExport(patch: Partial<Project['export']>): void;
  setCourseDistance(field: 'start' | 'finish', meters: number | null): void;
  setCourseMarker(field: 'start' | 'finish', globalTimeMs: number): boolean;
  clearCourseMarker(field: 'start' | 'finish'): void;
}

export const useProject = create<ProjectState>((set) => ({
  project: emptyProject(),
  projectFilePath: null,
  selectedGaugeId: null,
  selectedClipId: null,
  selectedOverlayId: null,
  playhead: 0,
  playing: false,
  workspaceMode: 'edit',
  busyMessage: null,
  previewStale: false,
  trimInProgress: false,
  previewBuilding: false,
  previewProgress: null,
  lastPreviewClipKey: '',
  previewGeneration: 0,

  setWorkspaceMode: (mode) => set({ workspaceMode: mode }),
  setBusyMessage: (message) => set({ busyMessage: message }),

  setProject: (p) => {
    const normalized = { ...p, version: 5 as const, overlays: p.overlays ?? [] };
    let clips = assignClipTimelinePositions(normalized.clips);
    clips = repairSharedFitSync(clips, normalized.sharedTracks);
    const project = { ...normalized, clips };
    set({
      project,
      selectedGaugeId: null,
      selectedClipId: project.clips[0]?.id ?? null,
      selectedOverlayId: null,
      playhead: 0,
      playing: false,
      previewStale: false,
      trimInProgress: false,
      previewBuilding: false,
      previewProgress: null,
      lastPreviewClipKey: '',
      previewGeneration: 0,
    });
  },

  setProjectFilePath: (path) => set({ projectFilePath: path }),

  setProjectName: (name) => set((s) => ({
    project: { ...s.project, name, updatedAt: new Date().toISOString() },
  })),

  resetProject: () => set({
    project: emptyProject(),
    projectFilePath: null,
    selectedGaugeId: null,
    selectedClipId: null,
    selectedOverlayId: null,
    playhead: 0,
    playing: false,
    previewStale: false,
    trimInProgress: false,
    previewBuilding: false,
    previewProgress: null,
    lastPreviewClipKey: '',
    previewGeneration: 0,
  }),

  addClip: (media) => set((s) => {
    const startGlobalMs = timelineEndMs(s.project.clips);
    let clip: TimelineClip = { ...emptyClip(media), startGlobalMs };
    const clipIndex = s.project.clips.length;
    const allClips = [...s.project.clips, clip];
    clip = seedSharedSyncForClip(clip, clipIndex, allClips, s.project.sharedTracks);

    const clips = [...s.project.clips, clip];
    const markStale = s.lastPreviewClipKey !== '';
    return {
      project: {
        ...s.project,
        clips,
        updatedAt: new Date().toISOString(),
      },
      selectedClipId: s.selectedClipId ?? clip.id,
      ...(markStale ? {
        previewStale: true,
        playing: false,
        // Auto-rebuild when clips are added after a preview exists (e.g. multi-file
        // import where the first clip's preview finishes before probing the next).
        previewGeneration: s.previewGeneration + 1,
      } : {}),
    };
  }),

  removeClip: (id) => set((s) => {
    const clips = s.project.clips.filter((c) => c.id !== id);
    const total = projectDurationMs(clips, s.project.overlays);
    const playhead = Math.min(s.playhead, Math.max(0, total));
    const selectedClipId = s.selectedClipId === id
      ? (clips[0]?.id ?? null)
      : s.selectedClipId;
    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
      playhead,
      selectedClipId,
      previewStale: s.lastPreviewClipKey !== '' ? true : s.previewStale,
      playing: s.lastPreviewClipKey !== '' ? false : s.playing,
    };
  }),

  reorderClips: (ids) => set((s) => {
    const byId = new Map(s.project.clips.map((c) => [c.id, c]));
    const reordered = ids.map((id) => byId.get(id)).filter((c): c is TimelineClip => c != null);
    if (reordered.length !== s.project.clips.length) return s;
    // The new adjacency may overlap — push clips right to keep a clean track.
    const clips = resolveClipOverlaps(reordered);
    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
      previewStale: s.lastPreviewClipKey !== '' ? true : s.previewStale,
      playing: s.lastPreviewClipKey !== '' ? false : s.playing,
    };
  }),

  selectClip: (id) => set((s) => {
    const patch: Partial<ProjectState> = {
      selectedClipId: id,
      selectedOverlayId: id ? null : s.selectedOverlayId,
    };
    if (id) {
      const clipIndex = s.project.clips.findIndex((c) => c.id === id);
      if (clipIndex >= 0) {
        patch.playhead = globalTimeFromClipLocal(s.project.clips, clipIndex, 0);
        patch.playing = false;
      }
    }
    return patch;
  }),

  setClipTrim: (clipId, inMs, outMs) => set((s) => {
    const MIN_TRIM_MS = 100;
    const clipIndex = s.project.clips.findIndex((c) => c.id === clipId);
    if (clipIndex < 0) return s;
    const target = s.project.clips[clipIndex]!;
    const dur = target.media.durationMs;
    let nextIn = Math.max(0, Math.min(inMs, dur - MIN_TRIM_MS));
    const nextOut = Math.max(nextIn + MIN_TRIM_MS, Math.min(outMs, dur));

    // The freed (or added) space must appear at the edge being trimmed:
    //  - tail-trim (out changes): keep the start fixed, the end moves.
    //  - head-trim (in changes): keep the end fixed, the start moves, so a gap
    //    opens at the beginning instead of silently shrinking the clip's tail.
    // FIT stays sampled against source time (clipInMs + localMs), so shifting the
    // clip's global position does not desync telemetry.
    const oldStart = clipStartGlobalMs(s.project.clips, clipIndex);
    const oldEnd = oldStart + clipDurationMs(target);
    const isHeadTrim = nextIn !== clipInMs(target);
    let startGlobalMs = oldStart;
    if (isHeadTrim) {
      const lowerBound = clipIndex > 0 ? clipEndGlobalMs(s.project.clips, clipIndex - 1) : 0;
      let nextStart = oldEnd - (nextOut - nextIn);
      if (nextStart < lowerBound) {
        // Not enough room to the left — cap the extension so we don't underflow
        // the timeline or overlap the previous clip.
        nextStart = lowerBound;
        nextIn = Math.max(0, Math.min(nextOut - MIN_TRIM_MS, nextOut - (oldEnd - nextStart)));
      }
      startGlobalMs = nextStart;
    }

    const currentStartGlobal = typeof target.startGlobalMs === 'number' && Number.isFinite(target.startGlobalMs)
      ? target.startGlobalMs
      : oldStart;
    const wouldChange = nextIn !== clipInMs(target)
      || nextOut !== clipOutMs(target)
      || startGlobalMs !== currentStartGlobal;
    if (!wouldChange) {
      const previewStale = isPreviewStale(s.lastPreviewClipKey, s.project.clips);
      if (previewStale === s.previewStale) return s;
      return {
        previewStale,
        playing: previewStale ? false : s.playing,
      };
    }

    let clips = updateClip(s.project.clips, clipId, (c) => ({
      ...c,
      inMs: nextIn,
      outMs: nextOut,
      startGlobalMs,
    }));
    // If lengthening the trim made this clip overlap later clips, ripple them
    // further along the timeline so clips never overlap (gaps are preserved).
    clips = resolveClipOverlaps(clips);
    clips = rechainAllSharedFit(clips, s.project.sharedTracks, clipIndex);

    const total = projectDurationMs(clips, s.project.overlays);
    const previewStale = isPreviewStale(s.lastPreviewClipKey, clips);
    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
      playhead: Math.min(s.playhead, Math.max(0, total)),
      previewStale,
      playing: previewStale ? false : s.playing,
    };
  }),

  setClipStartGlobalMs: (clipId, startGlobalMs) => set((s) => {
    const clipIndex = s.project.clips.findIndex((c) => c.id === clipId);
    if (clipIndex < 0) return s;
    // Confine the move to the free span between neighbors so clips never overlap.
    const clamped = clampClipStartGlobalMs(s.project.clips, clipIndex, Math.max(0, startGlobalMs));
    const clips = updateClip(s.project.clips, clipId, (c) => ({
      ...c,
      startGlobalMs: clamped,
    }));
    const total = projectDurationMs(clips, s.project.overlays);
    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
      playhead: Math.min(s.playhead, Math.max(0, total)),
    };
  }),

  markPreviewStale: () => set((s) => ({
    previewStale: s.lastPreviewClipKey !== '' ? true : s.previewStale,
    playing: false,
  })),

  beginTrim: () => set((s) => ({
    trimInProgress: true,
    playing: false,
  })),

  endTrim: () => set({ trimInProgress: false }),

  generatePreview: () => set((s) => ({
    previewBuilding: true,
    previewProgress: { phase: 'encoding', percent: 0, message: 'Preparing preview…' },
    previewGeneration: s.previewGeneration + 1,
    playing: false,
  })),

  setPreviewProgress: (progress) => set({ previewProgress: progress }),

  completePreviewBuild: (clipKey) => set({
    lastPreviewClipKey: clipKey,
    previewStale: false,
    previewBuilding: false,
    previewProgress: null,
  }),

  failPreviewBuild: () => set({ previewBuilding: false, previewProgress: null }),

  splitClipAtPlayhead: () => set((s) => {
    const loc = clipAtGlobalTime(s.project.clips, s.playhead);
    if (!loc) return s;
    const { clip, clipIndex, localMs } = loc;
    const inMs = clipInMs(clip);
    const outMs = clipOutMs(clip);
    const splitSourceMs = inMs + localMs;
    // Need a meaningful slice on both sides.
    if (splitSourceMs - inMs < 100 || outMs - splitSourceMs < 100) return s;

    const splitGlobalMs = globalTimeFromClipLocal(s.project.clips, clipIndex, localMs);
    const firstHalf: TimelineClip = { ...clip, outMs: splitSourceMs };
    const secondHalf: TimelineClip = {
      ...clip,
      id: newId(),
      inMs: splitSourceMs,
      outMs,
      startGlobalMs: splitGlobalMs,
      localTrackSync: { ...clip.localTrackSync },
      sharedTrackSync: { ...clip.sharedTrackSync },
    };
    // Pin the second half's shared FIT so the ride time stays continuous.
    for (const t of s.project.sharedTracks) {
      if (t.source !== 'fit') continue;
      const prev = clip.sharedTrackSync[t.id];
      const effOffset = effectiveSharedFitOffsetMs(s.project.clips, clipIndex, t.id);
      secondHalf.sharedTrackSync[t.id] = {
        offsetMs: effOffset,
        playSpeedPercent: prev?.playSpeedPercent ?? 100,
        anchor: 'manual',
      };
    }

    let clips = [
      ...s.project.clips.slice(0, clipIndex),
      firstHalf,
      secondHalf,
      ...s.project.clips.slice(clipIndex + 1),
    ];
    clips = rechainAllSharedFit(clips, s.project.sharedTracks, clipIndex + 1);

    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
      selectedClipId: secondHalf.id,
      previewStale: s.lastPreviewClipKey !== '' ? true : s.previewStale,
      playing: false,
    };
  }),

  rippleDeleteClip: (clipId) => set((s) => {
    const clipIndex = s.project.clips.findIndex((c) => c.id === clipId);
    if (clipIndex < 0) return s;
    let clips = s.project.clips.filter((c) => c.id !== clipId);
    clips = rechainAllSharedFit(clips, s.project.sharedTracks, Math.max(0, clipIndex - 1));
    const total = projectDurationMs(clips, s.project.overlays);
    const selectedClipId = s.selectedClipId === clipId
      ? (clips[Math.min(clipIndex, clips.length - 1)]?.id ?? null)
      : s.selectedClipId;
    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
      playhead: Math.min(s.playhead, Math.max(0, total)),
      selectedClipId,
      previewStale: s.lastPreviewClipKey !== '' ? true : s.previewStale,
      playing: false,
    };
  }),

  addOverlay: (media, startGlobalMs) => set((s) => {
    const start = startGlobalMs ?? s.playhead;
    const visibleDur = Math.min(media.durationMs, Math.max(1000, media.durationMs));
    const end = start + visibleDur;
    const hasUtc = videoUtcMs(media) != null;
    const alignMode: VideoOverlayAlignMode = hasUtc ? 'timestamp' : 'manual';
    let overlay: VideoOverlayClip = {
      id: newId(),
      media,
      startGlobalMs: Math.max(0, start),
      endGlobalMs: end,
      inMs: 0,
      outMs: media.durationMs,
      alignMode,
      offsetMs: 0,
      rect: defaultOverlayRect(),
      z: nextOverlayZ(s.project.overlays),
      includeAudio: false,
      opacity: 1,
    };
    if (alignMode === 'timestamp') {
      const offset = computeTimestampOverlayOffset(s.project.clips, overlay, overlay.startGlobalMs);
      if (offset != null) overlay = { ...overlay, offsetMs: offset };
    }
    return {
      project: {
        ...s.project,
        overlays: [...s.project.overlays, overlay],
        updatedAt: new Date().toISOString(),
      },
      selectedOverlayId: overlay.id,
      selectedClipId: null,
    };
  }),

  removeOverlay: (id) => set((s) => {
    const overlays = s.project.overlays.filter((o) => o.id !== id);
    const total = projectDurationMs(s.project.clips, overlays);
    return {
      project: { ...s.project, overlays, updatedAt: new Date().toISOString() },
      selectedOverlayId: s.selectedOverlayId === id ? null : s.selectedOverlayId,
      playhead: Math.min(s.playhead, Math.max(0, total)),
    };
  }),

  selectOverlay: (id) => set({ selectedOverlayId: id, selectedClipId: id ? null : useProject.getState().selectedClipId }),

  setOverlayWindow: (id, startGlobalMs, endGlobalMs) => set((s) => {
    const MIN_MS = 100;
    const overlays = updateOverlay(s.project.overlays, id, (o) => {
      const start = Math.max(0, startGlobalMs);
      const end = Math.max(start + MIN_MS, endGlobalMs);
      return { ...o, startGlobalMs: start, endGlobalMs: end };
    });
    const total = projectDurationMs(s.project.clips, overlays);
    return {
      project: { ...s.project, overlays, updatedAt: new Date().toISOString() },
      playhead: Math.min(s.playhead, Math.max(0, total)),
    };
  }),

  setOverlaySourceTrim: (id, inMs, outMs) => set((s) => {
    const MIN_TRIM_MS = 100;
    const overlays = updateOverlay(s.project.overlays, id, (o) => {
      const dur = o.media.durationMs;
      const nextIn = Math.max(0, Math.min(inMs, dur - MIN_TRIM_MS));
      const nextOut = Math.max(nextIn + MIN_TRIM_MS, Math.min(outMs, dur));
      return { ...o, inMs: nextIn, outMs: nextOut };
    });
    return {
      project: { ...s.project, overlays, updatedAt: new Date().toISOString() },
    };
  }),

  setOverlayAlignMode: (id, mode) => set((s) => {
    const overlays = updateOverlay(s.project.overlays, id, (o) => {
      if (mode === o.alignMode) return o;
      if (mode === 'timestamp') {
        const offset = computeTimestampOverlayOffset(s.project.clips, o, o.startGlobalMs);
        return { ...o, alignMode: mode, offsetMs: offset ?? o.offsetMs ?? 0 };
      }
      return { ...o, alignMode: mode };
    });
    return {
      project: { ...s.project, overlays, updatedAt: new Date().toISOString() },
    };
  }),

  setOverlayOffset: (id, offsetMs) => set((s) => ({
    project: {
      ...s.project,
      overlays: updateOverlay(s.project.overlays, id, (o) => ({ ...o, offsetMs })),
      updatedAt: new Date().toISOString(),
    },
  })),

  autoAlignOverlayTimestamps: (id) => set((s) => {
    const overlays = updateOverlay(s.project.overlays, id, (o) => {
      const offset = computeTimestampOverlayOffset(s.project.clips, o, o.startGlobalMs);
      if (offset == null) return o;
      return { ...o, alignMode: 'timestamp', offsetMs: offset };
    });
    return {
      project: { ...s.project, overlays, updatedAt: new Date().toISOString() },
    };
  }),

  setOverlayRect: (id, rect) => set((s) => ({
    project: {
      ...s.project,
      overlays: updateOverlay(s.project.overlays, id, (o) => ({ ...o, rect })),
      updatedAt: new Date().toISOString(),
    },
  })),

  setOverlayZ: (id, z) => set((s) => ({
    project: {
      ...s.project,
      overlays: updateOverlay(s.project.overlays, id, (o) => ({ ...o, z })),
      updatedAt: new Date().toISOString(),
    },
  })),

  moveOverlayZ: (id, direction) => set((s) => {
    const sorted = [...s.project.overlays].sort((a, b) => a.z - b.z);
    const idx = sorted.findIndex((o) => o.id === id);
    if (idx < 0) return s;
    const swapIdx = direction === 'up' ? idx + 1 : idx - 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return s;
    const a = sorted[idx]!;
    const b = sorted[swapIdx]!;
    const overlays = s.project.overlays.map((o) => {
      if (o.id === a.id) return { ...o, z: b.z };
      if (o.id === b.id) return { ...o, z: a.z };
      return o;
    });
    return {
      project: { ...s.project, overlays, updatedAt: new Date().toISOString() },
    };
  }),

  setOverlayIncludeAudio: (id, include) => set((s) => ({
    project: {
      ...s.project,
      overlays: updateOverlay(s.project.overlays, id, (o) => ({ ...o, includeAudio: include })),
      updatedAt: new Date().toISOString(),
    },
  })),

  addSharedTrack: (t) => set((s) => {
    const sharedTracks = [...s.project.sharedTracks, t];
    const clips = s.project.clips.map((clip, clipIndex) => {
      const sharedTrackSync = {
        ...clip.sharedTrackSync,
        [t.id]: defaultFitTrackSyncForClip(s.project.clips, clipIndex, t),
      };
      return { ...clip, sharedTrackSync };
    });
    return {
      project: {
        ...s.project,
        sharedTracks,
        clips,
        updatedAt: new Date().toISOString(),
      },
    };
  }),

  removeSharedTrack: (id) => set((s) => {
    const clips = s.project.clips.map((clip) => {
      const { [id]: _drop, ...sharedTrackSync } = clip.sharedTrackSync;
      return { ...clip, sharedTrackSync };
    });
    return {
      project: {
        ...s.project,
        sharedTracks: s.project.sharedTracks.filter((t) => t.id !== id),
        clips,
        updatedAt: new Date().toISOString(),
      },
    };
  }),

  addClipLocalTrack: (clipId, t) => set((s) => {
    let clips = updateClip(s.project.clips, clipId, (clip) => {
      const localTracks = [...clip.localTracks, t];
      const localTrackSync = {
        ...clip.localTrackSync,
        [t.id]: defaultFitTrackSync(clip.media, t),
      };
      return { ...clip, localTracks, localTrackSync };
    });
    clips = repairSharedFitSync(clips, s.project.sharedTracks);
    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
    };
  }),

  removeClipLocalTrack: (clipId, trackId) => set((s) => {
    const clips = updateClip(s.project.clips, clipId, (clip) => {
      const { [trackId]: _drop, ...localTrackSync } = clip.localTrackSync;
      return {
        ...clip,
        localTracks: clip.localTracks.filter((t) => t.id !== trackId),
        localTrackSync,
      };
    });
    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
    };
  }),

  setClipOffset: (clipId, trackId, ms, scope) => set((s) => {
    const syncKey = scope === 'local' ? 'localTrackSync' : 'sharedTrackSync';

    if (scope === 'shared') {
      const fit = s.project.sharedTracks.find((t) => t.id === trackId && t.source === 'fit');
      if (fit && s.project.clips.length > 0) {
        let baseOffsetMs = ms;
        const clipIndex = s.project.clips.findIndex((c) => c.id === clipId);
        if (clipIndex > 0) {
          let durationBefore = 0;
          for (let i = 0; i < clipIndex; i++) {
            durationBefore += clipDurationMs(s.project.clips[i]!);
          }
          baseOffsetMs = ms + durationBefore;
        }
        const clips = applySharedFitAnchorToAllClips(
          s.project.clips,
          trackId,
          fit,
          'manual',
          baseOffsetMs,
        );
        return {
          project: { ...s.project, clips, updatedAt: new Date().toISOString() },
        };
      }
    }

    const clips = updateClip(s.project.clips, clipId, (clip) => {
      const prev = clip[syncKey][trackId];
      return {
        ...clip,
        [syncKey]: {
          ...clip[syncKey],
          [trackId]: {
            offsetMs: ms,
            playSpeedPercent: prev?.playSpeedPercent ?? 100,
            anchor: 'manual',
          },
        },
      };
    });
    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
    };
  }),

  setClipTrackAnchor: (clipId, trackId, anchor, scope) => set((s) => {
    const syncKey = scope === 'local' ? 'localTrackSync' : 'sharedTrackSync';
    const trackList = scope === 'local'
      ? s.project.clips.find((c) => c.id === clipId)?.localTracks
      : s.project.sharedTracks;
    const track = trackList?.find((t) => t.id === trackId);
    if (!track) return s;

    const editedIndex = s.project.clips.findIndex((c) => c.id === clipId);

    let clips: TimelineClip[];
    if (scope === 'shared' && track.source === 'fit') {
      const manualSeed = anchor === 'manual' && editedIndex >= 0
        ? effectiveSharedFitOffsetMs(s.project.clips, editedIndex, trackId)
        : undefined;
      clips = applySharedFitAnchorToAllClips(
        s.project.clips,
        trackId,
        track,
        anchor,
        manualSeed,
      );
    } else {
      clips = updateClip(s.project.clips, clipId, (clip) => {
        const prev = clip[syncKey][trackId];
        const clipIndex = s.project.clips.findIndex((c) => c.id === clipId);
        const offsetMs = anchor === 'manual'
          ? (prev?.offsetMs ?? 0)
          : anchor === 'utc' && track.source === 'fit' && clipIndex >= 0
            ? defaultFitTrackSyncForClip(s.project.clips, clipIndex, track).offsetMs
            : computeOffsetFromAnchor(anchor, clip.media, track);
        return {
          ...clip,
          [syncKey]: {
            ...clip[syncKey],
            [trackId]: {
              offsetMs,
              playSpeedPercent: prev?.playSpeedPercent ?? 100,
              anchor,
            },
          },
        };
      });
    }
    return {
      project: { ...s.project, clips, updatedAt: new Date().toISOString() },
    };
  }),

  addGauge: (g) => set((s) => ({
    project: {
      ...s.project,
      gauges: [...s.project.gauges, g],
      updatedAt: new Date().toISOString(),
    },
    selectedGaugeId: g.id,
  })),

  updateGauge: (id, patch) => set((s) => ({
    project: {
      ...s.project,
      gauges: s.project.gauges.map((g) => (g.id === id ? { ...g, ...patch } : g)),
      updatedAt: new Date().toISOString(),
    },
  })),

  removeGauge: (id) => set((s) => ({
    project: {
      ...s.project,
      gauges: s.project.gauges.filter((g) => g.id !== id),
      updatedAt: new Date().toISOString(),
    },
    selectedGaugeId: s.selectedGaugeId === id ? null : s.selectedGaugeId,
  })),

  selectGauge: (id) => set({ selectedGaugeId: id }),
  setPlayhead: (ms) => set((s) => {
    const playhead = ms;
    if (!s.playing) return { playhead };
    const loc = clipAtGlobalTime(s.project.clips, playhead);
    if (loc && loc.clip.id !== s.selectedClipId) {
      return { playhead, selectedClipId: loc.clip.id };
    }
    return { playhead };
  }),
  setPlaying: (playing) => set({ playing }),

  setExport: (patch) => set((s) => ({
    project: { ...s.project, export: { ...s.project.export, ...patch } },
  })),

  setCourseDistance: (field, meters) => set((s) => {
    const prev = s.project.course ?? { startDistanceM: null, finishDistanceM: null };
    const key = field === 'start' ? 'startDistanceM' : 'finishDistanceM';
    return {
      project: {
        ...s.project,
        course: { ...prev, [key]: meters },
        updatedAt: new Date().toISOString(),
      },
    };
  }),

  setCourseMarker: (field, globalTimeMs) => {
    const { project } = useProject.getState();
    const frame = frameAtGlobalTime(project, globalTimeMs);
    const distance = frame.distance;
    if (typeof distance !== 'number') return false;

    const prev = project.course ?? { startDistanceM: null, finishDistanceM: null };
    const distanceKey = field === 'start' ? 'startDistanceM' : 'finishDistanceM';
    const markerKey = field === 'start' ? 'startMarkerVideoMs' : 'finishMarkerVideoMs';

    useProject.setState({
      project: {
        ...project,
        course: { ...prev, [distanceKey]: distance, [markerKey]: globalTimeMs },
        updatedAt: new Date().toISOString(),
      },
    });
    return true;
  },

  clearCourseMarker: (field) => set((s) => {
    const prev = s.project.course;
    if (!prev) return s;
    const distanceKey = field === 'start' ? 'startDistanceM' : 'finishDistanceM';
    const markerKey = field === 'start' ? 'startMarkerVideoMs' : 'finishMarkerVideoMs';
    return {
      project: {
        ...s.project,
        course: { ...prev, [distanceKey]: null, [markerKey]: null },
        updatedAt: new Date().toISOString(),
      },
    };
  }),
}));
