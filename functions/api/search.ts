import { formatCoordinates, isGoogleMapsUrl, MAX_SEARCH_RESULTS, resolveGoogleMapsLocation, type Coordinates } from '../../src/mapSearch';
import { normalizeGsiSearchResults } from '../../src/gsiSearch';

export function googleMapsLocation(coordinates: Coordinates & { label?: string }) {
  return {
    label: coordinates.label ?? formatCoordinates(coordinates),
    lat: coordinates.lat,
    lon: coordinates.lon,
  };
}

export function normalizeSearchResults(source: unknown[], query = '') {
  return normalizeGsiSearchResults(source, query).slice(0, MAX_SEARCH_RESULTS);
}

export async function onRequest(context: { request: Request }) {
  const query = new URL(context.request.url).searchParams.get('q')?.trim() ?? '';
  if (!query || query.length > 200) {
    return Response.json({ results: [] }, { status: 400 });
  }
  if (!isGoogleMapsUrl(query)) {
    return Response.json({ results: [] }, { headers: { 'cache-control': 'public, max-age=3600' } });
  }
  try {
    const location = await resolveGoogleMapsLocation(query);
    return Response.json(
      { results: location ? [googleMapsLocation(location)] : [] },
      { headers: { 'cache-control': location ? 'public, max-age=3600' : 'no-store' } },
    );
  } catch {
    return Response.json({ results: [] }, { headers: { 'cache-control': 'no-store' } });
  }
}
