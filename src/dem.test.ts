import { describe, expect, it } from 'vitest';

import { cropElevationGrid, decodeDemElevation } from './dem';

describe('GSI DEM PNG decoder', () => {
  it('decodes positive and negative elevations from RGB values', () => {
    expect(decodeDemElevation(0, 3, 255)).toBeCloseTo(10.23, 2);
    expect(decodeDemElevation(255, 255, 255)).toBeCloseTo(-0.01, 2);
  });

  it('returns null for GSI no-data pixels', () => {
    expect(decodeDemElevation(128, 0, 0)).toBeNull();
  });

  it('crops a visible window from a prefetched grid', () => {
    const source = {
      nx: 2,
      ny: 2,
      values: new Float32Array([0, 10, 20, 10, 20, 30, 20, 30, 40]),
      source: 'gsi-dem' as const,
    };
    const cropped = cropElevationGrid(source, 4, 4, 1, 1, 2, 2, 2, 2);
    expect(Array.from(cropped.values)).toEqual([10, 15, 20, 15, 20, 25, 20, 25, 30]);
  });
});
