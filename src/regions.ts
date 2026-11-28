export type CoverageRegion = 'japan' | 'united-states' | 'unsupported';

export type RegionProfile = {
  id: CoverageRegion;
  mapTiles: 'gsi' | 'osm' | 'none';
  elevation: 'gsi-dem' | 'usgs-3dep' | 'none';
};

export const REGION_PROFILES: Readonly<Record<CoverageRegion, RegionProfile>> = {
  japan: { id: 'japan', mapTiles: 'gsi', elevation: 'gsi-dem' },
  'united-states': { id: 'united-states', mapTiles: 'osm', elevation: 'usgs-3dep' },
  unsupported: { id: 'unsupported', mapTiles: 'none', elevation: 'none' },
};

export function regionProfileFor(region: CoverageRegion) {
  return REGION_PROFILES[region];
}

type Point = readonly [lon: number, lat: number];

// Deliberately simplified coverage outlines. They keep ordinary map searches
// out of GSI for overseas coordinates without adding a country-boundary
// dependency to the browser bundle.
const CONTIGUOUS_UNITED_STATES: readonly Point[] = [
  [-124.75, 48.4],
  [-124.6, 42],
  [-120, 39],
  [-117, 32.5],
  [-114.7, 32.7],
  [-111, 31.3],
  [-106.5, 31.8],
  [-104.5, 29.8],
  [-97.2, 25.8],
  [-90, 29],
  [-81, 25],
  [-80, 30],
  [-81, 32],
  [-79, 34],
  [-75, 35],
  [-75, 37],
  [-73, 40],
  [-70, 41],
  [-69, 44],
  [-67, 45],
  [-67, 47],
  [-72, 46],
  [-75, 45],
  [-79, 43],
  [-83, 46],
  [-89, 48],
  [-95, 49],
  [-104, 49],
  [-110, 49],
  [-115, 49],
  [-120, 49],
];

const ALASKA: readonly Point[] = [
  [-170, 51],
  [-130, 51],
  [-130, 72],
  [-170, 72],
];

const HAWAII: readonly Point[] = [
  [-160.5, 18.8],
  [-154.5, 18.8],
  [-154.5, 22.3],
  [-160.5, 22.3],
];

const JAPAN_BOUNDS = {
  minLat: 24,
  maxLat: 46,
  minLon: 122,
  maxLon: 154,
};

function inPolygon(lon: number, lat: number, polygon: readonly Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function inJapan(lat: number, lon: number) {
  if (lat < JAPAN_BOUNDS.minLat || lat > JAPAN_BOUNDS.maxLat || lon < JAPAN_BOUNDS.minLon || lon > JAPAN_BOUNDS.maxLon) {
    return false;
  }
  // Exclude the Korean peninsula, eastern China, and the Russian mainland
  // from the intentionally broad longitude envelope.
  if (lat >= 30 && lon < 128.5) return false;
  if (lat >= 34 && lon < 129) return false;
  if (lat >= 37 && lon < 130) return false;
  if (lat >= 41 && lon < 135) return false;
  return true;
}

function inUnitedStates(lat: number, lon: number) {
  return (
    inPolygon(lon, lat, CONTIGUOUS_UNITED_STATES) ||
    inPolygon(lon, lat, ALASKA) ||
    inPolygon(lon, lat, HAWAII)
  );
}

export function regionForCoordinates(lat: number, lon: number): CoverageRegion {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'unsupported';
  if (inJapan(lat, lon)) return 'japan';
  if (inUnitedStates(lat, lon)) return 'united-states';
  return 'unsupported';
}
