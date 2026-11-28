import { describe, expect, it } from 'vitest';

import { regionForCoordinates, regionProfileFor } from './regions';

describe('map coverage regions', () => {
  it('keeps Japan on the GSI provider', () => {
    expect(regionForCoordinates(35.681236, 139.767125)).toBe('japan');
  });

  it('routes US coordinates to the US providers', () => {
    expect(regionForCoordinates(40.7128, -74.006)).toBe('united-states');
    expect(regionForCoordinates(61.2176, -149.8997)).toBe('united-states');
    expect(regionProfileFor('united-states')).toEqual({
      id: 'united-states',
      mapTiles: 'osm',
      elevation: 'usgs-3dep',
    });
  });

  it('does not mistake Canada or Europe for a supported region', () => {
    expect(regionForCoordinates(43.6532, -79.3832)).toBe('unsupported');
    expect(regionForCoordinates(51.5074, -0.1278)).toBe('unsupported');
    expect(regionForCoordinates(37.5665, 126.978)).toBe('unsupported');
  });
});
