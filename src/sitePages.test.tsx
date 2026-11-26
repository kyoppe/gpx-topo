import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import AboutPage from './AboutPage';
import { detectLanguage } from './i18n';
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
  });
});
