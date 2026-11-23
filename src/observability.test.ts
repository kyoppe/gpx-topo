import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LogsEvent } from '@datadog/browser-logs';
import { datadogRum } from '@datadog/browser-rum';

import { supportsHtmlInCanvas } from './htmlInCanvas';
import { enrichBrowserLog } from './observability';
import { startViewEngagement } from './viewEngagement';

vi.mock('@datadog/browser-rum', () => ({
  datadogRum: { init: vi.fn(), setGlobalContextProperty: vi.fn() },
}));
vi.mock('@datadog/browser-logs', () => ({
  datadogLogs: { init: vi.fn() },
}));
vi.mock('@datadog/browser-rum-react', () => ({ reactPlugin: vi.fn() }));
vi.mock('./htmlInCanvas', () => ({ supportsHtmlInCanvas: vi.fn() }));
vi.mock('./viewEngagement', () => ({ startViewEngagement: vi.fn() }));

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
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it.each([true, false])('sets HTML-in-Canvas support to %s after RUM init', async (supported) => {
    vi.mocked(supportsHtmlInCanvas).mockReturnValue(supported);
    const { startObservability } = await import('./observability');

    startObservability();

    expect(datadogRum.init).toHaveBeenCalledOnce();
    expect(datadogRum.setGlobalContextProperty).toHaveBeenCalledExactlyOnceWith('html_in_canvas_supported', supported);
    expect(vi.mocked(datadogRum.init).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(datadogRum.setGlobalContextProperty).mock.invocationCallOrder[0],
    );
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
