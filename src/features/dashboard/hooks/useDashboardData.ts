import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { apiClient } from '@/services/api/client';
import {
  dashboardApi,
  type DashboardLoadState,
  type DashboardOutcome,
  type DashboardRequests,
  type DashboardRoutes,
  type DashboardSummary,
  type DashboardWindow,
} from '@/services/api/dashboard';
import { isRecord } from '@/utils/helpers';

export type { DashboardLoadState } from '@/services/api/dashboard';

interface Snapshot {
  scope: object;
  routes: DashboardRoutes | null;
  summary: DashboardSummary | null;
  requests: DashboardRequests | null;
  routesState: DashboardLoadState;
  trafficState: DashboardLoadState;
  refreshing: boolean;
  lastUpdate: string | null;
}

const loadState = (error: unknown): DashboardLoadState =>
  isRecord(error) && error.status === 404 ? 'unsupported' : 'error';

export function useDashboardData(timeWindow: DashboardWindow, outcome: DashboardOutcome) {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const revision = apiClient.getConnectionRevision();
  const scope = useMemo(
    () => ({ connected, apiBase, managementKey, revision, timeWindow, outcome }),
    [connected, apiBase, managementKey, revision, timeWindow, outcome]
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    let controller: AbortController | null = null;
    let pending: Promise<void> | null = null;
    let routesUnsupported = false;
    let trafficUnsupported = false;
    const connectionRevision = apiClient.getConnectionRevision();
    const current = () => active && connectionRevision === apiClient.getConnectionRevision();

    const load = (): Promise<void> => {
      if (pending) return pending;
      if (!current() || (routesUnsupported && trafficUnsupported)) return Promise.resolve();
      controller = new AbortController();
      const signal = controller.signal;
      setSnapshot((previous) => ({
        scope,
        routes: previous?.scope === scope ? previous.routes : null,
        summary: previous?.scope === scope ? previous.summary : null,
        requests: previous?.scope === scope ? previous.requests : null,
        routesState: previous?.scope === scope ? previous.routesState : 'loading',
        trafficState: previous?.scope === scope ? previous.trafficState : 'loading',
        refreshing: true,
        lastUpdate: previous?.scope === scope ? previous.lastUpdate : null,
      }));

      // Summary and feed commit together so every traffic panel describes the same window.
      const routesPromise = routesUnsupported
        ? Promise.resolve(null)
        : dashboardApi.getRoutes(signal);
      const trafficPromise = trafficUnsupported
        ? Promise.resolve(null)
        : Promise.all([
            dashboardApi.getSummary(timeWindow, signal),
            dashboardApi.getRequests({ window: timeWindow, outcome, limit: 8 }, signal),
          ]);
      pending = Promise.allSettled([routesPromise, trafficPromise])
        .then(([routes, traffic]) => {
          if (!current() || signal.aborted) return;
          if (routes.status === 'rejected')
            routesUnsupported = loadState(routes.reason) === 'unsupported';
          if (traffic.status === 'rejected')
            trafficUnsupported = loadState(traffic.reason) === 'unsupported';
          setSnapshot((previous) => {
            const prior = previous?.scope === scope ? previous : null;
            const routesValue = routes.status === 'fulfilled' ? routes.value : null;
            const trafficValue = traffic.status === 'fulfilled' ? traffic.value : null;
            return {
              scope,
              routes: routesValue ?? prior?.routes ?? null,
              summary: trafficValue?.[0] ?? prior?.summary ?? null,
              requests: trafficValue?.[1] ?? prior?.requests ?? null,
              routesState:
                routes.status === 'rejected'
                  ? loadState(routes.reason)
                  : routesValue
                    ? 'ready'
                    : (prior?.routesState ?? 'unsupported'),
              trafficState:
                traffic.status === 'rejected'
                  ? loadState(traffic.reason)
                  : trafficValue
                    ? 'ready'
                    : (prior?.trafficState ?? 'unsupported'),
              refreshing: false,
              lastUpdate:
                trafficValue?.[0].observedAt ??
                routesValue?.observedAt ??
                prior?.lastUpdate ??
                null,
            };
          });
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    };

    const resume = () => {
      if (document.visibilityState === 'visible') void load();
    };
    refreshRef.current = async () => {
      routesUnsupported = false;
      trafficUnsupported = false;
      await load();
    };
    resume();
    const timer = globalThis.window.setInterval(resume, 15_000);
    globalThis.window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      controller?.abort();
      globalThis.window.clearInterval(timer);
      globalThis.window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      refreshRef.current = async () => {};
    };
  }, [connected, scope, timeWindow, outcome]);

  const visible = connected && snapshot?.scope === scope ? snapshot : null;
  const state: DashboardLoadState = connected ? 'loading' : 'disconnected';
  return {
    routes: visible?.routes ?? null,
    summary: visible?.summary ?? null,
    requests: visible?.requests ?? null,
    routesState: visible?.routesState ?? state,
    trafficState: visible?.trafficState ?? state,
    refreshing: visible?.refreshing ?? false,
    lastUpdate: visible?.lastUpdate ?? null,
    refresh,
  };
}
