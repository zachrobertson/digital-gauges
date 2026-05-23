import type { Project } from '@shared/types';

export function projectHasSessionContent(project: Project): boolean {
  return project.video !== null || project.tracks.length > 0 || project.gauges.length > 0;
}

export function projectFileLabel(path: string | null): string | null {
  if (!path) return null;
  return path.split(/[/\\]/).pop() ?? path;
}
