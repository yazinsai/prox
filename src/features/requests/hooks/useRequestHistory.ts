import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { apiClient } from '@/services/api/client';
import {
  dashboardApi,
  type DashboardLoadState,
  type DashboardModel,
  type DashboardRequest,
  type DashboardSummary,
  type DashboardWindow,
} from '@/services/api/dashboard';
import { isRecord } from '@/utils/helpers';
import type { RequestsStatus } from '../params';

export const REQUEST_PAGE_SIZE = 50;

export interface RequestHistoryState {
  state: DashboardLoadState;
  requests: DashboardRequest[];
  /** Window totals; null until loaded or when the summary alone failed. */
  summary: DashboardSummary | null;
  /** Routing snapshot models, for model and provider labels. */
  models: DashboardModel[];
  observedAt: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  /** A background reload is running while the current list stays on screen. */
  refreshing: boolean;
  /** The list on screen belongs to the previous filters while the new ones load. */
  pending: boolean;
  loadMore: () => void;
  refresh: () => Promise<void>;
}

const EMPTY_MODELS: DashboardModel[] = [];

const failureState = (error: unknown): DashboardLoadState =>
  isRecord(error) && error.status === 404 ? 'unsupported' : 'error';

const isAbort = (error: unknown) =>
  (error instanceof DOMException && error.name === 'AbortError') ||
  (isRecord(error) && (error.name === 'CanceledError' || error.code === 'ERR_CANCELED'));

interface Feed {
  key: string;
  connectionKey: string;
  state: DashboardLoadState;
  requests: DashboardRequest[];
  summary: DashboardSummary | null;
  observedAt: string | null;
  cursor: string | null;
}

/**
 * Completed requests for one window and outcome, newest first, fifty at a time. Changing the
 * window or outcome starts over; refresh reloads the first page in place so the list never
 * blanks, and older pages are appended without duplicates.
 */
export function useRequestHistory(
  timeWindow: DashboardWindow,
  status: RequestsStatus
): RequestHistoryState {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const revision = apiClient.getConnectionRevision();
  const connectionKey = `${apiBase}\u0000${revision}`;
  const key = `${connectionKey}\u0000${timeWindow}\u0000${status}`;

  const [feed, setFeed] = useState<Feed | null>(null);
  const [models, setModels] = useState<DashboardModel[]>(EMPTY_MODELS);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const loadIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const loadFirstPage = useCallback(
    async (background: boolean) => {
      if (!connected) return;
      const loadId = ++loadIdRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const connection = apiClient.getConnectionRevision();
      const current = () =>
        loadId === loadIdRef.current && connection === apiClient.getConnectionRevision();
      if (background) setRefreshing(true);
      setLoadingMore(false);
      setLoadMoreFailed(false);
      const outcome = status === 'failed' ? 'failed' : 'all';
      const [page, summary] = await Promise.allSettled([
        dashboardApi.getRequests(
          { window: timeWindow, outcome, limit: REQUEST_PAGE_SIZE },
          controller.signal
        ),
        dashboardApi.getSummary(timeWindow, controller.signal),
      ]);
      if (!current() || controller.signal.aborted) return;
      setRefreshing(false);
      setFeed((previous) => {
        const prior = previous?.key === key ? previous : null;
        if (page.status === 'rejected') {
          if (isAbort(page.reason)) return previous;
          // A failed background reload keeps the list it already has.
          if (prior && prior.state === 'ready') return prior;
          return {
            key,
            connectionKey,
            state: failureState(page.reason),
            requests: [],
            summary: null,
            observedAt: null,
            cursor: null,
          };
        }
        return {
          key,
          connectionKey,
          state: 'ready',
          requests: page.value.requests,
          summary: summary.status === 'fulfilled' ? summary.value : (prior?.summary ?? null),
          observedAt: page.value.observedAt,
          cursor: page.value.nextCursor,
        };
      });
    },
    [connected, connectionKey, key, status, timeWindow]
  );

  useEffect(() => {
    void loadFirstPage(false);
    return () => {
      loadIdRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [loadFirstPage]);

  // Labels only; a backend without the routing snapshot still lists requests.
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    const connection = apiClient.getConnectionRevision();
    dashboardApi
      .getRoutes(controller.signal)
      .then((routes) => {
        if (connection === apiClient.getConnectionRevision()) setModels(routes.models);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [connected, apiBase, revision]);

  const current = feed?.key === key ? feed : null;
  // While another window or outcome loads, the previous list stays (dimmed) instead of blanking;
  // never across connections, where it would show one backend's data under another.
  const previous =
    !current && feed?.connectionKey === connectionKey && feed.state === 'ready' ? feed : null;
  const cursor = current?.cursor ?? null;

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    const loadId = loadIdRef.current;
    const connection = apiClient.getConnectionRevision();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    dashboardApi
      .getRequests(
        {
          window: timeWindow,
          outcome: status === 'failed' ? 'failed' : 'all',
          cursor,
          limit: REQUEST_PAGE_SIZE,
        },
        controller.signal
      )
      .then((page) => {
        if (loadId !== loadIdRef.current || connection !== apiClient.getConnectionRevision()) {
          return;
        }
        setFeed((previous) => {
          if (!previous || previous.key !== key) return previous;
          const seen = new Set(previous.requests.map((request) => request.id));
          return {
            ...previous,
            requests: [
              ...previous.requests,
              ...page.requests.filter((request) => !seen.has(request.id)),
            ],
            cursor: page.nextCursor,
          };
        });
      })
      .catch((error: unknown) => {
        if (loadId === loadIdRef.current && !isAbort(error)) setLoadMoreFailed(true);
      })
      .finally(() => {
        if (loadId === loadIdRef.current) setLoadingMore(false);
      });
  }, [cursor, key, loadingMore, status, timeWindow]);

  const refresh = useCallback(() => loadFirstPage(true), [loadFirstPage]);

  return {
    state: !connected ? 'disconnected' : (current?.state ?? previous?.state ?? 'loading'),
    requests: current?.requests ?? previous?.requests ?? [],
    // The window totals do not depend on the outcome filter.
    summary:
      current?.summary ?? (previous?.summary?.window === timeWindow ? previous.summary : null),
    models,
    observedAt: current?.observedAt ?? previous?.observedAt ?? null,
    hasMore: Boolean(cursor),
    loadingMore,
    loadMoreFailed,
    refreshing,
    pending: connected && !current && previous !== null,
    loadMore,
    refresh,
  };
}
