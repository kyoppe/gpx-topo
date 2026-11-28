import { describe, expect, it } from 'vitest';

import { regionForCoordinates, regionProfileFor } from './regions';

describe('map coverage regions', () => {
  it('keeps Japan on the GSI provider', () => {
    expect(regionForCoordinates(35.681236, 139.767125)).toBe('japan');
  });

  it('routes US coordinates to the US providers', () => {
    expect(regionForCoordinates(40.7128, -74.006)).toBe('united-states');
    expect(regionForCoordinates(37.7749, -122.4194)).toBe('united-states');
    expect(regionForCoordinates(34.0522, -118.2437)).toBe('united-states');
    expect(regionForCoordinates(25.7617, -80.1918)).toBe('united-states');
    expect(regionForCoordinates(31.7619, -106.485)).toBe('united-states');
    expect(regionForCoordinates(61.2176, -149.8997)).toBe('united-states');
    expect(regionProfileFor('united-states')).toEqual({
      id: 'united-states',
      mapTiles: 'osm',
      elevation: 'usgs-3dep',
    });
  });

  it('does not mistake Canada or Europe for a supported region', () => {
    expect(regionForCoordinates(43.6532, -79.3832)).toBe('unsupported');
    expect(regionForCoordinates(45.5019, -73.5674)).toBe('unsupported');
    expect(regionForCoordinates(45.4215, -75.6972)).toBe('unsupported');
    expect(regionForCoordinates(42.3149, -83.0364)).toBe('unsupported');
    expect(regionForCoordinates(60.7212, -135.0568)).toBe('unsupported');
    expect(regionForCoordinates(51.5074, -0.1278)).toBe('unsupported');
    expect(regionForCoordinates(37.5665, 126.978)).toBe('unsupported');
    expect(regionForCoordinates(35.1796, 129.0756)).toBe('unsupported');
    expect(regionForCoordinates(46, 143)).toBe('unsupported');
    expect(regionForCoordinates(25, -125)).toBe('unsupported');
  });
});
