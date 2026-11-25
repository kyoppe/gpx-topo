import { describe, expect, it } from 'vitest';

import { fallbackEnabled, resolveRenderPath } from './renderPath';

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
  it('is enabled in every build', () => {
    expect(fallbackEnabled()).toBe(true);
  });
});
