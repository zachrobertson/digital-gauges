import type { Project, TimelineClip } from '@shared/types';
import { pickCameraTrack } from '@shared/sync';

export type ClipSyncStatus =
  | 'auto-utc'
  | 'manual'
  | 'missing-fit'
  | 'visual-only';

export interface ClipSyncStatusDisplay {
  label: string;
  background: string;
  color: string;
}

const STATUS_DISPLAY: Record<ClipSyncStatus, ClipSyncStatusDisplay> = {
  'auto-utc': {
    label: 'Auto (UTC)',
    background: 'rgba(61,220,151,0.14)',
    color: '#3ddc97',
  },
  manual: {
    label: 'Manual',
    background: 'rgba(245,165,36,0.14)',
    color: '#f5a524',
  },
  'missing-fit': {
    label: 'Needs FIT',
    background: 'rgba(245,113,113,0.12)',
    color: '#f87171',
  },
  'visual-only': {
    label: 'Visual only (no GPS)',
    background: 'rgba(245,177,74,0.12)',
    color: '#f5b14a',
  },
};

export function clipSyncStatusDisplay(status: ClipSyncStatus): ClipSyncStatusDisplay {
  return STATUS_DISPLAY[status];
}

function findFitTrack(clip: TimelineClip, project: Project) {
  const localFit = clip.localTracks.find((t) => t.source === 'fit');
  const sharedFit = project.sharedTracks.find((t) => t.source === 'fit');
  const track = localFit ?? sharedFit;
  const scope: 'local' | 'shared' = localFit ? 'local' : 'shared';
  return { track, scope };
}

export function clipSyncStatus(
  clip: TimelineClip,
  _clipIndex: number,
  project: Project,
): ClipSyncStatus {
  const { track: fitTrack, scope } = findFitTrack(clip, project);
  if (!fitTrack) return 'missing-fit';

  const cameraTrack = pickCameraTrack(clip.localTracks);
  const hasGps = Boolean(
    cameraTrack?.fields.includes('lat') && cameraTrack?.fields.includes('lon'),
  );
  if (!hasGps) return 'visual-only';

  const sync = scope === 'local'
    ? clip.localTrackSync[fitTrack.id]
    : clip.sharedTrackSync[fitTrack.id];
  if (sync?.anchor === 'manual') return 'manual';

  return 'auto-utc';
}
