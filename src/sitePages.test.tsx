import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import AboutPage from './AboutPage';
import { detectLanguage, getCopy } from './i18n';
import { FlagContent } from './Flag';
import TutorialPage from './TutorialPage';
import { siteCopy } from './siteCopy';

((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true);

const roots: Array<ReturnType<typeof createRoot>> = [];

function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return { container, root };
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

describe('standalone site pages', () => {
  it('renders the About sections and navigation links', () => {
    const { container } = render(<AboutPage />);

    expect(container.querySelector('h1')?.textContent).toContain('Turn a flat map');
    expect(container.textContent).toContain('What you can do');
    expect(container.textContent).toContain('Ways to use it');
    expect(container.querySelector('a[href="/tutorial"]')).not.toBeNull();
    expect(container.querySelector('a[href="/"]')).not.toBeNull();
    expect(container.querySelector('a[href*="gpx-wallpaper"]')).not.toBeNull();
  });

  it('moves through the real-screen tutorial and can restart it', () => {
    const { container } = render(<TutorialPage />);
    const copy = siteCopy(detectLanguage());

    expect(container.querySelector('h2')?.textContent).toBe(copy.mapSteps[0].title);
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.tutorial-controls button'));
    act(() => buttons[1].click());
    expect(container.querySelector('h2')?.textContent).toBe(copy.mapSteps[1].title);
    act(() => container.querySelector<HTMLButtonElement>('.tutorial-restart')?.click());
    expect(container.querySelector('h2')?.textContent).toBe(copy.mapSteps[0].title);
    expect(container.querySelector('iframe')?.src).toContain('tutorial=map');

    const dots = Array.from(container.querySelectorAll<HTMLButtonElement>('.tutorial-dots button'));
    act(() => dots[dots.length - 1].click());
    expect(container.querySelector('h2')?.textContent).toBe(copy.gpxSteps[5].title);
    expect(container.querySelector('.tutorial-caption-meta')?.textContent).toContain(copy.mapMode);
    expect(container.querySelector('iframe')?.src).toContain('tutorial=map');
    expect(container.querySelector('iframe')?.src).toContain('step=10');
  });

  it('keeps Info compact and links to the standalone pages', () => {
    const copy = getCopy('en');
    const { container } = render(<FlagContent brushes={[]} copy={copy} />);

    expect(container.textContent).toContain(copy.appName);
    expect(container.textContent).toContain(copy.flag.lead);
    expect(container.querySelector('a[href="/about"]')?.textContent).toBe(copy.flag.about);
    expect(container.querySelector('a[href="/tutorial"]')?.textContent).toBe(copy.flag.tutorial);
    expect(container.textContent).toContain(copy.flag.madeBy);
    expect(container.textContent).toContain(copy.flag.otherApps);
    expect(container.textContent).not.toContain('Modes');
    expect(container.textContent).not.toContain('Load a route');
    expect(container.textContent).not.toContain('Waypoints and times');
  });
});
