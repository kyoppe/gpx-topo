import { execFileSync } from 'node:child_process';

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { isGoogleMapsUrl, resolveGoogleMapsLocation } from './src/mapSearch';

function commitVersion() {
  const injected = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
  if (injected) return injected.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim() || 'unknown';
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
        if (!isGoogleMapsUrl(query)) {
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
          response.statusCode = 200;
          response.setHeader('content-type', 'application/json');
          response.setHeader('cache-control', 'no-store');
          response.end(JSON.stringify({ results: [] }));
        } catch {
          response.statusCode = 200;
          response.setHeader('content-type', 'application/json');
          response.setHeader('cache-control', 'no-store');
          response.end(JSON.stringify({ results: [] }));
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
});
