import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFallbackUi, FallbackTimePicker, KeyFace, PanelKey, PanelTabs } from './fallbackUi';
import { getCopy } from './i18n';

const copy = getCopy('en');
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

describe('createFallbackUi', () => {
  it('makes the hosts the controls are rendered into, inside one root', () => {
    const ui = createFallbackUi();
    for (const host of [ui.backdrop, ui.mapControls, ui.panel, ui.hud, ui.panelKey, ui.modal]) expect(ui.root.contains(host)).toBe(true);
    expect(ui.panel.contains(ui.panelBody)).toBe(true);
    expect(ui.root.className).toBe('fb-ui');
  });

  it('gives the panel and the bar the engine\'s spring as their easing', () => {
    const ui = createFallbackUi();
    expect(ui.root.style.getPropertyValue('--fb-ease')).toMatch(/^linear\(0,/);
    expect(ui.root.style.getPropertyValue('--fb-duration')).toMatch(/^\d+ms$/);
  });

  it('follows the window: the panel width and the bar height, until stopped', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const ui = createFallbackUi();
    const set = (width: number, height: number) => {
      Object.assign(window, { innerWidth: width, innerHeight: height });
      window.dispatchEvent(new Event('resize'));
    };
    const stop = ui.connect();
    set(390, 844);
    expect(parseInt(ui.root.style.getPropertyValue('--fb-panel-width'), 10)).toBeLessThan(390);
    set(1366, 768);
    expect(ui.root.style.getPropertyValue('--fb-panel-width')).toBe('400px');
    stop();
    set(390, 844);
    expect(ui.root.style.getPropertyValue('--fb-panel-width')).toBe('400px');
  });
});

describe('PanelKey', () => {
  it('says what it will do, and whether the drawer is open', () => {
    const onToggle = vi.fn();
    render(<PanelKey open={false} copy={copy} onToggle={onToggle} />);
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe(copy.ui.showPanel);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    render(<PanelKey open copy={copy} onToggle={onToggle} />);
    expect(container.querySelector('button')!.getAttribute('aria-label')).toBe(copy.ui.hidePanel);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('PanelTabs', () => {
  const labels = { route: 'Route', search: 'Search', sun: 'Sun', ways: 'Ways' };

  it('shows the groups on offer, marks the active one, and selects on a tap', () => {
    const onSelect = vi.fn();
    render(<PanelTabs tabs={['route', 'sun', 'ways']} active="sun" labels={labels} onSelect={onSelect} />);
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(['Route', 'Sun', 'Ways']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    click(tabs[2]);
    expect(onSelect).toHaveBeenCalledWith('ways');
  });
});

describe('KeyFace', () => {
  it('keeps the words for screen readers beside the picture', () => {
    render(<KeyFace icon="open" label="Open GPX" />);
    expect(container.querySelector('.key-label')!.textContent).toBe('Open GPX');
    expect(container.querySelector('svg.key-icon')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('FallbackTimePicker', () => {
  const fields = () => Array.from(container.querySelectorAll<HTMLInputElement>('.fb-step-value'));
  const step = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === label)!;
  const commit = () => container.querySelector<HTMLButtonElement>('.pop-ok')!;

  function show(clock: boolean, minutes: number) {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(null);
    render(<FallbackTimePicker clock={clock} minutes={minutes} copy={copy} head={<div className="pop-head" />} onCancel={onCancel} onCommit={onCommit} />);
    return { onCommit, onCancel };
  }

  it('starts at the given time and commits it unchanged', () => {
    const { onCommit } = show(true, 6 * 60 + 5);
    expect(fields().map((f) => f.value)).toEqual(['06', '05']);
    click(commit());
    expect(onCommit).toHaveBeenCalledWith(365);
  });

  it('steps the hour and the minute, and a clock wraps at 24 hours and 60 minutes', () => {
    const { onCommit } = show(true, 23 * 60 + 59);
    click(step(`${copy.ui.hoursAria} +`));
    click(step(`${copy.ui.minutesAria} +`));
    expect(fields().map((f) => f.value)).toEqual(['00', '00']);
    click(commit());
    expect(onCommit).toHaveBeenCalledWith(0);
    click(step(`${copy.ui.hoursAria} -`));
    expect(fields()[0].value).toBe('23');
  });

  it('lets a duration run past 24 hours, but not below zero', () => {
    const { onCommit } = show(false, 23 * 60);
    click(step(`${copy.ui.hoursAria} +`));
    expect(fields()[0].value).toBe('24');
    click(commit());
    expect(onCommit).toHaveBeenCalledWith(24 * 60);
    show(false, 0);
    click(step(`${copy.ui.hoursAria} -`));
    expect(fields()[0].value).toBe('00');
  });

  it('takes typed digits, held within range', () => {
    const { onCommit } = show(true, 0);
    const hours = fields()[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(hours, '99');
      hours.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(fields()[0].value).toBe('23');
    click(commit());
    expect(onCommit).toHaveBeenCalledWith(23 * 60);
  });

  it('cancels without committing', () => {
    const { onCommit, onCancel } = show(true, 60);
    click(container.querySelector<HTMLButtonElement>('.pop-btn:not(.pop-ok)')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
