import { describe, expect, it } from 'vitest';

import type { GpxRoute } from './gpx';
import { alongTrack, defaultWaypoints, nextWaypointName, parseKm, planWaypoints, pointAtKm, trackProgress } from './plan';

// about 1.11 km per point northwards, flat at 100 m with one hill at point 40
const points = Array.from({ length: 60 }, (_, i) => ({
  lat: 35 + i * 0.01,
  lon: 138.5,
  ele: i === 40 ? 900 : 100,
}));
const bare: GpxRoute = { name: 'test', points, waypoints: [] };
const { km } = trackProgress(points);

describe('track progress', () => {
  it('adds up distance and climb', () => {
    const { km, up } = trackProgress(points);
    expect(km[59]).toBeCloseTo(65.6, 0);
    expect(up[59]).toBe(800);
  });
});

describe('points along the track', () => {
  it('finds the point between the two either side', () => {
    const half = (km[10] + km[11]) / 2;
    expect(alongTrack(km, half)).toMatchObject({ index: 10, km: half });
    expect(alongTrack(km, half).t).toBeCloseTo(0.5, 9);
    const p = pointAtKm(points, km, half);
    expect(p.lat).toBeCloseTo(35.105, 9);
    expect(p.lon).toBe(138.5);
    expect(p.ele).toBe(100);
  });

  it('keeps to the track', () => {
    expect(pointAtKm(points, km, -5)).toMatchObject({ km: 0, lat: 35 });
    expect(pointAtKm(points, km, 999).km).toBe(km[59]);
    expect(pointAtKm(points, km, 999).lat).toBeCloseTo(35.59, 9);
  });

  it('takes the height of whichever side has one', () => {
    const gappy = points.map((p, i) => (i === 5 ? { ...p, ele: null } : p));
    expect(pointAtKm(gappy, km, (km[4] + km[5]) / 2).ele).toBe(100);
  });
});

describe('default waypoints', () => {
  it('gives a file without waypoints a start, checkpoints, the high point and the finish', () => {
    const plan = planWaypoints({ ...bare, waypoints: defaultWaypoints(points) }, 360, {});
    expect(plan.map((w) => w.name)).toEqual(['Start', '25 km', 'High point', '50 km', 'Finish']);
    expect(plan.map((w) => +w.km.toFixed(1))).toEqual([0, 25, +km[40].toFixed(1), 50, +km[59].toFixed(1)]);
    expect(plan.every((w) => w.estimated)).toBe(true);
    expect(plan[0].minutes).toBe(360);
    expect(plan.at(-1)!.minutes).toBeGreaterThan(plan[3].minutes);
  });
});

describe('waypoint plan', () => {
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

  it('puts a waypoint placed on the route at its km, and moves it when the km changes', () => {
    const at = (d: number) => ({ id: 'user-1', name: 'WP 1', ...pointAtKm(points, km, d) });
    const near = planWaypoints({ ...bare, waypoints: [at(12.3)] }, 360, {})[0];
    expect(near.km).toBeCloseTo(12.3, 9);
    expect(near.minutes).toBeCloseTo(360 + 12.3 * 6, 6);
    const over = planWaypoints({ ...bare, waypoints: [at(47)] }, 360, {})[0];
    expect(over.km).toBeCloseTo(47, 9);
    expect(over.minutes).toBeCloseTo(360 + 47 * 6 + 800 * 0.1, 6);
  });

  it('lets an edited time win over the estimate', () => {
    const route: GpxRoute = {
      ...bare,
      waypoints: [...defaultWaypoints(points), { id: 'user-1', name: 'WP 1', lat: 35.3, lon: 138.5, ele: null }],
    };
    const plan = planWaypoints(route, 360, { 'user-1': 11 * 60 });
    const user = plan.find((w) => w.id === 'user-1')!;
    expect(plan[0].name).toBe('Start');
    expect(user.minutes).toBe(11 * 60);
    expect(user.estimated).toBe(false);
  });
});

describe('typed km', () => {
  it('reads half-width, full-width and Japanese-keyboard numbers', () => {
    expect(parseKm('1.8')).toBe(1.8);
    expect(parseKm('１．８')).toBe(1.8);
    expect(parseKm('１。８')).toBe(1.8);
    expect(parseKm('1,8')).toBe(1.8);
    expect(parseKm(' 1.8 km')).toBe(1.8);
    expect(parseKm('　２５ｋｍ')).toBe(25);
    expect(parseKm('12')).toBe(12);
  });

  it('gives null when there is no number', () => {
    expect(parseKm('')).toBeNull();
    expect(parseKm('km')).toBeNull();
    expect(parseKm('あ')).toBeNull();
  });
});

describe('waypoint names', () => {
  it('takes the next free number', () => {
    const named = (...names: string[]) => names.map((name, i) => ({ id: String(i), name, lat: 0, lon: 0, ele: null }));
    expect(nextWaypointName([])).toBe('WP 1');
    expect(nextWaypointName(named('Start', 'WP 1', 'WP 4', 'Finish'))).toBe('WP 5');
    expect(nextWaypointName(named('WP 2'))).toBe('WP 3');
  });
});
