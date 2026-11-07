import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { useNotificationStore } from '@/stores';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@/components/ui/icons';
import { useThemeStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import type { QuotaClassMap } from '@/features/quota/types';
import { summarizeCooldowns } from '@/features/authFiles/cooldowns';
import { getAuthFileIcon } from '@/features/authFiles/constants';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { formatRelativeInstant } from '@/utils/quota/relativeTime';
import { isObservationStale, type QuotaObservation } from '../observations';
import { nextQuotaReset, summarizeQuota } from '../quotaSummary';
import styles from '../RoutingPage.module.scss';

export function QuotaObservationRow({
  file,
  entry,
  observation,
  connected,
  nowMs,
  loading,
  classes,
  onCooldownCleared,
}: {
  file: AuthFileItem;
  entry: QuotaFileEntry | undefined;
  observation: QuotaObservation | undefined;
  connected: boolean;
  nowMs: number;
  loading: boolean;
  classes: QuotaClassMap;
  onCooldownCleared?: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [resetting, setResetting] = useState(false);
  const pending = useRef(false);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const clearCooldown = async () => {
    const authIndex = String(file.authIndex ?? '').trim();
    if (!connected || !authIndex || pending.current) return;
    const revision = apiClient.getConnectionRevision();
    pending.current = true;
    setResetting(true);
    try {
      await authFilesApi.resetCooldown(authIndex);
      if (revision !== apiClient.getConnectionRevision()) return;
      showNotification(t('auth_files.cooldown_reset_success', { name: file.name }), 'success');
      await onCooldownCleared?.();
    } catch (error) {
      if (revision !== apiClient.getConnectionRevision()) return;
      showNotification(
        t('auth_files.cooldown_reset_failed', {
          name: file.name,
          message: error instanceof Error ? error.message : t('notification.update_failed'),
        }),
        'error'
      );
    } finally {
      pending.current = false;
      setResetting(false);
    }
  };
  const theme = useThemeStore((state) => state.resolvedTheme);
  const Body = entry ? QUOTA_ADAPTERS[entry.type].Body : null;
  const stale = isObservationStale(observation, nowMs, connected);
  const windows = entry ? summarizeQuota(entry.type, observation?.quota) : [];
  const nextReset = nextQuotaReset(windows, nowMs);
  const icon = getAuthFileIcon(entry?.type ?? file.type ?? '', theme);
  const stateKey = !observation?.quota
    ? 'routing.observation_unknown'
    : stale
      ? 'routing.observation_stale'
      : 'routing.observation_measured';
  const cooldowns = file.cooldownSnapshot
    ? summarizeCooldowns(file.cooldownSnapshot, nowMs).rows.filter(
        (row) => row.remainingSeconds > 0
      )
    : [];
  return (
    <div className={styles.observationCard}>
      <details>
        <summary className={styles.observationSummary}>
          <span className={styles.observationIdentity}>
            <span className={styles.observationIcon} aria-hidden="true">
              {icon ? <img src={icon} alt="" /> : <span>{(file.type ?? '?').slice(0, 1)}</span>}
            </span>
            <span className={styles.observationName}>
              <strong>{getQuotaDisplayName(file)}</strong>
              <span className={styles.observationSource}>{entry?.type ?? file.type}</span>
            </span>
          </span>
          <span className={styles.observationWindows}>
            {windows.length ? (
              windows.map((window) => (
                <span className={styles.observationWindow} key={window.id}>
                  <span className={styles.observationWindowLabel} title={window.label}>
                    {window.labelKey ? t(window.labelKey, window.labelParams ?? {}) : window.label}
                  </span>
                  <span
                    className={styles.observationPercent}
                    data-depleted={window.remaining === 0}
                  >
                    {window.remaining === null ? '—' : `${Math.round(window.remaining)}%`}
                    <span>{t('routing.summary_remaining')}</span>
                  </span>
                  {window.remaining !== null ? (
                    <span className={styles.observationBar} aria-hidden="true">
                      <span style={{ width: `${window.remaining}%` }} />
                    </span>
                  ) : null}
                </span>
              ))
            ) : (
              <span className={styles.observationUnknown}>
                {t(
                  entry
                    ? loading
                      ? 'routing.sync_refreshing'
                      : 'routing.observation_unknown'
                    : 'routing.quota_unsupported'
                )}
              </span>
            )}
          </span>
          <span className={styles.observationReading}>
            <span className={styles.observationMeasured} data-stale={stale}>
              <i aria-hidden="true" />
              {t(stateKey)}
            </span>
            <span className={styles.observationReset}>
              {nextReset !== null
                ? t('routing.summary_next_reset', {
                    time: formatRelativeInstant(nextReset, nowMs, i18n.language),
                  })
                : observation?.observedAt
                  ? t('routing.snapshot_age', {
                      seconds: Math.max(0, Math.floor((nowMs - observation.observedAt) / 1000)),
                    })
                  : t('routing.snapshot_waiting')}
            </span>
            {cooldowns.length > 0 ? (
              <span className={styles.observationError}>{t('routing.proxy_cooldown_active')}</span>
            ) : null}
            {observation?.error ? (
              <span className={styles.observationError}>{observation.error}</span>
            ) : null}
          </span>
          <span className={styles.observationChevron}>
            <span className={styles.srOnly}>
              {t('routing.quota_details', { name: getQuotaDisplayName(file) })}
            </span>
            <IconChevronDown size={16} aria-hidden="true" />
          </span>
        </summary>
        <div className={styles.observationDetails}>
          <div className={styles.observationMeta}>
            <span>{t(stateKey)}</span>
            {observation?.observedAt ? (
              <span>
                {t('routing.snapshot_age', {
                  seconds: Math.max(0, Math.floor((nowMs - observation.observedAt) / 1000)),
                })}
              </span>
            ) : null}
          </div>
          {observation?.error ? (
            <p className={styles.syncError} role="alert">
              {observation.error}
            </p>
          ) : null}
          {cooldowns.length > 0 ? <p>{t('routing.quota_cooldown_explanation')}</p> : null}
          {observation?.quota && Body ? (
            <Body quota={observation.quota} classes={classes} />
          ) : (
            <p>
              {t(
                entry
                  ? loading
                    ? 'routing.sync_refreshing'
                    : 'routing.observation_unknown'
                  : 'routing.quota_unsupported'
              )}
            </p>
          )}
          <footer className={styles.observationMeta}>
            <span>
              {t('routing.request_counts', {
                success: file.successCount ?? '—',
                failed: file.failureCount ?? '—',
              })}
            </span>
            {cooldowns.map(({ record }, index) => (
              <span key={index}>
                {record.modelKey ?? file.type}: {record.reason}
                {record.httpStatus ? ` (HTTP ${record.httpStatus})` : ''}
              </span>
            ))}
          </footer>
        </div>
      </details>
      {cooldowns.length > 0 ? (
        <div className={styles.cooldownAction}>
          <p>{t('routing.cooldown_external_reset_hint')}</p>
          <Button
            variant="secondary"
            size="sm"
            loading={resetting}
            disabled={!connected || !file.authIndex}
            onClick={() => void clearCooldown()}
            aria-label={`${t('auth_files.cooldown_reset_button')}: ${getQuotaDisplayName(file)}`}
          >
            {t('auth_files.cooldown_reset_button')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
