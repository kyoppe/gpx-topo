import { describe, expect, it } from 'vitest';

import { createCenteredProjection, MAX_CENTERED_PROJECTION_TILES, nearestAlong } from './geo';

// an L on screen: 0 to 10 km along the top, then 10 to 15 km down the right
const line = [
  { x: 0, y: 0, km: 0 },
  { x: 100, y: 0, km: 10 },
  { x: 100, y: 50, km: 15 },
];
const near = (x: number, y: number) => {
  const hit = nearestAlong(line, x, y)!;
  return [+hit.km.toFixed(9), +hit.dist.toFixed(9)];
};

describe('nearestAlong', () => {
  it('finds the km of the nearest point on the line and how far off it is', () => {
    expect(near(30, 4)).toEqual([3, 4]);
    expect(near(108, 20)).toEqual([12, 8]);
  });

  it('stops at the ends', () => {
    expect(near(-30, 40)).toEqual([0, 50]);
    expect(near(100, 80)).toEqual([15, 30]);
  });

  it('needs two points', () => {
    expect(nearestAlong([], 0, 0)).toBeNull();
    expect(nearestAlong([line[0]], 0, 0)).toBeNull();
  });
});

describe('createCenteredProjection', () => {
  it('keeps the requested center at the middle of the map', () => {
    const projection = createCenteredProjection(35.681236, 139.767125, 800, 600, 3);
    expect(projection.inverse(400, 300).lat).toBeCloseTo(35.681236, 6);
    expect(projection.inverse(400, 300).lon).toBeCloseTo(139.767125, 6);
    expect(projection.project({ lat: 35.681236, lon: 139.767125 })).toMatchObject({ x: 400, y: 300 });
  });

  it('wraps longitude when panning across the date line', () => {
    const projection = createCenteredProjection(0, 179.8, 800, 600, 8);
    const point = projection.project({ lat: 0, lon: -179.8 });
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(800);
    expect(projection.inverse(point.x, point.y).lon).toBeCloseTo(-179.8, 6);
  });

  it('bounds tile enumeration for an extremely zoomed-out saved view', () => {
    const projection = createCenteredProjection(35.681236, 139.767125, 800, 600, 0.001);
    expect(projection.scale).toBeGreaterThan(0.001);
    expect(projection.tiles(5).length).toBeLessThanOrEqual(MAX_CENTERED_PROJECTION_TILES);
  });

  it('lowers source zoom when a huge saved viewport would exceed the tile budget', () => {
    const projection = createCenteredProjection(35.681236, 139.767125, 100_000, 100_000, 0.001);
    const zoom = projection.zoomFor(1.5, 5, 18);
    expect(zoom).toBe(5);
    expect(projection.tiles(zoom).length).toBeLessThanOrEqual(MAX_CENTERED_PROJECTION_TILES);
  });
});
