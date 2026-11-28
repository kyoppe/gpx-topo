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
  [-86.5, 47.5],
  [-85, 46.8],
  [-84, 45.8],
  [-83.2, 44.8],
  [-82.7, 43.5],
  [-82.2, 42.4],
  [-81, 42.5],
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

const MICHIGAN: readonly Point[] = [
  [-90.4, 46],
  [-88, 46],
  [-85.5, 46.5],
  [-84.5, 45.8],
  [-83.2, 45.7],
  [-82.5, 44.5],
  [-82.4, 43.5],
  [-83, 42],
  [-84.5, 41.7],
  [-86, 42],
  [-87.5, 43.5],
  [-89, 44.5],
];

const JAPAN_ISLANDS: readonly (readonly Point[])[] = [
  [
    [139.3, 41.4],
    [140, 41.3],
    [141, 41.5],
    [142, 42],
    [143, 42.1],
    [144.5, 42.5],
    [145.8, 43.5],
    [145.6, 44.7],
    [144.8, 45.1],
    [143.5, 45.2],
    [141.5, 45.5],
    [140.7, 45.1],
    [140, 44.5],
    [139.5, 43.5],
  ],
  [
    [130.8, 34.1],
    [131.7, 34.2],
    [132.7, 34.5],
    [133.7, 34.8],
    [134.8, 35.1],
    [135.7, 35.5],
    [136.5, 36.1],
    [137.3, 36.7],
    [138.2, 37.3],
    [139, 38.2],
    [139.7, 39.2],
    [140.5, 40.2],
    [141.3, 40.8],
    [141, 39.5],
    [140.8, 38.2],
    [140.8, 36.8],
    [140.3, 35.8],
    [139.5, 35],
    [138.5, 34.7],
    [137.5, 34.4],
    [136.5, 34.2],
    [135.4, 34.1],
    [134.3, 33.9],
    [133.2, 33.7],
    [132.2, 33.5],
    [131.3, 33.6],
  ],
  [
    [132, 32.8],
    [133, 32.7],
    [134.5, 33],
    [134.7, 33.8],
    [134, 34.2],
    [133, 34.1],
    [132.1, 33.6],
  ],
  [
    [129.5, 30.9],
    [130.4, 30.8],
    [131.4, 31.3],
    [131.8, 32.2],
    [131.4, 33],
    [130.7, 33.4],
    [129.6, 33],
    [129, 32],
  ],
  [
    [127.5, 26],
    [128.5, 26],
    [128.5, 27.2],
    [127.5, 27.2],
  ],
];

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
  return JAPAN_ISLANDS.some((island) => inPolygon(lon, lat, island));
}

function inUnitedStates(lat: number, lon: number) {
  return (
    ((inPolygon(lon, lat, CONTIGUOUS_UNITED_STATES) || inPolygon(lon, lat, MICHIGAN)) &&
      !inPolygon(lon, lat, SOUTHERN_CANADA)) ||
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
