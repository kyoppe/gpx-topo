import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { getCopy } from './i18n';
import { MapCredit } from './MapCredit';

describe('MapCredit', () => {
  it('links the GSI source for Japan', () => {
    const markup = renderToStaticMarkup(<MapCredit region="japan" copy={getCopy('ja')} />);

    expect(markup).toContain('https://maps.gsi.go.jp/development/ichiran.html');
    expect(markup).toContain('地理院タイル');
    expect(markup).not.toContain('OpenStreetMap');
  });

  it('links both map and elevation sources for the United States', () => {
    const markup = renderToStaticMarkup(<MapCredit region="united-states" copy={getCopy('en')} />);

    expect(markup).toContain('https://www.openstreetmap.org/copyright');
    expect(markup).toContain('https://www.usgs.gov/3d-elevation-program');
    expect(markup).toContain('OpenStreetMap contributors');
    expect(markup).toContain('USGS 3DEP');
  });

  it('does not render a credit for unsupported regions', () => {
    expect(renderToStaticMarkup(<MapCredit region="unsupported" copy={getCopy('en')} />)).toBe('');
  });
});
