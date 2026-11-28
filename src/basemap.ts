import type { MapProjection, MapTile } from './geo';
import { regionProfileFor, type CoverageRegion } from './regions';

/**
 * Two pictures of the selected GSI map. The flat pale map is Zessoku's: the hillshade over it at 35 %.
 * The 3D pale map has no hillshade, and the map's own contours and vegetation marks are taken out,
 * so the model's 10 m contours are all that draws the relief. Aerial photos and the blank map stay untouched.
 */
const MAP_MAX_ZOOM = 18;
const BLANK_MAX_ZOOM = 14;
const OSM_MAX_ZOOM = 19;
/** Start with one extra source zoom so the first close view does not need a new base texture. */
const INITIAL_ZOOM_BONUS = 1;
const HILLSHADE_MAX_ZOOM = 16;
const HILLSHADE_OPACITY = 0.35;
const PAPER = '#f2f1ee';
const TILE = 256;
const PHOTO_NAMES_OPACITY = 0.42;

export type MapStyle = 'std' | 'pale' | 'blank' | 'photo' | 'photoNames';

function mapLayer(style: MapStyle, region: CoverageRegion) {
  if (regionProfileFor(region).mapTiles === 'osm') return 'standard';
  return style === 'photo' || style === 'photoNames' ? 'seamlessphoto' : style;
}

export function maxZoomForStyle(style: MapStyle, region: CoverageRegion = 'japan') {
  if (regionProfileFor(region).mapTiles === 'osm') return OSM_MAX_ZOOM;
  return style === 'blank' ? BLANK_MAX_ZOOM : MAP_MAX_ZOOM;
}

function stripsRelief(style: MapStyle, region: CoverageRegion) {
  return regionProfileFor(region).mapTiles !== 'osm' && (style === 'std' || style === 'pale');
}

function usesHillshade(style: MapStyle, region: CoverageRegion) {
  return regionProfileFor(region).mapTiles !== 'osm' && (style === 'std' || style === 'pale' || style === 'blank');
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type CachedTileBlob = { blob: Blob; expiresAt: number };

const tileBlobCache = new Map<string, Promise<CachedTileBlob | null>>();
const MAX_TILE_BLOBS = 256;

function cacheExpiry(response: Response) {
  const cacheControl = response.headers.get('cache-control') ?? '';
  if (/\bno-store\b/i.test(cacheControl)) return 0;
  const maxAge = /\bmax-age=(\d+)/i.exec(cacheControl);
  if (maxAge) return Date.now() + Number(maxAge[1]) * 1000;
  const expires = response.headers.get('expires');
  const timestamp = expires ? Date.parse(expires) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > Date.now() ? timestamp : 0;
}

async function loadTile(url: string, signal?: AbortSignal) {
  try {
    let blob = tileBlobCache.get(url);
    if (!blob) {
      blob = fetch(url)
        .then(async (response) => (response.ok ? { blob: await response.blob(), expiresAt: cacheExpiry(response) } : null))
        .catch(() => null);
      tileBlobCache.set(url, blob);
      if (tileBlobCache.size > MAX_TILE_BLOBS) tileBlobCache.delete(tileBlobCache.keys().next().value as string);
    }
    const source = await blob;
    if (!source) {
      if (tileBlobCache.get(url) === blob) tileBlobCache.delete(url);
      return null;
    }
    if (signal?.aborted) return null;
    if (source.expiresAt > 0 && source.expiresAt <= Date.now()) {
      if (tileBlobCache.get(url) === blob) tileBlobCache.delete(url);
      return loadTile(url, signal);
    }
    if (source.expiresAt === 0 && tileBlobCache.get(url) === blob) tileBlobCache.delete(url);
    return await createImageBitmap(source.blob);
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

/** A part of the map, in map px. */
export type MapRegion = { x: number; y: number; w: number; h: number };

function tilesIn(projection: MapProjection, zoom: number, region: MapRegion) {
  return projection
    .tiles(zoom)
    .filter((t) => t.left < region.x + region.w && t.left + t.size > region.x && t.top < region.y + region.h && t.top + t.size > region.y);
}

function tileUrl(layer: string, tile: MapTile, region: CoverageRegion) {
  if (regionProfileFor(region).mapTiles === 'osm') return `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
  return `https://cyberjapandata.gsi.go.jp/xyz/${layer}/${tile.z}/${tile.x}/${tile.y}.${layer === 'seamlessphoto' ? 'jpg' : 'png'}`;
}

function placeTile(context: Context2D, image: CanvasImageSource, tile: MapTile, region: MapRegion, density: number) {
  // a hair of overlap so tile seams never show
  context.drawImage(
    image,
    (tile.left - region.x) * density - 0.25,
    (tile.top - region.y) * density - 0.25,
    tile.size * density + 0.5,
    tile.size * density + 0.5,
  );
}

/** The pale map's contour inks (z10-13, z14-17, z18), each drawn over white. */
const CONTOUR_INKS = [
  [255, 220, 150],
  [200, 160, 60],
  [151, 111, 10],
] as const;

export function isContourInk(r: number, g: number, b: number) {
  for (const [cr, cg, cb] of CONTOUR_INKS) {
    const a = (255 - b) / (255 - cb);
    if (a < 0.03 || a > 1.06) continue;
    if (Math.abs(255 - a * (255 - cr) - r) <= 7 && Math.abs(255 - a * (255 - cg) - g) <= 7) return true;
  }
  // contour labels at small zooms: a lighter yellow off those lines
  return r >= 250 && g >= 225 && g <= 250 && b >= 148 && b <= 182 && g - b >= 55;
}

/** Marks no larger than this (tile px) and this many px can be vegetation symbols. */
const MARK_SIDE = 14;
const MARK_PX = 80;
/** ...when nothing else is inked this close (px), which keeps the strokes of text together. */
const MARK_GAP = 3;
const DETAIL_HALO = 0.18;

/**
 * Takes the pale map's contour lines and labels out of a tile, and its vegetation marks
 * (conifer, broadleaf, orchard...): small, compact, grey blobs with nothing else close by.
 * Text (black), dashes of a path (long and thin) and blobs cut by the tile edge stay.
 */
export function stripRelief(image: ImageData) {
  const { data: d, width: W, height: H } = image;
  const N = W * H;
  const ink = new Uint8Array(N);
  for (let p = 0, i = 0; p < N; p += 1, i += 4) {
    if (d[i + 3] < 128) continue;
    if (isContourInk(d[i], d[i + 1], d[i + 2])) {
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
    } else if (Math.min(d[i], d[i + 1], d[i + 2]) < 236) ink[p] = 1;
  }
  const comp = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  const members = new Int32Array(N);
  let id = 0;
  for (let s = 0; s < N; s += 1) {
    if (!ink[s] || comp[s] >= 0) continue;
    const mine = id++;
    let top = 0;
    let n = 0;
    stack[top++] = s;
    comp[s] = mine;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    // the darkest px (by its brightest channel), and how coloured it is
    let dark = 256;
    let core = 0;
    let blue = false;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    while (top > 0) {
      const p = stack[--top];
      members[n++] = p;
      const x = p % W;
      const y = (p - x) / W;
      sx += x;
      sy += y;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const i = p * 4;
      const hi = Math.max(d[i], d[i + 1], d[i + 2]);
      if (hi < dark) {
        dark = hi;
        core = hi - Math.min(d[i], d[i + 1], d[i + 2]);
        blue = d[i + 2] > d[i] + 8;
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        const Y = y + dy;
        if (Y < 0 || Y >= H) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const X = x + dx;
          if (X < 0 || X >= W) continue;
          const q = Y * W + X;
          if (ink[q] && comp[q] < 0) {
            comp[q] = mine;
            stack[top++] = q;
          }
        }
      }
    }
    if (n > MARK_PX || x1 - x0 >= MARK_SIDE || y1 - y0 >= MARK_SIDE) continue;
    if (x0 === 0 || y0 === 0 || x1 === W - 1 || y1 === H - 1) continue;
    // grey, not black; or a faint leftover of something warm
    const grey = dark >= 96 && core <= 6;
    const faint = dark >= 200 && !blue;
    if (!grey && !faint) continue;
    // compact: a dash is several times longer than it is wide
    const mx = sx / n;
    const my = sy / n;
    const cxx = sxx / n - mx * mx + 0.08;
    const cyy = syy / n - my * my + 0.08;
    const cxy = sxy / n - mx * my;
    const half = (cxx + cyy) / 2;
    const root = Math.sqrt(Math.max(0, half * half - (cxx * cyy - cxy * cxy)));
    if (half + root >= 5 * (half - root)) continue;
    let alone = true;
    for (let y = Math.max(0, y0 - MARK_GAP); y <= Math.min(H - 1, y1 + MARK_GAP) && alone; y += 1) {
      for (let x = Math.max(0, x0 - MARK_GAP); x <= Math.min(W - 1, x1 + MARK_GAP); x += 1) {
        const q = y * W + x;
        if (ink[q] && comp[q] !== mine) {
          alone = false;
          break;
        }
      }
    }
    if (!alone) continue;
    for (let k = 0; k < n; k += 1) {
      const i = members[k] * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
    }
  }
}

function stripper() {
  const scratch = new OffscreenCanvas(TILE, TILE);
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas unavailable.');
  return (image: ImageBitmap) => {
    context.clearRect(0, 0, TILE, TILE);
    context.drawImage(image, 0, 0, TILE, TILE);
    const data = context.getImageData(0, 0, TILE, TILE);
    stripRelief(data);
    context.putImageData(data, 0, 0);
    return scratch;
  };
}

function prepare(canvas: HTMLCanvasElement, width: number, height: number) {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas unavailable.');
  context.fillStyle = PAPER;
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = 'high';
  return context;
}

/**
 * Draws the whole map into both canvases at `density` px per map px, the 3D one tile by tile as
 * they arrive; `onProgress` after each. The hillshade goes over the flat one once its map is in.
 */
export async function renderBasemaps(
  projection: MapProjection,
  density: number,
  targets: { flat: HTMLCanvasElement; relief: HTMLCanvasElement; photo?: HTMLCanvasElement },
  signal: AbortSignal,
  onProgress: () => void,
  style: MapStyle = 'pale',
  hillshade = true,
  coverage: CoverageRegion = 'japan',
) {
  const region: MapRegion = { x: 0, y: 0, w: projection.width, h: projection.height };
  const width = Math.max(1, Math.round(region.w * density));
  const height = Math.max(1, Math.round(region.h * density));
  const flat = prepare(targets.flat, width, height);
  const relief = prepare(targets.relief, width, height);
  const photo =
    style === 'photo' || style === 'photoNames'
      ? targets.photo
        ? prepare(targets.photo, width, height)
        : null
      : null;
  const strip = stripper();
  const maxZoom = maxZoomForStyle(style, coverage);
  const zoom = Math.min(maxZoom, projection.zoomFor(density, 5, maxZoom) + INITIAL_ZOOM_BONUS);
  const layer = mapLayer(style, coverage);
  let loaded = 0;
  await Promise.all(
    tilesIn(projection, zoom, region).map(async (tile) => {
      const image = await loadTile(tileUrl(layer, tile, coverage), signal);
      if (!image) return;
      if (signal.aborted) return image.close();
      loaded += 1;
      placeTile(flat, image, tile, region, density);
      if (photo) placeTile(photo, image, tile, region, density);
      placeTile(relief, stripsRelief(style, coverage) ? strip(image) : image, tile, region, density);
      image.close();
      onProgress();
    }),
  );
  if (loaded === 0) throw new Error('GSI map tiles are unavailable.');
  if (style === 'photoNames') {
    const nameTiles = tilesIn(projection, zoom, region);
    const names = await Promise.all(nameTiles.map((tile) => loadTile(tileUrl('std', tile, coverage), signal)));
    if (signal.aborted) return;
    flat.globalAlpha = PHOTO_NAMES_OPACITY;
    relief.globalAlpha = PHOTO_NAMES_OPACITY;
    names.forEach((image, index) => {
      if (!image) return;
      placeTile(flat, image, nameTiles[index], region, density);
      placeTile(relief, image, nameTiles[index], region, density);
      image.close();
    });
    flat.globalAlpha = 1;
    relief.globalAlpha = 1;
  }
  if (hillshade && usesHillshade(style, coverage)) {
    const hillTiles = tilesIn(projection, Math.min(zoom, HILLSHADE_MAX_ZOOM), region);
    const shades = await Promise.all(hillTiles.map((tile) => loadTile(tileUrl('hillshademap', tile, coverage), signal)));
    if (signal.aborted) return;
    flat.globalAlpha = HILLSHADE_OPACITY;
    shades.forEach((image, index) => {
      if (!image) return;
      placeTile(flat, image, hillTiles[index], region, density);
      image.close();
    });
    flat.globalAlpha = 1;
  }
  onProgress();
}

/**
 * Draws the 3D map of one part of the map into `context` (already sized for it) from finer tiles,
 * nearest the middle first, calling `onTile` as each one lands.
 */
export async function streamRelief(
  projection: MapProjection,
  density: number,
  region: MapRegion,
  context: CanvasRenderingContext2D,
  signal: AbortSignal,
  onTile: () => void,
  style: MapStyle = 'pale',
  coverage: CoverageRegion = 'japan',
) {
  const strip = stripper();
  const zoom = projection.zoomFor(density, 5, maxZoomForStyle(style, coverage));
  const fetchRegion: MapRegion = {
    x: Math.max(0, region.x - (regionProfileFor(coverage).mapTiles === 'osm' ? 0 : region.w * DETAIL_HALO)),
    y: Math.max(0, region.y - (regionProfileFor(coverage).mapTiles === 'osm' ? 0 : region.h * DETAIL_HALO)),
    w: Math.min(projection.width, region.w * (regionProfileFor(coverage).mapTiles === 'osm' ? 1 : 1 + 2 * DETAIL_HALO)),
    h: Math.min(projection.height, region.h * (regionProfileFor(coverage).mapTiles === 'osm' ? 1 : 1 + 2 * DETAIL_HALO)),
  };
  fetchRegion.w = Math.min(projection.width - fetchRegion.x, fetchRegion.w);
  fetchRegion.h = Math.min(projection.height - fetchRegion.y, fetchRegion.h);
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;
  const away = (t: MapTile) => Math.hypot(t.left + t.size / 2 - cx, t.top + t.size / 2 - cy);
  const tiles = tilesIn(projection, zoom, fetchRegion).sort((a, b) => away(a) - away(b));
  await Promise.all(
    tiles.map(async (tile) => {
      const image = await loadTile(tileUrl(mapLayer(style, coverage), tile, coverage), signal);
      if (!image) return;
      if (signal.aborted) return image.close();
      placeTile(context, stripsRelief(style, coverage) ? strip(image) : image, tile, region, density);
      image.close();
      onTile();
    }),
  );
  if (style === 'photoNames') {
    const nameTiles = tilesIn(projection, zoom, fetchRegion);
    const names = await Promise.all(nameTiles.map((tile) => loadTile(tileUrl('std', tile, coverage), signal)));
    if (signal.aborted) return;
    names.forEach((image, index) => {
      if (!image) return;
      const contextAlpha = context.globalAlpha;
      context.globalAlpha = PHOTO_NAMES_OPACITY;
      placeTile(context, image, nameTiles[index], region, density);
      context.globalAlpha = contextAlpha;
      image.close();
    });
  }
}

/** Draws only the standard-map name layer over an existing aerial-photo detail texture. */
export async function streamNames(
  projection: MapProjection,
  density: number,
  region: MapRegion,
  context: CanvasRenderingContext2D,
  signal: AbortSignal,
  onTile: () => void,
  coverage: CoverageRegion = 'japan',
) {
  const zoom = projection.zoomFor(density, 5, maxZoomForStyle('std', coverage));
  const fetchRegion: MapRegion = {
    x: Math.max(0, region.x - (regionProfileFor(coverage).mapTiles === 'osm' ? 0 : region.w * DETAIL_HALO)),
    y: Math.max(0, region.y - (regionProfileFor(coverage).mapTiles === 'osm' ? 0 : region.h * DETAIL_HALO)),
    w: Math.min(projection.width, region.w * (regionProfileFor(coverage).mapTiles === 'osm' ? 1 : 1 + 2 * DETAIL_HALO)),
    h: Math.min(projection.height, region.h * (regionProfileFor(coverage).mapTiles === 'osm' ? 1 : 1 + 2 * DETAIL_HALO)),
  };
  fetchRegion.w = Math.min(projection.width - fetchRegion.x, fetchRegion.w);
  fetchRegion.h = Math.min(projection.height - fetchRegion.y, fetchRegion.h);
  const tiles = tilesIn(projection, zoom, fetchRegion);
  let loaded = 0;
  await Promise.all(
    tiles.map(async (tile) => {
      const image = await loadTile(tileUrl('std', tile, coverage), signal);
      if (!image) return;
      if (signal.aborted) return image.close();
      const contextAlpha = context.globalAlpha;
      context.globalAlpha = PHOTO_NAMES_OPACITY;
      placeTile(context, image, tile, region, density);
      context.globalAlpha = contextAlpha;
      image.close();
      loaded += 1;
      onTile();
    }),
  );
  if (!signal.aborted && loaded === 0) throw new Error('GSI name tiles are unavailable.');
}
