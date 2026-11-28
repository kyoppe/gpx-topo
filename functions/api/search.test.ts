import { describe, expect, it } from 'vitest';

import { googleMapsLocation, normalizeSearchResults, onRequest } from './search';

describe('googleMapsLocation', () => {
  it('formats a resolved Google Maps coordinate as a search result', () => {
    expect(googleMapsLocation({ lat: 35.548554, lon: 139.435962 })).toEqual({
      label: '35.548554, 139.435962',
      lat: 35.548554,
      lon: 139.435962,
    });
  });

  it('keeps a place name when one was found in the URL', () => {
    expect(googleMapsLocation({ label: '高尾山', lat: 35.548554, lon: 139.435962 })).toEqual({
      label: '高尾山',
      lat: 35.548554,
      lon: 139.435962,
    });
  });
});

describe('normalizeSearchResults', () => {
  it('converts the GSI GeoJSON response into map locations', () => {
    expect(
      normalizeSearchResults([
        {
          geometry: { coordinates: [138.7308, 35.3606] },
          properties: { title: '富士山' },
        },
      ]),
    ).toEqual([{ label: '富士山', lat: 35.3606, lon: 138.7308 }]);
  });

  it('drops malformed results and limits the list', () => {
    expect(
      normalizeSearchResults([
        { geometry: { coordinates: [0, Number.NaN] }, properties: { title: 'invalid' } },
        { geometry: { coordinates: [139, 35] }, properties: { title: 'valid' } },
      ]),
    ).toEqual([{ label: 'valid', lat: 35, lon: 139 }]);
  });
});

describe('onRequest', () => {
  it('returns a resolved overseas Google Maps link without using GSI search', async () => {
    const response = await onRequest({
      request: new Request(`https://example.test/api/search?q=${encodeURIComponent('https://www.google.com/maps/@51.5074,-0.1278,12z')}`),
    });
    expect(await response.json()).toEqual({
      results: [{ label: '51.507400, -0.127800', lat: 51.5074, lon: -0.1278 }],
    });
  });
});
