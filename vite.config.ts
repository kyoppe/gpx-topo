import { execFileSync } from 'node:child_process';

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolveGoogleMapsLocation } from './src/mapSearch';
import { loadMunicipalityNames, normalizeGsiSearchResults } from './src/gsiSearch';

function commitVersion() {
  const injected = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
  if (injected) return injected;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function mapSearchRedirects(): Plugin {
  return {
    name: 'gpx-topo-map-search-redirects',
    configureServer(server) {
      server.middlewares.use('/api/search', async (request, response, next) => {
        const query = new URL(request.url ?? '', 'http://localhost').searchParams.get('q')?.trim() ?? '';
        if (!query || query.length > 200) {
          next();
          return;
        }
        try {
          const location = await resolveGoogleMapsLocation(query);
          if (location) {
            response.statusCode = 200;
            response.setHeader('content-type', 'application/json');
            response.setHeader('cache-control', 'public, max-age=3600');
            response.end(JSON.stringify({ results: [location] }));
            return;
          }
          const upstream = await fetch(
            `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`,
          );
          if (!upstream.ok) {
            next();
            return;
          }
          const source = (await upstream.json()) as unknown[];
          const municipalityNames = await loadMunicipalityNames();
          response.statusCode = 200;
          response.setHeader('content-type', 'application/json');
          response.setHeader('cache-control', 'public, max-age=3600');
          response.end(JSON.stringify({ results: normalizeGsiSearchResults(source, query, municipalityNames) }));
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mapSearchRedirects()],
  define: {
    __APP_VERSION__: JSON.stringify(commitVersion()),
  },
  server: {
    proxy: {
      '/api/gsi': {
        target: 'https://cyberjapandata.gsi.go.jp',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gsi/, '/xyz'),
      },
      '/api/search': {
        target: 'https://msearch.gsi.go.jp',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/search/, '/address-search/AddressSearch'),
      },
    },
  },
});
