export type Coordinates = {
  lat: number;
  lon: number;
};

export type SearchLocation = Coordinates & { label: string };

type GsiFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { address?: string; title?: string };
};

export function normalizeSearchResponse(body: unknown): SearchLocation[] {
  const source = Array.isArray(body) ? body : (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      if (typeof item === 'object' && item !== null && 'label' in item) {
        const result = item as { label?: unknown; lat?: unknown; lon?: unknown };
        return { label: String(result.label ?? ''), lat: Number(result.lat), lon: Number(result.lon) };
      }
      const feature = item as GsiFeature;
      const coordinates = feature.geometry?.coordinates;
      const label = feature.properties?.address ?? feature.properties?.title ?? '';
      return { label, lat: Number(coordinates?.[1]), lon: Number(coordinates?.[0]) };
    })
    .filter((item) => item.label && Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .slice(0, 12);
}

function validCoordinates(lat: number, lon: number): Coordinates | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

const COORDINATE = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const COORDINATE_PAIR = new RegExp(`^\\s*(${COORDINATE})\\s*[, ]\\s*(${COORDINATE})\\s*$`);

function coordinatePair(value: string): Coordinates | null {
  const match = COORDINATE_PAIR.exec(value);
  return match ? validCoordinates(Number(match[1]), Number(match[2])) : null;
}

function fromPair(value: string | null): Coordinates | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return null;
  }
  const pair = coordinatePair(decoded);
  if (pair) return pair;
  const match = new RegExp(`(${COORDINATE})\\s*[, ]\\s*(${COORDINATE})`).exec(decoded);
  return match ? validCoordinates(Number(match[1]), Number(match[2])) : null;
}

function isGoogleMapsHost(host: string) {
  return (
    host === 'maps.google.com' ||
    host.endsWith('.google.com') ||
    host.endsWith('.google.co.jp') ||
    host === 'google.com' ||
    host === 'maps.app.goo.gl' ||
    host === 'goo.gl'
  );
}

export function isGoogleMapsUrl(value: string) {
  try {
    return isGoogleMapsHost(new URL(value.trim()).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function parseGoogleMapsUrl(value: string): Coordinates | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!isGoogleMapsHost(host)) return null;
  const place = new RegExp(`!3d(${COORDINATE})!4d(${COORDINATE})`).exec(url.href);
  const at = new RegExp(`@(${COORDINATE},${COORDINATE})`).exec(url.href);
  const searchPath = /\/maps\/search\/([^/?#]+)/.exec(url.pathname);
  return (
    (place ? validCoordinates(Number(place[1]), Number(place[2])) : null) ??
    fromPair(at?.[1] ?? null) ??
    fromPair(url.searchParams.get('ll')) ??
    fromPair(url.searchParams.get('q')) ??
    fromPair(url.searchParams.get('query')) ??
    fromPair(searchPath?.[1] ?? null)
  );
}

export function parseMapSearchInput(value: string): Coordinates | null {
  return coordinatePair(value) ?? parseGoogleMapsUrl(value);
}

export async function resolveGoogleMapsUrl(value: string, fetcher: typeof fetch = fetch): Promise<Coordinates | null> {
  const direct = parseGoogleMapsUrl(value);
  if (direct) return direct;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!isGoogleMapsHost(url.hostname.toLowerCase())) return null;
  const response = await fetcher(url.href, { redirect: 'follow' });
  return parseGoogleMapsUrl(response.url);
}
