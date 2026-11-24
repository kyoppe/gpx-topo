import { afterEach, describe, expect, it, vi } from 'vitest';

import { fallbackEnabled, resolveRenderPath } from './renderPath';

afterEach(() => vi.unstubAllEnvs());

describe('resolveRenderPath', () => {
  it.each([true, false])('never leaves the native path when HTML-in-Canvas is supported (fallback enabled: %s)', (enabled) => {
    expect(resolveRenderPath(true, enabled)).toBe('native');
  });

  it('uses the fallback only when it is enabled and HTML-in-Canvas is missing', () => {
    expect(resolveRenderPath(false, true)).toBe('fallback');
    expect(resolveRenderPath(false, false)).toBe('unsupported');
  });
});

describe('fallbackEnabled', () => {
  it('is on in dev builds', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_ENABLE_FALLBACK', '');
    expect(fallbackEnabled()).toBe(true);
  });

  it('is off in a production build unless explicitly enabled', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ENABLE_FALLBACK', '');
    expect(fallbackEnabled()).toBe(false);
    vi.stubEnv('VITE_ENABLE_FALLBACK', 'true');
    expect(fallbackEnabled()).toBe(true);
  });
});
