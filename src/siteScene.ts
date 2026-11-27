/**
 * The place shown behind the standalone About page: the native HTML-in-Canvas showcase and the plain
 * fallback both read it, so changing the scene is a change to this one object.
 */
export type SiteScene = {
  name: string;
  lat: number;
  lon: number;
  /** GSI tile zoom of the blank (白地図) map, at most 14 */
  zoom: number;
};

// centred west of the main ridge, so the peaks stand on the right of the window and the page's text lies on gentler ground
export const SHOWCASE_SCENE: SiteScene = { name: '八ヶ岳', lat: 35.9712, lon: 138.31, zoom: 13 };

const TILE = 256;

/** GSI tile sets: the blank map (白地図) and the pale map (淡色地図) */
export type SceneLayer = 'blank' | 'pale';

export type SceneTile = { key: string; url: string; left: number; top: number };

/** Fractional tile coordinates of a point (Web Mercator). */
export function tileCoordinate(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom;
  const rad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/**
 * The GSI blank-map tiles that cover a width x height box centred on the scene, with each tile's
 * pixel position inside that box (one tile is 256 px).
 */
export function sceneTiles(
  scene: SiteScene,
  width: number,
  height: number,
  layer: SceneLayer = 'blank',
  /** where the scene's centre sits from the top of the box, in px (default: the middle) */
  focusY: number = height / 2,
): SceneTile[] {
  const centre = tileCoordinate(scene.lat, scene.lon, scene.zoom);
  const originX = centre.x * TILE - width / 2;
  const originY = centre.y * TILE - focusY;
  const first = { x: Math.floor(originX / TILE), y: Math.floor(originY / TILE) };
  const last = { x: Math.floor((originX + width - 1) / TILE), y: Math.floor((originY + height - 1) / TILE) };
  const tiles: SceneTile[] = [];
  for (let y = first.y; y <= last.y; y += 1) {
    for (let x = first.x; x <= last.x; x += 1) {
      tiles.push({
        key: `${layer}/${scene.zoom}/${x}/${y}`,
        url: `https://cyberjapandata.gsi.go.jp/xyz/${layer}/${scene.zoom}/${x}/${y}.png`,
        left: x * TILE - originX,
        top: y * TILE - originY,
      });
    }
  }
  return tiles;
}
