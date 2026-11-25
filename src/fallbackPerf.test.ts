import { describe, expect, it } from 'vitest';

import { fallbackPerformance, fallbackPerformanceFor, TOUCH_PIXEL_RATIO } from './fallbackPerf';

describe('fallbackPerformance', () => {
  it('draws touch devices at a lower pixel ratio than the desktop ceiling', () => {
    expect(fallbackPerformance(true).maxPixelRatio).toBe(TOUCH_PIXEL_RATIO);
    expect(TOUCH_PIXEL_RATIO).toBeLessThan(fallbackPerformance(false).maxPixelRatio);
  });

  it('reads a coarse pointer from the window', () => {
    const win = (coarse: boolean) => ({ matchMedia: (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }) as MediaQueryList });
    expect(fallbackPerformanceFor(win(true)).maxPixelRatio).toBe(TOUCH_PIXEL_RATIO);
    expect(fallbackPerformanceFor(win(false)).maxPixelRatio).toBe(2);
  });

  it('treats a window without matchMedia as not touch', () => {
    expect(fallbackPerformanceFor({} as Pick<Window, 'matchMedia'>).maxPixelRatio).toBe(2);
  });
});
