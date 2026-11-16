import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { readRequestsView, requestsPath, writeRequestsView } from '../src/features/requests/params';
import {
  formatRequestDuration,
  formatRequestTime,
  providerLabels,
  requestReasonShort,
  requestStatusText,
} from '../src/features/requests/format';
import { RequestList } from '../src/features/requests/components/RequestList';
import type { DashboardModel, DashboardRequest } from '../src/services/api/dashboard';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr'];

const translator = i18next.createInstance();
await translator.init({
  lng: 'en',
  resources: { en: { translation: JSON.parse(read('src/i18n/locales/en.json')) } },
  interpolation: { escapeValue: false },
});
const t = translator.t.bind(translator);

const request = (overrides: Partial<DashboardRequest> = {}): DashboardRequest => ({
  id: 'request-1',
  traceId: 'trace-1',
  model: 'claude-opus-5-5',
  provider: 'claude-oauth',
  startedAt: '2026-11-16T08:50:05Z',
  completedAt: '2026-11-16T08:50:43Z',
  statusCode: 500,
  outcome: 'failed',
  durationMs: 38_000,
  reason: 'upstream_error',
  archiveRequestId: null,
  ...overrides,
});

describe('requests view in the URL', () => {
  test('defaults to the last hour of all requests in history', () => {
    expect(readRequestsView(new URLSearchParams())).toEqual({
      tab: 'history',
      status: 'all',
      window: '1h',
    });
  });

  test('reads the server tab, failures and a wider window; ignores unknown values', () => {
    expect(readRequestsView(new URLSearchParams('tab=server&status=failed&window=24h'))).toEqual({
      tab: 'server',
      status: 'failed',
      window: '24h',
    });
    expect(readRequestsView(new URLSearchParams('tab=x&status=y&window=3h'))).toEqual({
      tab: 'history',
      status: 'all',
      window: '1h',
    });
  });

  test('writes only non-default values and keeps unrelated params', () => {
    const next = writeRequestsView(new URLSearchParams('status=failed&keep=1'), {
      status: 'all',
      window: '8h',
    });
    expect(next.toString()).toBe('keep=1&window=8h');
    // Switching tabs keeps history filters for the way back.
    expect(writeRequestsView(next, { tab: 'server' }).get('window')).toBe('8h');
  });

  test('builds links for other pages', () => {
    expect(requestsPath()).toBe('/requests');
    expect(requestsPath({ status: 'failed', window: '1h' })).toBe('/requests?status=failed');
    expect(requestsPath({ tab: 'server' })).toBe('/requests?tab=server');
  });
});

describe('request formatting', () => {
  test('durations read naturally at every scale', () => {
    expect(formatRequestDuration(t, 'en', 2_340)).toBe('2.3s');
    expect(formatRequestDuration(t, 'en', 38_200)).toBe('38s');
    expect(formatRequestDuration(t, 'en', 162_100)).toBe('2m 42s');
  });

  test('times carry a date only when the request did not finish today', () => {
    const now = new Date('2026-11-16T12:00:00');
    expect(formatRequestTime('en', '2026-11-16T09:24:36', now)).not.toMatch(/Nov/);
    expect(formatRequestTime('en', '2026-11-15T09:24:36', now)).toMatch(/^Nov 15 /);
  });

  test('statuses name failures without an HTTP code and interrupted streams', () => {
    expect(requestStatusText(t, { outcome: 'failed', statusCode: 0 })).toBe('Failed');
    expect(requestStatusText(t, { outcome: 'interrupted', statusCode: 200 })).toBe('Interrupted');
    expect(requestStatusText(t, { outcome: 'success', statusCode: 200 })).toBe('200');
  });

  test('short reasons appear for failures only and never repeat the status', () => {
    expect(requestReasonShort(t, { outcome: 'failed', reason: 'rate_limited' })).toBe(
      'Rate limited'
    );
    expect(requestReasonShort(t, { outcome: 'success', reason: null })).toBeNull();
    expect(requestReasonShort(t, { outcome: 'failed', reason: 'unknown' })).toBeNull();
    expect(
      requestReasonShort(t, { outcome: 'interrupted', reason: 'stream_interrupted' })
    ).toBeNull();
  });

  test('provider labels come from the routing snapshot', () => {
    const models: DashboardModel[] = [
      {
        id: 'm',
        label: 'M',
        lastUsedProvider: null,
        routes: [
          {
            provider: 'claude-oauth',
            providerLabel: 'Claude OAuth',
            priority: 0,
            readyCredentials: 1,
            status: 'ready',
            cooldownReason: null,
            retryAt: null,
          },
        ],
      },
    ];
    expect(providerLabels(models).get('claude-oauth')).toBe('Claude OAuth');
  });
});

describe('request list', () => {
  const render = (requests: DashboardRequest[]) =>
    renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: translator },
        createElement(RequestList, {
          requests,
          now: new Date('2026-11-16T12:00:00Z'),
          onSelect: () => {},
        })
      )
    );

  test('each request is one button that opens a dialog, with its cause', () => {
    const markup = render([request()]);
    expect(markup).toContain('<button type="button"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('data-failed="true"');
    expect(markup).toContain('Upstream error');
    expect(markup).toContain('38s');
    // Screen readers hear "failed" even though color carries it visually.
    expect(markup).toContain('Failed </span>500');
  });

  test('the column header is visual only', () => {
    expect(render([request()])).toMatch(/aria-hidden="true"><span>Time<\/span>/);
  });
});

describe('requests page contract', () => {
  const page = read('src/features/requests/RequestsPage.tsx');

  test('tabs are a keyboard-operable tablist bound to the URL', () => {
    expect(page).toContain('role="tablist"');
    expect(page).toContain('role="tab"');
    expect(page).toContain('role="tabpanel"');
    expect(page).toContain("'ArrowRight'");
    expect(page).toContain('useSearchParams');
    expect(page).toContain('<LogsPage embedded />');
  });

  test('the overview links to requests instead of opening a sheet', () => {
    const dashboard = read('src/features/dashboard/DashboardPage.tsx');
    expect(dashboard).not.toContain('RequestBrowser');
    expect(dashboard).toContain("requestsPath({ status: 'failed', window: '1h' })");
    expect(read('src/features/dashboard/components/RequestArchivePanel.tsx')).toContain(
      'to="/requests?tab=server"'
    );
  });

  test('the embedded log drops its own title', () => {
    expect(read('src/features/logs/LogsPage.tsx')).toContain(
      "{embedded ? null : <h1 className={styles.pageTitle}>{t('logs.title')}</h1>}"
    );
  });

  test('styles respect reduced motion', () => {
    for (const file of [
      'src/features/requests/RequestsPage.module.scss',
      'src/features/requests/components/RequestList.module.scss',
      'src/features/requests/components/RequestDetailsSheet.module.scss',
    ]) {
      expect(read(file)).toContain('@media (prefers-reduced-motion: reduce)');
    }
  });

  test('every locale has the same requests_page keys, plurals aside', () => {
    const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');
    const keysOf = (locale: string) =>
      new Set(
        Object.keys(JSON.parse(read(`src/i18n/locales/${locale}.json`)).requests_page ?? {}).map(
          base
        )
      );
    const english = keysOf('en');
    expect(english.size).toBeGreaterThan(30);
    for (const locale of LOCALES) expect(keysOf(locale)).toEqual(english);
  });
});

describe('same-page navigation', () => {
  test('the current page layer sees search changes, which do not animate a transition', () => {
    const transition = read('src/components/common/PageTransition.tsx');
    expect(transition).toContain(
      "layer.status === 'current' && layer.location.pathname === location.pathname"
    );
  });
});
