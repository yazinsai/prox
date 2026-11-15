import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import type { RequestArchiveStats } from '@/services/api/requestArchive';
import type { ArchiveLoadState } from '../hooks/useRequestArchive';
import { RequestArchivePanelContent } from './RequestArchivePanel';
import styles from '../dashboard.module.scss';

interface Props {
  stats: RequestArchiveStats | null;
  state: ArchiveLoadState;
  refresh: () => Promise<void>;
}

/** Physical bytes on disk, in decimal GB to match what `du` and Finder report. */
function formatArchiveSize(bytes: number, language: string): string {
  return (bytes / 1_000_000_000).toLocaleString(language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Storage is not a live signal, so the dashboard keeps it to one quiet line
 * that only raises its voice when capture needs attention.
 */
export function ArchiveSummary({ stats, state, refresh }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const index = stats?.index;
  const status = state === 'ready' ? (stats?.status ?? 'error') : state;
  const healthy = status === 'healthy';

  return (
    <>
      <button
        type="button"
        className={styles.footLink}
        data-attention={!healthy && state !== 'loading'}
        onClick={() => setOpen(true)}
      >
        <i className={styles.statusDot} aria-hidden="true" />
        <span>{t('dashboard_live.archive')}</span>
        <span className={styles.footValue}>
          {index
            ? t('dashboard_live.archive_size', {
                size: formatArchiveSize(index.archivedBytes, i18n.language),
              })
            : '—'}
        </span>
        <span className={styles.footStatus}>{t(`request_archive.status_${status}`)}</span>
      </button>
      <Sheet
        open={open}
        size="lg"
        ariaLabel={t('request_archive.title')}
        onClose={() => setOpen(false)}
      >
        <div className={styles.archiveSheet}>
          <RequestArchivePanelContent
            stats={stats}
            state={state}
            onRefresh={() => void refresh()}
          />
        </div>
      </Sheet>
    </>
  );
}
