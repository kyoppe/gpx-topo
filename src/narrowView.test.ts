import { describe, expect, it } from 'vitest';
import { narrowViewDistanceScale } from './narrowView';

describe('narrowViewDistanceScale', () => {
  it('keeps the distance for wide and near-square views', () => {
    expect(narrowViewDistanceScale(1.78)).toBe(1);
    expect(narrowViewDistanceScale(1.2)).toBe(1);
  });

  it('stretches the distance as the view gets narrower', () => {
    const tablet = narrowViewDistanceScale(0.75);
    const phone = narrowViewDistanceScale(0.6);
    expect(tablet).toBeGreaterThan(1);
    expect(phone).toBeGreaterThan(tablet);
  });

  it('caps the stretch for very tall views', () => {
    expect(narrowViewDistanceScale(0.46)).toBe(1.6);
    expect(narrowViewDistanceScale(0.1)).toBe(1.6);
  });

  it('ignores invalid aspect ratios', () => {
    expect(narrowViewDistanceScale(0)).toBe(1);
    expect(narrowViewDistanceScale(Number.NaN)).toBe(1);
    expect(narrowViewDistanceScale(-1)).toBe(1);
  });
});
