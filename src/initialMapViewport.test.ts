import { describe, expect, it } from 'vitest';

import { legacyFixtureProjectionScale, resolveInitialMapViewport, shouldWaitForInitialMapViewport } from './initialMapViewport';

const DEFAULT_VIEWPORT = { lat: 35.3606, lon: 138.7274, scale: 5000 };
const ROUTE_PROJECTION = { centerLat: 36.1, centerLon: 139.2, scale: 2400 };

describe('initial map viewport', () => {
  it('opens on the default view after confirming that no GPX was restored', () => {
    expect(shouldWaitForInitialMapViewport(null, null, 'none')).toBe(false);
    expect(
      resolveInitialMapViewport({
        permalinkCenter: null,
        fittedScale: null,
        savedMapViewport: null,
        gpxProjection: null,
        legacyPermalinkScale: null,
        defaultViewport: DEFAULT_VIEWPORT,
      }),
    ).toEqual(DEFAULT_VIEWPORT);
  });

  it('waits for a saved GPX before choosing the default view', () => {
    expect(shouldWaitForInitialMapViewport(null, null, 'pending')).toBe(true);
  });

  it('centers on a restored GPX once its projection is ready', () => {
    expect(shouldWaitForInitialMapViewport(null, ROUTE_PROJECTION, 'ready')).toBe(false);
    expect(
      resolveInitialMapViewport({
        permalinkCenter: null,
        fittedScale: null,
        savedMapViewport: null,
        gpxProjection: ROUTE_PROJECTION,
        legacyPermalinkScale: null,
        defaultViewport: DEFAULT_VIEWPORT,
      }),
    ).toEqual({ lat: 36.1, lon: 139.2, scale: 2400 });
  });

  it('keeps the default view after a saved GPX fails to parse', () => {
    expect(shouldWaitForInitialMapViewport(null, null, 'none')).toBe(false);
    expect(
      resolveInitialMapViewport({
        permalinkCenter: null,
        fittedScale: null,
        savedMapViewport: null,
        gpxProjection: null,
        legacyPermalinkScale: null,
        defaultViewport: DEFAULT_VIEWPORT,
      }),
    ).toEqual(DEFAULT_VIEWPORT);
  });

  it('lets a permalink override a restored GPX and saved view', () => {
    const permalinkCenter = { lat: 35.6762, lon: 139.6503 };
    expect(
      resolveInitialMapViewport({
        permalinkCenter,
        fittedScale: 1800,
        savedMapViewport: { lat: 40, lon: 140, scale: 9000 },
        gpxProjection: ROUTE_PROJECTION,
        legacyPermalinkScale: null,
        defaultViewport: DEFAULT_VIEWPORT,
      }),
    ).toEqual({ lat: 35.6762, lon: 139.6503, scale: 1800 });
  });

  it('keeps the former fixture scale for an area-less permalink without a GPX', () => {
    const legacyScale = legacyFixtureProjectionScale(620, 608);
    expect(legacyScale).toBeCloseTo(3067.3481, 4);
    expect(
      resolveInitialMapViewport({
        permalinkCenter: { lat: 35.68, lon: 139.76 },
        fittedScale: null,
        savedMapViewport: null,
        gpxProjection: null,
        legacyPermalinkScale: legacyScale,
        defaultViewport: DEFAULT_VIEWPORT,
      }),
    ).toEqual({ lat: 35.68, lon: 139.76, scale: legacyScale });
  });
});
