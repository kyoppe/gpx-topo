import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CurrentLocationButton } from './CurrentLocationButton';

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
});

function render(active: boolean, onClick: () => void) {
  act(() => {
    root.render(
      <CurrentLocationButton
        active={active}
        busy={false}
        disabled={false}
        label="Show current location"
        clearLabel="Hide current location"
        onClick={onClick}
      />,
    );
  });
}

describe('CurrentLocationButton', () => {
  it('exposes the inactive state and shows the current location label', () => {
    render(false, vi.fn());
    const button = container.querySelector('button')!;

    expect(button.getAttribute('aria-label')).toBe('Show current location');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.hasAttribute('data-latched')).toBe(false);
  });

  it('uses the inverted latched state and clears through the active action', () => {
    const onClick = vi.fn();
    render(true, onClick);
    const button = container.querySelector('button')!;

    expect(button.getAttribute('aria-label')).toBe('Hide current location');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.hasAttribute('data-latched')).toBe(true);

    act(() => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
