import { describe, expect, it } from 'vitest';

import type { GpxRoute } from './gpx';
import { planWaypoints, trackProgress } from './plan';

// about 1.11 km per point northwards, flat at 100 m with one hill at point 40
const points = Array.from({ length: 60 }, (_, i) => ({
  lat: 35 + i * 0.01,
  lon: 138.5,
  ele: i === 40 ? 900 : 100,
}));
const bare: GpxRoute = { name: 'test', points, waypoints: [] };

describe('track progress', () => {
  it('adds up distance and climb', () => {
    const { km, up } = trackProgress(points);
    expect(km[59]).toBeCloseTo(65.6, 0);
    expect(up[59]).toBe(800);
  });
});

describe('waypoint plan', () => {
  it('adds a start, checkpoints, the high point and the finish to a file without waypoints', () => {
    const plan = planWaypoints(bare, 360, {});
    expect(plan.map((w) => w.name)).toEqual(['Start', '25 km', 'High point', '50 km', 'Finish']);
    expect(plan.every((w) => w.auto && w.estimated)).toBe(true);
    expect(plan[0].minutes).toBe(360);
    expect(plan.at(-1)!.minutes).toBeGreaterThan(plan[3].minutes);
  });

  it('keeps file waypoints in course order and rolls early times to the next day', () => {
    const route: GpxRoute = {
      ...bare,
      waypoints: [
        { id: 'b', name: 'Night aid', lat: 35.5, lon: 138.5, ele: 100, targetTime: '01:30' },
        { id: 'a', name: 'Lake', lat: 35.1, lon: 138.5, ele: 100, targetTime: '08:00' },
      ],
    };
    const plan = planWaypoints(route, 360, {});
    expect(plan.map((w) => w.name)).toEqual(['Lake', 'Night aid']);
    expect(plan[0].minutes).toBe(8 * 60);
    expect(plan[1].minutes).toBe(1440 + 90);
    expect(plan[1].estimated).toBe(false);
  });

  it('lets an edited time win over the estimate, next to the auto waypoints', () => {
    const route: GpxRoute = {
      ...bare,
      waypoints: [{ id: 'user-1', name: 'WP 1', lat: 35.3, lon: 138.5, ele: null }],
    };
    const plan = planWaypoints(route, 360, { 'user-1': 11 * 60 });
    const user = plan.find((w) => w.id === 'user-1')!;
    expect(plan[0].name).toBe('Start');
    expect(user.minutes).toBe(11 * 60);
    expect(user.estimated).toBe(false);
    expect(user.auto).toBe(false);
  });
});
