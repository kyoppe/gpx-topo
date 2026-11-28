import { describe, expect, it } from 'vitest';

import { createTextureFreshness } from './stageTextures';

describe('texture freshness', () => {
  it('wants both pictures before the first one is taken', () => {
    const fresh = createTextureFreshness();
    expect(fresh.needsMap('800x600')).toBe(true);
    expect(fresh.needsPage('800x600')).toBe(true);
  });

  it('wants nothing while the model only moves', () => {
    const fresh = createTextureFreshness();
    fresh.mapTaken('800x600');
    fresh.pageTaken('1600x1200');
    // many frames of the model standing up: nothing changed on the elements
    for (let frame = 0; frame < 30; frame += 1) {
      expect(fresh.needsMap('800x600')).toBe(false);
      expect(fresh.needsPage('1600x1200')).toBe(false);
    }
  });

  it('takes only the picture whose element changed', () => {
    const fresh = createTextureFreshness();
    fresh.mapTaken('800x600');
    fresh.pageTaken('1600x1200');
    // a scroll changes the page, not the map
    fresh.markPage();
    expect(fresh.needsPage('1600x1200')).toBe(true);
    expect(fresh.needsMap('800x600')).toBe(false);
    fresh.pageTaken('1600x1200');
    expect(fresh.needsPage('1600x1200')).toBe(false);
    // a tile arriving changes the map, not the page
    fresh.markMap();
    expect(fresh.needsMap('800x600')).toBe(true);
    expect(fresh.needsPage('1600x1200')).toBe(false);
  });

  it('takes both again after a resize or a change of state', () => {
    const fresh = createTextureFreshness();
    fresh.mapTaken('800x600');
    fresh.pageTaken('1600x1200');
    fresh.markAll();
    expect(fresh.needsMap('800x600')).toBe(true);
    expect(fresh.needsPage('1600x1200')).toBe(true);
  });

  it('takes a picture again when its size is not the one it was taken at, even unmarked', () => {
    const fresh = createTextureFreshness();
    fresh.mapTaken('800x600');
    fresh.pageTaken('1600x1200');
    expect(fresh.needsMap('1000x600')).toBe(true);
    expect(fresh.needsPage('1600x1400')).toBe(true);
  });

  it('keeps wanting a picture whose upload failed', () => {
    const fresh = createTextureFreshness();
    // nothing is reported as taken, as when the upload throws
    fresh.markPage();
    expect(fresh.needsPage('1600x1200')).toBe(true);
    expect(fresh.needsPage('1600x1200')).toBe(true);
  });
});
