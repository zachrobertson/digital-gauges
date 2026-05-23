import { create } from 'zustand';

import type { GaugeInstance, Project, SyncAnchor, TelemetryTrack } from '@shared/types';

import { frameAtVideoTime } from '../lib/telemetry';

import {

  computeOffsetFromAnchor,

  defaultCameraTrackSync,

  defaultFitTrackSync,

  pickCameraTrack,

  refreshAnchoredTrackSync,

} from '@shared/sync';



const newId = () => crypto.randomUUID();



function emptyProject(): Project {

  return {

    version: 1,

    id: newId(),

    name: 'Untitled Ride',

    createdAt: new Date().toISOString(),

    updatedAt: new Date().toISOString(),

    video: null,

    tracks: [],

    trackSync: {},

    gauges: [],

    export: { codec: 'h264', crf: 18, fps: 30, resolution: 'source', outputPath: null },

  };

}



interface ProjectState {

  project: Project;

  /** Path of the last explicitly saved/opened .dgproj file, if any. */

  projectFilePath: string | null;

  selectedGaugeId: string | null;

  playhead: number;   // ms since start of video

  playing: boolean;



  setProject(p: Project): void;

  setProjectFilePath(path: string | null): void;

  resetProject(): void;

  setVideo(p: Project['video']): void;



  addTrack(t: TelemetryTrack): void;

  removeTrack(id: string): void;

  setOffset(id: string, ms: number): void;

  setTrackAnchor(id: string, anchor: SyncAnchor): void;



  addGauge(g: GaugeInstance): void;

  updateGauge(id: string, patch: Partial<GaugeInstance>): void;

  removeGauge(id: string): void;

  selectGauge(id: string | null): void;



  setPlayhead(ms: number): void;

  setPlaying(playing: boolean): void;



  setExport(patch: Partial<Project['export']>): void;

  setCourseDistance(field: 'start' | 'finish', meters: number | null): void;

  setCourseMarker(field: 'start' | 'finish', videoTimeMs: number): boolean;

  clearCourseMarker(field: 'start' | 'finish'): void;

}



export const useProject = create<ProjectState>((set) => ({

  project: emptyProject(),

  projectFilePath: null,

  selectedGaugeId: null,

  playhead: 0,

  playing: false,



  setProject: (p) => set({ project: p, selectedGaugeId: null, playhead: 0, playing: false }),

  setProjectFilePath: (path) => set({ projectFilePath: path }),

  resetProject: () =>

    set({

      project: emptyProject(),

      projectFilePath: null,

      selectedGaugeId: null,

      playhead: 0,

      playing: false,

    }),



  setVideo: (video) =>

    set((s) => {

      const tracks = s.project.tracks;

      const camera = pickCameraTrack(tracks);

      const trackSync = refreshAnchoredTrackSync(s.project.trackSync, tracks, video, camera);

      return {

        project: {

          ...s.project,

          video,

          trackSync,

          updatedAt: new Date().toISOString(),

        },

      };

    }),



  addTrack: (t) =>

    set((s) => {

      const tracks = [...s.project.tracks, t];

      const camera = pickCameraTrack(tracks);

      const trackSync = { ...s.project.trackSync };



      if (t.source === 'fit') {

        trackSync[t.id] = defaultFitTrackSync(s.project.video, t, camera);

      } else {

        trackSync[t.id] = defaultCameraTrackSync();

        if (camera && t.id === camera.id) {

          for (const fit of tracks) {

            if (fit.source !== 'fit') continue;

            const sync = trackSync[fit.id];

            if (sync && sync.anchor !== 'manual') {

              trackSync[fit.id] = {

                ...sync,

                offsetMs: computeOffsetFromAnchor(sync.anchor, s.project.video, fit, camera),

              };

            } else if (!sync) {

              trackSync[fit.id] = defaultFitTrackSync(s.project.video, fit, camera);

            }

          }

        }

      }



      return {

        project: {

          ...s.project,

          tracks,

          trackSync,

          updatedAt: new Date().toISOString(),

        },

      };

    }),



  removeTrack: (id) =>

    set((s) => {

      const { [id]: _drop, ...rest } = s.project.trackSync;

      return {

        project: {

          ...s.project,

          tracks: s.project.tracks.filter((t) => t.id !== id),

          trackSync: rest,

          updatedAt: new Date().toISOString(),

        },

      };

    }),



  setOffset: (id, ms) =>

    set((s) => {

      const prev = s.project.trackSync[id];

      return {

        project: {

          ...s.project,

          trackSync: {

            ...s.project.trackSync,

            [id]: {

              offsetMs: ms,

              playSpeedPercent: prev?.playSpeedPercent ?? 100,

              anchor: 'manual',

            },

          },

          updatedAt: new Date().toISOString(),

        },

      };

    }),



  setTrackAnchor: (id, anchor) =>

    set((s) => {

      const track = s.project.tracks.find((t) => t.id === id);

      if (!track) return s;

      const prev = s.project.trackSync[id];

      const camera = pickCameraTrack(s.project.tracks);

      const offsetMs = anchor === 'manual'

        ? (prev?.offsetMs ?? 0)

        : computeOffsetFromAnchor(anchor, s.project.video, track, camera);

      return {

        project: {

          ...s.project,

          trackSync: {

            ...s.project.trackSync,

            [id]: {

              offsetMs,

              playSpeedPercent: prev?.playSpeedPercent ?? 100,

              anchor,

            },

          },

          updatedAt: new Date().toISOString(),

        },

      };

    }),



  addGauge: (g) =>

    set((s) => ({

      project: {

        ...s.project,

        gauges: [...s.project.gauges, g],

        updatedAt: new Date().toISOString(),

      },

      selectedGaugeId: g.id,

    })),



  updateGauge: (id, patch) =>

    set((s) => ({

      project: {

        ...s.project,

        gauges: s.project.gauges.map((g) => (g.id === id ? { ...g, ...patch } : g)),

        updatedAt: new Date().toISOString(),

      },

    })),



  removeGauge: (id) =>

    set((s) => ({

      project: {

        ...s.project,

        gauges: s.project.gauges.filter((g) => g.id !== id),

        updatedAt: new Date().toISOString(),

      },

      selectedGaugeId: s.selectedGaugeId === id ? null : s.selectedGaugeId,

    })),



  selectGauge: (id) => set({ selectedGaugeId: id }),

  setPlayhead: (ms) => set({ playhead: ms }),

  setPlaying: (playing) => set({ playing }),



  setExport: (patch) =>

    set((s) => ({

      project: { ...s.project, export: { ...s.project.export, ...patch } },

    })),

  setCourseDistance: (field, meters) =>

    set((s) => {

      const prev = s.project.course ?? {

        startDistanceM: null,

        finishDistanceM: null,

      };

      const key = field === 'start' ? 'startDistanceM' : 'finishDistanceM';

      return {

        project: {

          ...s.project,

          course: { ...prev, [key]: meters },

          updatedAt: new Date().toISOString(),

        },

      };

    }),

  setCourseMarker: (field, videoTimeMs) => {

    const { project } = useProject.getState();

    const frame = frameAtVideoTime(project, videoTimeMs);

    const distance = frame.distance;

    if (typeof distance !== 'number') return false;

    const prev = project.course ?? {

      startDistanceM: null,

      finishDistanceM: null,

    };

    const distanceKey = field === 'start' ? 'startDistanceM' : 'finishDistanceM';

    const markerKey = field === 'start' ? 'startMarkerVideoMs' : 'finishMarkerVideoMs';

    useProject.setState({

      project: {

        ...project,

        course: {

          ...prev,

          [distanceKey]: distance,

          [markerKey]: videoTimeMs,

        },

        updatedAt: new Date().toISOString(),

      },

    });

    return true;

  },

  clearCourseMarker: (field) =>

    set((s) => {

      const prev = s.project.course;

      if (!prev) return s;

      const distanceKey = field === 'start' ? 'startDistanceM' : 'finishDistanceM';

      const markerKey = field === 'start' ? 'startMarkerVideoMs' : 'finishMarkerVideoMs';

      return {

        project: {

          ...s.project,

          course: {

            ...prev,

            [distanceKey]: null,

            [markerKey]: null,

          },

          updatedAt: new Date().toISOString(),

        },

      };

    }),

}));


