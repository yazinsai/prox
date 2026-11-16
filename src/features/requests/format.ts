import type { TFunction } from 'i18next';
import type {
  DashboardModel,
  DashboardRequestAttempt,
  DashboardRequestReason,
} from '@/services/api/dashboard';

/** A request whose HTTP status says success can still have failed mid-stream. */
export const isFailedRequest = (request: Pick<DashboardRequestAttempt, 'outcome'>) =>
  request.outcome !== 'success';

/**
 * Seconds with one decimal under ten seconds, whole seconds under a minute, then minutes and
 * seconds: long streaming requests read as "2m 42s", not "162.1s".
 */
export function formatRequestDuration(t: TFunction, language: string, durationMs: number): string {
  const seconds = Math.max(0, durationMs) / 1000;
  if (seconds < 60) {
    return t('dashboard_live.seconds', {
      seconds: seconds.toLocaleString(language, {
        maximumFractionDigits: seconds < 10 ? 1 : 0,
      }),
    });
  }
  const whole = Math.round(seconds);
  return t('requests_page.duration_minutes', {
    minutes: Math.floor(whole / 60),
    seconds: whole % 60,
  });
}

/** Clock time, with the date in front when the request did not finish today. */
export function formatRequestTime(language: string, iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  if (date.toDateString() === now.toDateString()) return time;
  const day = date.toLocaleDateString(language, { month: 'short', day: 'numeric' });
  return `${day} ${time}`;
}

/**
 * Status code, "Interrupted" for streams that broke after a success status, and "Failed" for
 * failures that never got an HTTP status (connection errors, timeouts).
 */
export function requestStatusText(
  t: TFunction,
  request: Pick<DashboardRequestAttempt, 'outcome' | 'statusCode'>
): string {
  if (request.outcome === 'interrupted') return t('dashboard_live.interrupted');
  if (request.statusCode) return String(request.statusCode);
  return request.outcome === 'failed' ? t('dashboard_live.failed') : '—';
}

/**
 * Short failure cause for a list row; null when there is nothing to add (successes, unknown
 * reasons, and interruptions, whose status text already says so).
 */
export function requestReasonShort(
  t: TFunction,
  request: Pick<DashboardRequestAttempt, 'outcome' | 'reason'>
): string | null {
  if (!isFailedRequest(request)) return null;
  const reason: DashboardRequestReason | null = request.reason;
  if (!reason || reason === 'unknown') return null;
  if (request.outcome === 'interrupted' && reason === 'stream_interrupted') return null;
  return t(`requests_page.reason_${reason}`);
}

/** Provider id → the label the routing snapshot uses for it. */
export function providerLabels(models: readonly DashboardModel[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const model of models) {
    for (const route of model.routes) {
      if (route.providerLabel && !labels.has(route.provider)) {
        labels.set(route.provider, route.providerLabel);
      }
    }
  }
  return labels;
}
