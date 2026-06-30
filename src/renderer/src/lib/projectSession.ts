import type { Project } from '@shared/types';

export function projectHasSessionContent(project: Project): boolean {
  return project.clips.length > 0
    || project.sharedTracks.length > 0
    || project.gauges.length > 0;
}

export function projectFileLabel(path: string | null): string | null {
  if (!path) return null;
  return path.split(/[/\\]/).pop() ?? path;
}

/** Basename of a project file without `.dgproj` / `.json`. */
export function projectNameFromPath(path: string): string {
  const base = projectFileLabel(path) ?? path;
  const stripped = base.replace(/\.(dgproj|json)$/i, '');
  return stripped || base;
}

export const DEFAULT_PROJECT_NAME = 'Untitled Ride';
