import { describe, expect, it } from 'vitest';

import { regionForCoordinates, regionProfileFor } from './regions';

describe('map coverage regions', () => {
  it('keeps Japan on the GSI provider', () => {
    expect(regionForCoordinates(35.681236, 139.767125)).toBe('japan');
    expect(regionForCoordinates(38.2682, 140.8694)).toBe('japan');
    expect(regionForCoordinates(36.5613, 136.6562)).toBe('japan');
    expect(regionForCoordinates(33.5904, 130.4017)).toBe('japan');
    expect(regionForCoordinates(43.3306, 145.5828)).toBe('japan');
  });

  it('routes US coordinates to the US providers', () => {
    expect(regionForCoordinates(40.7128, -74.006)).toBe('united-states');
    expect(regionForCoordinates(37.7749, -122.4194)).toBe('united-states');
    expect(regionForCoordinates(34.0522, -118.2437)).toBe('united-states');
    expect(regionForCoordinates(25.7617, -80.1918)).toBe('united-states');
    expect(regionForCoordinates(31.7619, -106.485)).toBe('united-states');
    expect(regionForCoordinates(29.24666706192231, -103.30491923588015)).toBe('united-states');
    expect(regionForCoordinates(25.9, -97.5)).toBe('united-states');
    expect(regionForCoordinates(24.55, -81.78)).toBe('united-states');
    expect(regionForCoordinates(42.3314, -83.0458)).toBe('united-states');
    expect(regionForCoordinates(46.495, -84.35)).toBe('united-states');
    expect(regionForCoordinates(46.681, -68.015)).toBe('united-states');
    expect(regionForCoordinates(61.2176, -149.8997)).toBe('united-states');
    expect(regionForCoordinates(58.3, -134.4)).toBe('united-states');
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
    expect(regionForCoordinates(46.52, -84.34)).toBe('unsupported');
    expect(regionForCoordinates(60.7212, -135.0568)).toBe('unsupported');
    expect(regionForCoordinates(53.5, -132.5)).toBe('unsupported');
    expect(regionForCoordinates(54.31, -130.32)).toBe('unsupported');
    expect(regionForCoordinates(51.5074, -0.1278)).toBe('unsupported');
    expect(regionForCoordinates(37.5665, 126.978)).toBe('unsupported');
    expect(regionForCoordinates(35.1796, 129.0756)).toBe('unsupported');
    expect(regionForCoordinates(45.5, 142.8)).toBe('unsupported');
    expect(regionForCoordinates(40, 136)).toBe('unsupported');
    expect(regionForCoordinates(25, -125)).toBe('unsupported');
  });
});
