import { datadogLogs, type LogsEvent } from '@datadog/browser-logs';
import { datadogRum } from '@datadog/browser-rum';
import { reactPlugin } from '@datadog/browser-rum-react';

import { startViewEngagement } from './viewEngagement';

const APPLICATION_ID = 'd5807eba-5947-4933-b5e1-b25c996dfe32';
const CLIENT_TOKEN = 'pubd8fe53f9f169d37ec0ca3bf772e6ee88';
const SITE = 'datadoghq.com';
const SERVICE = 'gpx-topo-web';
const ENV = import.meta.env.DEV ? 'dev' : 'kyo';
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';

type Context = Record<string, unknown>;

let started = false;

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
