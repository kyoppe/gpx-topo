export type ViewMode = 'gpx' | 'map';

export function toggleViewMode(mode: ViewMode, flat: boolean): ViewMode {
  return flat ? (mode === 'gpx' ? 'map' : 'gpx') : mode;
}

export function showsGpxControls(mode: ViewMode) {
  return mode === 'gpx';
}

/** A GPX selected from Map mode becomes the active view once loading finishes. */
export function shouldSwitchToGpxAfterFileLoad(mode: ViewMode) {
  return mode === 'map';
}
