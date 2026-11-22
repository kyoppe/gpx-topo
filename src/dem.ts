import type { MapProjection } from './geo';
import { decodePng } from './png';

const TILE = 256;
const INVALID_RGB = (128 << 16) | (0 << 8) | 0;
const INVALID_VALUE = 1 << 23;
const VALUE_RANGE = 1 << 24;

/** Elevations in metres on an (nx + 1) x (ny + 1) lattice spanning the whole map. */
export type ElevationGrid = {
  nx: number;
  ny: number;
  values: Float32Array;
  source: 'gsi-dem' | 'gpx';
};

export function decodeDemElevation(red: number, green: number, blue: number) {
  const encoded = red * 2 ** 16 + green * 2 ** 8 + blue;
  if (((red << 16) | (green << 8) | blue) === INVALID_RGB || encoded === INVALID_VALUE) {
    return null;
  }
  return (encoded < INVALID_VALUE ? encoded : encoded - VALUE_RANGE) * 0.01;
}

/** Only for PNG layouts `decodePng` does not read: the canvas may be colour managed or carry noise. */
async function canvasPixels(bytes: Uint8Array<ArrayBuffer>) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(TILE, TILE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error('DEM tile could not be read.');
  }
  context.drawImage(bitmap, 0, 0, TILE, TILE);
  bitmap.close();
  return { channels: 4, data: context.getImageData(0, 0, TILE, TILE).data };
}

async function decodeTile(bytes: Uint8Array<ArrayBuffer>) {
  const png = await decodePng(bytes);
  const { channels, data } = png && png.width === TILE && png.height === TILE ? png : await canvasPixels(bytes);
  const values = new Float32Array(TILE * TILE);
  for (let index = 0; index < values.length; index += 1) {
    const offset = index * channels;
    values[index] = decodeDemElevation(data[offset], data[offset + 1], data[offset + 2]) ?? Number.NaN;
  }
  return values;
}

async function fetchDemTile(z: number, x: number, y: number, signal?: AbortSignal) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`/api/gsi/dem_png/${z}/${x}/${y}.png`, { signal });
      if (response.status === 404) {
        return 'sea' as const;
      }
      if (!response.ok) {
        continue;
      }
      return await decodeTile(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
    }
  }
  return null;
}

/** Samples GSI DEM tiles (DEM10B) on the lattice the terrain is built from. */
export async function loadDemGrid(
  projection: MapProjection,
  nx: number,
  ny: number,
  signal?: AbortSignal,
): Promise<ElevationGrid> {
  const zoom = projection.zoomFor((2 * nx) / projection.width, 5, 14);
  const tiles = projection.tiles(zoom);
  const decoded = new Map<string, Float32Array | 'sea'>();
  let failed = 0;
  await Promise.all(
    tiles.map(async (tile) => {
      const values = await fetchDemTile(tile.z, tile.x, tile.y, signal);
      if (values === null) {
        failed += 1;
      } else {
        decoded.set(`${tile.x}/${tile.y}`, values);
      }
    }),
  );
  if (decoded.size === 0 || failed > tiles.length / 2) {
    throw new Error('GSI DEM tiles are unavailable for this area.');
  }

  const count = 2 ** zoom;
  const pixel = (gx: number, gy: number) => {
    const tx = Math.floor(gx / TILE);
    const ty = Math.floor(gy / TILE);
    const tile = decoded.get(`${((tx % count) + count) % count}/${ty}`);
    if (!tile || tile === 'sea') {
      return 0;
    }
    const value = tile[(gy - ty * TILE) * TILE + (gx - tx * TILE)];
    return Number.isFinite(value) ? value : 0;
  };

  const values = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j += 1) {
    const worldY = projection.originY + ((j / ny) * projection.height) / projection.scale;
    const py = worldY * count - 0.5;
    const y0 = Math.floor(py);
    const fy = py - y0;
    for (let i = 0; i <= nx; i += 1) {
      const worldX = projection.originX + ((i / nx) * projection.width) / projection.scale;
      const px = worldX * count - 0.5;
      const x0 = Math.floor(px);
      const fx = px - x0;
      const a = pixel(x0, y0);
      const b = pixel(x0 + 1, y0);
      const c = pixel(x0, y0 + 1);
      const d = pixel(x0 + 1, y0 + 1);
      values[j * (nx + 1) + i] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return { nx, ny, values, source: 'gsi-dem' };
}

/** When the DEM cannot be read: a rough surface interpolated from the track's own elevations. */
export function gpxElevationGrid(
  points: readonly { x: number; y: number; ele: number | null }[],
  nx: number,
  ny: number,
  width: number,
  height: number,
): ElevationGrid {
  const known = points.filter((point) => point.ele !== null);
  const step = Math.max(1, Math.ceil(known.length / 400));
  const samples = known.filter((_, index) => index % step === 0);
  const values = new Float32Array((nx + 1) * (ny + 1));
  const lowest = samples.reduce((low, point) => Math.min(low, point.ele ?? low), Infinity);
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const x = (i / nx) * width;
      const y = (j / ny) * height;
      let weight = 0;
      let sum = 0;
      let nearest = Infinity;
      for (const point of samples) {
        const distance2 = (point.x - x) ** 2 + (point.y - y) ** 2;
        nearest = Math.min(nearest, distance2);
        const w = 1 / (distance2 + 400) ** 1.5;
        weight += w;
        sum += w * (point.ele ?? 0);
      }
      const value = weight > 0 ? sum / weight : 0;
      const fade = Math.exp(-Math.sqrt(nearest) / 90);
      values[j * (nx + 1) + i] = Number.isFinite(lowest)
        ? lowest - 60 + (value - lowest + 60) * fade
        : 0;
    }
  }
  return { nx, ny, values, source: 'gpx' };
}

/** Crops a rectangular map-space window from a larger elevation grid. */
export function cropElevationGrid(
  source: ElevationGrid,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  nx: number,
  ny: number,
): ElevationGrid {
  const sourceW = source.nx + 1;
  const sample = (px: number, py: number) => {
    const gx = Math.max(0, Math.min(1, px / sourceWidth)) * source.nx;
    const gy = Math.max(0, Math.min(1, py / sourceHeight)) * source.ny;
    const i = Math.min(source.nx - 1, Math.floor(gx));
    const j = Math.min(source.ny - 1, Math.floor(gy));
    const fx = gx - i;
    const fy = gy - j;
    const a = source.values[j * sourceW + i];
    const b = source.values[j * sourceW + i + 1];
    const c = source.values[(j + 1) * sourceW + i];
    const d = source.values[(j + 1) * sourceW + i + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const values = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      values[j * (nx + 1) + i] = sample(x + (i / nx) * width, y + (j / ny) * height);
    }
  }
  return { nx, ny, values, source: source.source };
}
