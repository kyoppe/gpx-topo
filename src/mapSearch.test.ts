import { describe, expect, it } from 'vitest';

import {
  googleMapsLabel,
  isGoogleMapsUrl,
  normalizeSearchResponse,
  parseGoogleMapsUrl,
  parseMapSearchInput,
  resolveGoogleMapsLocation,
  resolveGoogleMapsUrl,
} from './mapSearch';

function fakeResponse(url: string, status = 200, location?: string): Response {
  return {
    url,
    status,
    headers: {
      get(name: string) {
        return name.toLowerCase() === 'location' ? location ?? null : null;
      },
    },
  } as Response;
}

describe('map search coordinates', () => {
  it('parses plain latitude and longitude', () => {
    expect(parseMapSearchInput('35.681236, 139.767125')).toEqual({ lat: 35.681236, lon: 139.767125 });
  });

  it('parses the common Google Maps coordinate URL forms', () => {
    expect(parseGoogleMapsUrl('https://www.google.com/maps/@35.681236,139.767125,15z')).toEqual({ lat: 35.681236, lon: 139.767125 });
    expect(parseGoogleMapsUrl('https://www.google.com/maps?q=35.681236%2C139.767125')).toEqual({ lat: 35.681236, lon: 139.767125 });
    expect(parseGoogleMapsUrl('https://www.google.com/maps/dir/foo/!3d35.681236!4d139.767125')).toEqual({
      lat: 35.681236,
      lon: 139.767125,
    });
    expect(parseGoogleMapsUrl('https://www.google.com/maps?api=1&query=35.681236%2C139.767125')).toEqual({
      lat: 35.681236,
      lon: 139.767125,
    });
  });

  it('parses search paths and prefers the place coordinate over the map center', () => {
    expect(parseGoogleMapsUrl('https://www.google.co.jp/maps/search/35.548554,+139.435962')).toEqual({
      lat: 35.548554,
      lon: 139.435962,
    });
    expect(
      parseGoogleMapsUrl(
        'https://www.google.co.jp/maps/place/clinic/@35.5439967,139.4364344,15z/data=!4m6!3m5!1splace!8m2!3d35.5479774!4d139.4380381!16s%2Fg%2Ftest',
      ),
    ).toEqual({ lat: 35.5479774, lon: 139.4380381 });
  });

  it('resolves a Google Maps short URL from its final redirect URL', async () => {
    const coordinates = await resolveGoogleMapsUrl(
      'https://maps.app.goo.gl/example',
      async () => fakeResponse('https://www.google.co.jp/maps/place/%E9%AB%98%E5%B0%BE%E5%B1%B1/@35.548554,139.435962,15z'),
    );
    expect(coordinates).toEqual({ lat: 35.548554, lon: 139.435962 });
  });

  it('follows only Google Maps redirects and uses manual redirect handling', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const location = await resolveGoogleMapsLocation('https://maps.app.goo.gl/example', async (url, init) => {
      const requestUrl = String(url);
      calls.push({ url: requestUrl, init });
      return calls.length === 1
        ? fakeResponse(requestUrl, 302, 'https://www.google.co.jp/maps/place/%E9%AB%98%E5%B0%BE%E5%B1%B1/@35.548554,139.435962,15z')
        : fakeResponse('https://www.google.co.jp/maps/place/%E9%AB%98%E5%B0%BE%E5%B1%B1/@35.548554,139.435962,15z');
    });

    expect(location).toEqual({ label: '高尾山', lat: 35.548554, lon: 139.435962 });
    expect(calls).toHaveLength(2);
    expect(calls[0].init).toMatchObject({ redirect: 'manual' });
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects an external redirect before fetching it', async () => {
    const calls: string[] = [];
    const location = await resolveGoogleMapsLocation('https://maps.app.goo.gl/example', async (url) => {
      const requestUrl = String(url);
      calls.push(requestUrl);
      return fakeResponse(requestUrl, 302, 'https://example.com/@35.548554,139.435962,15z');
    });

    expect(location).toBeNull();
    expect(calls).toEqual(['https://maps.app.goo.gl/example']);
  });

  it('extracts a place name from a Google Maps place URL', () => {
    expect(googleMapsLabel('https://www.google.co.jp/maps/place/%E9%AB%98%E5%B0%BE%E5%B1%B1/@35.548554,139.435962,15z')).toBe('高尾山');
    expect(googleMapsLabel('https://www.google.co.jp/maps/@35.548554,139.435962,15z')).toBeNull();
  });

  it('keeps a place name when resolving a short URL', async () => {
    const location = await resolveGoogleMapsLocation(
      'https://maps.app.goo.gl/example',
      async () => fakeResponse('https://www.google.co.jp/maps/place/%E9%AB%98%E5%B0%BE%E5%B1%B1/@35.548554,139.435962,15z'),
    );
    expect(location).toEqual({ label: '高尾山', lat: 35.548554, lon: 139.435962 });
  });

  it('recognizes Google Maps links before their short-link redirect is resolved', () => {
    expect(isGoogleMapsUrl('https://maps.app.goo.gl/example')).toBe(true);
    expect(isGoogleMapsUrl('https://www.google.com/maps/@35.548554,139.435962,15z')).toBe(true);
    expect(isGoogleMapsUrl('https://accounts.google.com/robots.txt')).toBe(false);
    expect(isGoogleMapsUrl('35.548554, 139.435962')).toBe(false);
  });

  it('rejects invalid coordinates and ordinary text', () => {
    expect(parseMapSearchInput('91, 139')).toBeNull();
    expect(parseGoogleMapsUrl('https://example.com/@35.681236,139.767125,15z')).toBeNull();
    expect(parseMapSearchInput('Sado Island')).toBeNull();
  });

  it('accepts both the local raw GSI response and the production wrapper', () => {
    const feature = { geometry: { coordinates: [138.7308, 35.3606] }, properties: { title: '富士山' } };
    expect(normalizeSearchResponse([feature])).toEqual([{ label: '富士山', lat: 35.3606, lon: 138.7308 }]);
    expect(normalizeSearchResponse({ results: [{ label: '富士山', lat: 35.3606, lon: 138.7308 }] })).toEqual([
      { label: '富士山', lat: 35.3606, lon: 138.7308 },
    ]);
  });
});
