import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { apiClient } from '@/services/api/client';
import {
  dashboardApi,
  type DashboardLoadState,
  type DashboardRoutes,
  type DashboardSummary,
  type DashboardWindow,
} from '@/services/api/dashboard';
import { isRecord } from '@/utils/helpers';
import { MINUTE_MS } from '@/utils/time/durations';
import { PULSE_MINUTES, type RecentActivity } from '../insights';

export type { DashboardLoadState } from '@/services/api/dashboard';

/** 4 × 100 rows covers the pulse up to ~27 requests/minute; beyond that it is marked partial. */
const PAGE_SIZE = 100;
const MAX_PAGES = 4;

interface Traffic {
  hour: DashboardSummary;
  day: DashboardSummary;
  /** Only fetched while the 8-hour window is selected. */
  eight: DashboardSummary | null;
  recent: RecentActivity;
}

interface Snapshot {
  scope: object;
  routes: DashboardRoutes | null;
  traffic: Traffic | null;
  routesState: DashboardLoadState;
  trafficState: DashboardLoadState;
  refreshing: boolean;
  /** Local clocks when each part last landed, to age server timestamps without skew. */
  routesReceivedAt: number | null;
  trafficReceivedAt: number | null;
}

const loadState = (error: unknown): DashboardLoadState =>
  isRecord(error) && error.status === 404 ? 'unsupported' : 'error';

export async function loadRecentActivity(signal: AbortSignal): Promise<RecentActivity> {
  const first = await dashboardApi.getRequests({ window: '1h', limit: PAGE_SIZE }, signal);
  const horizon = Date.parse(first.observedAt) - PULSE_MINUTES * MINUTE_MS;
  const requests = [...first.requests];
  let cursor = first.nextCursor;
  const reachedHorizon = () => {
    const last = requests[requests.length - 1];
    return !last || Date.parse(last.completedAt) <= horizon;
  };
  for (let page = 1; cursor && page < MAX_PAGES && !reachedHorizon(); page += 1) {
    const next = await dashboardApi.getRequests({ window: '1h', limit: PAGE_SIZE, cursor }, signal);
    requests.push(...next.requests);
    cursor = next.nextCursor;
  }
  return { observedAt: first.observedAt, requests, complete: !cursor || reachedHorizon() };
}

async function loadTraffic(window: DashboardWindow, signal: AbortSignal): Promise<Traffic> {
  const [hour, day, eight, recent] = await Promise.all([
    dashboardApi.getSummary('1h', signal),
    dashboardApi.getSummary('24h', signal),
    window === '8h' ? dashboardApi.getSummary('8h', signal) : Promise.resolve(null),
    loadRecentActivity(signal),
  ]);
  return { hour, day, eight, recent };
}

function selectedSummary(traffic: Traffic | null, window: DashboardWindow) {
  if (!traffic) return null;
  return window === '1h' ? traffic.hour : window === '24h' ? traffic.day : traffic.eight;
}

export function useDashboardData(timeWindow: DashboardWindow) {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const revision = apiClient.getConnectionRevision();
  // The window is deliberately not part of the scope: switching it keeps routes and the
  // pulse on screen, and 1h/24h are always loaded, so only 8h ever waits.
  const scope = useMemo(
    () => ({ connected, apiBase, managementKey, revision }),
    [connected, apiBase, managementKey, revision]
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
      setSnapshot((previous) => {
        const prior = previous?.scope === scope ? previous : null;
        return {
          scope,
          routes: prior?.routes ?? null,
          traffic: prior?.traffic ?? null,
          routesState: prior?.routesState ?? 'loading',
          trafficState: prior?.trafficState ?? 'loading',
          refreshing: true,
          routesReceivedAt: prior?.routesReceivedAt ?? null,
          trafficReceivedAt: prior?.trafficReceivedAt ?? null,
        };
      });

      const routesPromise = routesUnsupported
        ? Promise.resolve(null)
        : dashboardApi.getRoutes(signal);
      const trafficPromise = trafficUnsupported
        ? Promise.resolve(null)
        : loadTraffic(timeWindow, signal);
      pending = Promise.allSettled([routesPromise, trafficPromise])
        .then(([routes, traffic]) => {
          if (!current() || signal.aborted) return;
          if (routes.status === 'rejected')
            routesUnsupported = loadState(routes.reason) === 'unsupported';
          if (traffic.status === 'rejected')
            trafficUnsupported = loadState(traffic.reason) === 'unsupported';
          const receivedAt = Date.now();
          setSnapshot((previous) => {
            const prior = previous?.scope === scope ? previous : null;
            const routesValue = routes.status === 'fulfilled' ? routes.value : null;
            const trafficValue = traffic.status === 'fulfilled' ? traffic.value : null;
            return {
              scope,
              routes: routesValue ?? prior?.routes ?? null,
              traffic: trafficValue ?? prior?.traffic ?? null,
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
              routesReceivedAt: routesValue ? receivedAt : (prior?.routesReceivedAt ?? null),
              trafficReceivedAt: trafficValue ? receivedAt : (prior?.trafficReceivedAt ?? null),
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
  }, [connected, scope, timeWindow]);

  const visible = connected && snapshot?.scope === scope ? snapshot : null;
  const state: DashboardLoadState = connected ? 'loading' : 'disconnected';
  const traffic = visible?.traffic ?? null;
  return {
    routes: visible?.routes ?? null,
    hour: traffic?.hour ?? null,
    day: traffic?.day ?? null,
    selected: selectedSummary(traffic, timeWindow),
    recent: traffic?.recent ?? null,
    routesState: visible?.routesState ?? state,
    trafficState: visible?.trafficState ?? state,
    refreshing: visible?.refreshing ?? false,
    routesReceivedAt: visible?.routesReceivedAt ?? null,
    trafficReceivedAt: visible?.trafficReceivedAt ?? null,
    refresh,
  };
}
