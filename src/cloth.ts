import type { Vec3 } from './renderer';

// A flag's cloth: a grid of particles held together by springs, pinned along one edge to the pole, and moved by its
// weight and by the air. The air pushes on each bit of cloth by how fast it meets it, so a falling flag streams up,
// one pulled up trails down, and one standing in a breeze flies out and ripples: none of that is written in.
//
// The grid runs i = 0 (the fly end) to nx - 1 (the hoist, pinned), and j = 0 (the top) to ny - 1. Positions are in
// world units; `scale` is world units per metre, so the cloth weighs and catches the wind as a real one would.

export type Cloth = {
  nx: number;
  ny: number;
  pos: Float32Array;
  prev: Float32Array;
  nrm: Float32Array;
  /** 0 for the pinned hoist, 1 for the rest */
  free: Float32Array;
  /** spring ends and rest lengths */
  ia: Int32Array;
  ib: Int32Array;
  rest: Float32Array;
  stiff: Float32Array;
  /** where the pinned hoist was at the end of the last step, to sweep the pins smoothly within a step */
  pins: Float32Array;
  ready: boolean;
};

export type ClothStep = {
  /** the pinned hoist, top to bottom (ny points) */
  pins: Vec3[];
  /** the wind, in world units per second */
  wind: Vec3;
  /** world units per metre */
  scale: number;
  /** the height of the ground under a point, to keep the cloth above it */
  floor?: (x: number, y: number) => number;
  /** seconds, for the wind's eddies */
  time: number;
  /** how gusty the wind is: 1 sets it flapping, less lets it fly steadier */
  gust?: number;
  /** a shape it is drawn back towards, and how firmly (0 to 1): to keep it flying open enough to read */
  shape?: (i: number, j: number) => Vec3;
  hold?: number;
};

/** how firmly `hold` 1 draws the cloth to its shape (1/s²), and damps it there (1/s) */
const HOLD = 70;
const HOLD_DAMP = 5;

const G = 9.8;
/** kg per m² of the cloth: a light silk flag */
const AREAL = 0.12;
/** how hard the air presses on cloth that meets it head on: ½ ρ C_d */
const PRESS = 0.5 * 1.2 * 1.15;
/** and how much it drags cloth it slides along */
const SKIN = 0.22;
const DAMP = 0.996;
const ITER = 7;
const SUB = 1 / 150;

export function createCloth(nx: number, ny: number, w: number, h: number): Cloth {
  const n = nx * ny;
  const ia: number[] = [];
  const ib: number[] = [];
  const rest: number[] = [];
  const stiff: number[] = [];
  const dx = w / (nx - 1);
  const dy = h / (ny - 1);
  const link = (i0: number, j0: number, i1: number, j1: number, k: number) => {
    if (i1 >= nx || j1 >= ny || j1 < 0) return;
    ia.push(j0 * nx + i0);
    ib.push(j1 * nx + i1);
    rest.push(Math.hypot((i1 - i0) * dx, (j1 - j0) * dy));
    stiff.push(k);
  };
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      // cloth hardly stretches, shears easily, and barely resists bending
      link(i, j, i + 1, j, 1);
      link(i, j, i, j + 1, 1);
      link(i, j, i + 1, j + 1, 0.12);
      link(i, j, i + 1, j - 1, 0.12);
      link(i, j, i + 2, j, 0.04);
      link(i, j, i, j + 2, 0.04);
    }
  }
  return {
    nx,
    ny,
    pos: new Float32Array(n * 3),
    prev: new Float32Array(n * 3),
    nrm: new Float32Array(n * 3),
    free: Float32Array.from({ length: n }, (_, q) => (q % nx === nx - 1 ? 0 : 1)),
    ia: Int32Array.from(ia),
    ib: Int32Array.from(ib),
    rest: Float32Array.from(rest),
    stiff: Float32Array.from(stiff),
    pins: new Float32Array(ny * 3),
    ready: false,
  };
}

/** Lays the cloth out flat, still: at(i, j) gives each particle's place. */
export function layCloth(c: Cloth, at: (i: number, j: number) => Vec3) {
  for (let j = 0; j < c.ny; j += 1) {
    for (let i = 0; i < c.nx; i += 1) {
      const p = at(i, j);
      // never quite flat, so it has somewhere to start folding from
      if (i < c.nx - 1) {
        const q = at(i + 1, j);
        const r = at(i, Math.min(c.ny - 1, j + 1));
        const n = [(q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]), (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2])];
        const l = Math.hypot(n[0], n[1]) || 1;
        const bump = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) * 0.15 * Math.sin(i * 1.7 + j * 0.9);
        p[0] += (n[0] / l) * bump;
        p[1] += (n[1] / l) * bump;
      }
      const k = (j * c.nx + i) * 3;
      c.pos.set(p, k);
      c.prev.set(p, k);
    }
    c.pins.set(at(c.nx - 1, j), j * 3);
  }
  c.ready = true;
  clothNormals(c);
}

/** Moves the cloth on by `dt` seconds. */
export function stepCloth(c: Cloth, dt: number, s: ClothStep) {
  if (!c.ready) return;
  const { nx, ny, pos, prev } = c;
  const steps = Math.max(1, Math.min(16, Math.ceil(dt / SUB)));
  const h = dt / steps;
  const g = G * s.scale;
  const hoist = nx - 1;
  const from = c.pins.slice();
  // the air presses on the cloth as it lies at the start of the frame; that is close enough within it
  clothNormals(c);
  for (let step = 1; step <= steps; step += 1) {
    const f = step / steps;
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < hoist; i += 1) {
        const k = (j * nx + i) * 3;
        const x = pos[k];
        const y = pos[k + 1];
        const z = pos[k + 2];
        // the particle's velocity, and the air's: the wind with a few eddies running down it
        const vx = (x - prev[k]) / h;
        const vy = (y - prev[k + 1]) / h;
        const vz = (z - prev[k + 2]) / h;
        const t = s.time + f * dt;
        const gust = s.gust ?? 1;
        const eddy = gust * 0.22 * Math.sin(t * 2.3 + i * 0.37 + j * 0.21) + 0.12 * Math.sin(t * 5.1 - i * 0.8 + j * 0.5);
        // and gusts across it, which is what sets a flag flapping
        const speed = Math.sqrt(s.wind[0] * s.wind[0] + s.wind[1] * s.wind[1]);
        const across = gust * speed * (0.35 * Math.sin(t * 3.1 - i * 0.55 + j * 0.3) + 0.2 * Math.sin(t * 7.3 - i * 1.1 - j * 0.7));
        const ux = speed > 1e-6 ? -s.wind[1] / speed : 0;
        const uy = speed > 1e-6 ? s.wind[0] / speed : 0;
        const wx = s.wind[0] * (1 + eddy) + ux * across - vx;
        const wy = s.wind[1] * (1 + eddy) + uy * across - vy;
        const wz = s.wind[2] + gust * speed * 0.18 * Math.sin(t * 3.7 + i * 0.5 - j * 0.9) - vz;
        const nX = c.nrm[k];
        const nY = c.nrm[k + 1];
        const nZ = c.nrm[k + 2];
        // in metres per second, the air meeting the cloth head on and sliding along it
        const into = (wx * nX + wy * nY + wz * nZ) / s.scale;
        const press = (PRESS * into * Math.abs(into)) / AREAL;
        const ax = press * nX * s.scale + (SKIN / AREAL) * (wx - into * nX * s.scale);
        const ay = press * nY * s.scale + (SKIN / AREAL) * (wy - into * nY * s.scale);
        let az = press * nZ * s.scale + (SKIN / AREAL) * (wz - into * nZ * s.scale) - g;
        let bx = 0;
        let by = 0;
        if (s.shape && s.hold) {
          const home = s.shape(i, j);
          const k = HOLD * s.hold;
          const d = HOLD_DAMP * s.hold;
          bx = k * (home[0] - x) - d * vx;
          by = k * (home[1] - y) - d * vy;
          // and bears its weight there, so it does not sag below its shape
          az += k * (home[2] - z) - d * vz + g * Math.min(1, s.hold);
        }
        // Verlet: on as it was going, a little damped, plus what the air and its weight do to it
        prev[k] = x;
        prev[k + 1] = y;
        prev[k + 2] = z;
        pos[k] = x + vx * h * DAMP + (ax + bx) * h * h;
        pos[k + 1] = y + vy * h * DAMP + (ay + by) * h * h;
        pos[k + 2] = z + vz * h * DAMP + az * h * h;
      }
      // the hoist goes where the pole takes it, swept smoothly across the step
      const k = (j * nx + hoist) * 3;
      const p = s.pins[j];
      for (let a = 0; a < 3; a += 1) {
        prev[k + a] = pos[k + a];
        pos[k + a] = from[j * 3 + a] + (p[a] - from[j * 3 + a]) * f;
      }
    }
    for (let it = 0; it < ITER; it += 1) relax(c);
    if (s.floor) {
      for (let q = 0; q < nx * ny; q += 1) {
        const k = q * 3;
        const z = s.floor(pos[k], pos[k + 1]) + 0.3;
        if (pos[k + 2] < z) {
          pos[k + 2] = z;
          // the ground holds it, and rubs it to a stop
          prev[k] = pos[k] + (prev[k] - pos[k]) * 0.5;
          prev[k + 1] = pos[k + 1] + (prev[k + 1] - pos[k + 1]) * 0.5;
          prev[k + 2] = z;
        }
      }
    }
  }
  for (let j = 0; j < ny; j += 1) c.pins.set(s.pins[j], j * 3);
  clothNormals(c);
}

function relax(c: Cloth) {
  const { pos, ia, ib, rest, stiff, free } = c;
  for (let e = 0; e < rest.length; e += 1) {
    const a = ia[e];
    const b = ib[e];
    const ka = a * 3;
    const kb = b * 3;
    const dx = pos[kb] - pos[ka];
    const dy = pos[kb + 1] - pos[ka + 1];
    const dz = pos[kb + 2] - pos[ka + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9) continue;
    const wa = free[a];
    const wb = free[b];
    const w = wa + wb;
    if (!w) continue;
    // it holds against being pulled long, but folds up rather than push back when squeezed
    const m = ((d - rest[e]) / d) * stiff[e] * (d < rest[e] ? 0.08 : 1);
    pos[ka] += (dx * m * wa) / w;
    pos[ka + 1] += (dy * m * wa) / w;
    pos[ka + 2] += (dz * m * wa) / w;
    pos[kb] -= (dx * m * wb) / w;
    pos[kb + 1] -= (dy * m * wb) / w;
    pos[kb + 2] -= (dz * m * wb) / w;
  }
}

/** Each particle's normal, from its neighbours across and down. */
export function clothNormals(c: Cloth) {
  const { nx, ny, pos, nrm } = c;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const l = (j * nx + Math.max(0, i - 1)) * 3;
      const r = (j * nx + Math.min(nx - 1, i + 1)) * 3;
      const u = (Math.max(0, j - 1) * nx + i) * 3;
      const d = (Math.min(ny - 1, j + 1) * nx + i) * 3;
      const ax = pos[r] - pos[l];
      const ay = pos[r + 1] - pos[l + 1];
      const az = pos[r + 2] - pos[l + 2];
      const bx = pos[d] - pos[u];
      const by = pos[d + 1] - pos[u + 1];
      const bz = pos[d + 2] - pos[u + 2];
      let x = ay * bz - az * by;
      let y = az * bx - ax * bz;
      let z = ax * by - ay * bx;
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      x /= len;
      y /= len;
      z /= len;
      const k = (j * nx + i) * 3;
      nrm[k] = x;
      nrm[k + 1] = y;
      nrm[k + 2] = z;
    }
  }
}

/** The cloth as the renderer takes it: position, normal, and uv for each particle. */
export function clothVertices(c: Cloth, out?: Float32Array) {
  const n = c.nx * c.ny;
  const v = out && out.length === n * 8 ? out : new Float32Array(n * 8);
  for (let j = 0; j < c.ny; j += 1) {
    for (let i = 0; i < c.nx; i += 1) {
      const q = j * c.nx + i;
      v.set(c.pos.subarray(q * 3, q * 3 + 3), q * 8);
      v.set(c.nrm.subarray(q * 3, q * 3 + 3), q * 8 + 3);
      v[q * 8 + 6] = i / (c.nx - 1);
      v[q * 8 + 7] = j / (c.ny - 1);
    }
  }
  return v;
}
