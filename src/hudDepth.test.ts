import { describe, expect, it } from 'vitest';

import { hudDepthPlanes } from './hudDepth';
import type { DrawItem, Vec3 } from './renderer';

const eye: Vec3 = [0, 0, 0];
// the camera looks down +y, so `dir` (from the view back to the eye) is -y
const dir: Vec3 = [0, -1, 0];

/** A quad lying across the view at a distance, `depth` along +y. */
function quadAt(depth: number, size = 100): DrawItem {
  return { O: [-size / 2, depth, -size / 2], ex: [size, 0, 0], ey: [0, 0, size] };
}

/** The 24 bit depth value of a point at distance `z` for a perspective projection with these planes. */
function depthValue(z: number, near: number, far: number) {
  return (far / (far - near)) * (1 - near / z);
}

/** How many 24 bit depth buffer steps separate two distances. */
function depthSteps(z1: number, z2: number, near: number, far: number) {
  return Math.abs(depthValue(z1, near, far) - depthValue(z2, near, far)) * 2 ** 24;
}

describe('hudDepthPlanes', () => {
  it('fits the planes around the HUD', () => {
    const planes = hudDepthPlanes([quadAt(960), quadAt(1040)], eye, dir);

    expect(planes).toEqual({ near: 480, far: 2080 });
  });

  it('tells apart HUD layers that the scene planes of an eye-level camera cannot', () => {
    // an eye-level camera: the near plane is a fraction of a unit from the eye and the far plane is thousands away
    const scene = { near: 0.02, far: 2000 };
    const planes = hudDepthPlanes([quadAt(1000), quadAt(1000.5)], eye, dir)!;

    // half a unit apart at the distance of the HUD is under one depth step: the layers fight
    expect(depthSteps(1000, 1000.5, scene.near, scene.far)).toBeLessThan(1);
    // with the planes fitted to the HUD, the same gap is many steps
    expect(depthSteps(1000, 1000.5, planes.near, planes.far)).toBeGreaterThan(100);
  });

  it('keeps everything in the HUD between the planes', () => {
    const items = [quadAt(900, 400), quadAt(1010, 40), quadAt(1100)];
    const planes = hudDepthPlanes(items, eye, dir)!;

    expect(planes.near).toBeLessThan(900);
    expect(planes.far).toBeGreaterThan(1100);
  });

  it('keeps the scene planes when there is nothing to fit', () => {
    expect(hudDepthPlanes([], eye, dir)).toBeUndefined();
  });

  it('keeps the scene planes for a cloth, which has no flat frame to measure', () => {
    const cloth = { ...quadAt(1000), cloth: {} } as unknown as DrawItem;

    expect(hudDepthPlanes([quadAt(1000), cloth], eye, dir)).toBeUndefined();
  });

  it('keeps the scene planes when part of the HUD reaches the eye or is behind it', () => {
    expect(hudDepthPlanes([quadAt(1000), quadAt(0.01)], eye, dir)).toBeUndefined();
    expect(hudDepthPlanes([quadAt(1000), quadAt(-5)], eye, dir)).toBeUndefined();
  });
});
