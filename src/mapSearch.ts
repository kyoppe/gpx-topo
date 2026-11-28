export type Coordinates = {
  lat: number;
  lon: number;
};

export type SearchLocation = Coordinates & { label: string; detail?: string };

export const MAX_SEARCH_RESULTS = 50;

export function normalizeSearchResponse(body: unknown): SearchLocation[] {
  const source = Array.isArray(body) ? body : (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      if (typeof item === 'object' && item !== null && 'label' in item) {
        const result = item as { label?: unknown; detail?: unknown; lat?: unknown; lon?: unknown };
        const detail = typeof result.detail === 'string' ? result.detail.trim() : '';
        return {
          label: String(result.label ?? ''),
          ...(detail ? { detail } : {}),
          lat: Number(result.lat),
          lon: Number(result.lon),
        };
      }
      const feature = item as {
        geometry?: { coordinates?: [number, number] };
        properties?: { address?: string; title?: string };
      };
      const coordinates = feature.geometry?.coordinates;
      const label = feature.properties?.title ?? feature.properties?.address ?? '';
      return { label, lat: Number(coordinates?.[1]), lon: Number(coordinates?.[0]) };
    })
    .filter((item) => item.label && Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .slice(0, MAX_SEARCH_RESULTS);
}

function validCoordinates(lat: number, lon: number): Coordinates | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

const COORDINATE = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const COORDINATE_PAIR = new RegExp(`^\\s*(${COORDINATE})\\s*[, ]\\s*(${COORDINATE})\\s*$`);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_GOOGLE_REDIRECTS = 5;
const GOOGLE_REDIRECT_TIMEOUT_MS = 5_000;
const GOOGLE_COUNTRY_DOMAIN = '(?:[a-z]{2}|com|(?:com|co)\\.[a-z]{2})';
const GOOGLE_MAPS_HOST = new RegExp(`^maps\\.google\\.${GOOGLE_COUNTRY_DOMAIN}$`);
const GOOGLE_WEB_HOST = new RegExp(`^(?:www\\.)?google\\.${GOOGLE_COUNTRY_DOMAIN}$`);

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

function isGoogleMapsLocationUrl(url: URL) {
  if (url.protocol !== 'https:' || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl' || (host === 'goo.gl' && /^\/maps(?:\/|$)/.test(url.pathname))) return true;
  if (GOOGLE_MAPS_HOST.test(host)) return true;
  return GOOGLE_WEB_HOST.test(host) && /^\/maps(?:\/|$)/.test(url.pathname);
}

export function isGoogleMapsUrl(value: string) {
  try {
    return isGoogleMapsLocationUrl(new URL(value.trim()));
  } catch {
    return false;
  }
}

export function formatCoordinates(coordinates: Coordinates) {
  return `${coordinates.lat.toFixed(6)}, ${coordinates.lon.toFixed(6)}`;
}

function decodedLabel(value: string | null) {
  if (!value) return null;
  try {
    const label = decodeURIComponent(value.replace(/\+/g, ' ')).trim();
    if (!label || coordinatePair(label)) return null;
    return label;
  } catch {
    return null;
  }
}

/** Gets the human-readable place segment when a Google Maps URL happens to contain one. */
export function googleMapsLabel(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!isGoogleMapsLocationUrl(url)) return null;
  const path = /\/maps\/(?:place|search)\/([^/?#]+)/.exec(url.pathname);
  return decodedLabel(path?.[1] ?? url.searchParams.get('query') ?? url.searchParams.get('q'));
}

export function parseGoogleMapsUrl(value: string): Coordinates | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!isGoogleMapsLocationUrl(url)) return null;
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

async function fetchGoogleMapsUrl(initialUrl: URL, fetcher: typeof fetch): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_REDIRECT_TIMEOUT_MS);
  let currentUrl = initialUrl;
  try {
    for (let redirectCount = 0; redirectCount <= MAX_GOOGLE_REDIRECTS; redirectCount += 1) {
      if (!isGoogleMapsLocationUrl(currentUrl)) return null;

      const response = await fetcher(currentUrl.href, { redirect: 'manual', signal: controller.signal });
      const location = response.headers?.get('location');
      if (!REDIRECT_STATUSES.has(response.status) || !location) {
        const finalUrl = response.url || currentUrl.href;
        try {
          const parsedFinalUrl = new URL(finalUrl, currentUrl.href);
          return isGoogleMapsLocationUrl(parsedFinalUrl) ? parsedFinalUrl.href : null;
        } catch {
          return null;
        }
      }

      if (redirectCount === MAX_GOOGLE_REDIRECTS) return null;
      try {
        const nextUrl = new URL(location, currentUrl.href);
        if (!isGoogleMapsLocationUrl(nextUrl)) return null;
        currentUrl = nextUrl;
      } catch {
        return null;
      }
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveGoogleMapsLocation(value: string, fetcher: typeof fetch = fetch): Promise<SearchLocation | null> {
  const direct = parseGoogleMapsUrl(value);
  const directLabel = googleMapsLabel(value);
  if (direct) return { ...direct, label: directLabel ?? formatCoordinates(direct) };
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!isGoogleMapsLocationUrl(url)) return null;
  const resolvedUrl = await fetchGoogleMapsUrl(url, fetcher);
  if (!resolvedUrl) return null;
  const resolved = parseGoogleMapsUrl(resolvedUrl);
  return resolved ? { ...resolved, label: googleMapsLabel(resolvedUrl) ?? formatCoordinates(resolved) } : null;
}

export async function resolveGoogleMapsUrl(value: string, fetcher: typeof fetch = fetch): Promise<Coordinates | null> {
  const location = await resolveGoogleMapsLocation(value, fetcher);
  return location ? { lat: location.lat, lon: location.lon } : null;
}
