import { describe, expect, it } from 'vitest';

import { springEasing, springSettleTime, springStep } from './spring';

describe('spring easing', () => {
  it('starts at rest and ends at 1', () => {
    expect(springStep(0, 0.68, 16)).toBe(0);
    expect(springStep(10, 0.68, 16)).toBeCloseTo(1, 6);
  });

  it('overshoots when under-damped, and does not when critically damped', () => {
    const peak = (zeta: number) => Math.max(...Array.from({ length: 200 }, (_, i) => springStep(i * 0.01, zeta, 16)));
    expect(peak(0.68)).toBeGreaterThan(1.02);
    expect(peak(1)).toBeLessThanOrEqual(1);
  });

  it('settles sooner with a stiffer spring', () => {
    expect(springSettleTime(0.68, 24)).toBeLessThan(springSettleTime(0.68, 12));
  });

  it('builds a CSS linear() timing function that ends exactly at 1, with its duration', () => {
    const { easing, duration } = springEasing(0.68, 16, 8);
    expect(easing).toMatch(/^linear\((-?[\d.]+, ){8}1\)$/);
    expect(easing.startsWith('linear(0,')).toBe(true);
    expect(duration).toBeGreaterThan(200);
    expect(duration).toBeLessThan(1500);
  });
});
