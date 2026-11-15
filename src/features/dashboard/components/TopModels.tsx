import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import type {
  DashboardLoadState,
  DashboardModel,
  DashboardSummary,
  DashboardWindow,
} from '@/services/api/dashboard';
import { collapseRoutes, topModels } from '../insights';
import { formatPercent } from '../format';
import { RouteChips, RouteLegend } from './RouteChips';
import styles from '../dashboard.module.scss';

const WINDOWS: DashboardWindow[] = ['1h', '8h', '24h'];
const LIMIT = 5;

interface Props {
  summary: DashboardSummary | null;
  models: DashboardModel[];
  window: DashboardWindow;
  onWindow: (value: DashboardWindow) => void;
  trafficState: DashboardLoadState;
  routesObservedAt: string | null;
  routesReceivedAt: number | null;
}

export function TopModels({
  summary,
  models,
  window: timeWindow,
  onWindow,
  trafficState,
  routesObservedAt,
  routesReceivedAt,
}: Props) {
  const { t, i18n } = useTranslation();
  const [browsing, setBrowsing] = useState(false);
  const rows = useMemo(() => topModels(summary, models, LIMIT), [summary, models]);
  const lead = rows[0]?.total ?? 0;

  return (
    <section className={styles.card} aria-labelledby="dashboard-models-title">
      <header className={styles.cardHead}>
        <h2 id="dashboard-models-title">{t('dashboard_live.models_title')}</h2>
        <div className={styles.segmented} role="group" aria-label={t('dashboard_live.time_window')}>
          {WINDOWS.map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={timeWindow === value}
              onClick={() => onWindow(value)}
            >
              {t('dashboard_live.short_window', { hours: Number(value.slice(0, -1)) })}
            </button>
          ))}
        </div>
      </header>

      {rows.length ? (
        <ol className={styles.models} aria-busy={summary?.window !== timeWindow}>
          {rows.map((row) => (
            <li key={row.id} className={styles.modelRow}>
              <div className={styles.modelLine}>
                <span className={styles.modelName} title={row.id}>
                  {row.label}
                </span>
                {row.failed > 0 ? (
                  <span className={styles.modelFailed}>
                    {t('dashboard_live.failed_count', { count: row.failed })}
                  </span>
                ) : null}
                <span className={styles.modelCount}>{row.total.toLocaleString(i18n.language)}</span>
                <span className={styles.modelShare}>
                  {formatPercent(row.share, i18n.language)}%
                </span>
              </div>
              <span className={styles.shareTrack} aria-hidden="true">
                <span style={{ width: `${lead ? (row.total / lead) * 100 : 0}%` }} />
              </span>
              <RouteChips
                routes={row.routes}
                observedAt={routesObservedAt}
                receivedAt={routesReceivedAt}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>
          {summary ? t('dashboard_live.no_requests') : t(`dashboard_live.state_${trafficState}`)}
        </p>
      )}

      <footer className={styles.cardFoot}>
        <RouteLegend />
        <button
          type="button"
          className={styles.textButton}
          disabled={!models.length}
          onClick={() => setBrowsing(true)}
        >
          {t('dashboard_live.all_models', { count: models.length })}
          <span aria-hidden="true"> →</span>
        </button>
      </footer>

      {browsing ? (
        <AllModels
          models={models}
          summary={summary}
          window={timeWindow}
          onClose={() => setBrowsing(false)}
          routesObservedAt={routesObservedAt}
          routesReceivedAt={routesReceivedAt}
        />
      ) : null}
    </section>
  );
}

function AllModels({
  models,
  summary,
  window: timeWindow,
  onClose,
  routesObservedAt,
  routesReceivedAt,
}: {
  models: DashboardModel[];
  summary: DashboardSummary | null;
  window: DashboardWindow;
  onClose: () => void;
  routesObservedAt: string | null;
  routesReceivedAt: number | null;
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const usage = useMemo(
    () => new Map((summary?.byModel ?? []).map((row) => [row.id, row.total])),
    [summary]
  );
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models
      .filter(
        (model) =>
          !needle ||
          model.label.toLowerCase().includes(needle) ||
          model.id.toLowerCase().includes(needle) ||
          model.routes.some((route) => route.providerLabel.toLowerCase().includes(needle))
      )
      .map((model) => ({
        model,
        requests: usage.get(model.id) ?? 0,
        routes: collapseRoutes(model.routes),
      }))
      .sort((a, b) => b.requests - a.requests || a.model.label.localeCompare(b.model.label));
  }, [models, usage, query]);

  return (
    <Sheet
      open
      size="lg"
      title={t('dashboard_live.all_models_title')}
      description={t('dashboard_live.default_policy')}
      onClose={onClose}
    >
      <input
        type="search"
        className={styles.search}
        value={query}
        placeholder={t('dashboard_live.filter_models')}
        aria-label={t('dashboard_live.filter_models')}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className={styles.catalogHead}>
        <span>{t('dashboard_live.model')}</span>
        <span>
          {t('dashboard_live.requests_in', {
            window:
              timeWindow === '1h'
                ? t('dashboard_live.window_hour')
                : t('dashboard_live.window', { hours: Number(timeWindow.slice(0, -1)) }),
          })}
        </span>
      </p>
      {rows.length ? (
        <ul className={styles.catalog}>
          {rows.map(({ model, requests, routes }) => (
            <li key={model.id}>
              <div className={styles.modelLine}>
                <span className={styles.modelName} title={model.id}>
                  {model.label}
                </span>
                <span className={styles.modelCount} data-zero={requests === 0}>
                  {requests.toLocaleString(i18n.language)}
                </span>
              </div>
              <RouteChips
                routes={routes}
                observedAt={routesObservedAt}
                receivedAt={routesReceivedAt}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{t('dashboard_live.no_match')}</p>
      )}
    </Sheet>
  );
}
