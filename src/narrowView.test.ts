import { describe, expect, it } from 'vitest';
import { displayDistanceScale } from './narrowView';

describe('displayDistanceScale', () => {
  it('keeps the distance for wide and near-square views', () => {
    expect(displayDistanceScale(1.78, 660)).toBe(1);
    expect(displayDistanceScale(1.2, 660)).toBe(1);
  });

  it('stretches the distance as the view gets narrower', () => {
    expect(displayDistanceScale(0.75, 660)).toBeCloseTo(1.6);
    expect(displayDistanceScale(0.6, 660)).toBeCloseTo(2);
  });

  it('also stretches when the map display is smaller', () => {
    expect(displayDistanceScale(1.2, 330)).toBe(2);
    expect(displayDistanceScale(0.6, 330)).toBe(2.6);
  });

  it('caps the stretch for very small or tall views', () => {
    expect(displayDistanceScale(0.46, 660)).toBe(2.6);
    expect(displayDistanceScale(0.1, 66)).toBe(2.6);
  });

  it('ignores invalid display dimensions', () => {
    expect(displayDistanceScale(0, 660)).toBe(1);
    expect(displayDistanceScale(Number.NaN, 660)).toBe(1);
    expect(displayDistanceScale(-1, 660)).toBe(1);
    expect(displayDistanceScale(1, 0)).toBe(1);
    expect(displayDistanceScale(1, Number.NaN)).toBe(1);
  });
});
