import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LogsEvent } from '@datadog/browser-logs';
import { datadogLogs } from '@datadog/browser-logs';
import { datadogRum } from '@datadog/browser-rum';

import { supportsHtmlInCanvas } from './htmlInCanvas';
import { enrichBrowserLog } from './observability';
import { startViewEngagement } from './viewEngagement';

vi.mock('@datadog/browser-rum', () => ({
  datadogRum: {
    init: vi.fn(),
    setGlobalContextProperty: vi.fn(),
    getInitConfiguration: vi.fn(),
    startDurationVital: vi.fn(),
    stopDurationVital: vi.fn(),
  },
}));
vi.mock('@datadog/browser-logs', () => ({
  datadogLogs: { init: vi.fn(), setGlobalContextProperty: vi.fn() },
}));
vi.mock('@datadog/browser-rum-react', () => ({ reactPlugin: vi.fn() }));
vi.mock('./htmlInCanvas', () => ({ supportsHtmlInCanvas: vi.fn() }));
vi.mock('./viewEngagement', () => ({ startViewEngagement: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

afterEach(() => vi.restoreAllMocks());

function log(overrides: Partial<LogsEvent> = {}): LogsEvent {
  return {
    date: 0,
    message: 'test',
    status: 'info',
    origin: 'logger',
    view: { url: 'https://example.test/' },
    ...overrides,
  };
}

describe('enrichBrowserLog', () => {
  it('preserves an explicit event type', () => {
    const event = log({ event_type: 'browser_operation_failed' });

    expect(enrichBrowserLog(event)).toBe(true);
    expect(event.event_type).toBe('browser_operation_failed');
    expect(event.service).toBe('gpx-topo-web');
    expect(event.env).toBeDefined();
    expect(event.version).toBeDefined();
  });

  it('classifies automatic console and error logs', () => {
    const consoleEvent = log({ origin: 'console' });
    const errorEvent = log({ origin: 'report', status: 'error' });

    enrichBrowserLog(consoleEvent);
    enrichBrowserLog(errorEvent);

    expect(consoleEvent.event_type).toBe('browser_console');
    expect(errorEvent.event_type).toBe('browser_error');
  });
});

describe('startObservability', () => {
  it.each([true, false])('sets HTML-in-Canvas support to %s after RUM init', async (supported) => {
    vi.mocked(supportsHtmlInCanvas).mockReturnValue(supported);
    const { startObservability } = await import('./observability');

    startObservability();

    expect(datadogRum.init).toHaveBeenCalledOnce();
    expect(datadogRum.setGlobalContextProperty).toHaveBeenCalledWith('html_in_canvas_supported', supported);
    expect(vi.mocked(datadogRum.init).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(datadogRum.setGlobalContextProperty).mock.invocationCallOrder[0],
    );
  });

  it.each([
    { supported: true, path: 'native' },
    { supported: false, path: 'fallback' },
  ])('tags RUM and Logs with render_path $path (supported $supported)', async ({ supported, path }) => {
    vi.mocked(supportsHtmlInCanvas).mockReturnValue(supported);
    const { startObservability } = await import('./observability');

    startObservability();

    expect(datadogRum.setGlobalContextProperty).toHaveBeenCalledWith('render_path', path);
    expect(datadogLogs.setGlobalContextProperty).toHaveBeenCalledWith('render_path', path);
  });

  it('sets render_path after RUM initialization and before view engagement starts', async () => {
    vi.mocked(supportsHtmlInCanvas).mockReturnValue(false);
    const { startObservability } = await import('./observability');

    startObservability();

    const index = vi.mocked(datadogRum.setGlobalContextProperty).mock.calls.findIndex(([name]) => name === 'render_path');
    expect(index).toBeGreaterThanOrEqual(0);
    const setOrder = vi.mocked(datadogRum.setGlobalContextProperty).mock.invocationCallOrder[index];
    expect(vi.mocked(datadogRum.init).mock.invocationCallOrder[0]).toBeLessThan(setOrder);
    expect(vi.mocked(startViewEngagement).mock.invocationCallOrder[0]).toBeGreaterThan(setOrder);
  });

  it('marks the events of the tutorial page\'s frame, and only those', async () => {
    window.history.replaceState(null, '', '/?tutorial=map&step=0');
    const { startObservability } = await import('./observability');
    startObservability();
    expect(datadogRum.setGlobalContextProperty).toHaveBeenCalledWith('tutorial', true);
    expect(datadogLogs.setGlobalContextProperty).toHaveBeenCalledWith('tutorial', true);

    vi.resetModules();
    vi.mocked(datadogRum.setGlobalContextProperty).mockClear();
    window.history.replaceState(null, '', '/');
    const again = await import('./observability');
    again.startObservability();
    expect(vi.mocked(datadogRum.setGlobalContextProperty).mock.calls.map(([name]) => name)).not.toContain('tutorial');
  });

  it('starts view engagement once, after RUM initialization', async () => {
    const { startObservability } = await import('./observability');
    vi.mocked(datadogRum.init).mockImplementationOnce(() => {
      expect(startViewEngagement).not.toHaveBeenCalled();
    });

    startObservability();
    startObservability();

    expect(datadogRum.init).toHaveBeenCalledOnce();
    expect(startViewEngagement).toHaveBeenCalledOnce();
  });
});

describe('duration vitals', () => {
  let startVital: typeof import('./observability').startVital;

  beforeEach(async () => {
    ({ startVital } = await import('./observability'));
    vi.mocked(datadogRum.getInitConfiguration).mockReturnValue({ applicationId: 'app', clientToken: 'token' });
  });

  it('uses distinct string keys to finish overlapping measurements independently', () => {
    const stopCoarse = startVital('dem_load', { phase: 'coarse' });
    const stopFine = startVital('dem_load', { phase: 'fine' });
    const coarseKey = vi.mocked(datadogRum.startDurationVital).mock.calls[0][1]!.vitalKey;
    const fineKey = vi.mocked(datadogRum.startDurationVital).mock.calls[1][1]!.vitalKey;

    expect(coarseKey).toEqual(expect.any(String));
    expect(fineKey).toEqual(expect.any(String));
    expect(coarseKey).not.toBe(fineKey);

    stopFine('error');
    stopCoarse('ok', { nx: 100 });

    expect(datadogRum.stopDurationVital).toHaveBeenNthCalledWith(1, 'dem_load', {
      vitalKey: fineKey,
      context: { phase: 'fine', status: 'error' },
    });
    expect(datadogRum.stopDurationVital).toHaveBeenNthCalledWith(2, 'dem_load', {
      vitalKey: coarseKey,
      context: { phase: 'coarse', nx: 100, status: 'ok' },
    });
  });

  it('merges completion context without modifying the caller context', () => {
    const context = { source: 'file' };
    const stop = startVital('gpx_parse', context);

    stop('ok', { point_count: 42 });

    expect(datadogRum.startDurationVital).toHaveBeenCalledWith('gpx_parse', {
      vitalKey: expect.any(String),
      context: { source: 'file' },
    });
    expect(datadogRum.stopDurationVital).toHaveBeenCalledWith('gpx_parse', {
      vitalKey: expect.any(String),
      context: { source: 'file', point_count: 42, status: 'ok' },
    });
    expect(context).toEqual({ source: 'file' });
  });

  it('records abort immediately and ignores later success or error completion', () => {
    const controller = new AbortController();
    const stop = startVital('dem_load', { phase: 'coarse' }, controller.signal);

    controller.abort();

    expect(datadogRum.stopDurationVital).toHaveBeenCalledExactlyOnceWith('dem_load', {
      vitalKey: vi.mocked(datadogRum.startDurationVital).mock.calls[0][1]!.vitalKey,
      context: { phase: 'coarse', status: 'aborted' },
    });
    stop('ok');
    stop('error');
    expect(datadogRum.stopDurationVital).toHaveBeenCalledOnce();
  });

  it.each(['ok', 'error', 'aborted'] as const)('finishes with status %s only once and removes the abort listener', (status) => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const stop = startVital('dem_load', {}, controller.signal);

    stop(status);
    stop('ok');
    controller.abort();

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(datadogRum.stopDurationVital).toHaveBeenCalledExactlyOnceWith('dem_load', {
      vitalKey: expect.any(String),
      context: { status },
    });
  });

  it('skips signals that were already aborted', () => {
    const controller = new AbortController();
    controller.abort();

    const stop = startVital('dem_load', {}, controller.signal);
    stop('error');

    expect(datadogRum.startDurationVital).not.toHaveBeenCalled();
    expect(datadogRum.stopDurationVital).not.toHaveBeenCalled();
  });

  it('does not start or later finish a measurement begun before RUM initialization', () => {
    vi.mocked(datadogRum.getInitConfiguration).mockReturnValueOnce(undefined);

    const stop = startVital('gpx_parse');
    stop('ok');

    expect(datadogRum.startDurationVital).not.toHaveBeenCalled();
    expect(datadogRum.stopDurationVital).not.toHaveBeenCalled();
  });

  it('does not stop a measurement if RUM is no longer initialized', () => {
    const stop = startVital('gpx_parse');
    vi.mocked(datadogRum.getInitConfiguration).mockReturnValue(undefined);

    expect(() => stop('ok')).not.toThrow();

    expect(datadogRum.stopDurationVital).not.toHaveBeenCalled();
  });

  it('ignores errors checking RUM initialization', () => {
    vi.mocked(datadogRum.getInitConfiguration).mockImplementationOnce(() => { throw new Error('unavailable'); });

    expect(() => startVital('gpx_parse')('ok')).not.toThrow();

    expect(datadogRum.startDurationVital).not.toHaveBeenCalled();
    expect(datadogRum.stopDurationVital).not.toHaveBeenCalled();
  });

  it('ignores SDK start errors without attempting a stop', () => {
    vi.mocked(datadogRum.startDurationVital).mockImplementationOnce(() => { throw new Error('unavailable'); });

    expect(() => startVital('gpx_parse')('error')).not.toThrow();

    expect(datadogRum.stopDurationVital).not.toHaveBeenCalled();
  });

  it('ignores SDK stop errors, including from abort handlers', () => {
    vi.mocked(datadogRum.stopDurationVital).mockImplementation(() => { throw new Error('unavailable'); });
    const controller = new AbortController();
    const stop = startVital('dem_load', {}, controller.signal);

    expect(() => controller.abort()).not.toThrow();
    expect(() => stop('error')).not.toThrow();
    expect(() => startVital('gpx_parse')('ok')).not.toThrow();

    expect(datadogRum.stopDurationVital).toHaveBeenCalledTimes(2);
  });
});
