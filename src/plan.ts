import type { GpxRoute, TrackPoint, Waypoint } from './gpx';
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
  fixed: boolean;
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

/** Where `at` km from the start falls on the track (clamped to it): the point before it and the share (0 to 1) of the way to the next. */
export function alongTrack(km: ArrayLike<number>, at: number) {
  const d = Math.max(0, Math.min(km[km.length - 1], at));
  let a = 0;
  let b = km.length - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (km[m] <= d) a = m;
    else b = m;
  }
  const span = km[b] - km[a];
  return { index: a, t: span > 0 ? (d - km[a]) / span : 0, km: d };
}

/** The point on the track `at` km from the start (clamped to the track). */
export function pointAtKm(points: readonly TrackPoint[], km: ArrayLike<number>, at: number) {
  const { index, t, km: d } = alongTrack(km, at);
  const a = points[index];
  const b = points[Math.min(index + 1, points.length - 1)];
  const ele = a.ele !== null && b.ele !== null ? a.ele + (b.ele - a.ele) * t : (a.ele ?? b.ele);
  return { km: d, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele };
}

const MARATHON_DISTANCE_KM = 42.195;
const ULTRA_DISTANCE_KM = 100;
const ENDPOINT_TOLERANCE_KM = 1;

/** For a file without waypoints: a start, distance-based checkpoints and the finish. */
export function defaultWaypoints(points: readonly TrackPoint[]): Waypoint[] {
  const { km } = trackProgress(points);
  const total = km[km.length - 1];
  const step = total <= MARATHON_DISTANCE_KM ? 5 : total < ULTRA_DISTANCE_KM ? 10 : 25;
  const at = (id: string, name: string, d: number, fixed = false): Waypoint => ({
    id,
    name,
    ...pointAtKm(points, km, d),
    ...(fixed ? { fixed: true } : {}),
  });
  const out = [at('auto-start', 'Start', 0, true)];
  for (let mark = step; mark < total - 1e-6; mark += step) out.push(at(`auto-${mark}`, `${mark} km`, mark));
  out.push(at('auto-finish', 'Finish', total, true));
  return out;
}

function waypointKm(waypoint: Waypoint, points: readonly TrackPoint[], km: ArrayLike<number>) {
  if (waypoint.km !== undefined) return Math.max(0, Math.min(km[km.length - 1], waypoint.km));
  return km[nearestTrackIndex(points, waypoint.lat, waypoint.lon)];
}

/** Keep user waypoints, add only missing endpoints, and mark both endpoints as non-deletable. */
export function ensureWaypoints(route: GpxRoute): GpxRoute {
  if (!route.waypoints.length) return { ...route, waypoints: defaultWaypoints(route.points) };
  const { km } = trackProgress(route.points);
  const total = km[km.length - 1];
  const at = (id: string, name: string, d: number): Waypoint => ({
    id,
    name,
    ...pointAtKm(route.points, km, d),
    fixed: true,
  });
  const waypoints = route.waypoints.map((waypoint) => {
    const d = waypointKm(waypoint, route.points, km);
    return { ...waypoint, fixed: waypoint.fixed || d <= ENDPOINT_TOLERANCE_KM || total - d <= ENDPOINT_TOLERANCE_KM };
  });
  const additions: Waypoint[] = [];
  if (!waypoints.some((waypoint) => waypointKm(waypoint, route.points, km) <= ENDPOINT_TOLERANCE_KM)) additions.push(at('auto-start', 'Start', 0));
  if (!waypoints.some((waypoint) => total - waypointKm(waypoint, route.points, km) <= ENDPOINT_TOLERANCE_KM)) {
    additions.push(at('auto-finish', 'Finish', total));
  }
  return additions.length ? { ...route, waypoints: [...waypoints, ...additions] } : { ...route, waypoints };
}

/** Index of the highest track point that has an elevation, or -1 when none has. */
export function highestIndex(points: readonly TrackPoint[]) {
  let best = -1;
  points.forEach((point, index) => {
    if (point.ele !== null && (best < 0 || point.ele > (points[best].ele as number))) best = index;
  });
  return best;
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
 * One placed on the route sits at its distance; one from a file sits at the nearest track point.
 */
export function planWaypoints(
  route: GpxRoute,
  startMinutes: number,
  overrides: Readonly<Record<string, number>>,
): PlannedWaypoint[] {
  const points = route.points;
  const { km, up } = trackProgress(points);
  const seeds = route.waypoints.map((waypoint) => {
    let at: number;
    let climbed: number;
    if (waypoint.km !== undefined) {
      const along = alongTrack(km, waypoint.km);
      at = along.km;
      climbed = up[along.index] + (up[Math.min(along.index + 1, up.length - 1)] - up[along.index]) * along.t;
    } else {
      const index = nearestTrackIndex(points, waypoint.lat, waypoint.lon);
      at = km[index];
      climbed = up[index];
    }
    return { waypoint, at, climbed, time: clockOf(waypoint.targetTime) ?? undefined };
  });
  seeds.sort((a, b) => a.at - b.at);

  let previous = startMinutes;
  return seeds.map(({ waypoint, at, climbed, time }) => {
    const estimate = startMinutes + estimateMinutes(at, climbed);
    let minutes = overrides[waypoint.id] ?? time ?? estimate;
    // a clock time earlier than the one before it is on the next day
    while (minutes < previous - 1) minutes += 1440;
    previous = minutes;
    return {
      id: waypoint.id,
      name: waypoint.name,
      lat: waypoint.lat,
      lon: waypoint.lon,
      ele: waypoint.ele,
      km: at,
      minutes,
      estimated: overrides[waypoint.id] === undefined && time === undefined,
      fixed: waypoint.fixed ?? false,
    };
  });
}

/** A distance typed in km, also with full-width digits or a 。 or comma for the point; null when there is no number. */
export function parseKm(text: string) {
  const value = Number.parseFloat(text.normalize('NFKC').replace(/[。、,]/g, '.'));
  return Number.isFinite(value) ? value : null;
}

/** The next free "WP n" name. */
export function nextWaypointName(waypoints: readonly Waypoint[]) {
  let n = 0;
  for (const w of waypoints) n = Math.max(n, Number(/^WP (\d+)$/.exec(w.name)?.[1] ?? 0));
  return `WP ${n + 1}`;
}
