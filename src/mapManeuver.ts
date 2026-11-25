export type MapManeuverKind = 'dronie' | 'circle' | 'rocket' | 'helix' | 'boomerang' | 'asteroid' | 'dollyZoom';
export type MapManeuverPhase = 'select' | 'approach' | 'move' | 'hold' | 'return';

export const MAP_MANEUVERS = {
  dronie: { move: 8, hold: 1 },
  circle: { move: 12, hold: 1 },
  rocket: { move: 10, hold: 1 },
  helix: { move: 12, hold: 1 },
  boomerang: { move: 12, hold: 1 },
  asteroid: { move: 14, hold: 2 },
  dollyZoom: { move: 10, hold: 1 },
} as const satisfies Record<Exclude<MapManeuverKind, 'select'>, { move: number; hold: number }>;

/** The maneuvers, in the order a menu lists them. */
export const MAP_MANEUVER_KINDS = Object.keys(MAP_MANEUVERS) as MapManeuverKind[];

export const MAP_MANEUVR_APPROACH_SECONDS = 2.5;
export const MAP_MANEUVR_RETURN_SECONDS = 1.2;

export function maneuverActionPhase(kind: MapManeuverKind, elapsed: number) {
  return elapsed < MAP_MANEUVERS[kind].move ? 'move' : 'hold';
}
