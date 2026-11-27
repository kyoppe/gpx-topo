import { useEffect, useState } from 'react';

import type { SiteCopy } from './siteCopy';

export type SitePageName = 'about' | 'tutorial';

export function SiteHeader({ copy, current }: { copy: SiteCopy; current: SitePageName }) {
  return (
    <header className="site-header">
      <a className="site-brand" href="/about" aria-label={copy.navAbout}>
        <img src="/gpx-topo-logo.png" alt="" width={48} height={48} />
        <span>{copy.footer}</span>
      </a>
      <nav className="site-nav" aria-label={copy.footer}>
        <a href="/about" aria-current={current === 'about' ? 'page' : undefined}>
          {copy.navAbout}
        </a>
        <a href="/tutorial" aria-current={current === 'tutorial' ? 'page' : undefined}>
          {copy.navTutorial}
        </a>
        <a className="site-nav-map" href="/">
          {copy.navMap}
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter({ copy }: { copy: SiteCopy }) {
  return (
    <footer className="site-footer">
      <span>{copy.footer}</span>
      <nav aria-label={copy.footer}>
        <a href="/about">{copy.navAbout}</a>
        <a href="/tutorial">{copy.navTutorial}</a>
        <a href="/">{copy.navMap}</a>
      </nav>
    </footer>
  );
}

const TOUCH_QUERY = '(pointer: coarse)';

function primaryIsTouch() {
  return typeof window !== 'undefined' && (window.matchMedia?.(TOUCH_QUERY).matches ?? false);
}

/** True when the main input is a finger rather than a mouse or trackpad. Follows the device, not the viewport width. */
export function usePrimaryTouch() {
  const [touch, setTouch] = useState(primaryIsTouch);
  useEffect(() => {
    const query = window.matchMedia?.(TOUCH_QUERY);
    if (!query) return;
    const update = () => setTouch(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return touch;
}
