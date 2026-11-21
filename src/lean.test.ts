import { describe, expect, it } from 'vitest';

import { holdLean, softLimit } from './lean';

const LIMIT = (20 * Math.PI) / 180;
const FLIP = (40 * Math.PI) / 180;

/** Screen lean and turn of a page turned `a` (rad) from the view, seen with its depth squashed by `squash`. */
const page = (a: number, squash: number) => {
  const lean = Math.atan2(Math.sin(a) * squash, Math.cos(a));
  return [lean, Math.abs(Math.atan2(Math.sin(a), Math.cos(a)))];
};

describe('softLimit', () => {
  it('passes small values through and never goes past the limit', () => {
    expect(softLimit(0.1, LIMIT)).toBe(0.1);
    expect(softLimit(-0.2, LIMIT)).toBe(-0.2);
    for (let x = -3; x <= 3; x += 0.01) expect(Math.abs(softLimit(x, LIMIT))).toBeLessThanOrEqual(LIMIT);
    expect(softLimit(3, LIMIT)).toBeCloseTo(LIMIT, 6);
  });
});

describe('holdLean', () => {
  it('follows the page, then holds at the limit', () => {
    expect(holdLean(0.2, 0.3, LIMIT, FLIP)).toBe(0.2);
    expect(holdLean(1.2, 1.6, LIMIT, FLIP)).toBeCloseTo(LIMIT, 6);
    expect(holdLean(-1.2, 1.6, LIMIT, FLIP)).toBeCloseTo(-LIMIT, 6);
  });

  it('goes level at the half turn', () => {
    expect(holdLean(Math.PI, Math.PI, LIMIT, FLIP)).toBe(0);
    expect(holdLean(-Math.PI + 1e-9, Math.PI - 1e-9, LIMIT, FLIP)).toBeCloseTo(0, 12);
  });

  it('swings over smoothly as the page turns all the way round', () => {
    for (const squash of [0.25, 0.55, 1]) {
      let prev: number | null = null;
      for (let a = -7; a <= 7; a += 0.002) {
        const [lean, turn] = page(a, squash);
        const want = holdLean(lean, turn, LIMIT, FLIP);
        expect(Math.abs(want)).toBeLessThanOrEqual(LIMIT);
        if (prev !== null) expect(Math.abs(want - prev)).toBeLessThan(0.003);
        prev = want;
      }
    }
  });
});
