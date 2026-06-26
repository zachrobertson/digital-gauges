import { useEffect, useRef, useState } from 'react';
import type { TimelineClip } from '@shared/types';
import { clipInMs, clipOutMs } from '@shared/timeline';
import { useProject } from '../store/project';

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
  const lastPreviewClipKey = useProject((s) => s.lastPreviewClipKey);
  const previewGeneration = useProject((s) => s.previewGeneration);
  const completePreviewBuild = useProject((s) => s.completePreviewBuild);
  const failPreviewBuild = useProject((s) => s.failPreviewBuild);

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
    clips.length > 0 && clipKey !== cachedClipKey && lastPreviewClipKey === '',
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
      return;
    }

    const needsInitialBuild = lastPreviewClipKey === '' && clipKey !== cachedClipKey;
    const needsManualBuild = previewGeneration > lastBuiltGenerationRef.current;

    if (!needsInitialBuild && !needsManualBuild) {
      if (clipKey === cachedClipKey && cachedPreviewPath) {
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
    useProject.getState().setPlaying(false);

    window.api.buildPreviewVideo(segments)
      .then(({ path }) => {
        if (cancelled) return;
        cachedClipKey = clipKey;
        cachedPreviewPath = path;
        setPreviewPath(path);
        setLoading(false);
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
    };
  }, [clipKey, clips.length, lastPreviewClipKey, previewGeneration, completePreviewBuild, failPreviewBuild]);

  return { previewPath, loading, error };
}
