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
// dependency to the browser bundle. The northern edge follows the US-Canada
// border closely enough to avoid routing Canadian coordinates to US providers.
const CONTIGUOUS_UNITED_STATES: readonly Point[] = [
  [-124.8, 49],
  [-124.8, 46],
  [-124.5, 42],
  [-124.1, 40],
  [-123.2, 38],
  [-122.5, 36],
  [-120.8, 34],
  [-118.5, 32.5],
  [-117.1, 32.5],
  [-114.7, 32.7],
  [-111, 31.3],
  [-108.2, 31.3],
  [-106.6, 31.8],
  [-104.5, 29.8],
  [-100, 28],
  [-97.2, 25.8],
  [-95, 28.5],
  [-91.2, 29],
  [-88, 30],
  [-85, 30],
  [-82.5, 29.5],
  [-81, 25],
  [-80, 25],
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
  [-71, 45],
  [-75, 44.5],
  [-77, 43.8],
  [-79.5, 43.5],
  [-81, 42.8],
  [-83.2, 42.2],
  [-84.8, 46],
  [-89, 48],
  [-95, 49],
  [-104, 49],
  [-110, 49],
  [-115, 49],
  [-120, 49],
];

const SOUTHERN_CANADA: readonly Point[] = [
  [-141, 49],
  [-95, 49],
  [-90, 48],
  [-86, 46],
  [-84, 45.5],
  [-83.2, 42.2],
  [-82.8, 42.45],
  [-81, 42.8],
  [-79.5, 43.5],
  [-77, 43.8],
  [-75, 44.5],
  [-73, 45],
  [-71, 45],
  [-67, 47],
  [-52, 47],
  [-52, 72],
  [-141, 72],
];

const ALASKA: readonly Point[] = [
  [-170, 51],
  [-130, 51],
  [-130, 54.5],
  [-136, 57],
  [-141, 60],
  [-141, 72],
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
  if (lat >= 34 && lat <= 39 && lon < 130) return false;
  if (lat >= 37 && lon < 130) return false;
  if (lat >= 41 && lon < 135) return false;
  if (lat > 45.7) return false;
  return true;
}

function inUnitedStates(lat: number, lon: number) {
  return (
    (inPolygon(lon, lat, CONTIGUOUS_UNITED_STATES) && !inPolygon(lon, lat, SOUTHERN_CANADA)) ||
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
