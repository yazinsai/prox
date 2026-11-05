import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import type { RequestArchiveStats } from '@/services/api/requestArchive';
import { formatFileSize } from '@/utils/format';
import { useRequestArchive, type ArchiveLoadState } from '../hooks/useRequestArchive';
import styles from './RequestArchivePanel.module.scss';

const FORK_GUIDE = 'https://github.com/yazinsai/prox/blob/main/REQUEST_ARCHIVE.md';
const SYNC_WORKFLOW = 'https://github.com/yazinsai/CLIProxyAPI/actions/workflows/sync-upstream.yml';

interface Props {
  stats: RequestArchiveStats | null;
  state: ArchiveLoadState;
  onRefresh?: () => void;
}

export function RequestArchivePanelContent({ stats, state, onRefresh }: Props) {
  const { t, i18n } = useTranslation();
  const index = stats?.index;
  const status = state === 'ready' ? (stats?.status ?? 'error') : state;
  const healthy = status === 'healthy';
  const timestamp = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString(i18n.language) : t('request_archive.none_yet');
  const saved = index ? Math.max(0, index.originalBytes - index.archivedBytes) : 0;
  const scale = Math.max(index?.originalBytes ?? 0, index?.archivedBytes ?? 0, 1);
  const peak = Math.max(...(index?.daily.map((day) => day.records) ?? []), 1);
  const todayCount = (index ? index.daily[index.daily.length - 1]?.records : undefined) ?? 0;

  return (
    <section className={styles.panel} aria-labelledby="request-archive-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t('request_archive.eyebrow')}</p>
          <h2 id="request-archive-title">{t('request_archive.title')}</h2>
          <p className={styles.description}>{t('request_archive.description')}</p>
        </div>
        <span className={`${styles.status} ${healthy ? styles.healthy : styles.attention}`}>
          <span aria-hidden="true">{healthy ? '✓' : status === 'loading' ? '…' : '○'}</span>
          {t(`request_archive.status_${status}`)}
        </span>
      </header>

      <p className={styles.statusNote}>{t(`request_archive.hint_${status}`)}</p>

      {index ? (
        <>
          <dl className={styles.metrics}>
            {[
              ['records', index.records.toLocaleString(i18n.language)],
              ['stored', formatFileSize(index.archivedBytes)],
              ['saved', formatFileSize(saved)],
              ['today', todayCount.toLocaleString(i18n.language)],
            ].map(([key, value]) => (
              <div key={key}>
                <dt>{t(`request_archive.metric_${key}`)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <div className={styles.charts}>
            <figure className={styles.storage}>
              <figcaption>{t('request_archive.storage_title')}</figcaption>
              {[
                ['original', index.originalBytes, styles.original],
                ['compressed', index.archivedBytes, styles.compressed],
              ].map(([key, bytes, className]) => (
                <div className={styles.storageRow} key={key}>
                  <div className={styles.storageLabel}>
                    <span>{t(`request_archive.storage_${key}`)}</span>
                    <strong>{formatFileSize(Number(bytes))}</strong>
                  </div>
                  <div className={styles.track} aria-hidden="true">
                    <span
                      className={String(className)}
                      style={{ width: `${(Number(bytes) / scale) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              <p className={styles.caption}>
                {t('request_archive.index_size', { size: formatFileSize(index.indexBytes) })}
              </p>
            </figure>

            <figure className={styles.activity}>
              <figcaption>{t('request_archive.activity_title')}</figcaption>
              <div className={styles.bars}>
                {index.daily.map((day) => (
                  <div className={styles.day} key={day.date}>
                    <span className={styles.dayCount}>
                      {day.records.toLocaleString(i18n.language)}
                    </span>
                    <div className={styles.barTrack} aria-hidden="true">
                      <span style={{ height: `${(day.records / peak) * 100}%` }} />
                    </div>
                    <time dateTime={day.date}>
                      {new Date(`${day.date}T00:00:00Z`).toLocaleDateString(i18n.language, {
                        weekday: 'short',
                        timeZone: 'UTC',
                      })}
                    </time>
                  </div>
                ))}
              </div>
              <p className={styles.caption}>{t('request_archive.activity_timezone')}</p>
            </figure>
          </div>

          <dl className={styles.details}>
            <div>
              <dt>{t('request_archive.latest')}</dt>
              <dd>{timestamp(index.latestAt)}</dd>
            </div>
            <div>
              <dt>{t('request_archive.index_checked')}</dt>
              <dd>{timestamp(index.updatedAt)}</dd>
            </div>
            <div>
              <dt>{t('request_archive.disk_free')}</dt>
              <dd>{formatFileSize(index.diskFreeBytes)}</dd>
            </div>
            <div>
              <dt>{t('request_archive.capture_errors')}</dt>
              <dd>{stats?.failuresSinceStart ?? 0}</dd>
            </div>
          </dl>
          {index.archiveFiles !== index.records ? (
            <p className={styles.caption}>
              {t('request_archive.index_lag', {
                files: index.archiveFiles,
                indexed: index.records,
              })}
            </p>
          ) : null}
        </>
      ) : null}

      <footer className={styles.footer}>
        <p>{t('request_archive.policy')}</p>
        {onRefresh ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={state === 'disconnected'}
            loading={state === 'loading'}
          >
            {t('common.refresh')}
          </Button>
        ) : null}
        <Link to="/logs">
          {t('request_archive.logs_link')} <span aria-hidden="true">→</span>
        </Link>
      </footer>
      <details className={styles.maintenance}>
        <summary>{t('request_archive.updates_title')}</summary>
        <p>{t('request_archive.updates_description')}</p>
        {stats ? (
          <p className={styles.build}>
            {t('request_archive.build', {
              version: stats.version || '—',
              base: stats.upstreamBase === 'unknown' ? '—' : stats.upstreamBase.slice(0, 12),
            })}
          </p>
        ) : null}
        <div className={styles.links}>
          <a href={SYNC_WORKFLOW} target="_blank" rel="noopener noreferrer">
            {t('request_archive.sync_link')}
          </a>
          <a href={FORK_GUIDE} target="_blank" rel="noopener noreferrer">
            {t('request_archive.guide_link')}
          </a>
        </div>
      </details>
    </section>
  );
}

export function RequestArchivePanel() {
  const { stats, state, refresh } = useRequestArchive();
  return (
    <RequestArchivePanelContent stats={stats} state={state} onRefresh={() => void refresh()} />
  );
}
