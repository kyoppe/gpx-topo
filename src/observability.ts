import { datadogLogs, type LogsEvent } from '@datadog/browser-logs';
import { datadogRum } from '@datadog/browser-rum';
import { reactPlugin } from '@datadog/browser-rum-react';

import { supportsHtmlInCanvas } from './htmlInCanvas';
import { startViewEngagement } from './viewEngagement';

const APPLICATION_ID = 'd5807eba-5947-4933-b5e1-b25c996dfe32';
const CLIENT_TOKEN = 'pubd8fe53f9f169d37ec0ca3bf772e6ee88';
const SITE = 'datadoghq.com';
const SERVICE = 'gpx-topo-web';
const ENV = import.meta.env.DEV ? 'dev' : 'kyo';
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';

type Context = Record<string, unknown>;
type VitalStatus = 'ok' | 'error' | 'aborted';
type StopVital = (status: VitalStatus, context?: Context) => void;

let started = false;
let vitalSequence = 0;

const ERROR_STATUSES = new Set(['error', 'critical', 'alert', 'emerg']);

export function enrichBrowserLog(event: LogsEvent): boolean {
  if (typeof event.event_type !== 'string' || event.event_type.length === 0) {
    event.event_type = ERROR_STATUSES.has(event.status)
      ? 'browser_error'
      : event.origin === 'console'
        ? 'browser_console'
        : 'browser_log';
  }
  event.service ??= SERVICE;
  event.env ??= ENV;
  event.version ??= VERSION;
  return true;
}

export function startObservability(): void {
  if (started) return;
  started = true;
  const shared = {
    clientToken: CLIENT_TOKEN,
    site: SITE,
    service: SERVICE,
    env: ENV,
    version: VERSION,
  };
  try {
    datadogRum.init({
      applicationId: APPLICATION_ID,
      ...shared,
      sessionSampleRate: 100,
      sessionReplaySampleRate: 100,
      defaultPrivacyLevel: 'allow',
      trackUserInteractions: true,
      trackResources: true,
      trackLongTasks: true,
      plugins: [reactPlugin()],
    });
    datadogRum.setGlobalContextProperty('html_in_canvas_supported', supportsHtmlInCanvas());
    startViewEngagement();
  } catch (error) {
    console.error('gpx_topo_rum_init_failed', error);
    datadogLogs.logger.error('gpx-topo RUM initialization failed', {
      event_type: 'rum_init_failed',
      error: String(error),
    });
  }
  try {
    datadogLogs.init({
      ...shared,
      forwardErrorsToLogs: true,
      forwardConsoleLogs: 'all',
      beforeSend: enrichBrowserLog,
    });
  } catch (error) {
    console.error('gpx_topo_logs_init_failed', error);
  }
}

export function addAction(name: string, context: Context = {}): void {
  datadogRum.addAction(name, context);
}

/** Starts an independent duration vital and returns an idempotent, non-throwing stop callback. */
export function startVital(name: string, context: Context = {}, signal?: AbortSignal): StopVital {
  const vitalKey = `${name}_${++vitalSequence}`;
  let active = false;
  const stop: StopVital = (status, stopContext = {}) => {
    if (!active) return;
    active = false;
    try {
      signal?.removeEventListener('abort', onAbort);
      if (!datadogRum.getInitConfiguration()) return;
      datadogRum.stopDurationVital(name, {
        vitalKey,
        context: { ...context, ...stopContext, status },
      });
    } catch {
      // Observability must not interrupt the operation being measured.
    }
  };
  const onAbort = () => stop('aborted');
  try {
    if (signal?.aborted || !datadogRum.getInitConfiguration()) return stop;
    datadogRum.startDurationVital(name, { vitalKey, context });
    active = true;
    signal?.addEventListener('abort', onAbort, { once: true });
  } catch {
    // RUM may be unavailable or the SDK may reject the measurement.
  }
  return stop;
}

export function reportError(operation: string, error: unknown, context: Context = {}): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const details = {
    operation,
    error_name: normalized.name,
    error_message: normalized.message,
    ...context,
  };
  datadogRum.addAction('operation_failed', details);
  datadogRum.addError(normalized, details);
  datadogLogs.logger.error(`gpx-topo operation failed: ${operation}`, {
    event_type: 'browser_operation_failed',
    ...details,
  });
}

export function reportWarning(operation: string, error: unknown, context: Context = {}): void {
  const details = {
    operation,
    warning: error instanceof Error ? error.message : String(error),
    ...context,
  };
  datadogRum.addAction('operation_warning', details);
  datadogLogs.logger.warn(`gpx-topo operation warning: ${operation}`, {
    event_type: 'browser_operation_warning',
    ...details,
  });
}

export function reportInfo(message: string, context: Context = {}): void {
  datadogLogs.logger.info(message, context);
}
