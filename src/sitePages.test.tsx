import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

    expect(container.querySelector('h1')?.textContent).toContain('The map suddenly stands up');
    expect(container.textContent).toContain('What you can do');
    expect(container.textContent).toContain('Ways to use it');
    expect(container.querySelector('.about-page')?.getAttribute('data-primary-input')).toBe('pointer');
    // only the primary input's instructions are in the page
    expect(container.querySelectorAll('.site-controls').length).toBe(1);
    expect(container.querySelector('.site-controls')?.textContent).toContain('Drag to rotate');
    expect(container.querySelector('.site-controls')?.textContent).not.toContain('two fingers');
    expect(container.querySelector('#faq')).not.toBeNull();
    expect(container.querySelector('.about-plain')).not.toBeNull();
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

    const dots = Array.from(container.querySelectorAll<HTMLButtonElement>('.tutorial-index button'));
    // jsdom has no HTML-in-Canvas, so the steps for the native screen alone are left out
    const total = [...copy.mapSteps, ...copy.gpxSteps].filter((step) => !step.nativeOnly).length;
    act(() => dots[dots.length - 1].click());
    expect(container.querySelector('h2')?.textContent).toBe(copy.gpxSteps[copy.gpxSteps.length - 1].title);
    expect(container.querySelector('.tutorial-caption-meta')?.textContent).toContain(copy.tutorialGpx);
    expect(container.querySelector('.tutorial-open')?.getAttribute('href')).toBe('/');
    expect(dots).toHaveLength(total);
    // one frame for every step: it is told the step, never reloaded
    const frame = container.querySelector('iframe')!;
    const firstSrc = frame.getAttribute('src');
    const sent: Array<{ step: number; target: string; mode: string }> = [];
    const spy = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation((message: unknown) => {
      sent.push(message as { step: number; target: string; mode: string });
    });
    for (const dot of dots) act(() => dot.click());
    spy.mockRestore();
    expect(container.querySelector('iframe')).toBe(frame);
    expect(frame.getAttribute('src')).toBe(firstSrc);
    expect(sent.map((message) => message.step)).toEqual([...Array(total).keys()]);
    expect(sent[0].mode).toBe('map');
    expect(sent[sent.length - 1].mode).toBe('map');
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
