import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFallbackUi, FallbackDialog, FallbackTimePicker, KeyFace, listenDialogEscape, PanelTabs, SheetGrip } from './fallbackUi';
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
    for (const host of [ui.mapControls, ui.grip, ui.panel, ui.hud, ui.modal]) expect(ui.root.contains(host)).toBe(true);
    expect(ui.panel.contains(ui.panelBody)).toBe(true);
    // the grip, the keys and the cards are one sheet, in that order
    const sheet = ui.grip.parentElement!;
    expect(Array.from(sheet.children)).toEqual([ui.grip, ui.hud, ui.panel]);
    expect(ui.root.className).toBe('fb-ui');
  });

  it('gives the panel and the bar the engine\'s spring as their easing', () => {
    const ui = createFallbackUi();
    expect(ui.root.style.getPropertyValue('--fb-ease')).toMatch(/^linear\(0,/);
    expect(ui.root.style.getPropertyValue('--fb-duration')).toMatch(/^\d+ms$/);
  });

  it('carries the sheet\'s height on the page, so the 3D view can make room, and tidies up when stopped', () => {
    const ui = createFallbackUi();
    const page = document.documentElement;
    const stop = ui.connect();
    ui.setSheet(300.4);
    expect(page.style.getPropertyValue('--fb-sheet-h')).toBe('300px');
    expect(page.dataset.fbDrag).toBeUndefined();
    ui.setSheet(120, true);
    expect(page.dataset.fbDrag).toBe('');
    ui.setSheet(0);
    expect(page.dataset.fbDrag).toBeUndefined();
    stop();
    expect(page.style.getPropertyValue('--fb-sheet-h')).toBe('');
    expect(page.style.getPropertyValue('--fb-sheet-open')).toBe('');
  });

  it('follows the window: the cards\' height when pulled up', () => {
    const ui = createFallbackUi();
    const set = (height: number) => {
      Object.assign(window, { innerWidth: 390, innerHeight: height });
      window.dispatchEvent(new Event('resize'));
    };
    const stop = ui.connect();
    set(667);
    expect(document.documentElement.style.getPropertyValue('--fb-sheet-open')).toBe('400px');
    set(1000);
    expect(document.documentElement.style.getPropertyValue('--fb-sheet-open')).toBe('520px');
    stop();
  });
});

describe('SheetGrip', () => {
  const pointer = (type: string, clientY: number, at = 0) => {
    const event = new MouseEvent(type, { bubbles: true, clientY });
    Object.defineProperties(event, { pointerId: { value: 1 }, timeStamp: { value: 1000 + at } });
    act(() => void container.querySelector('button')!.dispatchEvent(event));
  };

  it('says what it will do, and whether the sheet is up', () => {
    render(<SheetGrip open={false} copy={copy} max={400} onDrag={vi.fn()} onSettle={vi.fn()} />);
    const button = container.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe(copy.ui.showPanel);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    render(<SheetGrip open copy={copy} max={400} onDrag={vi.fn()} onSettle={vi.fn()} />);
    expect(container.querySelector('button')!.getAttribute('aria-label')).toBe(copy.ui.hidePanel);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens on a tap, and closes on the next', () => {
    const onSettle = vi.fn();
    render(<SheetGrip open={false} copy={copy} max={400} onDrag={vi.fn()} onSettle={onSettle} />);
    pointer('pointerdown', 700);
    pointer('pointerup', 701);
    expect(onSettle).toHaveBeenLastCalledWith(true);
    render(<SheetGrip open copy={copy} max={400} onDrag={vi.fn()} onSettle={onSettle} />);
    pointer('pointerdown', 700);
    pointer('pointerup', 700);
    expect(onSettle).toHaveBeenLastCalledWith(false);
  });

  it('opens and closes from the keyboard', () => {
    const onSettle = vi.fn();
    render(<SheetGrip open={false} copy={copy} max={400} onDrag={vi.fn()} onSettle={onSettle} />);
    click(container.querySelector('button')!); // a click with no pointer: detail 0
    expect(onSettle).toHaveBeenCalledWith(true);
  });

  it('follows a drag up, clamped to the sheet, and settles on the nearer end', () => {
    const onDrag = vi.fn();
    const onSettle = vi.fn();
    render(<SheetGrip open={false} copy={copy} max={400} onDrag={onDrag} onSettle={onSettle} />);
    pointer('pointerdown', 700, 0);
    pointer('pointermove', 600, 400);
    expect(onDrag).toHaveBeenLastCalledWith(100);
    pointer('pointermove', 100, 900);
    expect(onDrag).toHaveBeenLastCalledWith(400);
    pointer('pointerup', 450, 1900); // slow: 250px up of 400, past the 40 % mark
    expect(onSettle).toHaveBeenLastCalledWith(true);

    pointer('pointerdown', 700, 0);
    pointer('pointermove', 640, 400);
    pointer('pointerup', 640, 1200); // slow: 60px up of 400, short of the 40 % mark
    expect(onSettle).toHaveBeenLastCalledWith(false);
  });

  it('lets a quick flick decide, whatever the distance', () => {
    const onSettle = vi.fn();
    render(<SheetGrip open={false} copy={copy} max={400} onDrag={vi.fn()} onSettle={onSettle} />);
    pointer('pointerdown', 700, 0);
    pointer('pointermove', 680, 10);
    pointer('pointerup', 660, 20); // 2 px/ms upwards
    expect(onSettle).toHaveBeenLastCalledWith(true);
    render(<SheetGrip open copy={copy} max={400} onDrag={vi.fn()} onSettle={onSettle} />);
    pointer('pointerdown', 300, 0);
    pointer('pointermove', 320, 10);
    pointer('pointerup', 340, 20); // downwards
    expect(onSettle).toHaveBeenLastCalledWith(false);
  });
});

describe('PanelTabs', () => {
  const labels = { route: 'Route', search: 'Search', pin: 'Pin', sun: 'Sun', ways: 'Ways' };

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

describe('listenDialogEscape', () => {
  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  it('closes the dialog on Esc before the engine hears it, so the model is not laid flat', () => {
    // the engine's listener is on window in the bubble phase and is added first (in a layout effect)
    const engine = vi.fn();
    window.addEventListener('keydown', engine);
    const close = vi.fn();
    const stop = listenDialogEscape(close);

    const event = press('Escape');
    expect(close).toHaveBeenCalledTimes(1);
    expect(engine).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);

    stop();
    window.removeEventListener('keydown', engine);
  });

  it('leaves other keys to the engine', () => {
    const engine = vi.fn();
    window.addEventListener('keydown', engine);
    const close = vi.fn();
    const stop = listenDialogEscape(close);

    press('a');
    expect(close).not.toHaveBeenCalled();
    expect(engine).toHaveBeenCalledTimes(1);

    stop();
    window.removeEventListener('keydown', engine);
  });

  it('stops listening once removed', () => {
    const engine = vi.fn();
    window.addEventListener('keydown', engine);
    const close = vi.fn();
    listenDialogEscape(close)();

    press('Escape');
    expect(close).not.toHaveBeenCalled();
    expect(engine).toHaveBeenCalledTimes(1);

    window.removeEventListener('keydown', engine);
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

describe('FallbackDialog', () => {
  const press = (el: Element, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    act(() => void el.dispatchEvent(event));
    return event;
  };
  const dialog = (children: React.ReactNode) => (
    <FallbackDialog label="Photo" closeLabel="Close" onClose={() => {}}>
      {children}
    </FallbackDialog>
  );

  it('moves focus in to the element marked for it, else to the first one it can reach', () => {
    render(
      dialog(
        <>
          <button id="a">A</button>
          <button id="b" data-autofocus="">
            B
          </button>
        </>,
      ),
    );
    expect(document.activeElement?.id).toBe('b');
    act(() => root.unmount());
    root = createRoot(container);
    render(
      dialog(
        <>
          <button id="a">A</button>
          <button id="b">B</button>
        </>,
      ),
    );
    expect(document.activeElement?.id).toBe('a');
  });

  it('leaves the scrim out of the keys\' order, and takes the card itself when it holds nothing to reach', () => {
    render(dialog(<p>just words</p>));
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
  });

  it('keeps Tab and Shift+Tab inside, wrapping at either end', () => {
    render(
      dialog(
        <>
          <button id="a">A</button>
          <button id="b">B</button>
          <button id="c">C</button>
        </>,
      ),
    );
    const at = (id: string) => document.getElementById(id)!;
    at('c').focus();
    expect(press(at('c')).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('a');
    expect(press(at('a'), true).defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('c');
    // in the middle the browser moves on by itself
    at('b').focus();
    expect(press(at('b')).defaultPrevented).toBe(false);
    expect(press(at('b'), true).defaultPrevented).toBe(false);
  });

  it('does not count a disabled key, or one taken out of the order', () => {
    render(
      dialog(
        <>
          <button id="a">A</button>
          <button id="skipped" tabIndex={-1}>
            skipped
          </button>
          <button id="off" disabled>
            off
          </button>
          <button id="z">Z</button>
        </>,
      ),
    );
    document.getElementById('z')!.focus();
    press(document.getElementById('z')!);
    expect(document.activeElement?.id).toBe('a');
  });

  it('gives focus back to where it was when it closes', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    render(dialog(<button id="a">A</button>));
    expect(document.activeElement?.id).toBe('a');
    render(null);
    expect(document.activeElement).toBe(opener);
  });
});
