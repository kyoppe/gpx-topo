import type { GpxRoute, TrackPoint } from './gpx';

const TILE = 256;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export type MapPoint = {
  x: number;
  y: number;
  ele: number | null;
};

export type MapTile = {
  key: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
  size: number;
};

export type MapProjection = {
  width: number;
  height: number;
  /** Map px per world px at zoom 0. */
  scale: number;
  originX: number;
  originY: number;
  centerLat: number;
  centerLon: number;
  metersPerPixel: number;
  project(point: { lat: number; lon: number; ele?: number | null }): MapPoint;
  inverse(x: number, y: number): { lat: number; lon: number };
  tiles(zoom: number): MapTile[];
  /** The tile zoom that gives about `texelsPerPx` tile pixels per map px. */
  zoomFor(texelsPerPx: number, min: number, max: number): number;
};

export function worldPoint(lat: number, lon: number) {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * TILE,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE,
  };
}

function geoPoint(x: number, y: number) {
  const lon = (x / TILE) * 360 - 180;
  const value = Math.PI - (2 * Math.PI * y) / TILE;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(value)), lon };
}

export function createMapProjection(
  route: Pick<GpxRoute, 'points'>,
  width: number,
  height: number,
  padding = 0.09,
): MapProjection {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of route.points) {
    const world = worldPoint(point.lat, point.lon);
    minX = Math.min(minX, world.x);
    maxX = Math.max(maxX, world.x);
    minY = Math.min(minY, world.y);
    maxY = Math.max(maxY, world.y);
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min(
    (width * (1 - 2 * padding)) / spanX,
    (height * (1 - 2 * padding)) / spanY,
    2 ** 17,
  );
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const originX = centerX - width / 2 / scale;
  const originY = centerY - height / 2 / scale;
  const center = geoPoint(centerX, centerY);
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_M * Math.cos((center.lat * Math.PI) / 180)) / TILE / scale;

  const project = (point: { lat: number; lon: number; ele?: number | null }): MapPoint => {
    const world = worldPoint(point.lat, point.lon);
    return {
      x: (world.x - originX) * scale,
      y: (world.y - originY) * scale,
      ele: point.ele ?? null,
    };
  };

  const inverse = (x: number, y: number) => geoPoint(originX + x / scale, originY + y / scale);

  const tiles = (zoom: number) => {
    const count = 2 ** zoom;
    const tileWorld = TILE / count;
    const size = tileWorld * scale;
    const x0 = Math.floor(originX / tileWorld);
    const x1 = Math.floor((originX + width / scale) / tileWorld);
    const y0 = Math.max(0, Math.floor(originY / tileWorld));
    const y1 = Math.min(count - 1, Math.floor((originY + height / scale) / tileWorld));
    const list: MapTile[] = [];
    for (let ty = y0; ty <= y1; ty += 1) {
      for (let tx = x0; tx <= x1; tx += 1) {
        const wrapped = ((tx % count) + count) % count;
        list.push({
          key: `${zoom}/${wrapped}/${ty}`,
          z: zoom,
          x: wrapped,
          y: ty,
          left: (tx * tileWorld - originX) * scale,
          top: (ty * tileWorld - originY) * scale,
          size,
        });
      }
    }
    return list;
  };

  const zoomFor = (texelsPerPx: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(Math.log2(scale * texelsPerPx))));

  return {
    width,
    height,
    scale,
    originX,
    originY,
    centerLat: center.lat,
    centerLon: center.lon,
    metersPerPixel,
    project,
    inverse,
    tiles,
    zoomFor,
  };
}

/** Projects the track and resamples it so consecutive points are at least `spacing` map px apart. */
export function projectTrack(
  points: readonly TrackPoint[],
  projection: MapProjection,
  spacing: number,
) {
  const out: { x: number; y: number; ele: number | null; index: number }[] = [];
  let last: MapPoint | null = null;
  points.forEach((point, index) => {
    const projected = projection.project(point);
    if (
      !last ||
      index === points.length - 1 ||
      Math.hypot(projected.x - last.x, projected.y - last.y) >= spacing
    ) {
      out.push({ ...projected, index });
      last = projected;
    }
  });
  return out;
}

export function pathD(points: readonly { x: number; y: number }[]) {
  let d = '';
  points.forEach((point, index) => {
    d += `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  });
  return d;
}

/** The point of a line through `line` (each with its km along the route) nearest to (x, y): its km and how far off it is. */
export function nearestAlong(line: readonly { x: number; y: number; km: number }[], x: number, y: number) {
  let best: { km: number; dist: number } | null = null;
  for (let i = 0; i + 1 < line.length; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
    const dist = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
    if (!best || dist < best.dist) best = { km: a.km + (b.km - a.km) * t, dist };
  }
  return best;
}
