import { describe, expect, it } from 'vitest';

import type { LogsEvent } from '@datadog/browser-logs';

import { enrichBrowserLog } from './observability';

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
