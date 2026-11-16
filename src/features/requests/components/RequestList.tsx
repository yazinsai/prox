import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft } from '@/components/ui/icons';
import type { DashboardModel, DashboardRequest } from '@/services/api/dashboard';
import { modelLabel } from '@/utils/modelIdentity';
import {
  formatRequestDuration,
  formatRequestTime,
  isFailedRequest,
  providerLabels,
  requestReasonShort,
  requestStatusText,
} from '../format';
import styles from './RequestList.module.scss';

interface RequestListProps {
  requests: DashboardRequest[];
  models?: readonly DashboardModel[];
  /** Reference "today" for date prefixes; injectable for tests. */
  now?: Date;
  onSelect: (request: DashboardRequest) => void;
}

/**
 * Completed requests, newest first. Each row is one button so the whole line opens the request,
 * and its text reads in column order for screen readers; the column header is visual only.
 */
export function RequestList({ requests, models = [], now, onSelect }: RequestListProps) {
  const { t, i18n } = useTranslation();
  const labels = useMemo(() => providerLabels(models), [models]);
  const reference = now ?? new Date();

  return (
    <div className={styles.list}>
      <div className={styles.columns} aria-hidden="true">
        <span>{t('dashboard_live.time')}</span>
        <span>{t('dashboard_live.model')}</span>
        <span>{t('dashboard_live.provider')}</span>
        <span>{t('dashboard_live.status')}</span>
        <span className={styles.end}>{t('dashboard_live.duration')}</span>
        <span />
      </div>
      <ol className={styles.rows}>
        {requests.map((request) => {
          const failed = isFailedRequest(request);
          const reason = requestReasonShort(t, request);
          return (
            <li key={request.id}>
              <button
                type="button"
                className={styles.row}
                data-failed={failed}
                aria-haspopup="dialog"
                data-request-id={request.id}
                onClick={() => onSelect(request)}
              >
                <span className={styles.model}>{modelLabel(request.model, models) || '—'}</span>
                <span className={styles.meta}>
                  <span className={styles.time}>
                    <time
                      dateTime={request.completedAt}
                      title={new Date(request.completedAt).toLocaleString(i18n.language)}
                    >
                      {formatRequestTime(i18n.language, request.completedAt, reference)}
                    </time>
                  </span>
                  <span className={styles.provider}>
                    {labels.get(request.provider) || request.provider || '—'}
                  </span>
                </span>
                <span className={styles.status}>
                  <i className={styles.dot} aria-hidden="true" />
                  <span className={styles.code}>
                    {failed && request.outcome !== 'interrupted' ? (
                      <span className={styles.srOnly}>{t('dashboard_live.failed')} </span>
                    ) : null}
                    {requestStatusText(t, request)}
                  </span>
                  {reason ? <span className={styles.reason}>{reason}</span> : null}
                </span>
                <span className={styles.duration}>
                  {formatRequestDuration(t, i18n.language, request.durationMs)}
                </span>
                <span className={styles.chevron} aria-hidden="true">
                  <IconChevronLeft size={14} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
