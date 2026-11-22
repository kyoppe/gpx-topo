export type ViewMode = 'gpx' | 'map';

export function toggleViewMode(mode: ViewMode, flat: boolean): ViewMode {
  return flat ? (mode === 'gpx' ? 'map' : 'gpx') : mode;
}

export function showsGpxControls(mode: ViewMode) {
  return mode === 'gpx';
}
