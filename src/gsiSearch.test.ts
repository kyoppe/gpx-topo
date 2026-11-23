import { describe, expect, it } from 'vitest';

import { MAX_SEARCH_RESULTS } from './mapSearch';
import { normalizeGsiSearchResults, parseMunicipalityNames, searchGsiAddress } from './gsiSearch';

describe('GSI search display parts', () => {
  it('separates a matching place name from its address prefix', () => {
    expect(
      normalizeGsiSearchResults(
        [
          {
            geometry: { coordinates: [130.2, 33.5] },
            properties: { title: '福岡県糸島市高尾山' },
          },
        ],
        '高尾山',
      ),
    ).toEqual([{ label: '高尾山', detail: '福岡県糸島市', lat: 33.5, lon: 130.2 }]);
  });

  it('uses the municipality table when the result title is only the place name', () => {
    const municipalityNames = parseMunicipalityNames(`GSI.MUNI_ARRAY["13201"] = '13,東京都,13201,八王子市';`);
    expect(
      normalizeGsiSearchResults(
        [
          {
            geometry: { coordinates: [139.2437, 35.6254] },
            properties: { addressCode: '13201', title: '高尾山' },
          },
        ],
        '高尾山',
        municipalityNames,
      ),
    ).toEqual([{ label: '高尾山', detail: '東京都八王子市', lat: 35.6254, lon: 139.2437 }]);
  });

  it('searches GSI directly, enriches municipalities, and limits the result count', async () => {
    const requests: string[] = [];
    const source = Array.from({ length: MAX_SEARCH_RESULTS + 1 }, (_, index) => ({
      geometry: { coordinates: [139 + index / 1000, 35 + index / 1000] },
      properties: { addressCode: '13201', title: `高尾山${index ? index : ''}` },
    }));
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === 'https://maps.gsi.go.jp/js/muni.js') {
        return new Response(`GSI.MUNI_ARRAY["13201"] = '13,東京都,13201,八王子市';`);
      }
      return new Response(JSON.stringify(source), { headers: { 'content-type': 'application/json' } });
    };

    const results = await searchGsiAddress('高尾山', fetcher);

    expect(requests).toEqual([
      'https://msearch.gsi.go.jp/address-search/AddressSearch?q=%E9%AB%98%E5%B0%BE%E5%B1%B1',
      'https://maps.gsi.go.jp/js/muni.js',
    ]);
    expect(results).toHaveLength(MAX_SEARCH_RESULTS);
    expect(results[0]).toEqual({ label: '高尾山', detail: '東京都八王子市', lat: 35, lon: 139 });
  });
});
