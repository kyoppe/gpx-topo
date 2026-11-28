import { createCenteredProjection, type MapProjection } from './geo';
import type { SiteScene } from './siteScene';
import { decodePng } from './png';
import { regionProfileFor, type CoverageRegion } from './regions';

const TILE = 256;
const INVALID_RGB = (128 << 16) | (0 << 8) | 0;
const INVALID_VALUE = 1 << 23;
const VALUE_RANGE = 1 << 24;

/** Elevations in metres on an (nx + 1) x (ny + 1) lattice spanning the whole map. */
export type ElevationGrid = {
  nx: number;
  ny: number;
  values: Float32Array;
  source: 'gsi-dem' | 'usgs-3dep' | 'gpx' | 'flat';
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
    const requestController = new AbortController();
    const forwardAbort = () => requestController.abort();
    if (signal?.aborted) requestController.abort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });
    const timeout = window.setTimeout(() => requestController.abort(), GSI_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`, {
        signal: requestController.signal,
      });
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
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
  return null;
}

const USGS_SAMPLES_URL = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';
// POST keeps the geometry out of the URL. The service accepts up to about 1,000
// sample points per operation, so larger batches avoid the long serial tail of
// many small browser requests.
const USGS_MAX_SAMPLE_POINTS = 1000;
const USGS_MAX_CONCURRENT_REQUESTS = 4;
const USGS_REQUEST_TIMEOUT_MS = 30_000;
const GSI_MAX_CONCURRENT_REQUESTS = 8;
const GSI_REQUEST_TIMEOUT_MS = 15_000;
// ArcGIS documents an approximate 1,000-sample operation limit. Use a denser
// 64 x 64 lattice for the fine pass and split it into browser-safe requests.
const USGS_MAX_SAMPLE_INTERVALS = 63;

type UsgsSample = {
  locationId?: number;
  value?: number | string;
};

type UsgsSamplesResponse = {
  samples?: UsgsSample[];
  error?: { message?: string };
};

async function fetchUsgsSamples(points: readonly { lat: number; lon: number }[], signal?: AbortSignal) {
  const values = new Array<number | null>(points.length).fill(null);
  const batches = Array.from({ length: Math.ceil(points.length / USGS_MAX_SAMPLE_POINTS) }, (_, batchIndex) => {
    const offset = batchIndex * USGS_MAX_SAMPLE_POINTS;
    return { offset, points: points.slice(offset, offset + USGS_MAX_SAMPLE_POINTS) };
  });
  const batchController = new AbortController();
  const forwardAbort = () => batchController.abort();
  if (signal?.aborted) batchController.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = window.setTimeout(() => batchController.abort(), USGS_REQUEST_TIMEOUT_MS);
  let nextBatch = 0;
  const worker = async () => {
    try {
      while (nextBatch < batches.length) {
        if (batchController.signal.aborted) throw new Error('USGS 3DEP sample requests aborted.');
        const batch = batches[nextBatch];
        nextBatch += 1;
        const params = new URLSearchParams({
          geometry: JSON.stringify({
            points: batch.points.map((point) => [point.lon, point.lat]),
            spatialReference: { wkid: 4326 },
          }),
          geometryType: 'esriGeometryMultipoint',
          returnFirstValueOnly: 'true',
          interpolation: 'RSP_BilinearInterpolation',
          f: 'json',
        });
        const response = await fetch(USGS_SAMPLES_URL, {
          method: 'POST',
          body: params,
          signal: batchController.signal,
        });
        if (!response.ok) throw new Error(`USGS 3DEP sample request failed: ${response.status}`);
        const body = (await response.json()) as UsgsSamplesResponse;
        if (body.error) throw new Error(body.error.message ?? 'USGS 3DEP sample request failed.');
        for (let index = 0; index < (body.samples?.length ?? 0); index += 1) {
          const sample = body.samples?.[index];
          const localIndex = Number.isInteger(sample?.locationId) ? Number(sample?.locationId) : index;
          const value = Number(sample?.value);
          if (localIndex >= 0 && localIndex < batch.points.length && Number.isFinite(value)) values[batch.offset + localIndex] = value;
        }
      }
    } catch (error) {
      batchController.abort();
      throw error;
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(USGS_MAX_CONCURRENT_REQUESTS, batches.length) }, () => worker()));
    return values;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

function fillMissingSamples(samples: readonly (number | null)[], sampleNx: number, sampleNy: number) {
  const filled = samples.slice();
  const sampleWidth = sampleNx + 1;
  const valid = filled.flatMap((value, index) =>
    value === null
      ? []
      : [{ index, x: index % sampleWidth, y: Math.floor(index / sampleWidth), value }],
  );
  if (!valid.length) throw new Error('USGS 3DEP has no elevation data for this area.');
  for (let index = 0; index < filled.length; index += 1) {
    if (filled[index] !== null) continue;
    let nearest = valid[0];
    const x = index % sampleWidth;
    const y = Math.floor(index / sampleWidth);
    let distance = (nearest.x - x) ** 2 + (nearest.y - y) ** 2;
    for (const candidate of valid.slice(1)) {
      const nextDistance = (candidate.x - x) ** 2 + (candidate.y - y) ** 2;
      if (nextDistance < distance) {
        nearest = candidate;
        distance = nextDistance;
      }
    }
    filled[index] = nearest.value;
  }
  return filled as number[];
}

/** Resamples a small USGS sample lattice to the lattice consumed by the terrain renderer. */
export function interpolateElevationSamples(
  samples: readonly (number | null)[],
  sampleNx: number,
  sampleNy: number,
  nx: number,
  ny: number,
) {
  const sourceW = sampleNx + 1;
  const source = fillMissingSamples(samples, sampleNx, sampleNy);
  const values = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j += 1) {
    const gy = (j / Math.max(1, ny)) * sampleNy;
    const y0 = Math.min(sampleNy - 1, Math.floor(gy));
    const fy = gy - y0;
    for (let i = 0; i <= nx; i += 1) {
      const gx = (i / Math.max(1, nx)) * sampleNx;
      const x0 = Math.min(sampleNx - 1, Math.floor(gx));
      const fx = gx - x0;
      const a = source[y0 * sourceW + x0];
      const b = source[y0 * sourceW + x0 + 1];
      const c = source[(y0 + 1) * sourceW + x0];
      const d = source[(y0 + 1) * sourceW + x0 + 1];
      values[j * (nx + 1) + i] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return values;
}

async function loadUsgsDemGrid(
  projection: MapProjection,
  nx: number,
  ny: number,
  signal?: AbortSignal,
  quality: 'coarse' | 'fine' = 'fine',
): Promise<ElevationGrid> {
  const maxIntervals = quality === 'coarse' ? 9 : USGS_MAX_SAMPLE_INTERVALS;
  const sampleNx = Math.min(Math.max(1, nx), maxIntervals);
  const sampleNy = Math.min(Math.max(1, ny), maxIntervals);
  const points = [];
  for (let j = 0; j <= sampleNy; j += 1) {
    for (let i = 0; i <= sampleNx; i += 1) {
      points.push(projection.inverse((i / sampleNx) * projection.width, (j / sampleNy) * projection.height));
    }
  }
  const samples = await fetchUsgsSamples(points, signal);
  return {
    nx,
    ny,
    values: interpolateElevationSamples(samples, sampleNx, sampleNy, nx, ny),
    source: 'usgs-3dep',
  };
}

/** Samples GSI DEM tiles (DEM10B) on the lattice the terrain is built from. */
export async function loadDemGrid(
  projection: MapProjection,
  nx: number,
  ny: number,
  signal?: AbortSignal,
  region: CoverageRegion = 'japan',
  quality: 'coarse' | 'fine' = 'fine',
): Promise<ElevationGrid> {
  const profile = regionProfileFor(region);
  if (profile.elevation === 'usgs-3dep') return loadUsgsDemGrid(projection, nx, ny, signal, quality);
  if (profile.elevation === 'none') throw new Error('Elevation data is unavailable for this region.');
  const zoom = projection.zoomFor((2 * nx) / projection.width, 5, 14);
  const tiles = projection.tiles(zoom);
  const decoded = new Map<string, Float32Array | 'sea'>();
  let failed = 0;
  let nextTile = 0;
  const worker = async () => {
    while (nextTile < tiles.length) {
      const tile = tiles[nextTile];
      nextTile += 1;
      const values = await fetchDemTile(tile.z, tile.x, tile.y, signal);
      if (values === null) {
        failed += 1;
      } else {
        decoded.set(`${tile.x}/${tile.y}`, values);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(GSI_MAX_CONCURRENT_REQUESTS, tiles.length) }, () => worker()));
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

/**
 * A fixed set of rolling hills for the tutorial frame, used only when the GSI elevation tiles cannot be
 * loaded, so the lesson never shows an empty terrain. It is deterministic: the same lattice gives the same hills.
 */
export function tutorialElevationGrid(nx: number, ny: number): ElevationGrid {
  const values = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const u = i / Math.max(1, nx);
      const v = j / Math.max(1, ny);
      const ridge = Math.exp(-(((u - 0.55) / 0.22) ** 2 + ((v - 0.45) / 0.3) ** 2)) * 900;
      const knoll = Math.exp(-(((u - 0.25) / 0.14) ** 2 + ((v - 0.7) / 0.16) ** 2)) * 420;
      const swell = (Math.sin(u * 9) * Math.cos(v * 7) + 1) * 30;
      values[j * (nx + 1) + i] = 1200 + ridge + knoll + swell;
    }
  }
  return { nx, ny, values, source: 'gsi-dem' };
}

/**
 * The elevations under a standalone-page scene: the same box the blank-map sheet covers (one sheet pixel per
 * map pixel at the scene's zoom), sampled on an (nx + 1) x (ny + 1) lattice.
 */
export function loadSceneElevation(
  scene: SiteScene,
  width: number,
  height: number,
  nx: number,
  ny: number,
  signal?: AbortSignal,
): Promise<ElevationGrid> {
  const projection = createCenteredProjection(scene.lat, scene.lon, width, height, 2 ** scene.zoom);
  return loadDemGrid(projection, nx, ny, signal);
}
