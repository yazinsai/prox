import { useTranslation } from 'react-i18next';
import { useDashboardCooldownClock } from '../hooks/useDashboardCooldownClock';
import { formatAgo, formatWait } from '../format';

/**
 * Server timestamps are aged by the local time elapsed since the response
 * landed, never by comparing them with the local wall clock: a remote proxy's
 * clock can be minutes off from the browser's.
 */
function useElapsedSince(receivedAt: number | null): number {
  const now = useDashboardCooldownClock(receivedAt !== null);
  return receivedAt === null ? 0 : Math.max(0, now - receivedAt);
}

/** `12s ago`, ticking. `ageMs` is the age at observation time. */
export function Ago({
  ageMs,
  receivedAt,
  template,
}: {
  ageMs: number;
  receivedAt: number | null;
  /** Translation key receiving the age as `{{ago}}`. */
  template?: string;
}) {
  const { t } = useTranslation();
  const ago = formatAgo(t, ageMs + useElapsedSince(receivedAt));
  return <>{template ? t(template, { ago }) : ago}</>;
}

/** Time until `retryAt`, measured on the server clock that issued it. */
function useRemainingMs(
  retryAt: string | null,
  observedAt: string | null,
  receivedAt: number | null
): number | null {
  const elapsed = useElapsedSince(receivedAt);
  if (!retryAt || !observedAt) return null;
  return Date.parse(retryAt) - Date.parse(observedAt) - elapsed;
}

/** `3d 23h`, ticking; the absolute local time is offered as a tooltip. */
export function Countdown({
  retryAt,
  observedAt,
  receivedAt,
  template = 'dashboard_live.back_in',
}: {
  retryAt: string;
  observedAt: string | null;
  receivedAt: number | null;
  template?: string;
}) {
  const { t, i18n } = useTranslation();
  const remaining = useRemainingMs(retryAt, observedAt, receivedAt);
  if (remaining === null || !observedAt || receivedAt === null) return null;
  // The retry instant translated onto the local clock.
  const localRetry = receivedAt + Date.parse(retryAt) - Date.parse(observedAt);
  const at = new Date(localRetry).toLocaleString(i18n.language, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <time dateTime={retryAt} title={at}>
      {remaining <= 0
        ? t('dashboard_live.retry_due')
        : t(template, { wait: formatWait(t, remaining) })}
    </time>
  );
}
