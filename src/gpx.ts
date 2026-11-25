export type TrackPoint = {
  lat: number;
  lon: number;
  ele: number | null;
  time?: string;
};

export type Waypoint = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  ele: number | null;
  desc?: string;
  targetTime?: string;
  /** Distance along the route (km) of a waypoint placed on it; changing it moves the waypoint along the route. */
  km?: number;
  /** Automatically added endpoint waypoints cannot be deleted; imported endpoints can be removed. */
  fixed?: boolean;
};

export type GpxRoute = {
  name: string;
  points: TrackPoint[];
  waypoints: Waypoint[];
};

export type RouteStats = {
  distanceKm: number;
  ascentM: number;
  minEle: number | null;
  maxEle: number | null;
};

const EARTH_RADIUS_M = 6_371_000;

function numberFrom(element: Element | null): number | null {
  if (!element) {
    return null;
  }
  const value = Number.parseFloat(element.textContent?.trim() ?? '');
  return Number.isFinite(value) ? value : null;
}

function extensionNumber(element: Element, name: string) {
  const child = [...element.querySelectorAll('extensions *')].find((candidate) => candidate.localName === name);
  return numberFrom(child ?? null);
}

function parsePoint(element: Element): TrackPoint | null {
  const lat = Number.parseFloat(element.getAttribute('lat') ?? '');
  const lon = Number.parseFloat(element.getAttribute('lon') ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return {
    lat,
    lon,
    ele: numberFrom(element.querySelector('ele')),
    time: element.querySelector('time')?.textContent?.trim() || undefined,
  };
}

function distanceMeters(a: TrackPoint, b: TrackPoint) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function calculateStats(points: readonly TrackPoint[]): RouteStats {
  let distance = 0;
  let ascent = 0;
  let minEle: number | null = null;
  let maxEle: number | null = null;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.ele !== null) {
      minEle = minEle === null ? point.ele : Math.min(minEle, point.ele);
      maxEle = maxEle === null ? point.ele : Math.max(maxEle, point.ele);
    }
    if (index === 0) {
      continue;
    }
    distance += distanceMeters(points[index - 1], point);
    const previousElevation = points[index - 1].ele;
    if (previousElevation !== null && point.ele !== null && point.ele > previousElevation) {
      ascent += point.ele - previousElevation;
    }
  }

  return {
    distanceKm: distance / 1000,
    ascentM: Math.round(ascent),
    minEle,
    maxEle,
  };
}

export function parseGpx(xml: string): GpxRoute {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = document.querySelector('parsererror');
  if (parserError) {
    throw new Error('GPXを読み込めませんでした。XML形式を確認してください。');
  }

  const trackPoints = [...document.querySelectorAll('trkpt')]
    .map(parsePoint)
    .filter((point): point is TrackPoint => point !== null);
  const routePoints =
    trackPoints.length > 0
      ? trackPoints
      : [...document.querySelectorAll('rtept')]
          .map(parsePoint)
          .filter((point): point is TrackPoint => point !== null);

  if (routePoints.length < 2) {
    throw new Error('GPXに2点以上のトラックまたはルートがありません。');
  }

  const waypoints: Waypoint[] = [...document.querySelectorAll('wpt')]
    .map((element, index): Waypoint | null => {
      const point = parsePoint(element);
      if (!point) {
        return null;
      }
      return {
        ...point,
        id: `wpt-${index + 1}`,
        name: element.querySelector('name')?.textContent?.trim() || `Waypoint ${index + 1}`,
        desc: element.querySelector('desc')?.textContent?.trim() || undefined,
        targetTime: point.time,
        km: extensionNumber(element, 'km') ?? undefined,
      };
    })
    .filter((point): point is Waypoint => point !== null);

  const name =
    document.querySelector('metadata > name, trk > name, rte > name')?.textContent?.trim() ||
    'Untitled route';

  return { name, points: routePoints, waypoints };
}

export function serializeGpx(route: GpxRoute): string {
  const escapeXml = (value: string) =>
    value.replace(
      /[<>&'"]/g,
      (character) =>
        ({
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          "'": '&apos;',
          '"': '&quot;',
        })[character] ?? character,
    );
  const formatPoint = (point: TrackPoint) =>
    `<trkpt lat="${point.lat}" lon="${point.lon}">${point.ele === null ? '' : `<ele>${point.ele}</ele>`}${point.time ? `<time>${escapeXml(point.time)}</time>` : ''}</trkpt>`;
  const waypoints = route.waypoints
    .map(
      (point) =>
        `<wpt lat="${point.lat}" lon="${point.lon}">${point.ele === null ? '' : `<ele>${point.ele}</ele>`}${point.targetTime ? `<time>${escapeXml(point.targetTime)}</time>` : ''}<name>${escapeXml(point.name)}</name>${point.desc ? `<desc>${escapeXml(point.desc)}</desc>` : ''}${point.km === undefined ? '' : `<extensions><gpx-topo:km xmlns:gpx-topo="https://gpx-topo.pages.dev/gpx-topo">${point.km}</gpx-topo:km></extensions>`}</wpt>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="gpx-topo" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapeXml(route.name)}</name></metadata>${waypoints}<trk><name>${escapeXml(route.name)}</name><trkseg>${route.points.map(formatPoint).join('')}</trkseg></trk></gpx>\n`;
}
