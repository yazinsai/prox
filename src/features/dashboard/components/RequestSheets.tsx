import { modelLabel } from '@/utils/modelIdentity';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import {
  dashboardApi,
  type DashboardModel,
  type DashboardRequest,
  type DashboardRequestDetail,
  type DashboardRequests as RequestFeed,
  type DashboardWindow,
} from '@/services/api/dashboard';
import { apiClient } from '@/services/api/client';
import { logsApi } from '@/services/api/logs';
import { downloadBlob } from '@/utils/download';
import styles from './RequestSheets.module.scss';

interface BrowserProps {
  models?: DashboardModel[];
  /** Which list to open, or null when the browser is closed. */
  view: 'all' | 'failed' | null;
  window: DashboardWindow;
  onClose: () => void;
}

/** Request history and single-request details, opened on demand from the dashboard. */
export function RequestBrowser({ models = [], view, window: timeWindow, onClose }: BrowserProps) {
  const [selected, setSelected] = useState<DashboardRequest | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(view === 'failed');
  const [opened, setOpened] = useState(view);
  if (view !== opened) {
    setOpened(view);
    if (view) setErrorsOnly(view === 'failed');
  }

  return (
    <>
      {view && !selected ? (
        <RequestHistory
          key={timeWindow}
          models={models}
          timeWindow={timeWindow}
          errorsOnly={errorsOnly}
          onErrorsOnly={setErrorsOnly}
          onClose={onClose}
          onSelect={setSelected}
        />
      ) : null}
      {selected ? (
        <RequestDetails key={selected.id} request={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

export function RequestTable({
  requests,
  onSelect,
  models = [],
}: {
  requests: DashboardRequest[];
  models?: DashboardModel[];
  onSelect: (request: DashboardRequest) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className={styles.tableWrap}>
      <table className={styles.requestTable}>
        <thead>
          <tr>
            {['time', 'model', 'provider', 'status', 'duration'].map((key) => (
              <th key={key} scope="col">
                {t(`dashboard_live.${key}`)}
              </th>
            ))}
            <th scope="col">
              <span className={styles.srOnly}>{t('dashboard_live.request_details')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id} data-failed={request.outcome !== 'success'}>
              <td className={styles.requestTime}>
                <time
                  dateTime={request.completedAt}
                  title={new Date(request.completedAt).toLocaleString(i18n.language)}
                >
                  {new Date(request.completedAt).toLocaleTimeString(i18n.language, {
                    hour12: false,
                  })}
                </time>
              </td>
              <td>
                <button
                  type="button"
                  className={styles.requestLink}
                  onClick={() => onSelect(request)}
                >
                  {modelLabel(request.model, models) || '—'}
                </button>
              </td>
              <td>
                {models
                  .flatMap((model) => model.routes)
                  .find((route) => route.provider === request.provider)?.providerLabel ||
                  request.provider ||
                  '—'}
              </td>
              <td>
                <span className={styles.requestStatus} data-failed={request.outcome !== 'success'}>
                  <i className={styles.dot} aria-hidden="true" />
                  {request.outcome === 'interrupted'
                    ? t('dashboard_live.interrupted')
                    : request.statusCode || '—'}
                </span>
              </td>
              <td className={styles.duration}>
                {t('dashboard_live.seconds', {
                  seconds: (request.durationMs / 1000).toLocaleString(i18n.language, {
                    maximumFractionDigits: 1,
                  }),
                })}
              </td>
              <td>
                <button
                  type="button"
                  className={styles.textButton}
                  aria-label={t('dashboard_live.open_request', { id: request.id })}
                  onClick={() => onSelect(request)}
                >
                  <span aria-hidden="true">↗</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// These sheets are mounted for one interaction. Restore focus when the owner
// unmounts after the shared Sheet finishes its closing animation.
function useRestoreOpenerFocus() {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
}

function RequestHistory({
  models,
  timeWindow,
  errorsOnly,
  onErrorsOnly,
  onClose,
  onSelect,
}: {
  models: DashboardModel[];
  timeWindow: DashboardWindow;
  errorsOnly: boolean;
  onErrorsOnly: (value: boolean) => void;
  onClose: () => void;
  onSelect: (request: DashboardRequest) => void;
}) {
  const { t } = useTranslation();
  useRestoreOpenerFocus();
  const [cursor, setCursor] = useState<string | null>(null);
  const [feed, setFeed] = useState<RequestFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const revision = apiClient.getConnectionRevision();
    let active = true;
    setLoading(true);
    setFailed(false);
    setFeed(null);
    void dashboardApi
      .getRequests(
        { window: timeWindow, outcome: errorsOnly ? 'failed' : 'all', cursor, limit: 50 },
        controller.signal
      )
      .then((result) => {
        if (active && revision === apiClient.getConnectionRevision()) setFeed(result);
      })
      .catch(() => {
        if (active && !controller.signal.aborted && revision === apiClient.getConnectionRevision())
          setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [timeWindow, errorsOnly, cursor, retry]);

  return (
    <Sheet
      open
      size="xl"
      title={t('dashboard_live.request_history')}
      description={t('dashboard_live.completed_requests')}
      onClose={onClose}
    >
      <div className={styles.historyFilter}>
        <div
          className={styles.segmented}
          role="group"
          aria-label={t('dashboard_live.request_filter')}
        >
          {[false, true].map((value) => (
            <button
              type="button"
              key={String(value)}
              aria-pressed={errorsOnly === value}
              onClick={() => {
                setCursor(null);
                onErrorsOnly(value);
              }}
            >
              {t(value ? 'dashboard_live.errors' : 'dashboard_live.all')}
            </button>
          ))}
        </div>
        <span>
          {timeWindow === '1h'
            ? t('dashboard_live.window_hour')
            : t('dashboard_live.window', { hours: Number(timeWindow.slice(0, -1)) })}
        </span>
      </div>
      {loading ? (
        <p className={styles.empty} role="status">
          {t('dashboard_live.state_loading')}
        </p>
      ) : failed ? (
        <div className={styles.empty}>
          <p role="status">{t('dashboard_live.state_error')}</p>
          <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>
            {t('dashboard_live.retry')}
          </Button>
        </div>
      ) : (
        <RequestTable requests={feed?.requests ?? []} onSelect={onSelect} models={models} />
      )}
      {!loading && !failed && !feed?.requests.length ? (
        <p className={styles.empty}>
          {t(errorsOnly ? 'dashboard_live.no_errors' : 'dashboard_live.no_requests')}
        </p>
      ) : null}
      <div className={styles.historyActions}>
        <Button variant="secondary" disabled={loading || !cursor} onClick={() => setCursor(null)}>
          {t('dashboard_live.first_page')}
        </Button>
        <Button
          variant="secondary"
          disabled={loading || !feed?.nextCursor}
          onClick={() => setCursor(feed?.nextCursor ?? null)}
        >
          {t('dashboard_live.next_page')}
        </Button>
      </div>
    </Sheet>
  );
}

function RequestDetails({ request, onClose }: { request: DashboardRequest; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  useRestoreOpenerFocus();
  const [detail, setDetail] = useState<DashboardRequestDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const revision = apiClient.getConnectionRevision();
    let active = true;
    setFailed(false);
    void dashboardApi
      .getRequest(request.id, controller.signal)
      .then((result) => {
        if (active && revision === apiClient.getConnectionRevision()) setDetail(result);
      })
      .catch(() => {
        if (active && !controller.signal.aborted && revision === apiClient.getConnectionRevision())
          setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [request.id, retry]);
  const download = async () => {
    if (!detail?.archiveRequestId || downloading) return;
    const revision = apiClient.getConnectionRevision();
    setDownloading(true);
    setDownloadError(false);
    try {
      const response = await logsApi.downloadRequestLogById(detail.archiveRequestId, {
        captureConnection: true,
      });
      if (revision === apiClient.getConnectionRevision())
        downloadBlob({ filename: `request-${detail.archiveRequestId}.log`, blob: response.data });
    } catch {
      if (revision === apiClient.getConnectionRevision()) setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };
  const value = detail ?? request;
  const status =
    value.outcome === 'interrupted'
      ? t('dashboard_live.interrupted')
      : String(value.statusCode || '—');
  return (
    <Sheet
      open
      title={t('dashboard_live.request_details')}
      description={value.model}
      onClose={onClose}
      footer={
        detail?.archiveRequestId ? (
          <Button variant="secondary" loading={downloading} onClick={() => void download()}>
            {t('dashboard_live.download_archive')}
          </Button>
        ) : undefined
      }
    >
      <dl className={styles.detailList}>
        {[
          ['request_id', value.id],
          ['trace_id', value.traceId || '—'],
          ['provider', value.provider || '—'],
          ['status', status],
          ['started', new Date(value.startedAt).toLocaleString(i18n.language)],
          ['completed', new Date(value.completedAt).toLocaleString(i18n.language)],
          [
            'duration',
            t('dashboard_live.seconds', {
              seconds: (value.durationMs / 1000).toLocaleString(i18n.language, {
                maximumFractionDigits: 1,
              }),
            }),
          ],
          ['reason', t(`dashboard_live.reason_${value.reason ?? 'unknown'}`)],
        ].map(([key, text]) => (
          <div key={key}>
            <dt>{t(`dashboard_live.${key}`)}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      {failed ? (
        <div className={styles.detailError}>
          <p>{t('dashboard_live.state_error')}</p>
          <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>
            {t('dashboard_live.retry')}
          </Button>
        </div>
      ) : detail ? (
        <section className={styles.attempts}>
          <h3>{t('dashboard_live.attempts')}</h3>
          <ul>
            {detail.attempts.map((attempt) => (
              <li key={attempt.id}>
                <span>
                  {attempt.provider || '—'}
                  <br />
                  <small>{attempt.model}</small>
                </span>
                <span>
                  {attempt.outcome === 'interrupted'
                    ? t('dashboard_live.interrupted')
                    : attempt.statusCode || '—'}{' '}
                  ·{' '}
                  {t('dashboard_live.seconds', {
                    seconds: (attempt.durationMs / 1000).toLocaleString(i18n.language, {
                      maximumFractionDigits: 1,
                    }),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className={styles.empty} role="status">
          {t('dashboard_live.state_loading')}
        </p>
      )}
      {downloadError ? (
        <p className={styles.detailError} role="status">
          {t('dashboard_live.state_error')}
        </p>
      ) : null}
    </Sheet>
  );
}
