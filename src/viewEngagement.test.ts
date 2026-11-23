import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { datadogRum } from '@datadog/browser-rum';

import { startViewEngagement } from './viewEngagement';

vi.mock('@datadog/browser-rum', () => ({
  datadogRum: {
    getInternalContext: vi.fn(),
    setViewContextProperty: vi.fn(),
  },
}));

describe('view engagement', () => {
  let viewId: string | undefined;
  let stop: () => void;

  function interact(type = 'pointerdown', buttons = 1, target: EventTarget = window) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'buttons', { value: buttons });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(datadogRum.setViewContextProperty).mockClear();
    viewId = 'view-1';
    vi.mocked(datadogRum.getInternalContext).mockImplementation(() =>
      viewId
        ? { application_id: 'app', session_id: 'session', view: { id: viewId, url: 'https://example.test/', referrer: '' } }
        : undefined,
    );
    stop = startViewEngagement();
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('excludes time before the first and after the last interaction', () => {
    vi.advanceTimersByTime(60_000);
    expect(datadogRum.setViewContextProperty).not.toHaveBeenCalled();

    interact();
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 0);

    vi.advanceTimersByTime(2500);
    interact('keydown');
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 2500);

    vi.advanceTimersByTime(60_000);
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(2);
  });

  it.each(['pointerdown', 'pointermove', 'pointerup', 'keydown', 'wheel', 'click'])(
    'counts %s interactions',
    (type) => {
      interact(type);
      vi.advanceTimersByTime(1500);
      const event = interact(type);
      expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 1500);
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it('ignores pointer hover, including after a drag has ended', () => {
    interact('pointermove', 0);
    expect(datadogRum.setViewContextProperty).not.toHaveBeenCalled();

    interact('pointerdown');
    vi.advanceTimersByTime(1500);
    interact('pointermove');
    vi.advanceTimersByTime(1500);
    interact('pointerup', 0);
    vi.advanceTimersByTime(1500);
    interact('pointermove', 0);
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 3000);
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(3);
  });

  it('throttles continuous interactions and publishes the last timestamp after they stop', () => {
    interact();
    for (let i = 0; i < 9; i += 1) {
      vi.advanceTimersByTime(100);
      interact('wheel');
    }
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 900);
    vi.advanceTimersByTime(50);
    interact('wheel');
    vi.advanceTimersByTime(949);
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 1050);

    vi.advanceTimersByTime(60_000);
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(3);
  });

  it('includes idle gaps between interactions in the same view', () => {
    interact();
    vi.advanceTimersByTime(5 * 60_000);
    interact('keydown');
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 300_000);
  });

  it('resets the timestamps, throttle, and pending update when the view ID changes', () => {
    interact();
    vi.advanceTimersByTime(100);
    interact('wheel');
    vi.advanceTimersByTime(100);
    viewId = 'view-2';
    interact('keydown');
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 0);

    vi.advanceTimersByTime(800);
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(700);
    interact('wheel');
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 1500);
  });

  it('discards a pending update if the view changes before it runs', () => {
    interact();
    vi.advanceTimersByTime(500);
    interact('wheel');
    viewId = 'view-2';
    vi.advanceTimersByTime(500);
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(1);

    interact('keydown');
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 0);
  });

  it('skips interactions without a RUM view and resets after the context disappears', () => {
    viewId = undefined;
    interact();
    expect(datadogRum.setViewContextProperty).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    viewId = 'view-1';
    interact();
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 0);

    vi.advanceTimersByTime(500);
    interact();
    viewId = undefined;
    vi.advanceTimersByTime(500);
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(1);

    viewId = 'view-1';
    interact();
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 0);
  });

  it('captures interactions even when a control stops propagation', () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    try {
      interact('pointerdown', 1, button);
      vi.advanceTimersByTime(1500);
      interact('pointerdown', 1, button);
      expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 1500);
    } finally {
      button.remove();
    }
  });

  it.each(['visibilitychange', 'pagehide'])('flushes the last interaction on %s', (type) => {
    interact();
    vi.advanceTimersByTime(350);
    interact('wheel');
    vi.advanceTimersByTime(50);
    if (type === 'visibilitychange') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event(type));
    } else {
      window.dispatchEvent(new Event(type));
    }
    expect(datadogRum.setViewContextProperty).toHaveBeenLastCalledWith('engaged_ms', 350);
    vi.advanceTimersByTime(5000);
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(2);
  });

  it('removes listeners and pending updates on cleanup', () => {
    interact();
    vi.advanceTimersByTime(100);
    interact('wheel');
    stop();
    vi.advanceTimersByTime(5000);
    interact();
    window.dispatchEvent(new Event('pagehide'));
    expect(datadogRum.setViewContextProperty).toHaveBeenCalledTimes(1);
  });
});
