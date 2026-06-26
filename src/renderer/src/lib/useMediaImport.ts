import { useCallback } from 'react';
import { useProject } from '../store/project';
import { roundExportFps } from '@shared/types';
import type { TelemetryTrack } from '@shared/types';

/**
 * Shared media-import actions used by the Edit workspace (add clip, load FIT).
 * Reports progress through the global `busyMessage` store field so the
 * App-level ProcessingOverlay stays in sync.
 */
export function useMediaImport() {
  const addClip = useProject((s) => s.addClip);
  const addOverlay = useProject((s) => s.addOverlay);
  const addSharedTrack = useProject((s) => s.addSharedTrack);
  const addClipLocalTrack = useProject((s) => s.addClipLocalTrack);
  const setExport = useProject((s) => s.setExport);
  const setBusyMessage = useProject((s) => s.setBusyMessage);

  const addClipFromFile = useCallback(async () => {
    const paths = await window.api.pickVideoFile();
    if (paths.length === 0) return;

    const hadClips = useProject.getState().project.clips.length > 0;
    let setExportFps = !hadClips;

    try {
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i]!;
        const progress = paths.length > 1 ? ` (${i + 1}/${paths.length})` : '';

        setBusyMessage(`Probing video${progress}…`);
        const probe = await window.api.probeVideo(path);
        const media = {
          id: crypto.randomUUID(),
          path,
          filename: path.split(/[/\\]/).pop() ?? path,
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
          fps: probe.fps,
          creationTime: probe.creationTime,
        };
        let localTracks: TelemetryTrack[] = [];
        if (probe.cameraExtractorId) {
          setBusyMessage(`Extracting ${probe.detectedBrand ?? 'camera'} telemetry${progress}…`);
          try {
            localTracks = [await window.api.extractCameraTelemetry(path)];
          } catch (e) {
            alert(`Telemetry extraction failed for ${media.filename}: ${(e as Error).message}`);
          }
        }
        addClip(media, localTracks);
        if (setExportFps) {
          setExport({ fps: roundExportFps(probe.fps) });
          setExportFps = false;
        }
      }
    } finally {
      setBusyMessage(null);
    }
  }, [addClip, setExport, setBusyMessage]);

  const importAsOverlay = useCallback(async () => {
    const { project, playhead } = useProject.getState();
    if (project.clips.length === 0) {
      alert('Add a base clip first.');
      return;
    }
    const paths = await window.api.pickVideoFile();
    if (paths.length === 0) return;

    try {
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i]!;
        const progress = paths.length > 1 ? ` (${i + 1}/${paths.length})` : '';
        setBusyMessage(`Probing overlay video${progress}…`);
        const probe = await window.api.probeVideo(path);
        const media = {
          id: crypto.randomUUID(),
          path,
          filename: path.split(/[/\\]/).pop() ?? path,
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
          fps: probe.fps,
          creationTime: probe.creationTime,
        };
        const startMs = i === 0 ? playhead : useProject.getState().playhead;
        addOverlay(media, startMs);
      }
    } finally {
      setBusyMessage(null);
    }
  }, [addOverlay, setBusyMessage]);

  const loadSharedFit = useCallback(async () => {
    const path = await window.api.pickFitFile();
    if (!path) return;
    setBusyMessage('Parsing FIT…');
    try {
      const track = await window.api.parseFitFile(path);
      addSharedTrack(track);
    } catch (e) {
      alert(`FIT parse failed: ${(e as Error).message}`);
    } finally {
      setBusyMessage(null);
    }
  }, [addSharedTrack, setBusyMessage]);

  const loadClipFit = useCallback(async () => {
    const { selectedClipId, project } = useProject.getState();
    const clipId = selectedClipId ?? project.clips[0]?.id;
    if (!clipId) {
      alert('Add a clip first.');
      return;
    }
    const path = await window.api.pickFitFile();
    if (!path) return;
    setBusyMessage('Parsing FIT…');
    try {
      const track = await window.api.parseFitFile(path);
      addClipLocalTrack(clipId, track);
    } catch (e) {
      alert(`FIT parse failed: ${(e as Error).message}`);
    } finally {
      setBusyMessage(null);
    }
  }, [addClipLocalTrack, setBusyMessage]);

  return { addClipFromFile, importAsOverlay, loadSharedFit, loadClipFit };
}
