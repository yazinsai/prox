import type { DashboardWindow } from '@/services/api/dashboard';

/**
 * The Requests page keeps its whole view in the URL so a link (from the overview's failed count,
 * or shared between tabs) opens exactly that view. Defaults are left out to keep addresses short.
 *
 * - `tab=server`: the server log; anything else is request history.
 * - `status=failed`: only failed requests.
 * - `window=8h|24h`: history window; the last hour is the default.
 */
export type RequestsTab = 'history' | 'server';
export type RequestsStatus = 'all' | 'failed';

export interface RequestsView {
  tab: RequestsTab;
  status: RequestsStatus;
  window: DashboardWindow;
}

export const REQUEST_WINDOWS: readonly DashboardWindow[] = ['1h', '8h', '24h'];
export const DEFAULT_REQUESTS_VIEW: RequestsView = { tab: 'history', status: 'all', window: '1h' };

const isWindow = (value: string | null): value is DashboardWindow =>
  value !== null && (REQUEST_WINDOWS as readonly string[]).includes(value);

export function readRequestsView(params: URLSearchParams): RequestsView {
  const window = params.get('window');
  return {
    tab: params.get('tab') === 'server' ? 'server' : 'history',
    status: params.get('status') === 'failed' ? 'failed' : 'all',
    window: isWindow(window) ? window : DEFAULT_REQUESTS_VIEW.window,
  };
}

/** Applies a change to the current params, dropping defaults and keeping unrelated params. */
export function writeRequestsView(
  params: URLSearchParams,
  change: Partial<RequestsView>
): URLSearchParams {
  const next = new URLSearchParams(params);
  const view = { ...readRequestsView(params), ...change };
  const set = (key: keyof RequestsView, value: string) => {
    if (value === DEFAULT_REQUESTS_VIEW[key]) next.delete(key);
    else next.set(key, value);
  };
  set('tab', view.tab);
  set('status', view.status);
  set('window', view.window);
  return next;
}

/** Hash-router address of a requests view, for links from other pages. */
export function requestsPath(change: Partial<RequestsView> = {}): string {
  const query = writeRequestsView(new URLSearchParams(), change).toString();
  return query ? `/requests?${query}` : '/requests';
}
