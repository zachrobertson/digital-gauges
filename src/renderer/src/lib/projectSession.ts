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
