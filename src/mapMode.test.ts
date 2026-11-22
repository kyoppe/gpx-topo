import { describe, expect, it } from 'vitest';

import { showsGpxControls, toggleViewMode } from './mapMode';

describe('view modes', () => {
  it('switches only while the model is flat', () => {
    expect(toggleViewMode('gpx', true)).toBe('map');
    expect(toggleViewMode('map', true)).toBe('gpx');
    expect(toggleViewMode('gpx', false)).toBe('gpx');
    expect(toggleViewMode('map', false)).toBe('map');
  });

  it('keeps GPX-only controls out of map mode', () => {
    expect(showsGpxControls('gpx')).toBe(true);
    expect(showsGpxControls('map')).toBe(false);
  });
});
