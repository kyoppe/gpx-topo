import { describe, expect, it } from 'vitest';

import { normalizeGsiSearchResults, parseMunicipalityNames } from './gsiSearch';

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
});
