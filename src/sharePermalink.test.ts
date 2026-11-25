import { describe, expect, it } from 'vitest';

import { shareTextWithPermalink } from './sharePermalink';

describe('shareTextWithPermalink', () => {
  it('replaces the app URL in localized share text', () => {
    expect(shareTextWithPermalink('Made with gpx-topo.\nhttps://gpx-topo.pages.dev/\n#GPX', 'https://gpx-topo.pages.dev/?mode=map&lat=35')).toBe(
      'Made with gpx-topo.\nhttps://gpx-topo.pages.dev/?mode=map&lat=35\n#GPX',
    );
  });

  it('appends a permalink when the share text has no app URL', () => {
    expect(shareTextWithPermalink('Made with gpx-topo.', 'https://example.test/?mode=map')).toBe(
      'Made with gpx-topo.\nhttps://example.test/?mode=map',
    );
  });
});
