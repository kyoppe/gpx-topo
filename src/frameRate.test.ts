import { describe, expect, it } from 'vitest';

import { createAdaptiveFrameRate } from './frameRate';

describe('createAdaptiveFrameRate', () => {
  it('drops to the low rate after repeated slow frames', () => {
    const rate = createAdaptiveFrameRate({ highFps: 60, lowFps: 30, slowSamples: 3 });

    expect(rate.fps).toBe(60);
    expect(rate.observe(27)).toBeNull();
    expect(rate.observe(30)).toBeNull();
    expect(rate.observe(40)).toEqual({ fps: 30, reason: 'slow' });
    expect(rate.fps).toBe(30);
  });

  it('recovers only after a sustained run of fast frames', () => {
    const rate = createAdaptiveFrameRate({ highFps: 60, lowFps: 30, slowSamples: 1, recoverSamples: 3 });

    expect(rate.observe(30)).toEqual({ fps: 30, reason: 'slow' });
    expect(rate.observe(17)).toBeNull();
    expect(rate.observe(17)).toBeNull();
    expect(rate.observe(17)).toEqual({ fps: 60, reason: 'recovered' });
  });

  it('uses the remaining frame budget as the delay', () => {
    const rate = createAdaptiveFrameRate({ highFps: 60, lowFps: 30 });

    expect(rate.frameDelayMs(10)).toBeCloseTo(3.667, 2);
    expect(rate.frameDelayMs(40)).toBe(0);
  });

  it('starts the request slightly before the target period', () => {
    const rate = createAdaptiveFrameRate({ highFps: 60, lowFps: 30, slowSamples: 1, scheduleLeadMs: 3 });

    expect(rate.observe(30)).toEqual({ fps: 30, reason: 'slow' });
    expect(rate.frameDelayMs(20)).toBeCloseTo(10.333, 2);
    expect(rate.frameDelayMs(31)).toBeCloseTo(0, 2);
  });
});
