import type { ElevationGrid } from './dem';

/** GSI 1:25,000 maps: a contour every 10 m, and every fifth one (50 m) drawn heavier. */
export const CONTOUR_MINOR_M = 10;
export const CONTOUR_MAJOR_M = 50;

export type Terrain = {
  width: number;
  height: number;
  grid: ElevationGrid;
  /** Ground metres per map px; heights use the same scale, so the model is 1:1. */
  metersPerPixel: number;
  /** The model's floor: a round 100 m under the lowest point. */
  baseElevation: number;
  minElevation: number;
  maxElevation: number;
  summit: { x: number; y: number; ele: number };
  /** Elevation (m) at a map point, bilinear between lattice nodes. */
  elev(x: number, y: number): number;
};

export function buildTerrain(grid: ElevationGrid, width: number, height: number, metersPerPixel: number): Terrain {
  const { nx, ny, values } = grid;
  const W = nx + 1;
  let min = Infinity;
  let max = -Infinity;
  let top = 0;
  for (let k = 0; k < values.length; k += 1) {
    const v = values[k];
    if (v < min) min = v;
    if (v > max) {
      max = v;
      top = k;
    }
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 0;
  }
  const elev = (x: number, y: number) => {
    const gx = Math.max(0, Math.min(1, x / width)) * nx;
    const gy = Math.max(0, Math.min(1, y / height)) * ny;
    const i = Math.min(nx - 1, Math.floor(gx));
    const j = Math.min(ny - 1, Math.floor(gy));
    const fx = gx - i;
    const fy = gy - j;
    const a = values[j * W + i];
    const b = values[j * W + i + 1];
    const c = values[(j + 1) * W + i];
    const d = values[(j + 1) * W + i + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return {
    width,
    height,
    grid,
    metersPerPixel,
    baseElevation: Math.floor(min / 100) * 100 - 100,
    minElevation: min,
    maxElevation: max,
    summit: { x: ((top % W) / nx) * width, y: (Math.floor(top / W) / ny) * height, ele: max },
    elev,
  };
}

export function formatMeters(m: number) {
  return `${Math.round(m).toLocaleString('en-US')} m`;
}
