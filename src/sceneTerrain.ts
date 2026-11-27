import type { ElevationGrid } from './dem';
import type { SiteScene } from './siteScene';

/** The model's footprint in scene units: 1 deep each way from the centre, and `halfWidth` (the window's aspect) wide. */
export const MODEL_HALF_WIDTH = 1.6;
export const MODEL_HALF_DEPTH = 1;
/** How many times taller than true scale the relief is drawn, so a ridge reads as a ridge from a distance. */
export const VERTICAL_EXAGGERATION = 0.95;
/** The share of the model's depth, at the top and at the bottom, over which the relief fades out. */
export const RIM = 0.17;
/** The thickness of the model's base, below its lowest point. */
export const BASE_THICKNESS = 0.1;

/** floats per vertex: x, y, height, slope x, slope y, u, v, kind (0 surface, 1 side wall) */
export const TERRAIN_STRIDE = 8;

export type TerrainMesh = {
  vertices: Float32Array;
  indices: Uint32Array;
  minElevation: number;
  maxElevation: number;
  /** the tallest point above the base plane, in scene units */
  reliefHeight: number;
  /** scene units of height per metre of elevation */
  unitsPerMeter: number;
};

/** Metres on the ground that one tile pixel covers at a latitude and zoom. */
export function metersPerPixel(lat: number, zoom: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Turns an elevation grid into the model: a surface that follows the elevations, and walls down to a flat
 * base so the whole thing reads as a solid piece. The surface carries the slope at each point so the
 * shader can light it without a second pass.
 */
export function buildTerrainMesh(
  grid: ElevationGrid,
  scene: SiteScene,
  sheetWidth: number,
  halfWidth = MODEL_HALF_WIDTH,
): TerrainMesh {
  const { nx, ny, values } = grid;
  const columns = nx + 1;
  const rows = ny + 1;
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  for (const value of values) {
    if (value < minElevation) minElevation = value;
    if (value > maxElevation) maxElevation = value;
  }
  if (!Number.isFinite(minElevation)) {
    minElevation = 0;
    maxElevation = 0;
  }
  const unitsPerMeter =
    ((halfWidth * 2) / (sheetWidth * metersPerPixel(scene.lat, scene.zoom))) *
    VERTICAL_EXAGGERATION *
    // a narrow window (a phone held upright) gets a gentler relief, so the page on it stays readable
    Math.min(1, Math.max(0.55, halfWidth / MODEL_HALF_WIDTH));
  // The ground eases down to the base plane towards the top and bottom edges, so the page's bars there
  // (its header and its buttons) lie on level ground instead of behind a ridge.
  const verticalRim = (j: number) => {
    const edge = Math.min(j, ny - j) / ny;
    const t = Math.min(1, edge / RIM);
    return t * t * (3 - 2 * t);
  };
  const heightAt = (i: number, j: number) => (values[j * columns + i] - minElevation) * unitsPerMeter * verticalRim(j);
  const stepX = (halfWidth * 2) / nx;
  const stepY = (MODEL_HALF_DEPTH * 2) / ny;

  const wallCount = 2 * (columns + rows);
  const vertexCount = columns * rows + wallCount * 2;
  const vertices = new Float32Array(vertexCount * TERRAIN_STRIDE);
  let cursor = 0;
  const push = (x: number, y: number, h: number, gx: number, gy: number, u: number, v: number, kind: number) => {
    vertices[cursor] = x;
    vertices[cursor + 1] = y;
    vertices[cursor + 2] = h;
    vertices[cursor + 3] = gx;
    vertices[cursor + 4] = gy;
    vertices[cursor + 5] = u;
    vertices[cursor + 6] = v;
    vertices[cursor + 7] = kind;
    cursor += TERRAIN_STRIDE;
  };

  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const left = heightAt(Math.max(0, i - 1), j);
      const right = heightAt(Math.min(nx, i + 1), j);
      const up = heightAt(i, Math.max(0, j - 1));
      const down = heightAt(i, Math.min(ny, j + 1));
      const spanX = (Math.min(nx, i + 1) - Math.max(0, i - 1)) * stepX;
      // rows run from north (top, +y) to south, so the y step runs the other way
      const spanY = (Math.min(ny, j + 1) - Math.max(0, j - 1)) * stepY;
      push(
        (i / nx) * halfWidth * 2 - halfWidth,
        MODEL_HALF_DEPTH - (j / ny) * MODEL_HALF_DEPTH * 2,
        heightAt(i, j),
        (right - left) / spanX,
        (up - down) / spanY,
        i / nx,
        j / ny,
        0,
      );
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = j * columns + i;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Walls: for each edge, a top row (at the surface height) and a bottom row (at the base), facing outward.
  const wall = (edge: { x: number; y: number; h: number; u: number; v: number }[], nxOut: number, nyOut: number) => {
    const topStart = cursor / TERRAIN_STRIDE;
    for (const point of edge) push(point.x, point.y, point.h, nxOut, nyOut, point.u, point.v, 1);
    const bottomStart = cursor / TERRAIN_STRIDE;
    for (const point of edge) push(point.x, point.y, -BASE_THICKNESS, nxOut, nyOut, point.u, point.v, 1);
    for (let k = 0; k < edge.length - 1; k += 1) {
      const t0 = topStart + k;
      const t1 = t0 + 1;
      const b0 = bottomStart + k;
      const b1 = b0 + 1;
      indices.push(t0, b0, t1, t1, b0, b1);
    }
  };
  const row = (j: number) =>
    Array.from({ length: columns }, (_, i) => ({
      x: (i / nx) * halfWidth * 2 - halfWidth,
      y: MODEL_HALF_DEPTH - (j / ny) * MODEL_HALF_DEPTH * 2,
      h: heightAt(i, j),
      u: i / nx,
      v: j / ny,
    }));
  const column = (i: number) =>
    Array.from({ length: rows }, (_, j) => ({
      x: (i / nx) * halfWidth * 2 - halfWidth,
      y: MODEL_HALF_DEPTH - (j / ny) * MODEL_HALF_DEPTH * 2,
      h: heightAt(i, j),
      u: i / nx,
      v: j / ny,
    }));
  wall(row(ny), 0, -1);
  wall(row(0).reverse(), 0, 1);
  wall(column(0), -1, 0);
  wall(column(nx).reverse(), 1, 0);

  return {
    vertices: vertices.subarray(0, cursor),
    indices: Uint32Array.from(indices),
    minElevation,
    maxElevation,
    reliefHeight: (maxElevation - minElevation) * unitsPerMeter,
    unitsPerMeter,
  };
}
