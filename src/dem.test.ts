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
    expect(Array.from(values)).toEqual([0, 5, 10, 0, 10, 20, 0, 15, 30]);
  });

  it('uses a 64 x 64 fine USGS lattice with concurrent POST batches', async () => {
    const requests: { method: string; points: number }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const params = new URLSearchParams(String(init?.body ?? ''));
        const points = JSON.parse(params.get('geometry') ?? '{"points":[]}').points as unknown[];
        requests.push({ method: init?.method ?? 'GET', points: points.length });
        return new Response(
          JSON.stringify({ samples: points.map((_, index) => ({ locationId: index, value: index })) }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const projection = createCenteredProjection(36.1, -112.1, 1000, 1000, 1);
    const grid = await loadDemGrid(projection, 64, 64, undefined, 'united-states', 'fine');

    expect(grid.source).toBe('usgs-3dep');
    expect(requests.every((request) => request.method === 'POST')).toBe(true);
    expect(requests.map((request) => request.points).sort((a, b) => a - b)).toEqual([96, 1000, 1000, 1000, 1000]);
  });

  it('aborts remaining USGS batches after one request fails', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1;
        if (calls === 1) return Promise.resolve(new Response('failed', { status: 500 }));
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }),
    );

    const projection = createCenteredProjection(36.1, -112.1, 1000, 1000, 1);
    await expect(loadDemGrid(projection, 64, 64, undefined, 'united-states', 'fine')).rejects.toThrow(
      'USGS 3DEP sample request failed: 500',
    );
    expect(calls).toBe(4);
  });

  it('times out stalled USGS sample batches', async () => {
    vi.useFakeTimers();
    try {
      let abortedSignals = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
          new Promise<Response>((resolve) => {
            init?.signal?.addEventListener('abort', () => {
              abortedSignals += 1;
              resolve(new Response(JSON.stringify({ error: { message: 'aborted' } }), { status: 200 }));
            }, { once: true });
          })
        )),
      );

      const projection = createCenteredProjection(36.1, -112.1, 1000, 1000, 1);
      const loading = expect(loadDemGrid(projection, 64, 64, undefined, 'united-states', 'fine')).rejects.toThrow('aborted');
      await vi.advanceTimersByTimeAsync(30_000);
      await loading;
      expect(abortedSignals).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
