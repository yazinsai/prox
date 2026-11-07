import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RequestArchiveStats } from '@/services/api/requestArchive';
import type { ArchiveLoadState } from '../hooks/useRequestArchive';
import { RequestArchivePanelContent } from './RequestArchivePanel';
import styles from '../dashboard.module.scss';

interface Props {
  stats: RequestArchiveStats | null;
  state: ArchiveLoadState;
  refresh: () => Promise<void>;
}

export function ArchiveSummary({ stats, state, refresh }: Props) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const index = stats?.index;
  const status = state === 'ready' ? (stats?.status ?? 'error') : state;
  const healthy = status === 'healthy';
  const percentage =
    index && index.originalBytes > 0
      ? Math.max(0, 100 * (1 - index.archivedBytes / index.originalBytes))
      : null;
  const gb = (bytes: number) =>
    (bytes / 1_000_000_000).toLocaleString(i18n.language, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <section
      className={`${styles.panel} ${styles.archive}`}
      aria-labelledby="dashboard-archive-title"
    >
      <header className={styles.archiveHead}>
        <h2 id="dashboard-archive-title">{t('dashboard_live.archive')}</h2>
        <span className={healthy ? styles.positive : styles.warning}>
          <i className={styles.dot} aria-hidden="true" />
          {healthy ? t('dashboard_live.healthy') : t(`request_archive.status_${status}`)}
        </span>
      </header>
      <div className={styles.archiveSize}>
        <strong>{index ? gb(index.archivedBytes) : '—'}</strong>
        {index ? <span>GB</span> : null}
      </div>
      <p className={styles.muted}>{t('dashboard_live.compressed_archive')}</p>
      {!healthy ? (
        <p className={styles.archiveNote}>{t(`request_archive.hint_${status}`)}</p>
      ) : null}
      {index ? (
        <>
          <div className={styles.storageLabels}>
            <span>
              {t('dashboard_live.original_size', { size: `${gb(index.originalBytes)} GB` })}
            </span>
            {percentage !== null ? (
              <span>{t('dashboard_live.smaller', { percent: Math.round(percentage) })}</span>
            ) : null}
          </div>
          <div className={styles.track} aria-hidden="true">
            <span
              style={{
                width: `${index.originalBytes > 0 ? Math.min(100, (100 * index.archivedBytes) / index.originalBytes) : 0}%`,
              }}
            />
          </div>
          <dl className={styles.archiveDetails}>
            <div>
              <dt>{t('dashboard_live.records')}</dt>
              <dd>{index.records.toLocaleString(i18n.language)}</dd>
            </div>
            <div>
              <dt>{t('dashboard_live.index_size')}</dt>
              <dd>{`${(index.indexBytes / 1_000_000).toLocaleString(i18n.language, { maximumFractionDigits: 1 })} MB`}</dd>
            </div>
            <div>
              <dt>{t('dashboard_live.capture_failures')}</dt>
              <dd>
                {t('dashboard_live.since_restart', { count: stats?.failuresSinceStart ?? 0 })}
              </dd>
            </div>
            <div>
              <dt>{t('dashboard_live.disk_free')}</dt>
              <dd>{`${gb(index.diskFreeBytes)} GB`}</dd>
            </div>
          </dl>
        </>
      ) : null}
      <footer className={styles.archiveFooter}>
        <p>
          {stats
            ? t(stats.enabled ? 'dashboard_live.capture_on' : 'dashboard_live.capture_off')
            : t('dashboard_live.status_unknown')}
          {index
            ? ` · ${t('dashboard_live.index_checked', { time: new Date(index.updatedAt).toLocaleTimeString(i18n.language) })}`
            : ''}
        </p>
        <button
          type="button"
          className={styles.textButton}
          aria-expanded={expanded}
          aria-controls="dashboard-archive-details"
          onClick={() => setExpanded((value) => !value)}
        >
          {t('dashboard_live.archive_details')}{' '}
          <span aria-hidden="true">{expanded ? '↑' : '↗'}</span>
        </button>
      </footer>
      {expanded ? (
        <div id="dashboard-archive-details" className={styles.expandedArchive}>
          <RequestArchivePanelContent
            stats={stats}
            state={state}
            onRefresh={() => void refresh()}
          />
        </div>
      ) : null}
    </section>
  );
}
