import { describe, expect, it } from 'vitest';

import { SHOWCASE_SCENE, sceneTiles, tileCoordinate } from './siteScene';

describe('site scene', () => {
  it('maps a coordinate to Web Mercator tile coordinates', () => {
    const { x, y } = tileCoordinate(0, 0, 1);
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(1);
  });

  it('covers the whole box with GSI blank tiles around the scene', () => {
    const tiles = sceneTiles(SHOWCASE_SCENE, 1280, 800);
    expect(tiles.length).toBeGreaterThanOrEqual(15);
    expect(tiles.every((tile) => tile.url.startsWith('https://cyberjapandata.gsi.go.jp/xyz/blank/13/'))).toBe(true);
    expect(Math.min(...tiles.map((tile) => tile.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((tile) => tile.left + 256))).toBeGreaterThanOrEqual(1280);
    expect(Math.min(...tiles.map((tile) => tile.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((tile) => tile.top + 256))).toBeGreaterThanOrEqual(800);
  });
});
