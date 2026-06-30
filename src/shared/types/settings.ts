export type SpeedUnits = 'kmh' | 'mph';
export type DistanceUnits = 'km' | 'mi';
export type PreviewResolution = '720p' | '1080p' | 'source';

export interface AppSettings {
  /** Absolute path of the most recently opened/saved project, for recovery. */
  lastProjectPath: string | null;
  speedUnits: SpeedUnits;
  distanceUnits: DistanceUnits;
  previewResolution: PreviewResolution;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  lastProjectPath: null,
  speedUnits: 'kmh',
  distanceUnits: 'km',
  previewResolution: '720p',
};
