import { describe, expect, it } from 'vitest';
import { createCloth, layCloth, stepCloth } from './cloth';
import type { Vec3 } from './renderer';

// a 1.5 m x 1 m flag on a pole along z, in metres (scale 1), the cloth running out along -x from the hoist at x = 0
const W = 1.5;
const H = 1;
const lay = (nx: number, ny: number) => (i: number, j: number): Vec3 => [-(1 - i / (nx - 1)) * W, 0, 2 - (j / (ny - 1)) * H];
const pins = (ny: number, lift = 0): Vec3[] => Array.from({ length: ny }, (_, j) => [0, 0, 2 + lift - (j / (ny - 1)) * H]);

function run(wind: Vec3, lift: (t: number) => number, seconds: number) {
  const c = createCloth(16, 11, W, H);
  layCloth(c, lay(16, 11));
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) stepCloth(c, dt, { pins: pins(11, lift(t + dt)), wind, scale: 1, time: t });
  return c;
}

const point = (c: ReturnType<typeof createCloth>, i: number, j: number) => {
  const k = (j * c.nx + i) * 3;
  return [c.pos[k], c.pos[k + 1], c.pos[k + 2]];
};

describe('cloth', () => {
  it('keeps the hoist on the pole', () => {
    const c = run([-5, 0, 0], () => 0, 1);
    for (let j = 0; j < c.ny; j += 1) {
      const [x, y, z] = point(c, c.nx - 1, j);
      expect(Math.hypot(x, y)).toBeLessThan(1e-4);
      expect(z).toBeCloseTo(2 - (j / (c.ny - 1)) * H, 4);
    }
  });

  it('hangs down along the pole in still air', () => {
    const c = run([0, 0, 0], () => 0, 4);
    const [, , z] = point(c, 0, 0);
    expect(z).toBeLessThan(1.2);
  });

  it('flies out from the pole in a wind', () => {
    const c = run([-6, 0, 0], () => 0, 4);
    const [x, , z] = point(c, 0, 0);
    expect(x).toBeLessThan(-1.1);
    expect(z).toBeGreaterThan(1.3);
  });

  it('streams up above the pole as it falls', () => {
    // falling at 12 m/s through still air
    const c = run([0, 0, 0], (t) => -12 * t, 0.5);
    const top = point(c, c.nx - 1, 0)[2];
    expect(point(c, 0, 0)[2]).toBeGreaterThan(top);
  });

  it('stays in one piece', () => {
    const c = run([-8, 0, 0], () => 0, 3);
    for (let e = 0; e < c.rest.length; e += 1) {
      const a = c.ia[e] * 3;
      const b = c.ib[e] * 3;
      const d = Math.hypot(c.pos[b] - c.pos[a], c.pos[b + 1] - c.pos[a + 1], c.pos[b + 2] - c.pos[a + 2]);
      if (c.stiff[e] === 1) expect(d / c.rest[e]).toBeLessThan(1.15);
    }
  });
});
