import { describe, expect, it } from 'vitest';
import { MAP_MANEUVER_KINDS, MAP_MANEUVERS, MAP_MANEUVR_APPROACH_SECONDS, maneuverActionPhase } from './mapManeuver';

describe('map camera maneuvers', () => {
  it('keeps the approach and action timings explicit', () => {
    expect(MAP_MANEUVR_APPROACH_SECONDS).toBe(2.5);
    expect(MAP_MANEUVERS.dronie).toEqual({ move: 8, hold: 1 });
    expect(MAP_MANEUVERS.circle).toEqual({ move: 12, hold: 1 });
    expect(MAP_MANEUVERS.rocket).toEqual({ move: 10, hold: 1 });
    expect(MAP_MANEUVERS.helix).toEqual({ move: 12, hold: 1 });
    expect(MAP_MANEUVERS.boomerang).toEqual({ move: 12, hold: 1 });
    expect(MAP_MANEUVERS.asteroid).toEqual({ move: 14, hold: 2 });
    expect(MAP_MANEUVERS.dollyZoom).toEqual({ move: 10, hold: 1 });
  });

  it('holds after the active movement reaches its end', () => {
    expect(maneuverActionPhase('dronie', 7.99)).toBe('move');
    expect(maneuverActionPhase('dronie', 8)).toBe('hold');
    expect(maneuverActionPhase('circle', 11.99)).toBe('move');
    expect(maneuverActionPhase('rocket', 10)).toBe('hold');
  });

  it('lists every maneuver once, for a menu', () => {
    expect(MAP_MANEUVER_KINDS).toEqual(['dronie', 'circle', 'rocket', 'helix', 'boomerang', 'asteroid', 'dollyZoom']);
    expect(new Set(MAP_MANEUVER_KINDS).size).toBe(Object.keys(MAP_MANEUVERS).length);
  });
});
