import { describe, expect, it } from 'vitest';

import { nearestTurn } from './angle';

describe('nearestTurn', () => {
  it('takes off whole turns only', () => {
    expect(nearestTurn(0)).toBe(0);
    expect(nearestTurn(3)).toBe(0);
    expect(nearestTurn(-3)).toBeCloseTo(0, 12);
    expect(nearestTurn(4)).toBeCloseTo(2 * Math.PI, 12);
    expect(nearestTurn(-4)).toBeCloseTo(-2 * Math.PI, 12);
    expect(nearestTurn(7 * Math.PI + 0.1)).toBeCloseTo(8 * Math.PI, 12);
  });

  it('leaves at most half a turn, so turning back is the short way', () => {
    for (let a = -40; a <= 40; a += 0.37) {
      expect(Math.abs(a - nearestTurn(a))).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });
});
