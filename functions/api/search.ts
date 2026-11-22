import { resolveGoogleMapsUrl, type Coordinates } from '../../src/mapSearch';

type SearchResult = {
  geometry?: { coordinates?: [number, number] };
  properties?: { address?: string; title?: string };
};

export function googleMapsLocation(coordinates: Coordinates) {
  return {
    label: `${coordinates.lat.toFixed(6)}, ${coordinates.lon.toFixed(6)}`,
    lat: coordinates.lat,
    lon: coordinates.lon,
  };
}

export function normalizeSearchResults(source: SearchResult[]) {
  return source
    .map((item) => {
      const coordinates = item.geometry?.coordinates;
      return {
        label: item.properties?.address ?? item.properties?.title ?? '',
        lat: Number(coordinates?.[1]),
        lon: Number(coordinates?.[0]),
      };
    })
    .filter((item) => item.label && Number.isFinite(item.lat) && Number.isFinite(item.lon))
    .slice(0, 12);
}

export async function onRequest(context: { request: Request }) {
  const query = new URL(context.request.url).searchParams.get('q')?.trim() ?? '';
  if (!query || query.length > 200) {
    return Response.json({ results: [] }, { status: 400 });
  }
  try {
    const coordinates = await resolveGoogleMapsUrl(query);
    if (coordinates) {
      return Response.json({ results: [googleMapsLocation(coordinates)] }, { headers: { 'cache-control': 'public, max-age=3600' } });
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
  const source = (await upstream.json()) as SearchResult[];
  return Response.json({ results: normalizeSearchResults(source) }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
