import { describe, expect, it } from 'vitest';

import { buildTerrainMesh, metersPerPixel, MODEL_HALF_DEPTH, MODEL_HALF_WIDTH, TERRAIN_STRIDE } from './sceneTerrain';
import { SHOWCASE_SCENE } from './siteScene';

const grid = (nx: number, ny: number, at: (i: number, j: number) => number) => {
  const values = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j += 1) for (let i = 0; i <= nx; i += 1) values[j * (nx + 1) + i] = at(i, j);
  return { nx, ny, values, source: 'gsi-dem' as const };
};

describe('buildTerrainMesh', () => {
  it('raises the surface where the ground is higher and keeps the lowest point at the base plane', () => {
    const mesh = buildTerrainMesh(grid(4, 4, (i, j) => 1000 + (i === 2 && j === 2 ? 1500 : 0)), SHOWCASE_SCENE, 1280);
    const height = (i: number, j: number) => mesh.vertices[(j * 5 + i) * TERRAIN_STRIDE + 2];
    expect(mesh.minElevation).toBe(1000);
    expect(mesh.maxElevation).toBe(2500);
    expect(height(0, 0)).toBe(0);
    expect(height(2, 2)).toBeGreaterThan(0.2);
    expect(mesh.reliefHeight).toBeCloseTo(height(2, 2), 5);
  });

  it('spans the whole sheet and maps each corner to the matching corner of the map picture', () => {
    const mesh = buildTerrainMesh(grid(2, 2, () => 0), SHOWCASE_SCENE, 1280);
    const vertex = (index: number) => Array.from(mesh.vertices.subarray(index * TERRAIN_STRIDE, (index + 1) * TERRAIN_STRIDE));
    const northWest = vertex(0);
    const southEast = vertex(8);
    [-MODEL_HALF_WIDTH, MODEL_HALF_DEPTH, 0, 0].forEach((value, k) => expect([northWest[0], northWest[1], northWest[5], northWest[6]][k]).toBeCloseTo(value, 5));
    [MODEL_HALF_WIDTH, -MODEL_HALF_DEPTH, 1, 1].forEach((value, k) => expect([southEast[0], southEast[1], southEast[5], southEast[6]][k]).toBeCloseTo(value, 5));
  });

  it('leans the slope towards the lower ground, and closes the sides with walls', () => {
    // ground rises to the east: the slope along x is positive
    const mesh = buildTerrainMesh(grid(4, 4, (i) => i * 100), SHOWCASE_SCENE, 1280);
    expect(mesh.vertices[(2 * 5 + 2) * TERRAIN_STRIDE + 3]).toBeGreaterThan(0);
    const walls = Array.from({ length: mesh.vertices.length / TERRAIN_STRIDE }, (_, k) => mesh.vertices[k * TERRAIN_STRIDE + 7]).filter((kind) => kind === 1);
    expect(walls.length).toBe(2 * (5 + 5) * 2);
    for (const index of mesh.indices) expect(index).toBeLessThan(mesh.vertices.length / TERRAIN_STRIDE);
  });
});

describe('metersPerPixel', () => {
  it('is about 15 m per tile pixel at zoom 13 around Yatsugatake', () => {
    expect(metersPerPixel(35.97, 13)).toBeGreaterThan(15);
    expect(metersPerPixel(35.97, 13)).toBeLessThan(16);
  });
});
