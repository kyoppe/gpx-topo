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
  [-105.6, 31.3],
  [-104.8, 30.8],
  [-104.5, 29.8],
  [-104, 29.35],
  [-103.3, 29],
  [-102, 28.7],
  [-100, 28],
  [-97.5, 25.8],
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
  [-84.7, 46.6],
  [-84.35, 46.515],
  [-84, 45.8],
  [-83.2, 44.8],
  [-82.7, 43.5],
  [-82.2, 42.4],
  [-81, 42.5],
  [-79.5, 43.5],
  [-77, 43.8],
  [-75, 44.5],
  [-73, 45],
  [-71.5, 45.2],
  [-70.5, 46],
  [-69, 46.7],
  [-68, 47],
  [-67, 47.2],
  [-52, 47.2],
  [-52, 72],
  [-141, 72],
];

const ALASKA: readonly Point[] = [
  [-170, 51],
  [-160, 53],
  [-150, 54],
  [-141, 55],
  [-137, 54.6],
  [-133, 54.6],
  [-130, 56],
  [-130, 60],
  [-141, 60],
  [-141, 72],
  [-170, 72],
];

const FLORIDA_KEYS: readonly Point[] = [
  [-82.2, 24.3],
  [-80, 24.3],
  [-80, 26],
  [-82.2, 26],
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
  [-84.7, 46.55],
  [-84.35, 46.52],
  [-84.15, 46.3],
  [-84.5, 45.8],
  [-83.2, 45.7],
  [-82.8, 42.8],
  [-83.04, 42.35],
  [-83.04, 42.28],
  [-83, 42],
  [-84.5, 41.7],
  [-86, 42],
  [-87.5, 43.5],
  [-89, 44.5],
];

const NORTHERN_MAINE: readonly Point[] = [
  [-71.1, 45],
  [-69.5, 45],
  [-67.1, 45.8],
  [-67, 47.3],
  [-68.8, 47.3],
  [-70, 47],
  [-71, 46.2],
];

const JAPAN_ISLANDS: readonly (readonly Point[])[] = [
  [
    [139.3, 41.4],
    [140, 41.3],
    [141, 41.5],
    [142, 42],
    [143, 42.1],
    [144.5, 42.5],
    [146, 43.6],
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
    [131.5, 34.5],
    [132.5, 35],
    [133.5, 35.3],
    [134.5, 35.8],
    [135.5, 36.4],
    [136.5, 37.2],
    [137.5, 37.8],
    [138.5, 38.5],
    [139.3, 39.4],
    [140, 40.1],
    [140.8, 40.8],
    [141.5, 41],
    [141.3, 39],
    [141, 37],
    [140.6, 35.8],
    [139.8, 34.9],
    [138.5, 34.3],
    [137, 34],
    [135.5, 33.8],
    [134, 33.6],
    [132.5, 33.4],
    [131.3, 33.5],
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
    [131.4, 33.2],
    [130.8, 33.8],
    [129.6, 33.8],
    [129, 33.1],
    [128.8, 32],
  ],
  [
    [127.5, 26],
    [128.5, 26],
    [128.5, 27.2],
    [127.5, 27.2],
  ],
  [
    [123.7, 24],
    [124.6, 24],
    [124.6, 24.8],
    [123.7, 24.8],
  ],
  [
    [124.7, 24.4],
    [125.6, 24.4],
    [125.6, 25.2],
    [124.7, 25.2],
  ],
  [
    [128, 27.6],
    [130.2, 27.6],
    [130.2, 30.1],
    [128, 30.1],
  ],
  [
    [129, 33.9],
    [130, 33.9],
    [130, 34.8],
    [129, 34.8],
  ],
  [
    [141.5, 26],
    [142.7, 26],
    [142.7, 27.8],
    [141.5, 27.8],
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
    ((inPolygon(lon, lat, CONTIGUOUS_UNITED_STATES) ||
      inPolygon(lon, lat, MICHIGAN) ||
      inPolygon(lon, lat, NORTHERN_MAINE)) &&
      !inPolygon(lon, lat, SOUTHERN_CANADA)) ||
    inPolygon(lon, lat, ALASKA) ||
    inPolygon(lon, lat, HAWAII) ||
    inPolygon(lon, lat, FLORIDA_KEYS)
  );
}

export function regionForCoordinates(lat: number, lon: number): CoverageRegion {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'unsupported';
  if (inJapan(lat, lon)) return 'japan';
  if (inUnitedStates(lat, lon)) return 'united-states';
  return 'unsupported';
}
