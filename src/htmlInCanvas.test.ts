import { afterEach, describe, expect, it, vi } from 'vitest';

import { getHtmlInCanvasContext } from './htmlInCanvas';

afterEach(() => vi.unstubAllGlobals());

describe('HTML-in-Canvas action context', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 16; Pixel 9; wv) Chrome/157.0.8103.50 TwitterAndroid/12.45.1', true],
    ['Mozilla/5.0 (Linux; Android 16; Pixel 9) Chrome/157.0.8103.50 Mobile Safari/537.36', false],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/157.0.0.0 Safari/537.36', false],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Twitter', false],
    ['Browser/1.0 wvSomething', false],
  ])('recognizes only the wv token in %s', (userAgent, isWebview) => {
    vi.stubGlobal('navigator', { userAgent });

    expect(getHtmlInCanvasContext()).toEqual({ is_webview: isWebview });
  });

  it('includes the available UA brand names and versions', () => {
    const brands = [
      { brand: 'Chromium', version: '157' },
      { brand: 'Android WebView', version: '157' },
      { brand: 'Not/A)Brand', version: '99' },
    ];
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 16; wv)', userAgentData: { brands } });

    expect(getHtmlInCanvasContext()).toEqual({ is_webview: true, user_agent_data_brands: brands });
  });
});
