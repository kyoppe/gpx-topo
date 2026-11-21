import { describe, expect, it } from 'vitest';

import type { ElevationGrid } from './dem';
import { buildTerrain, formatMeters } from './terrain';

function cone(nx: number, ny: number, low: number, peak: number): ElevationGrid {
  const values = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const d = Math.hypot(i - nx / 2, j - ny / 2) / (Math.min(nx, ny) / 2);
      values[j * (nx + 1) + i] = low + Math.max(0, (peak - low) * (1 - d));
    }
  }
  return { nx, ny, values, source: 'gsi-dem' };
}

describe('terrain height field', () => {
  const terrain = buildTerrain(cone(90, 60, 437, 1437), 270, 180, 28.8);

  it('keeps the range and puts the floor on a round 100 m under the lowest point', () => {
    expect(terrain.minElevation).toBeCloseTo(437, 3);
    expect(terrain.maxElevation).toBeCloseTo(1437, 3);
    expect(terrain.baseElevation).toBe(300);
    expect(terrain.metersPerPixel).toBe(28.8);
  });

  it('finds the summit and reads heights between lattice nodes', () => {
    expect(terrain.summit.x).toBeCloseTo(135, 6);
    expect(terrain.summit.y).toBeCloseTo(90, 6);
    expect(terrain.elev(135, 90)).toBeCloseTo(1437, 3);
    expect(terrain.elev(0, 0)).toBeCloseTo(437, 3);
    // halfway between two nodes is their mean
    const a = terrain.elev(129, 90);
    const b = terrain.elev(132, 90);
    expect(terrain.elev(130.5, 90)).toBeCloseTo((a + b) / 2, 3);
    // outside the map it holds the edge
    expect(terrain.elev(-50, 90)).toBeCloseTo(terrain.elev(0, 90), 6);
  });

  it('formats metres for the probe', () => {
    expect(formatMeters(1234.4)).toBe('1,234 m');
    expect(formatMeters(87.6)).toBe('88 m');
  });
});
