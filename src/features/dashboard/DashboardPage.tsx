import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore } from '@/stores/useAuthStore';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useRequestArchive } from './hooks/useRequestArchive';
import { useDashboardData } from './hooks/useDashboardData';
import { useDashboardCooldownClock } from './hooks/useDashboardCooldownClock';
import type { DashboardLoadState, DashboardModel, DashboardWindow } from '@/services/api/dashboard';
import { apiClient } from '@/services/api/client';
import { normalizeModelPins, pinStorageKey, readModelPins } from './modelPins';
import { ArchiveSummary } from './components/ArchiveSummary';
import { DashboardRequests } from './components/DashboardRequests';
import styles from './dashboard.module.scss';

const DASH = '—';
const EMPTY_MODELS: DashboardModel[] = [];
const WINDOWS: DashboardWindow[] = ['1h', '8h', '24h'];

export function DashboardPage() {
  const connection = useAuthStore((state) => state.apiBase);
  useAuthStore((state) => state.managementKey);
  const revision = apiClient.getConnectionRevision();
  // Remount local controls and drawers when the authenticated connection changes.
  return <DashboardContent key={`${connection}\u0000${revision}`} connection={connection} />;
}

function DashboardContent({ connection }: { connection: string }) {
  const { t, i18n } = useTranslation();
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const [timeWindow, setTimeWindow] = useState<DashboardWindow>('8h');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [grouping, setGrouping] = useState<'model' | 'provider'>('model');
  const [storedPins, setStoredPins] = useState<string[] | null>(() => readModelPins(connection));
  const [editingPins, setEditingPins] = useState(false);
  const [draftPins, setDraftPins] = useState<string[]>([]);
  const [storageFailed, setStorageFailed] = useState(false);
  const data = useDashboardData(timeWindow, errorsOnly ? 'failed' : 'all');
  const archive = useRequestArchive();
  const nowMs = useDashboardCooldownClock(connected);
  const refreshData = data.refresh;
  const refreshArchive = archive.refresh;
  const refresh = useCallback(async () => {
    await Promise.allSettled([refreshData(), refreshArchive()]);
  }, [refreshData, refreshArchive]);
  useHeaderRefresh(refresh, connected);

  const models = data.routes?.models ?? EMPTY_MODELS;
  const pins = storedPins ?? models.slice(0, 4).map((model) => model.id);
  const pinnedModels = pins.map(
    (id) =>
      models.find((model) => model.id === id) ?? {
        id,
        label: id,
        routes: [],
        lastUsedProvider: null,
      }
  );
  useEffect(() => {
    if (storedPins !== null || models.length === 0) return;
    const defaults = models.slice(0, 4).map((model) => model.id);
    setStoredPins(defaults);
    try {
      localStorage.setItem(pinStorageKey(connection), JSON.stringify(defaults));
    } catch {
      setStorageFailed(true);
    }
  }, [storedPins, models, connection]);
  const readyModels = pinnedModels.filter((model) =>
    model.routes.some((route) => route.status === 'ready' && route.readyCredentials > 0)
  ).length;
  const summary = data.summary;
  const breakdown = useMemo(() => {
    const rows = grouping === 'model' ? summary?.byModel : summary?.byProvider;
    return [...(rows ?? [])].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  }, [summary, grouping]);
  const count = (value: number | undefined) =>
    value === undefined ? DASH : value.toLocaleString(i18n.language);
  const percent = (value: number) =>
    value.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const rate = summary && summary.total > 0 ? (summary.success / summary.total) * 100 : null;
  const windowLabel =
    timeWindow === '1h'
      ? t('dashboard_live.window_hour')
      : t('dashboard_live.window', { hours: Number(timeWindow.slice(0, -1)) });
  const stateNote = (state: DashboardLoadState) => t(`dashboard_live.state_${state}`);
  const stale = data.routesState === 'error' || data.trafficState === 'error';
  const observation =
    data.routesState === 'error'
      ? data.routes?.observedAt
      : data.trafficState === 'error'
        ? summary?.observedAt
        : data.lastUpdate;
  const lastUpdate = observation ? new Date(observation).toLocaleTimeString(i18n.language) : null;
  const labelFor = (id: string) => {
    if (!id) return DASH;
    if (grouping === 'model') return models.find((model) => model.id === id)?.label || id;
    return (
      models.flatMap((model) => model.routes).find((route) => route.provider === id)
        ?.providerLabel || id
    );
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1>{t('nav.dashboard')}</h1>
          <p>{t('dashboard_live.description')}</p>
        </div>
        <div className={styles.pageActions}>
          <span className={styles.updated} role="status">
            <i className={styles.dot} aria-hidden="true" />
            {data.refreshing
              ? t('dashboard_live.refreshing')
              : lastUpdate
                ? t(stale ? 'dashboard_live.last_observed' : 'dashboard_live.updated', {
                    time: lastUpdate,
                  })
                : stateNote(data.trafficState)}
          </span>
          <Link to="/routing" className={styles.outlineLink}>
            {t('dashboard_live.manage_routing')} <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <section className={styles.panel} aria-labelledby="dashboard-routes-title">
        <header className={styles.panelHead}>
          <div className={styles.titleGroup}>
            <h2 id="dashboard-routes-title">{t('dashboard_live.active_providers')}</h2>
            {data.routes && pins.length > 0 ? (
              <span
                className={
                  data.routes.runtimeKnown &&
                  readyModels === pins.length &&
                  pins.length > 0 &&
                  !stale
                    ? styles.positive
                    : styles.muted
                }
              >
                <i className={styles.dot} aria-hidden="true" />
                {data.routesState === 'error'
                  ? t('dashboard_live.stale')
                  : data.routes.runtimeKnown
                    ? t('dashboard_live.models_ready', { ready: readyModels, total: pins.length })
                    : t('dashboard_live.status_unknown')}
              </span>
            ) : null}
          </div>
          <button
            className={styles.textButton}
            type="button"
            disabled={!data.routes || (models.length === 0 && pins.length === 0)}
            onClick={() => {
              setDraftPins(pins);
              setEditingPins(true);
            }}
          >
            {t('dashboard_live.edit_pins')}
          </button>
        </header>
        <div className={styles.routeColumns} aria-hidden="true">
          <span>{t('dashboard_live.model')}</span>
          <span>{t('dashboard_live.ready_priority')}</span>
          <span>{t('dashboard_live.other_routes')}</span>
          <span>{t('dashboard_live.last_used')}</span>
        </div>
        {data.routesState !== 'ready' ? (
          <p className={styles.notice} role="status">
            {stateNote(data.routesState)}
            {data.routes && data.routesState === 'error'
              ? ` · ${t('dashboard_live.last_observed', { time: new Date(data.routes.observedAt).toLocaleTimeString(i18n.language) })}`
              : ''}
          </p>
        ) : null}
        {pinnedModels.length === 0 && data.routes ? (
          <p className={styles.empty}>
            {t(models.length === 0 ? 'dashboard_live.no_models' : 'dashboard_live.no_pins')}
          </p>
        ) : null}
        <ul className={styles.routeList}>
          {pinnedModels.map((model) => {
            const ready = model.routes.filter(
              (route) => route.status === 'ready' && route.readyCredentials > 0
            );
            const others = model.routes.filter((route) => !ready.includes(route));
            return (
              <li className={styles.routeRow} key={model.id}>
                <div className={styles.modelName}>
                  <strong>{model.label}</strong>
                  <code>{model.id}</code>
                </div>
                <div className={styles.readyRoutes}>
                  <span className={styles.mobileLabel}>{t('dashboard_live.ready_priority')}</span>
                  {ready.length ? (
                    ready.map((route) => (
                      <span
                        className={styles.routeChip}
                        key={`${route.provider}:${route.priority}`}
                      >
                        <i className={styles.dot} aria-hidden="true" />
                        {route.providerLabel}
                        <span className={styles.credentialCount}>
                          {count(route.readyCredentials)}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className={styles.muted}>
                      {t(
                        !data.routes?.runtimeKnown || !model.routes.length
                          ? 'dashboard_live.status_unknown'
                          : 'dashboard_live.no_ready'
                      )}
                    </span>
                  )}
                </div>
                <div className={styles.otherRoutes}>
                  <span className={styles.mobileLabel}>{t('dashboard_live.other_routes')}</span>
                  {others.length ? (
                    others.map((route) => {
                      const seconds = route.retryAt
                        ? Math.max(0, Math.ceil((Date.parse(route.retryAt) - nowMs) / 1000))
                        : null;
                      const status =
                        route.status === 'cooling' && seconds === 0 ? 'unknown' : route.status;
                      return (
                        <span
                          key={`${route.provider}:${route.priority}`}
                          className={status === 'cooling' ? styles.warning : ''}
                        >
                          {route.providerLabel}
                          <span className={status === 'cooling' ? styles.warning : styles.muted}>
                            {' '}
                            · {t(`dashboard_live.route_${status}`)}
                            {status === 'cooling' && seconds !== null
                              ? ` ${t('dashboard_live.minutes', { minutes: Math.max(1, Math.ceil(seconds / 60)) })}`
                              : ''}
                          </span>
                        </span>
                      );
                    })
                  ) : (
                    <span className={styles.muted}>{t('dashboard_live.no_other_routes')}</span>
                  )}
                </div>
                <span className={styles.lastUsed}>
                  <span className={styles.mobileLabel}>{t('dashboard_live.last_used')}</span>
                  {model.routes.find((route) => route.provider === model.lastUsedProvider)
                    ?.providerLabel ||
                    model.lastUsedProvider ||
                    DASH}
                </span>
              </li>
            );
          })}
        </ul>
        <footer className={styles.panelFooter}>
          <span>{t('dashboard_live.route_legend')}</span>
          <span title={t('dashboard_live.default_policy')}>{t('dashboard_live.auto_refresh')}</span>
        </footer>
      </section>

      <section
        className={styles.summary}
        aria-label={t('dashboard_live.request_summary')}
        aria-busy={data.refreshing}
      >
        <div className={styles.kpi}>
          <span>
            {t('dashboard_live.requests')} <small>{windowLabel}</small>
          </span>
          <strong>{count(summary?.total)}</strong>
        </div>
        <div className={styles.kpi}>
          <span>{t('dashboard_live.succeeded')}</span>
          <strong>{count(summary?.success)}</strong>
        </div>
        <button
          type="button"
          className={`${styles.kpi} ${styles.failedKpi}`}
          aria-pressed={errorsOnly}
          onClick={() => setErrorsOnly((value) => !value)}
        >
          <span>
            {t('dashboard_live.failed')} <span aria-hidden="true">↗</span>
          </span>
          <div>
            <strong className={summary?.failed ? styles.negative : ''}>
              {count(summary?.failed)}
            </strong>
            {summary && summary.total > 0 ? (
              <small>{percent((summary.failed / summary.total) * 100)}%</small>
            ) : null}
          </div>
        </button>
        <div className={styles.kpi}>
          <span>{t('dashboard.success_rate')}</span>
          <strong>
            {rate === null ? (
              DASH
            ) : (
              <>
                {percent(rate)}
                <em>%</em>
              </>
            )}
          </strong>
        </div>
        <div className={styles.segmented} role="group" aria-label={t('dashboard_live.time_window')}>
          {WINDOWS.map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={timeWindow === value}
              onClick={() => setTimeWindow(value)}
            >
              {t('dashboard_live.short_window', { hours: Number(value.slice(0, -1)) })}
            </button>
          ))}
        </div>
      </section>
      {data.trafficState !== 'ready' ? (
        <p className={styles.notice} role="status">
          {stateNote(data.trafficState)}
          {summary
            ? ` · ${t('dashboard_live.last_observed', { time: new Date(summary.observedAt).toLocaleTimeString(i18n.language) })}`
            : ''}
        </p>
      ) : null}
      {summary?.partial ? (
        <p className={styles.coverage}>
          {t('dashboard_live.coverage', {
            time: new Date(summary.coverageStart).toLocaleString(i18n.language),
          })}
        </p>
      ) : null}

      <div className={styles.activityGrid}>
        <DashboardRequests
          models={models}
          feed={data.requests}
          state={data.trafficState}
          window={timeWindow}
          errorsOnly={errorsOnly}
          onErrorsOnly={setErrorsOnly}
        />
        <ArchiveSummary stats={archive.stats} state={archive.state} refresh={archive.refresh} />
      </div>
      <section className={styles.panel} aria-labelledby="dashboard-breakdown-title">
        <header className={styles.panelHead}>
          <div className={styles.titleGroup}>
            <h2 id="dashboard-breakdown-title">
              {t(grouping === 'model' ? 'dashboard_live.by_model' : 'dashboard_live.by_provider')}
            </h2>
            <span className={styles.muted}>
              {windowLabel} · {summary ? t('dashboard_live.total', { count: summary.total }) : DASH}
            </span>
          </div>
          <div className={styles.segmented} role="group" aria-label={t('dashboard_live.group_by')}>
            {(['model', 'provider'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={grouping === value}
                onClick={() => setGrouping(value)}
              >
                {t(`dashboard_live.${value}`)}
              </button>
            ))}
          </div>
        </header>
        <ul className={styles.breakdownList}>
          {breakdown.map((row) => (
            <li className={styles.breakdownRow} key={row.id}>
              <span className={styles.breakdownName} title={row.id}>
                {labelFor(row.id)}
              </span>
              <span className={styles.track} aria-hidden="true">
                <span
                  style={{ width: `${summary?.total ? (row.total / summary.total) * 100 : 0}%` }}
                />
              </span>
              <span className={styles.share}>
                {percent(summary?.total ? (row.total / summary.total) * 100 : 0)}%
              </span>
              <span className={styles.breakdownTotal}>{count(row.total)}</span>
              <span className={row.failed ? styles.negative : styles.muted}>
                {t('dashboard_live.failed_count', { count: row.failed })}
              </span>
            </li>
          ))}
        </ul>
        {!breakdown.length ? (
          <p className={styles.empty}>
            {summary ? t('dashboard_live.no_requests') : stateNote(data.trafficState)}
          </p>
        ) : null}
      </section>

      <Modal
        open={editingPins}
        onClose={() => setEditingPins(false)}
        title={t('dashboard_live.pinned_models')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingPins(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                const next = normalizeModelPins(draftPins) ?? [];
                setStoredPins(next);
                try {
                  localStorage.setItem(pinStorageKey(connection), JSON.stringify(next));
                  setStorageFailed(false);
                } catch {
                  setStorageFailed(true);
                }
                setEditingPins(false);
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <p className={styles.pinHint}>{t('dashboard_live.pin_hint')}</p>
        <div className={styles.pinList}>
          {[...new Set([...pins, ...models.map((model) => model.id)])].map((id) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={draftPins.includes(id)}
                disabled={!draftPins.includes(id) && draftPins.length >= 4}
                onChange={(event) =>
                  setDraftPins((current) =>
                    event.target.checked ? [...current, id] : current.filter((pin) => pin !== id)
                  )
                }
              />
              <span>
                {models.find((model) => model.id === id)?.label || id}
                <code>{id}</code>
              </span>
            </label>
          ))}
        </div>
      </Modal>
      {storageFailed ? (
        <p className={styles.notice}>{t('dashboard_live.pin_storage_failed')}</p>
      ) : null}
    </div>
  );
}
