import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconInbox,
  IconScrollText,
} from '@/components/ui/icons';
import type { DashboardRequest, DashboardSummary, DashboardWindow } from '@/services/api/dashboard';
import { REQUEST_WINDOWS, type RequestsStatus, type RequestsView } from '../params';
import type { RequestHistoryState } from '../hooks/useRequestHistory';
import { RequestList } from './RequestList';
import { RequestDetailsSheet } from './RequestDetailsSheet';
import styles from '../RequestsPage.module.scss';

const SKELETON_ROWS = 8;
const windowHours = (window: DashboardWindow) => Number(window.slice(0, -1));

interface RequestHistoryProps {
  view: RequestsView;
  history: RequestHistoryState;
  onChange: (change: Partial<RequestsView>) => void;
}

/** Completed requests for a window, filterable to failures, each one openable. */
export function RequestHistory({ view, history, onChange }: RequestHistoryProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<DashboardRequest | null>(null);
  const { state, requests, pending } = history;
  const showList = state === 'ready' && requests.length > 0;

  return (
    <>
      <div className={styles.toolbar}>
        <Segmented
          label={t('dashboard_live.request_filter')}
          options={(['all', 'failed'] as RequestsStatus[]).map((status) => ({
            value: status,
            label: t(status === 'failed' ? 'dashboard_live.failed' : 'dashboard_live.all'),
          }))}
          value={view.status}
          onChange={(status) => onChange({ status })}
        />
        <Segmented
          label={t('dashboard_live.time_window')}
          options={REQUEST_WINDOWS.map((window) => ({
            value: window,
            label: t('dashboard_live.short_window', { hours: windowHours(window) }),
            title:
              window === '1h'
                ? t('dashboard_live.window_hour')
                : t('dashboard_live.window', { hours: windowHours(window) }),
          }))}
          value={view.window}
          onChange={(window) => onChange({ window })}
        />
      </div>

      <section
        className={styles.card}
        aria-label={t('dashboard_live.request_history')}
        aria-busy={state === 'loading' || pending || history.refreshing}
      >
        <header className={styles.cardHead}>
          <Summary summary={history.summary} view={view} state={state} />
          <Freshness history={history} />
        </header>

        <div className={styles.cardBody} data-pending={pending}>
          {state === 'loading' ? (
            <div className={styles.skeleton} role="status" aria-label={t('requests_page.loading')}>
              {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <div key={index} className={styles.skeletonRow}>
                  <Skeleton height={12} width={72} />
                  <Skeleton height={12} width={`${48 + ((index * 17) % 30)}%`} />
                  <Skeleton height={12} width={40} />
                </div>
              ))}
            </div>
          ) : state === 'unsupported' ? (
            <StatePanel
              icon={<IconScrollText size={18} />}
              title={t('requests_page.unsupported_title')}
              description={t('requests_page.unsupported_desc')}
              action={
                <Button variant="secondary" size="sm" onClick={() => onChange({ tab: 'server' })}>
                  {t('requests_page.open_server_log')}
                </Button>
              }
            />
          ) : state === 'error' ? (
            <StatePanel
              tone="error"
              icon={<IconAlertTriangle size={18} />}
              title={t('requests_page.error_title')}
              description={t('requests_page.error_desc')}
              action={
                <Button variant="secondary" size="sm" onClick={() => void history.refresh()}>
                  {t('dashboard_live.retry')}
                </Button>
              }
            />
          ) : state === 'disconnected' ? (
            <StatePanel
              icon={<IconInbox size={18} />}
              title={t('dashboard_live.state_disconnected')}
            />
          ) : !showList ? (
            <EmptyHistory view={view} onChange={onChange} />
          ) : (
            <RequestList requests={requests} models={history.models} onSelect={setSelected} />
          )}
        </div>

        {showList ? <ListFooter view={view} history={history} /> : null}
      </section>

      <RequestDetailsSheet
        request={selected}
        models={history.models}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          title={option.title}
          aria-label={option.title}
          aria-pressed={value === option.value}
          onClick={() => {
            if (value !== option.value) onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Summary({
  summary,
  view,
  state,
}: {
  summary: DashboardSummary | null;
  view: RequestsView;
  state: RequestHistoryState['state'];
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const hours = windowHours(view.window);
  const scope = view.window === '1h' ? 'hour' : 'hours';

  if (!summary) {
    // Totals are optional; without them the window alone still says what is listed.
    return (
      <div className={styles.summary}>
        {state === 'loading' ? (
          <Skeleton height={14} width={220} />
        ) : (
          <span className={styles.summaryTotal}>
            {view.window === '1h'
              ? t('dashboard_live.window_hour')
              : t('dashboard_live.window', { hours })}
          </span>
        )}
      </div>
    );
  }

  if (summary.total === 0) {
    return (
      <div className={styles.summary}>
        <span className={styles.summaryTotal}>
          {t(`requests_page.summary_none_${scope}`, { hours })}
        </span>
      </div>
    );
  }

  const rate = (summary.success / summary.total) * 100;
  const since = summary.partial
    ? new Date(summary.coverageStart).toLocaleTimeString(lang, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null;
  return (
    <div className={styles.summary}>
      <span className={styles.summaryTotal}>
        {t(`requests_page.summary_${scope}`, {
          count: summary.total,
          total: summary.total.toLocaleString(lang),
          hours,
        })}
      </span>
      <span className={styles.summaryParts}>
        <span className={styles.summaryPart} data-failed={summary.failed > 0}>
          {t('dashboard_live.failed_count', { count: summary.failed })}
        </span>
        <span className={styles.summaryPart}>
          {t('requests_page.success_rate', {
            rate: rate.toLocaleString(lang, { maximumFractionDigits: rate >= 99.5 ? 1 : 0 }),
          })}
        </span>
        {since ? (
          <span className={styles.summaryPart}>
            {t('requests_page.recorded_since', { time: since })}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function Freshness({ history }: { history: RequestHistoryState }) {
  const { t, i18n } = useTranslation();
  if (history.state !== 'ready') return null;
  const text =
    history.refreshing || history.pending
      ? t('requests_page.refreshing')
      : history.observedAt
        ? t('dashboard_live.updated', {
            time: new Date(history.observedAt).toLocaleTimeString(i18n.language, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: false,
            }),
          })
        : null;
  return text ? <span className={styles.freshness}>{text}</span> : null;
}

function EmptyHistory({
  view,
  onChange,
}: {
  view: RequestsView;
  onChange: (change: Partial<RequestsView>) => void;
}) {
  const { t } = useTranslation();
  const hours = windowHours(view.window);
  const scope = view.window === '1h' ? 'hour' : 'hours';
  if (view.status === 'failed') {
    return (
      <StatePanel
        tone="success"
        icon={<IconCheckCircle2 size={18} />}
        title={t(`requests_page.no_failures_${scope}`, { hours })}
        description={t('requests_page.no_failures_desc')}
        action={
          <Button variant="secondary" size="sm" onClick={() => onChange({ status: 'all' })}>
            {t('requests_page.show_all')}
          </Button>
        }
      />
    );
  }
  return (
    <StatePanel
      icon={<IconInbox size={18} />}
      title={t(`requests_page.summary_none_${scope}`, { hours })}
      description={t('requests_page.no_requests_desc')}
      action={
        view.window !== '24h' ? (
          <Button variant="secondary" size="sm" onClick={() => onChange({ window: '24h' })}>
            {t('requests_page.widen_window')}
          </Button>
        ) : undefined
      }
    />
  );
}

function ListFooter({ view, history }: { view: RequestsView; history: RequestHistoryState }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const shown = history.requests.length;
  const total = history.summary
    ? view.status === 'failed'
      ? history.summary.failed
      : history.summary.total
    : null;
  const count =
    total !== null && total >= shown
      ? t('requests_page.showing_of', {
          shown: shown.toLocaleString(lang),
          total: total.toLocaleString(lang),
        })
      : t('requests_page.showing', { count: shown, shown: shown.toLocaleString(lang) });

  return (
    <footer className={styles.cardFoot}>
      <span className={styles.footCount} aria-live="polite">
        {count}
      </span>
      {history.loadMoreFailed ? (
        <span className={styles.footError} role="alert">
          {t('requests_page.load_more_error')}
        </span>
      ) : null}
      {history.hasMore ? (
        <Button
          variant="secondary"
          size="sm"
          loading={history.loadingMore}
          disabled={history.pending}
          onClick={history.loadMore}
        >
          {history.loadMoreFailed ? t('dashboard_live.retry') : t('requests_page.load_older')}
        </Button>
      ) : (
        <span className={styles.footEnd}>{t('requests_page.end_of_list')}</span>
      )}
    </footer>
  );
}

function StatePanel({
  icon,
  title,
  description,
  action,
  tone,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: 'success' | 'error';
}) {
  return (
    <div className={styles.state} data-tone={tone} role={tone === 'error' ? 'alert' : undefined}>
      <span className={styles.stateIcon} aria-hidden="true">
        {icon}
      </span>
      <p className={styles.stateTitle}>{title}</p>
      {description ? <p className={styles.stateDesc}>{description}</p> : null}
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </div>
  );
}
