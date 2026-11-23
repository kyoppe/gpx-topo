import { formatCoordinates, MAX_SEARCH_RESULTS, resolveGoogleMapsLocation, type Coordinates } from '../../src/mapSearch';
import { loadMunicipalityNames, normalizeGsiSearchResults } from '../../src/gsiSearch';

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
  try {
    const location = await resolveGoogleMapsLocation(query);
    if (location) {
      return Response.json({ results: [googleMapsLocation(location)] }, { headers: { 'cache-control': 'public, max-age=3600' } });
    }
  } catch {
    // Fall through to the normal address search if a Google Maps redirect cannot be resolved.
  }
  const upstream = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`, {
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!upstream.ok) {
    return new Response('GSI search unavailable.', { status: upstream.status });
  }
  const source = (await upstream.json()) as unknown[];
  const municipalityNames = await loadMunicipalityNames();
  return Response.json(
    { results: normalizeGsiSearchResults(source, query, municipalityNames).slice(0, MAX_SEARCH_RESULTS) },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  );
}
