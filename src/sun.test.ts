import { describe, expect, it } from 'vitest';

import { formatClock, instantFor, lightAt, parseClock, solarPosition, sunTimes } from './sun';

const TOKYO = { lat: 35.68, lon: 139.77 };

describe('clock times', () => {
  it('reads JST clock minutes as UTC instants', () => {
    expect(instantFor('2026-11-21', 9 * 60).toISOString()).toBe('2026-11-21T00:00:00.000Z');
    expect(instantFor('2026-11-21', 0).toISOString()).toBe('2026-11-20T15:00:00.000Z');
  });

  it('formats and parses clock values, with the day after the start', () => {
    expect(formatClock(6 * 60)).toBe('06:00');
    expect(formatClock(1440 + 125)).toBe('02:05 +1d');
    expect(parseClock('06:30')).toBe(390);
    expect(parseClock('soon')).toBeNull();
  });
});

describe('sun position', () => {
  it('puts the midsummer noon sun high in the south', () => {
    const { azimuth, elevation } = solarPosition(instantFor('2026-06-21', 11 * 60 + 41), TOKYO.lat, TOKYO.lon);
    expect(elevation).toBeGreaterThan(76);
    expect(elevation).toBeLessThan(79);
    expect(Math.abs(azimuth - 180)).toBeLessThan(8);
  });

  it('matches the late-November sunrise and sunset in Tokyo', () => {
    const { rise, set } = sunTimes('2026-11-21', TOKYO.lat, TOKYO.lon);
    expect(rise).toBeGreaterThanOrEqual(6 * 60 + 14);
    expect(rise).toBeLessThanOrEqual(6 * 60 + 28);
    expect(set).toBeGreaterThanOrEqual(16 * 60 + 24);
    expect(set).toBeLessThanOrEqual(16 * 60 + 38);
  });

  it('lights the model by day and switches to moonlight at night', () => {
    const noon = lightAt('2026-11-21', 12 * 60, TOKYO.lat, TOKYO.lon);
    expect(noon.night).toBe(0);
    expect(noon.dir[2]).toBeGreaterThan(0.4);
    expect(noon.dir[1]).toBeGreaterThan(0);
    const midnight = lightAt('2026-11-21', 0, TOKYO.lat, TOKYO.lon);
    expect(midnight.night).toBe(1);
    expect(midnight.dir[2]).toBeGreaterThan(0);
  });
});
