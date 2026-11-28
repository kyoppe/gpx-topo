import { afterEach, describe, expect, it, vi } from 'vitest';

import { cropElevationGrid, decodeDemElevation, interpolateElevationSamples, loadDemGrid } from './dem';
import { createCenteredProjection } from './geo';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('resamples a USGS sample lattice and fills missing samples', () => {
    const values = interpolateElevationSamples([0, 10, null, 30], 1, 1, 2, 2);
    expect(Array.from(values)).toEqual([0, 5, 10, 5, 12.5, 20, 10, 20, 30]);
  });

  it('keeps a fine USGS lattice near the service limit while batching browser requests', async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push(url.href);
        const points = JSON.parse(url.searchParams.get('geometry') ?? '{"points":[]}').points as unknown[];
        return new Response(
          JSON.stringify({ samples: points.map((_, index) => ({ locationId: index, value: index })) }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const projection = createCenteredProjection(36.1, -112.1, 1000, 1000, 1);
    const grid = await loadDemGrid(projection, 64, 64, undefined, 'united-states', 'fine');
    const batchSizes = requests.map((request) => {
      const geometry = JSON.parse(new URL(request).searchParams.get('geometry') ?? '{"points":[]}');
      return geometry.points.length;
    });

    expect(grid.source).toBe('usgs-3dep');
    expect(batchSizes).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 61]);
  });
});
