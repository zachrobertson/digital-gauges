import { useEffect, useRef, useState } from 'react';
import type { TimelineClip } from '@shared/types';
import { clipInMs, clipOutMs } from '@shared/timeline';
import { useProject } from '../store/project';

const INITIAL_PREVIEW_PROGRESS = {
  phase: 'encoding' as const,
  percent: 0,
  message: 'Preparing preview…',
};

/** Renderer cache — avoids blank/loading flash when switching workspaces. */
let cachedClipKey = '';
let cachedPreviewPath: string | null = null;

/** Stable key for concat preview invalidation (trim, reorder, split, etc.). */
export function clipKeyFromClips(clips: TimelineClip[]): string {
  return clips.map((c, i) =>
    `${i}:${c.id}:${c.media.path}:${clipInMs(c)}:${clipOutMs(c)}`,
  ).join('|');
}

/** Build/load a single concatenated preview file for all clips (trim-aware). */
export function usePreviewVideo(clips: TimelineClip[]): {
  previewPath: string | null;
  loading: boolean;
  error: string | null;
} {
  const previewGeneration = useProject((s) => s.previewGeneration);
  const completePreviewBuild = useProject((s) => s.completePreviewBuild);
  const failPreviewBuild = useProject((s) => s.failPreviewBuild);
  const setPreviewProgress = useProject((s) => s.setPreviewProgress);

  const segments = clips.map((c) => ({
    path: c.media.path,
    inMs: clipInMs(c),
    outMs: clipOutMs(c),
    durationMs: c.media.durationMs,
  }));
  const clipKey = clipKeyFromClips(clips);

  const [previewPath, setPreviewPath] = useState<string | null>(
    clipKey === cachedClipKey ? cachedPreviewPath : null,
  );
  const [loading, setLoading] = useState(
    () => clips.length > 0
      && clipKey !== cachedClipKey
      && useProject.getState().lastPreviewClipKey === '',
  );
  const [error, setError] = useState<string | null>(null);
  const lastBuiltGenerationRef = useRef(0);

  useEffect(() => {
    if (clips.length === 0) {
      cachedClipKey = '';
      cachedPreviewPath = null;
      setPreviewPath(null);
      setLoading(false);
      setError(null);
      failPreviewBuild();
      return;
    }

    const lastPreviewClipKey = useProject.getState().lastPreviewClipKey;
    const cacheValid = clipKey === cachedClipKey && !!cachedPreviewPath;
    const needsInitialBuild = lastPreviewClipKey === '' && !cacheValid;
    const needsManualBuild = previewGeneration > lastBuiltGenerationRef.current;
    // Module cache can be cold after a remount/HMR even though the store recorded a build.
    const needsCacheRefresh = lastPreviewClipKey === clipKey && !cacheValid;

    if (!needsInitialBuild && !needsManualBuild && !needsCacheRefresh) {
      if (cacheValid) {
        setPreviewPath(cachedPreviewPath);
        setLoading(false);
        setError(null);
      } else if (cachedPreviewPath && lastPreviewClipKey !== clipKey) {
        // Timeline changed (trim/reorder) — keep showing the outdated concat until regenerate.
        setPreviewPath(cachedPreviewPath);
        setLoading(false);
        setError(null);
      }
      return;
    }

    if (needsManualBuild) {
      lastBuiltGenerationRef.current = previewGeneration;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    useProject.setState({
      previewBuilding: true,
      previewProgress: INITIAL_PREVIEW_PROGRESS,
      playing: false,
    });

    const offProgress = window.api.onPreviewProgress((progress) => {
      if (!cancelled) setPreviewProgress(progress);
    });

    window.api.buildPreviewVideo(segments)
      .then(({ path, cancelled: wasCancelled }) => {
        if (wasCancelled) {
          if (cancelled) {
            setLoading(false);
            setPreviewProgress(null);
            // Superseded by a newer build — leave previewBuilding to that effect.
          }
          return;
        }
        if (!path) {
          if (!cancelled) {
            setLoading(false);
            setPreviewProgress(null);
            failPreviewBuild();
          }
          return;
        }
        if (cancelled) return;
        cachedClipKey = clipKey;
        cachedPreviewPath = path;
        setPreviewPath(path);
        setLoading(false);
        setPreviewProgress(null);
        completePreviewBuild(clipKey);
      })
      .catch((e) => {
        if (cancelled) return;
        cachedClipKey = '';
        cachedPreviewPath = null;
        setError((e as Error).message);
        setPreviewPath(null);
        setLoading(false);
        failPreviewBuild();
      });

    return () => {
      cancelled = true;
      offProgress();
      void window.api.cancelPreviewBuild();
    };
  }, [clipKey, clips.length, previewGeneration, completePreviewBuild, failPreviewBuild, setPreviewProgress]);

  return { previewPath, loading, error };
}
