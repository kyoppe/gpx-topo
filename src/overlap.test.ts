import { describe, expect, it } from 'vitest';

import { separation, type ScreenPoint } from './overlap';

const box = (x: number, y: number, w: number, h: number): ScreenPoint[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const move = (poly: ScreenPoint[], d: ScreenPoint): ScreenPoint[] => poly.map(([x, y]) => [x + d[0], y + d[1]]);

describe('screen overlap', () => {
  it('leaves polygons alone once they are a gap apart', () => {
    expect(separation(box(0, 0, 100, 50), box(110, 0, 100, 50), 10)).toBeNull();
    expect(separation(box(0, 0, 100, 50), box(0, 70, 100, 50), 10)).toBeNull();
  });

  it('pushes the shortest way out, to a gap apart', () => {
    const push = separation(box(0, 0, 100, 50), box(90, 5, 100, 50), 10);
    expect(push?.[0]).toBeCloseTo(20, 6);
    expect(push?.[1]).toBeCloseTo(0, 6);
    const up = separation(box(0, 0, 100, 50), box(5, -45, 100, 50), 10);
    expect(up?.[0]).toBeCloseTo(0, 6);
    expect(up?.[1]).toBeCloseTo(-15, 6);
  });

  it('frees tilted polygons across their own short side when that is shortest', () => {
    const c = Math.cos(0.35);
    const s = Math.sin(0.35);
    const tilted: ScreenPoint[] = box(-50, -25, 100, 50).map(([x, y]) => [x * c - y * s + 200, x * s + y * c + 100]);
    const other = move(tilted, [30, 0]);
    const push = separation(tilted, other, 1);
    const need = 51 - 30 * s;
    expect(push?.[0]).toBeCloseTo(s * need, 6);
    expect(push?.[1]).toBeCloseTo(-c * need, 6);
    expect(separation(tilted, move(other, push!), 0.5)).toBeNull();
  });
});
