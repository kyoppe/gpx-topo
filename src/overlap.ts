export type ScreenPoint = [number, number];

/**
 * The shortest push (screen px) that moves convex polygon `b` at least `gap` clear of convex polygon `a`,
 * or null when it already is.
 */
export function separation(a: ScreenPoint[], b: ScreenPoint[], gap: number): ScreenPoint | null {
  let best: ScreenPoint | null = null;
  let bestD = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l < 1e-6) continue;
      const nx = (q[1] - p[1]) / l;
      const ny = (p[0] - q[0]) / l;
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const v of a) {
        const d = v[0] * nx + v[1] * ny;
        a0 = Math.min(a0, d);
        a1 = Math.max(a1, d);
      }
      for (const v of b) {
        const d = v[0] * nx + v[1] * ny;
        b0 = Math.min(b0, d);
        b1 = Math.max(b1, d);
      }
      const ahead = a1 + gap - b0;
      const behind = b1 - (a0 - gap);
      if (ahead <= 0 || behind <= 0) return null;
      if (ahead < bestD) {
        bestD = ahead;
        best = [nx * ahead, ny * ahead];
      }
      if (behind < bestD) {
        bestD = behind;
        best = [-nx * behind, -ny * behind];
      }
    }
  }
  return best;
}
