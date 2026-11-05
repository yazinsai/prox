import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useInterval } from '@/hooks/useInterval';
import { apiClient } from '@/services/api/client';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { classifyQuotaFiles } from '@/features/quota/logic';
import { QUOTA_ADAPTERS, getQuotaSetter } from '@/features/quota/providers';
import { bindQuotaClasses } from '@/features/quota/types';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import {
  isObservationStale,
  mergeQuotaObservation,
  readQuotaObservations,
  type QuotaObservation,
} from '../observations';
import bodyStyles from '@/features/quota/components/QuotaBody.module.scss';
import styles from '../RoutingPage.module.scss';

const classes = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export function ObservedStatus({
  files,
  connected,
  nowMs,
}: {
  files: AuthFileItem[];
  connected: boolean;
  nowMs: number;
}) {
  const { t } = useTranslation();
  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const entries = useMemo(() => classifyQuotaFiles(files), [files]);
  const [observations, setObservations] = useState<Record<string, QuotaObservation>>({});
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  // File inventory polling must not restart quota polling or clear its measurements.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  const inventoryKey = entries.map((entry) => getQuotaCacheKey(entry.file)).join('|');

  const refresh = useCallback(async () => {
    if (!connected || busy.current) return;
    busy.current = true;
    setLoading(true);
    const request = generation.current;
    const revision = apiClient.getConnectionRevision();
    const cache = captureQuotaCacheGeneration();
    const isCurrent = () =>
      request === generation.current && revision === apiClient.getConnectionRevision();
    try {
      await readQuotaObservations(
        entriesRef.current,
        QUOTA_ADAPTERS,
        tRef.current,
        isCurrent,
        (entry, result) => {
          const key = getQuotaCacheKey(entry.file);
          commitIfQuotaCacheCurrent(
            cache,
            () => {
              setObservations((previous) => ({
                ...previous,
                [key]: mergeQuotaObservation(previous[key], result),
              }));
              // Both pages consume the same successful provider measurement.
              if (result.quota) {
                const quota = result.quota;
                getQuotaSetter(QUOTA_ADAPTERS[entry.type])((previous) => ({
                  ...previous,
                  [key]: quota,
                }));
              }
            },
            entry.file.name
          );
        }
      );
    } finally {
      if (isCurrent()) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [connected]);

  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setObservations({});
    void refresh();
    return () => {
      generation.current += 1;
      busy.current = false;
    };
  }, [refresh, inventoryKey, sessionGeneration]);

  useInterval(
    () => {
      if (document.visibilityState === 'visible') void refresh();
    },
    connected ? 30_000 : null
  );

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);

  const entryByKey = new Map(entries.map((entry) => [getQuotaCacheKey(entry.file), entry]));
  return (
    <section className={styles.observed} aria-label={t('routing.observed_title')}>
      <div className={styles.snapshotHeading}>
        <div>
          <h2>{t('routing.observed_title')}</h2>
          <p>{t('routing.observed_description')}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={loading}
          disabled={!connected}
          onClick={() => void refresh()}
        >
          {t('routing.refresh_quota')}
        </Button>
      </div>
      <div className={styles.observationGrid}>
        {files.map((file) => {
          const key = getQuotaCacheKey(file);
          const entry = entryByKey.get(key);
          const observation = observations[key];
          const Body = entry ? QUOTA_ADAPTERS[entry.type].Body : null;
          const stale = isObservationStale(observation, nowMs, connected);
          const cooldowns = file.cooldownSnapshot?.records?.filter(
            (record) =>
              record.remainingSeconds * 1000 > nowMs - (file.cooldownSnapshot?.receivedAtMs ?? 0)
          );
          return (
            <article key={key} className={styles.observationCard}>
              <header>
                <strong>{getQuotaDisplayName(file)}</strong>
                <span className={styles.observationSource}>{entry?.type ?? file.type}</span>
              </header>
              <div className={styles.observationMeta}>
                <span>
                  {t(
                    !observation?.quota
                      ? 'routing.observation_unknown'
                      : stale
                        ? 'routing.observation_stale'
                        : 'routing.observation_measured'
                  )}
                </span>
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
                {cooldowns?.map((record, index) => (
                  <span key={index}>
                    {record.modelKey ?? file.type}: {record.reason}
                    {record.httpStatus ? ` (HTTP ${record.httpStatus})` : ''}
                  </span>
                ))}
              </footer>
            </article>
          );
        })}
      </div>
      {!files.length ? <p>{t('routing.snapshot_waiting')}</p> : null}
    </section>
  );
}
