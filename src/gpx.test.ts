import { describe, expect, it } from 'vitest';

import { calculateStats, parseGpx, serializeGpx } from './gpx';

const FIXTURE = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Test route</name></metadata>
  <wpt lat="35.0005" lon="138.0005"><ele>120</ele><name>Lookout</name></wpt>
  <trk><name>Test route</name><trkseg>
    <trkpt lat="35.0000" lon="138.0000"><ele>100</ele></trkpt>
    <trkpt lat="35.0010" lon="138.0000"><ele>150</ele></trkpt>
  </trkseg></trk>
</gpx>`;

describe('GPX model', () => {
  it('parses tracks, waypoints, names, and elevations', () => {
    const route = parseGpx(FIXTURE);

    expect(route.name).toBe('Test route');
    expect(route.points).toHaveLength(2);
    expect(route.points[1].ele).toBe(150);
    expect(route.waypoints[0].name).toBe('Lookout');
  });

  it('calculates distance and ascent', () => {
    const route = parseGpx(FIXTURE);
    const stats = calculateStats(route.points);

    expect(stats.distanceKm).toBeGreaterThan(0.1);
    expect(stats.distanceKm).toBeLessThan(0.2);
    expect(stats.ascentM).toBe(50);
    expect(stats.maxEle).toBe(150);
  });

  it('serializes edited routes back to GPX 1.1', () => {
    const route = parseGpx(FIXTURE);
    const xml = serializeGpx(route);

    expect(xml).toContain('creator="gpx-topo"');
    expect(xml).toContain('<name>Lookout</name>');
    expect(xml).toContain('lat="35"');
    expect(xml).toContain('<ele>150</ele>');
  });
});
