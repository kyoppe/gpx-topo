import { execFileSync } from 'node:child_process';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function commitVersion() {
  const injected = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
  if (injected) return injected;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],
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
    },
  },
});
