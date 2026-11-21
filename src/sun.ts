const RAD = Math.PI / 180;
/** GSI tiles cover Japan, so clock times are Japan Standard Time. */
const TZ_OFFSET_MIN = 9 * 60;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export type Vec3 = [number, number, number];

export type Light = {
  dir: Vec3;
  col: Vec3;
  amb: Vec3;
  expo: number;
  night: number;
  /** Sun elevation in degrees (negative below the horizon). */
  elevation: number;
};

/** Date of `date` (YYYY-MM-DD, local JST) at `minutes` after its midnight, as a UTC instant. */
export function instantFor(date: string, minutes: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1) + (minutes - TZ_OFFSET_MIN) * 60_000);
}

/** Sun azimuth (degrees clockwise from north) and elevation (degrees). */
export function solarPosition(instant: Date, lat: number, lon: number) {
  const n = instant.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const elevation = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha),
  );
  const azimuth = Math.atan2(
    -Math.sin(ha),
    Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha),
  );
  return {
    azimuth: ((azimuth / RAD) % 360 + 360) % 360,
    elevation: elevation / RAD,
  };
}

/** Sunrise and sunset (minutes after local midnight), or null when the sun does not cross. */
export function sunTimes(date: string, lat: number, lon: number) {
  let rise: number | null = null;
  let set: number | null = null;
  let previous = solarPosition(instantFor(date, 0), lat, lon).elevation;
  for (let minute = 2; minute <= 1440; minute += 2) {
    const elevation = solarPosition(instantFor(date, minute), lat, lon).elevation;
    if (previous < -0.833 && elevation >= -0.833 && rise === null) rise = minute;
    if (previous >= -0.833 && elevation < -0.833) set = minute;
    previous = elevation;
  }
  return { rise, set };
}

/** Light on the model at a clock time: low sun goes amber, after dusk the moon takes over. */
export function lightAt(date: string, minutes: number, lat: number, lon: number): Light {
  const { azimuth, elevation } = solarPosition(instantFor(date, minutes), lat, lon);
  const elRad = elevation * RAD;
  const el = Math.max(0.085, elRad);
  const az = azimuth * RAD;
  let dir: Vec3 = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
  const k = smooth((el - 0.085) / 0.5);
  const dusk = smooth((0.14 - elRad) / 0.14);
  const night = smooth((-0.02 - elRad) / 0.12);
  let col: Vec3 = [lerp(1.46, 1.07, k), lerp(0.98, 1.0, k), lerp(0.5, 0.91, k)].map(
    (c, i) => c * (1 - dusk * [0.2, 0.35, 0.5][i]),
  ) as Vec3;
  let amb: Vec3 = [lerp(0.6, 0.53, k), lerp(0.555, 0.6, k), lerp(0.54, 0.745, k)];
  // partial white balance, as a camera would
  const fl = [0, 1, 2].map((i) => amb[i] + col[i] * dir[2]);
  const wb = fl.map((x) => Math.pow(fl[1] / x, lerp(0.12, 0.3, k)));
  col = col.map((x, i) => x * wb[i]) as Vec3;
  amb = amb.map((x, i) => x * wb[i]) as Vec3;
  let expo = 1.02 / Math.pow(fl[1], 0.9);
  if (night > 0) {
    // moonlight from the north-east, and much less of everything
    const moon: Vec3 = [0.52, -0.45, 0.73];
    const mc: Vec3 = [0.36, 0.43, 0.6];
    const ma: Vec3 = [0.2, 0.25, 0.38];
    dir = night > 0.5 ? moon : dir;
    const w = night > 0.5 ? (night - 0.5) * 2 : 1 - night * 2;
    col = (night > 0.5 ? mc : col).map((x) => x * w) as Vec3;
    amb = amb.map((x, i) => lerp(x, ma[i], night)) as Vec3;
    expo = lerp(expo, 1.25, night);
  }
  return { dir, col, amb, expo, night, elevation };
}

export function formatClock(minutes: number) {
  const m = Math.round(minutes);
  const day = Math.floor(m / 1440);
  const t = ((m % 1440) + 1440) % 1440;
  const text = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  return day > 0 ? `${text} +${day}d` : text;
}

export function parseClock(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
