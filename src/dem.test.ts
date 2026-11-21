import { describe, expect, it } from 'vitest';

import { decodeDemElevation } from './dem';

describe('GSI DEM PNG decoder', () => {
  it('decodes positive and negative elevations from RGB values', () => {
    expect(decodeDemElevation(0, 3, 255)).toBeCloseTo(10.23, 2);
    expect(decodeDemElevation(255, 255, 255)).toBeCloseTo(-0.01, 2);
  });

  it('returns null for GSI no-data pixels', () => {
    expect(decodeDemElevation(128, 0, 0)).toBeNull();
  });
});
