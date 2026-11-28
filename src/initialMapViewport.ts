import { worldPoint } from './geo';
import type { MapViewport } from './session';

export type GpxRestoreState = 'pending' | 'none' | 'ready';
export type MapCenter = { lat: number; lon: number };
export type GpxProjectionCenter = { centerLat: number; centerLon: number; scale: number };

const LEGACY_FIXTURE_MIN_LAT = 36.718392;
const LEGACY_FIXTURE_MAX_LAT = 36.875791;
const LEGACY_FIXTURE_MIN_LON = 138.063563;
const LEGACY_FIXTURE_MAX_LON = 138.296643;
const LEGACY_MAP_PADDING = 0.09;
const TILE = 256;
const TILE_AXIS_BUDGET = 125;

type InitialMapViewportInput = {
  permalinkCenter: MapCenter | null;
  fittedScale: number | null;
  savedMapViewport: MapViewport | null;
  gpxProjection: GpxProjectionCenter | null;
  legacyPermalinkScale: number | null;
  defaultViewport: MapViewport;
};

/**
 * Preserve the scale of area-less permalinks created before the display-area parameters existed.
 *
 * Before the bundled sample GPX was removed, those links waited for its projection and used the
 * projection scale. Keep only the sample route's bounds here instead of fetching the GPX at startup.
 */
export function legacyFixtureProjectionScale(width: number, height: number) {
  const minX = worldPoint(LEGACY_FIXTURE_MIN_LAT, LEGACY_FIXTURE_MIN_LON).x;
  const maxX = worldPoint(LEGACY_FIXTURE_MIN_LAT, LEGACY_FIXTURE_MAX_LON).x;
  const minY = worldPoint(LEGACY_FIXTURE_MAX_LAT, LEGACY_FIXTURE_MIN_LON).y;
  const maxY = worldPoint(LEGACY_FIXTURE_MIN_LAT, LEGACY_FIXTURE_MIN_LON).y;
  const scale = Math.min(
    (width * (1 - 2 * LEGACY_MAP_PADDING)) / Math.max(maxX - minX, 1e-6),
    (height * (1 - 2 * LEGACY_MAP_PADDING)) / Math.max(maxY - minY, 1e-6),
    2 ** 17,
  );
  const viewport = Math.max(width, height, 1);
  return Math.max(1e-6, scale, viewport / (TILE_AXIS_BUDGET * TILE));
}

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
  legacyPermalinkScale,
  defaultViewport,
}: InitialMapViewportInput): MapViewport {
  const scale = fittedScale
    ?? (permalinkCenter
      ? (gpxProjection?.scale ?? legacyPermalinkScale ?? defaultViewport.scale)
      : (savedMapViewport?.scale ?? gpxProjection?.scale ?? defaultViewport.scale));
  return {
    lat: permalinkCenter?.lat ?? gpxProjection?.centerLat ?? defaultViewport.lat,
    lon: permalinkCenter?.lon ?? gpxProjection?.centerLon ?? defaultViewport.lon,
    scale,
  };
}
