import { describe, expect, it } from 'vitest';

import { nearestAlong } from './geo';

// an L on screen: 0 to 10 km along the top, then 10 to 15 km down the right
const line = [
  { x: 0, y: 0, km: 0 },
  { x: 100, y: 0, km: 10 },
  { x: 100, y: 50, km: 15 },
];
const near = (x: number, y: number) => {
  const hit = nearestAlong(line, x, y)!;
  return [+hit.km.toFixed(9), +hit.dist.toFixed(9)];
};

describe('nearestAlong', () => {
  it('finds the km of the nearest point on the line and how far off it is', () => {
    expect(near(30, 4)).toEqual([3, 4]);
    expect(near(108, 20)).toEqual([12, 8]);
  });

  it('stops at the ends', () => {
    expect(near(-30, 40)).toEqual([0, 50]);
    expect(near(100, 80)).toEqual([15, 30]);
  });

  it('needs two points', () => {
    expect(nearestAlong([], 0, 0)).toBeNull();
    expect(nearestAlong([line[0]], 0, 0)).toBeNull();
  });
});
