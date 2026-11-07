import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { apiClient } from '@/services/api/client';
import { requestArchiveApi, type RequestArchiveStats } from '@/services/api/requestArchive';
import { isRecord } from '@/utils/helpers';

export type ArchiveLoadState = 'loading' | 'ready' | 'unsupported' | 'error' | 'disconnected';

export function useRequestArchive() {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const revision = apiClient.getConnectionRevision();
  const [result, setResult] = useState<{
    revision: number;
    stats: RequestArchiveStats | null;
    state: ArchiveLoadState;
  } | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    let controller: AbortController | null = null;
    let running = false;
    let unsupported = false;
    const scope = apiClient.getConnectionRevision();
    const current = () => active && apiClient.getConnectionRevision() === scope;
    const load = async () => {
      if (running || unsupported || !current()) return;
      running = true;
      controller = new AbortController();
      try {
        const stats = await requestArchiveApi.get(controller.signal);
        if (current()) setResult({ revision: scope, stats, state: 'ready' });
      } catch (error: unknown) {
        if (current() && !controller.signal.aborted) {
          unsupported = isRecord(error) && error.status === 404;
          // Do not leave a stale healthy result visible after a failed refresh.
          setResult((previous) => ({
            revision: scope,
            stats: previous?.revision === scope ? previous.stats : null,
            state: unsupported ? 'unsupported' : 'error',
          }));
        }
      } finally {
        running = false;
      }
    };
    const resume = () => {
      if (document.visibilityState === 'visible') void load();
    };
    refreshRef.current = async () => {
      unsupported = false;
      await load();
    };
    void load();
    const timer = window.setInterval(resume, 15_000);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      refreshRef.current = async () => {};
    };
  }, [connected, apiBase, managementKey, revision]);

  const state: ArchiveLoadState = !connected
    ? 'disconnected'
    : result?.revision === revision
      ? result.state
      : 'loading';
  return {
    stats: connected && result?.revision === revision ? result.stats : null,
    state,
    refresh,
  };
}
