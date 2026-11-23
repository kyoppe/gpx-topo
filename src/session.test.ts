import { beforeEach, describe, expect, it } from 'vitest';
import { loadStart, loadView, saveStart, saveView, startNow } from './session';

describe('session', () => {
  beforeEach(() => localStorage.clear());

  it('keeps the start for the next visit', () => {
    saveStart({ date: '2026-11-22', time: '06:30' });
    expect(loadStart()).toEqual({ date: '2026-11-22', time: '06:30' });
  });

  it('ignores a start it cannot read', () => {
    localStorage.setItem('gpx-topo:start', '{"date":"tomorrow","time":"6"}');
    expect(loadStart()).toBeNull();
    localStorage.setItem('gpx-topo:start', 'not json');
    expect(loadStart()).toBeNull();
  });

  it('starts a new GPX now, to the minute', () => {
    expect(startNow(new Date(2026, 10, 2, 7, 5, 42))).toEqual({ date: '2026-11-02', time: '07:05' });
  });

  it('keeps the last view and map viewport for the next visit', () => {
    saveView({
      viewMode: 'map',
      mapViewport: { lat: 38.0123, lon: 138.1234, scale: 1.75 },
      baseMapStyle: 'photoNames',
      hillshade: false,
      mapSunlight: false,
    });
    expect(loadView()).toEqual({
      viewMode: 'map',
      mapViewport: { lat: 38.0123, lon: 138.1234, scale: 1.75 },
      baseMapStyle: 'photoNames',
      hillshade: false,
      mapSunlight: false,
    });
  });

  it('ignores an invalid saved view', () => {
    localStorage.setItem(
      'gpx-topo:view',
      JSON.stringify({ viewMode: 'map', mapViewport: { lat: 91, lon: 0, scale: 1 }, baseMapStyle: 'pale' }),
    );
    expect(loadView()).toBeNull();
    localStorage.setItem('gpx-topo:view', 'not json');
    expect(loadView()).toBeNull();
  });

  it('defaults hillshade on for an older saved view', () => {
    localStorage.setItem(
      'gpx-topo:view',
      JSON.stringify({ viewMode: 'gpx', mapViewport: null, baseMapStyle: 'pale' }),
    );
    expect(loadView()).toEqual({
      viewMode: 'gpx',
      mapViewport: null,
      baseMapStyle: 'pale',
      hillshade: true,
      mapSunlight: true,
    });
  });
});
