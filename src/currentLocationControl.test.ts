import { describe, expect, it } from 'vitest';

import { shouldShowCurrentLocationControl } from './currentLocationControl';

describe('current location control visibility', () => {
  it('is visible only for the flat map in both rendering paths', () => {
    for (const renderPath of ['native', 'fallback'] as const) {
      expect(shouldShowCurrentLocationControl('map', false), renderPath).toBe(true);
      expect(shouldShowCurrentLocationControl('map', true), renderPath).toBe(false);
      expect(shouldShowCurrentLocationControl('gpx', false), renderPath).toBe(false);
      expect(shouldShowCurrentLocationControl('gpx', true), renderPath).toBe(false);
    }
  });
});
