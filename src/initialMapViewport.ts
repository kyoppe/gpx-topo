import type { MapViewport } from './session';

export type GpxRestoreState = 'pending' | 'none' | 'ready';
export type MapCenter = { lat: number; lon: number };
export type GpxProjectionCenter = { centerLat: number; centerLon: number; scale: number };

type InitialMapViewportInput = {
  permalinkCenter: MapCenter | null;
  fittedScale: number | null;
  savedMapViewport: MapViewport | null;
  gpxProjection: GpxProjectionCenter | null;
  defaultViewport: MapViewport;
};

/** Wait for a saved GPX to finish restoring before choosing the default map. */
export function shouldWaitForInitialMapViewport(
  permalinkCenter: MapCenter | null,
  gpxProjection: GpxProjectionCenter | null,
  gpxRestoreState: GpxRestoreState,
) {
  return !permalinkCenter && !gpxProjection && gpxRestoreState === 'pending';
}

/** Resolve the first map viewport while preserving permalink, GPX, and saved-view precedence. */
export function resolveInitialMapViewport({
  permalinkCenter,
  fittedScale,
  savedMapViewport,
  gpxProjection,
  defaultViewport,
}: InitialMapViewportInput): MapViewport {
  const scale = fittedScale
    ?? (permalinkCenter
      ? (gpxProjection?.scale ?? defaultViewport.scale)
      : (savedMapViewport?.scale ?? gpxProjection?.scale ?? defaultViewport.scale));
  return {
    lat: permalinkCenter?.lat ?? gpxProjection?.centerLat ?? defaultViewport.lat,
    lon: permalinkCenter?.lon ?? gpxProjection?.centerLon ?? defaultViewport.lon,
    scale,
  };
}
