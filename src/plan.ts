import type { GpxRoute, TrackPoint } from './gpx';
import { parseClock } from './sun';

const EARTH_RADIUS_M = 6_371_000;
/** Estimated pace when a waypoint has no target time: minutes per km, plus minutes per metre climbed. */
const MIN_PER_KM = 6;
const MIN_PER_M_UP = 0.1;

export type PlannedWaypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  ele: number | null;
  km: number;
  minutes: number;
  /** True when the time is the estimate, not a target the user or the file gave. */
  estimated: boolean;
  auto: boolean;
};

function meters(a: TrackPoint, b: TrackPoint) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Distance (km) and climb (m) from the start at every track point. */
export function trackProgress(points: readonly TrackPoint[]) {
  const km = new Float64Array(points.length);
  const up = new Float64Array(points.length);
  for (let i = 1; i < points.length; i += 1) {
    km[i] = km[i - 1] + meters(points[i - 1], points[i]) / 1000;
    const a = points[i - 1].ele;
    const b = points[i].ele;
    up[i] = up[i - 1] + (a !== null && b !== null && b > a ? b - a : 0);
  }
  return { km, up };
}

export function nearestTrackIndex(points: readonly TrackPoint[], lat: number, lon: number) {
  let best = 0;
  let distance = Infinity;
  const scale = Math.cos((lat * Math.PI) / 180);
  points.forEach((point, index) => {
    const d = (point.lat - lat) ** 2 + ((point.lon - lon) * scale) ** 2;
    if (d < distance) {
      distance = d;
      best = index;
    }
  });
  return best;
}

/** Minutes after local (JST) midnight for an ISO timestamp or an HH:MM value. */
function clockOf(value: string | undefined) {
  if (!value) return null;
  if (value.includes('T')) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? Math.round((((t / 60_000 + 540) % 1440) + 1440) % 1440) : null;
  }
  return parseClock(value);
}

export function estimateMinutes(km: number, up: number) {
  return km * MIN_PER_KM + up * MIN_PER_M_UP;
}

/**
 * The waypoints shown on the map and in the list, in course order, each with a target time.
 * A file without waypoints gets a start, checkpoints every 25 km, the high point and the finish.
 */
export function planWaypoints(
  route: GpxRoute,
  startMinutes: number,
  overrides: Readonly<Record<string, number>>,
): PlannedWaypoint[] {
  const points = route.points;
  const { km, up } = trackProgress(points);
  const total = km[km.length - 1];
  type Seed = { id: string; name: string; index: number; lat: number; lon: number; ele: number | null; time?: number; auto: boolean };
  const seeds: Seed[] = [];
  const atIndex = (id: string, name: string, index: number): Seed => ({
    id,
    name,
    index,
    lat: points[index].lat,
    lon: points[index].lon,
    ele: points[index].ele,
    auto: true,
  });

  const fileWaypoints = route.waypoints.filter((w) => !w.id.startsWith('user-'));
  if (fileWaypoints.length === 0) {
    seeds.push(atIndex('auto-start', 'Start', 0));
    for (let mark = 25; mark < total - 8; mark += 25) {
      let index = 0;
      while (index < km.length - 1 && km[index] < mark) index += 1;
      seeds.push(atIndex(`auto-${mark}`, `${mark} km`, index));
    }
    let high = 0;
    points.forEach((point, index) => {
      if ((point.ele ?? -Infinity) > (points[high].ele ?? -Infinity)) high = index;
    });
    if (points[high].ele !== null && seeds.every((seed) => Math.abs(km[seed.index] - km[high]) > 3)) {
      seeds.push(atIndex('auto-high', 'High point', high));
    }
    seeds.push(atIndex('auto-finish', 'Finish', points.length - 1));
  }
  for (const waypoint of route.waypoints) {
    const clock = clockOf(waypoint.targetTime);
    seeds.push({
      id: waypoint.id,
      name: waypoint.name,
      index: nearestTrackIndex(points, waypoint.lat, waypoint.lon),
      lat: waypoint.lat,
      lon: waypoint.lon,
      ele: waypoint.ele,
      time: clock ?? undefined,
      auto: false,
    });
  }
  seeds.sort((a, b) => km[a.index] - km[b.index]);

  let previous = startMinutes;
  return seeds.map((seed) => {
    const estimate = startMinutes + estimateMinutes(km[seed.index], up[seed.index]);
    let minutes = overrides[seed.id] ?? seed.time ?? estimate;
    // a clock time earlier than the one before it is on the next day
    while (minutes < previous - 1) minutes += 1440;
    previous = minutes;
    return {
      id: seed.id,
      name: seed.name,
      lat: seed.lat,
      lon: seed.lon,
      ele: seed.ele,
      km: km[seed.index],
      minutes,
      estimated: overrides[seed.id] === undefined && seed.time === undefined,
      auto: seed.auto,
    };
  });
}
