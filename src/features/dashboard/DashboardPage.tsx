import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/useAuthStore';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiClient } from '@/services/api/client';
import type { DashboardModel, DashboardWindow } from '@/services/api/dashboard';
import { useDashboardData } from './hooks/useDashboardData';
import { useRequestArchive } from './hooks/useRequestArchive';
import { baselinePerMinute, summarizeActivity, summarizeProviders } from './insights';
import { NowCard } from './components/NowCard';
import { TopModels } from './components/TopModels';
import { Providers } from './components/Providers';
import { ArchiveSummary } from './components/ArchiveSummary';
import { RequestBrowser } from './components/RequestSheets';
import styles from './dashboard.module.scss';

const EMPTY_MODELS: DashboardModel[] = [];

export function DashboardPage() {
  const connection = useAuthStore((state) => state.apiBase);
  useAuthStore((state) => state.managementKey);
  const revision = apiClient.getConnectionRevision();
  // Remount local controls and sheets when the authenticated connection changes.
  return <DashboardContent key={`${connection}\u0000${revision}`} />;
}

/**
 * Three questions, in the order an operator asks them: how busy is the proxy
 * right now, which models carry the load, and is any provider throttled.
 */
function DashboardContent() {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [timeWindow, setTimeWindow] = useState<DashboardWindow>('1h');
  const [requests, setRequests] = useState<{
    view: 'all' | 'failed';
    window: DashboardWindow;
  } | null>(null);
  const data = useDashboardData(timeWindow);
  const archive = useRequestArchive();
  const refreshData = data.refresh;
  const refreshArchive = archive.refresh;
  const refresh = useCallback(async () => {
    await Promise.allSettled([refreshData(), refreshArchive()]);
  }, [refreshData, refreshArchive]);
  useHeaderRefresh(refresh, connected);

  const models = data.routes?.models ?? EMPTY_MODELS;
  const activity = useMemo(
    () => (data.recent ? summarizeActivity(data.recent, baselinePerMinute(data.day)) : null),
    [data.recent, data.day]
  );
  // Rank affected models by the last 24 hours so a quiet hour does not hide what matters.
  const providers = useMemo(
    () => (data.routes ? summarizeProviders(models, data.day?.byModel) : null),
    [data.routes, models, data.day]
  );
  const stale = data.routesState === 'error' || data.trafficState === 'error';
  const observed = data.recent?.observedAt ?? data.routes?.observedAt ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <h1>{t('nav.dashboard')}</h1>
        <span className={styles.updated} data-stale={stale} role="status">
          <i className={styles.statusDot} aria-hidden="true" />
          {stale
            ? t('dashboard_live.stale')
            : observed
              ? t('dashboard_live.updated', {
                  time: new Date(observed).toLocaleTimeString(i18n.language, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }),
                })
              : t(`dashboard_live.state_${data.trafficState}`)}
        </span>
      </header>

      <NowCard
        activity={activity}
        observedAt={data.recent?.observedAt ?? null}
        hour={data.hour}
        trafficState={data.trafficState}
        trafficReceivedAt={data.trafficReceivedAt}
        providers={providers}
        runtimeKnown={data.routes?.runtimeKnown ?? true}
        routesObservedAt={data.routes?.observedAt ?? null}
        routesReceivedAt={data.routesReceivedAt}
        onShowFailures={() => setRequests({ view: 'failed', window: '1h' })}
      />

      <div className={styles.columns}>
        <TopModels
          summary={data.selected}
          models={models}
          window={timeWindow}
          onWindow={setTimeWindow}
          trafficState={data.trafficState}
          routesObservedAt={data.routes?.observedAt ?? null}
          routesReceivedAt={data.routesReceivedAt}
        />
        <Providers
          providers={providers}
          routesState={data.routesState}
          observedAt={data.routes?.observedAt ?? null}
          receivedAt={data.routesReceivedAt}
        />
      </div>

      <footer className={styles.pageFoot}>
        <button
          type="button"
          className={styles.footLink}
          disabled={data.trafficState === 'unsupported'}
          onClick={() => setRequests({ view: 'all', window: timeWindow })}
        >
          <span>{t('dashboard_live.request_history')}</span>
          <span aria-hidden="true">→</span>
        </button>
        <ArchiveSummary stats={archive.stats} state={archive.state} refresh={archive.refresh} />
      </footer>

      <RequestBrowser
        models={models}
        view={requests?.view ?? null}
        window={requests?.window ?? timeWindow}
        onClose={() => setRequests(null)}
      />
    </div>
  );
}
