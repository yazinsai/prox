import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { IconCheck, IconCopy } from '@/components/ui/icons';
import {
  dashboardApi,
  type DashboardModel,
  type DashboardRequest,
  type DashboardRequestDetail,
} from '@/services/api/dashboard';
import { apiClient } from '@/services/api/client';
import { logsApi } from '@/services/api/logs';
import { copyToClipboard } from '@/utils/clipboard';
import { downloadBlob } from '@/utils/download';
import { modelLabel } from '@/utils/modelIdentity';
import {
  formatRequestDuration,
  formatRequestTime,
  isFailedRequest,
  providerLabels,
  requestStatusText,
} from '../format';
import styles from './RequestDetailsSheet.module.scss';

interface RequestDetailsSheetProps {
  /** The request to show, or null when closed. */
  request: DashboardRequest | null;
  models?: readonly DashboardModel[];
  onClose: () => void;
}

/**
 * One request: the outcome and its cause first, then every provider attempt in order (the
 * fallback story), then identifiers for matching it against the server log.
 */
export function RequestDetailsSheet({ request, models = [], onClose }: RequestDetailsSheetProps) {
  // Keep the last request while the sheet animates closed.
  const [shown, setShown] = useState(request);
  if (request && request !== shown) setShown(request);
  return (
    <Sheet
      open={request !== null}
      size="md"
      onClose={onClose}
      eyebrow={shown ? <SheetEyebrow request={shown} /> : undefined}
      title={shown ? <SheetTitle request={shown} models={models} /> : undefined}
      footer={
        shown?.archiveRequestId ? <DownloadArchive key={shown.id} request={shown} /> : undefined
      }
    >
      {shown ? <RequestDetailsBody key={shown.id} request={shown} models={models} /> : null}
    </Sheet>
  );
}

function SheetEyebrow({ request }: { request: DashboardRequest }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {t('requests_page.request_at', {
        time: formatRequestTime(i18n.language, request.completedAt),
      })}
    </>
  );
}

function SheetTitle({
  request,
  models,
}: {
  request: DashboardRequest;
  models: readonly DashboardModel[];
}) {
  return <>{modelLabel(request.model, models) || request.model || '—'}</>;
}

function useRequestDetail(id: string) {
  const [detail, setDetail] = useState<DashboardRequestDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const revision = apiClient.getConnectionRevision();
    let active = true;
    setFailed(false);
    void dashboardApi
      .getRequest(id, controller.signal)
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
  }, [id, retry]);
  return { detail, failed, retry: () => setRetry((value) => value + 1) };
}

function RequestDetailsBody({
  request,
  models,
}: {
  request: DashboardRequest;
  models: readonly DashboardModel[];
}) {
  const { t, i18n } = useTranslation();
  const { detail, failed, retry } = useRequestDetail(request.id);
  const labels = useMemo(() => providerLabels(models), [models]);
  const value = detail ?? request;
  const lang = i18n.language;
  const providerName = (id: string) => labels.get(id) || id || '—';
  const requestFailed = isFailedRequest(value);
  const reason = value.reason ?? 'unknown';
  const attempts = detail?.attempts ?? [];

  return (
    <div className={styles.body}>
      <section
        className={styles.verdict}
        data-failed={requestFailed}
        aria-label={t('dashboard_live.status')}
      >
        <p className={styles.verdictLine}>
          <i className={styles.dot} aria-hidden="true" />
          <strong>
            {t(requestFailed ? 'requests_page.outcome_failed' : 'requests_page.outcome_success')}
          </strong>
          <span className={styles.verdictCode}>{requestStatusText(t, value)}</span>
        </p>
        {requestFailed ? (
          <p className={styles.verdictReason}>{t(`dashboard_live.reason_${reason}`)}</p>
        ) : null}
        <dl className={styles.facts}>
          <div>
            <dt>{t('dashboard_live.provider')}</dt>
            <dd>{providerName(value.provider)}</dd>
          </div>
          <div>
            <dt>{t('dashboard_live.duration')}</dt>
            <dd className={styles.numeric}>{formatRequestDuration(t, lang, value.durationMs)}</dd>
          </div>
          <div>
            <dt>{t('dashboard_live.started')}</dt>
            <dd className={styles.numeric}>
              <time
                dateTime={value.startedAt}
                title={new Date(value.startedAt).toLocaleString(lang)}
              >
                {formatRequestTime(lang, value.startedAt)}
              </time>
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby={`attempts-${request.id}`}>
        <h3 id={`attempts-${request.id}`}>
          {t('dashboard_live.attempts')}
          {attempts.length > 0 ? <span className={styles.count}>{attempts.length}</span> : null}
        </h3>
        {failed ? (
          <div className={styles.inlineError} role="alert">
            <p>{t('requests_page.detail_error')}</p>
            <Button variant="secondary" size="sm" onClick={retry}>
              {t('dashboard_live.retry')}
            </Button>
          </div>
        ) : !detail ? (
          <p className={styles.muted} role="status">
            {t('requests_page.loading_attempts')}
          </p>
        ) : attempts.length === 0 ? (
          <p className={styles.muted}>{t('requests_page.no_attempts')}</p>
        ) : (
          <ol className={styles.attempts}>
            {attempts.map((attempt, index) => {
              const attemptFailed = isFailedRequest(attempt);
              return (
                <li key={attempt.id} data-failed={attemptFailed}>
                  <span className={styles.step} aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className={styles.attemptMain}>
                    <span>{providerName(attempt.provider)}</span>
                    <small>
                      {modelLabel(attempt.model, models) || attempt.model}
                      {attemptFailed && attempt.reason && attempt.reason !== 'unknown'
                        ? ` · ${t(`dashboard_live.reason_${attempt.reason}`)}`
                        : ''}
                    </small>
                  </span>
                  <span className={styles.attemptMeta}>
                    <span className={styles.attemptStatus}>
                      <i className={styles.dot} aria-hidden="true" />
                      {requestStatusText(t, attempt)}
                    </span>
                    <small className={styles.numeric}>
                      {formatRequestDuration(t, lang, attempt.durationMs)}
                    </small>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className={styles.section} aria-labelledby={`ids-${request.id}`}>
        <h3 id={`ids-${request.id}`}>{t('requests_page.identifiers')}</h3>
        <dl className={styles.ids}>
          <IdentifierRow label={t('dashboard_live.request_id')} value={value.id} />
          <IdentifierRow label={t('dashboard_live.trace_id')} value={value.traceId} />
        </dl>
      </section>
    </div>
  );
}

function IdentifierRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    if (!(await copyToClipboard(value))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <code className={styles.identifier}>{value || '—'}</code>
        {value ? (
          <button
            type="button"
            className={styles.copy}
            aria-label={t('requests_page.copy_value', { label })}
            onClick={() => void copy()}
          >
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
          </button>
        ) : null}
        <span className={styles.srOnly} role="status">
          {copied ? t('auth_login.copied') : ''}
        </span>
      </dd>
    </div>
  );
}

function DownloadArchive({ request }: { request: DashboardRequest }) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(false);
  const archiveId = request.archiveRequestId;
  if (!archiveId) return null;
  const download = async () => {
    if (downloading) return;
    const revision = apiClient.getConnectionRevision();
    setDownloading(true);
    setError(false);
    try {
      const response = await logsApi.downloadRequestLogById(archiveId, {
        captureConnection: true,
      });
      if (revision === apiClient.getConnectionRevision())
        downloadBlob({ filename: `request-${archiveId}.log`, blob: response.data });
    } catch {
      if (revision === apiClient.getConnectionRevision()) setError(true);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div className={styles.footer}>
      {error ? (
        <p className={styles.footerError} role="alert">
          {t('requests_page.download_error')}
        </p>
      ) : null}
      <Button variant="secondary" loading={downloading} onClick={() => void download()}>
        {t('dashboard_live.download_archive')}
      </Button>
    </div>
  );
}
