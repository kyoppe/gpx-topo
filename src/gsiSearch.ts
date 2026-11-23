import type { SearchLocation } from './mapSearch';

type GsiFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { addressCode?: string; address?: string; title?: string };
};

const MUNICIPALITY_URL = 'https://maps.gsi.go.jp/js/muni.js';
let municipalityNamesPromise: Promise<ReadonlyMap<string, string>> | null = null;

function displayParts(title: string, query: string, municipality: string | undefined) {
  const name = title.trim();
  const term = query.trim();
  if (term && name.endsWith(term) && name !== term) {
    const prefix = name.slice(0, -term.length).trim();
    return { label: term, detail: prefix || municipality };
  }
  return { label: name, detail: municipality };
}

export function parseMunicipalityNames(source: string): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const pattern = /GSI\.MUNI_ARRAY\["([^"]+)"\]\s*=\s*'[^,]*,([^,]*),[^,]*,([^']*)';/g;
  for (const match of source.matchAll(pattern)) {
    const prefecture = match[2].trim();
    const city = match[3].trim().replace(/\u3000/g, '');
    if (prefecture && city) names.set(match[1], `${prefecture}${city}`);
  }
  return names;
}

export async function loadMunicipalityNames(): Promise<ReadonlyMap<string, string>> {
  if (!municipalityNamesPromise) {
    municipalityNamesPromise = fetch(MUNICIPALITY_URL)
      .then((response) => (response.ok ? response.text() : ''))
      .then(parseMunicipalityNames)
      .catch(() => new Map<string, string>());
  }
  return municipalityNamesPromise;
}

export function normalizeGsiSearchResults(
  source: unknown,
  query = '',
  municipalityNames: ReadonlyMap<string, string> = new Map(),
): SearchLocation[] {
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      const feature = item as GsiFeature;
      const coordinates = feature.geometry?.coordinates;
      const title = feature.properties?.title ?? feature.properties?.address ?? '';
      const parts = displayParts(title, query, municipalityNames.get(feature.properties?.addressCode ?? ''));
      return {
        ...parts,
        lat: Number(coordinates?.[1]),
        lon: Number(coordinates?.[0]),
      };
    })
    .filter((item) => item.label && Number.isFinite(item.lat) && Number.isFinite(item.lon));
}
