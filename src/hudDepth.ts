import type { DrawItem, Vec3 } from './renderer';

/** A HUD closer to the eye than this is not a HUD in front of a view. */
const MIN_HUD_DEPTH = 0.05;
const MIN_NEAR = 0.02;

/**
 * The near and far planes for drawing the HUD pass, or undefined when the scene's own planes must be kept.
 *
 * The HUD pass clears the depth buffer and orders only the HUD's own layers (slab, sides, keys, shadow), which are a
 * few px apart. A camera at eye level has a near plane a fraction of a unit from the eye and a far plane thousands of
 * units away, and a 24 bit depth buffer cannot tell layers 1 px apart at the distance of the HUD: they fight, and
 * the HUD flickers as the view turns. Fitting the planes around the HUD removes that without moving anything on
 * screen, because the position of a point on screen does not depend on the near and far planes.
 *
 * `dir` points from the view back to the eye, as in the camera. A cloth item has no flat frame to measure, and a HUD
 * that reaches the eye leaves no room for a near plane, so those keep the scene's planes.
 */
export function hudDepthPlanes(items: readonly DrawItem[], eye: Vec3, dir: Vec3): { near: number; far: number } | undefined {
  let near = Infinity;
  let far = -Infinity;
  for (const item of items) {
    if (item.cloth) return undefined;
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      let depth = 0;
      for (let i = 0; i < 3; i += 1) depth -= (item.O[i] + item.ex[i] * a + item.ey[i] * b - eye[i]) * dir[i];
      near = Math.min(near, depth);
      far = Math.max(far, depth);
    }
  }
  if (!Number.isFinite(near) || near <= MIN_HUD_DEPTH) return undefined;
  const fitted = Math.max(MIN_NEAR, near * 0.5);
  return { near: fitted, far: Math.max(far * 2, fitted * 2) };
}