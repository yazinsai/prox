import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { ArchiveSummary } from '../src/features/dashboard/components/ArchiveSummary';
import { RequestList } from '../src/features/requests/components/RequestList';
import { rankRequestBreakdown } from '../src/features/dashboard/requestBreakdown';
import { NowCard } from '../src/features/dashboard/components/NowCard';
import { TopModels } from '../src/features/dashboard/components/TopModels';
import { Providers } from '../src/features/dashboard/components/Providers';
import {
  summarizeActivity,
  summarizeProviders,
  type ActivitySnapshot,
} from '../src/features/dashboard/insights';
import type { DashboardModel, DashboardSummary } from '../src/services/api/dashboard';
import type { RequestArchiveStats } from '../src/services/api/requestArchive';
import type { DashboardRequest } from '../src/services/api/dashboard';

const translator = i18next.createInstance();
await translator.init({
  lng: 'en',
  resources: {
    en: {
      translation: JSON.parse(
        readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8')
      ),
    },
  },
  interpolation: { escapeValue: false },
});

const stats: RequestArchiveStats = {
  enabled: true,
  status: 'healthy',
  failuresSinceStart: 0,
  lastFailureAt: null,
  startedAt: '2026-11-07T10:00:00Z',
  version: 'fixture-version',
  commit: 'fixture-commit',
  upstreamBase: 'fixture-base',
  index: {
    updatedAt: '2026-11-07T12:00:00Z',
    records: 12480,
    archiveFiles: 12480,
    originalBytes: 18_600_000_000,
    archivedBytes: 2_840_000_000,
    indexBytes: 18_000_000,
    diskFreeBytes: 138_000_000_000,
    diskTotalBytes: 256_000_000_000,
    pendingPlaintextFiles: 0,
    latestAt: '2026-11-07T11:59:59Z',
    oldestAt: '2026-11-01T00:00:00Z',
    daily: [],
  },
};

const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: translator }, createElement(MemoryRouter, null, element))
  );
const renderArchive = (
  value: RequestArchiveStats | null,
  state: 'ready' | 'unsupported' | 'error'
) => render(createElement(ArchiveSummary, { stats: value, state, refresh: async () => {} }));

describe('dashboard archive presentation', () => {
  test('shows physical compressed bytes in decimal GB, excluding index overhead', () => {
    const markup = renderArchive(stats, 'ready');
    expect(markup).toContain('2.84 GB');
    expect(markup).not.toContain('2.86');
    expect(markup).toContain('Recording');
    expect(markup).toContain('data-attention="false"');
    expect(markup).not.toContain('request_archive.');
    expect(markup).not.toContain('dashboard_live.');
  });

  test('missing reports show unknown size without invented bytes', () => {
    for (const state of ['unsupported', 'error'] as const) {
      const markup = renderArchive(null, state);
      expect(markup).toContain('—');
      expect(markup).not.toContain('0.00');
      expect(markup).toContain('data-attention="true"');
      expect(markup).toContain(
        state === 'unsupported' ? 'Reporting unavailable' : 'Status unavailable'
      );
    }
  });

  test('stale, disabled and degraded archives keep their real status and last-known size', () => {
    const stale = renderArchive({ ...stats, status: 'index_stale' }, 'ready');
    expect(stale).toContain('2.84 GB');
    expect(stale).toContain('Indexer not reporting');
    expect(stale).toContain('data-attention="true"');
    const disabled = renderArchive({ ...stats, enabled: false, status: 'disabled' }, 'ready');
    expect(disabled).toContain('Recording paused');
    const degraded = renderArchive({ ...stats, status: 'degraded' }, 'ready');
    expect(degraded).toContain('Needs attention');
  });

  test('an empty healthy archive has a known zero size without NaN', () => {
    const index = stats.index;
    if (!index) throw new Error('Missing fixture index');
    const empty = renderArchive(
      {
        ...stats,
        index: { ...index, records: 0, archiveFiles: 0, originalBytes: 0, archivedBytes: 0 },
      },
      'ready'
    );
    expect(empty).toContain('0.00 GB');
    expect(empty).not.toContain('NaN');
  });
});

describe('dashboard request presentation', () => {
  const request: DashboardRequest = {
    id: 'request-fixture',
    traceId: 'trace-fixture',
    model: 'exact-model-id',
    provider: 'public-group',
    startedAt: '2026-11-07T11:59:58Z',
    completedAt: '2026-11-07T12:00:00Z',
    statusCode: 200,
    outcome: 'interrupted',
    durationMs: 2000,
    reason: 'stream_interrupted',
    archiveRequestId: null,
  };

  test('interrupted streams are labelled failures even after HTTP 200', () => {
    const markup = render(createElement(RequestList, { requests: [request], onSelect: () => {} }));
    expect(markup).toContain('Interrupted');
    expect(markup).toContain('data-failed="true"');
    expect(markup).toContain('data-request-id="request-fixture"');
    expect(markup).toContain('2s');
    expect(markup).not.toContain('>200<');
  });
});

describe('dashboard model ranking', () => {
  test('ranks by request totals with stable ties and without merging model IDs', () => {
    const rows = [1, 80, 3, 40, 80, 20, 9].map((total, index) => ({
      id: `model-${index}`,
      total,
      success: total,
      failed: 0,
    }));
    expect(rankRequestBreakdown(rows).map((row) => row.id)).toEqual([
      'model-1',
      'model-4',
      'model-3',
      'model-5',
      'model-6',
    ]);
    expect(rows[0].id).toBe('model-0');
    expect(rankRequestBreakdown(rows, rows.length)).toHaveLength(7);
    expect(rankRequestBreakdown([])).toEqual([]);
  });
});

describe('dashboard cards', () => {
  const observedAt = '2026-11-07T12:00:00Z';
  const models: DashboardModel[] = [
    {
      id: 'claude-opus-5-5',
      label: 'Claude Opus 5.5',
      lastUsedProvider: 'claude-oauth',
      routes: [
        {
          provider: 'antigravity',
          providerLabel: 'Antigravity',
          priority: 0,
          readyCredentials: 0,
          status: 'cooling',
          cooldownReason: 'quota',
          retryAt: '2026-11-07T14:05:00Z',
        },
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
  const hour: DashboardSummary = {
    observedAt,
    coverageStart: '2026-11-07T11:00:00Z',
    partial: false,
    window: '1h',
    total: 614,
    success: 609,
    failed: 5,
    byModel: [{ id: 'claude-opus-5-5', total: 335, success: 332, failed: 3 }],
    byProvider: [],
  };
  const activity: ActivitySnapshot = summarizeActivity(
    {
      observedAt,
      complete: true,
      requests: Array.from({ length: 62 }, (_, index) => ({
        id: `r${index}`,
        traceId: '',
        model: 'claude-opus-5-5',
        provider: 'claude-oauth',
        startedAt: new Date(Date.parse(observedAt) - index * 4_000 - 8_000).toISOString(),
        completedAt: new Date(Date.parse(observedAt) - index * 4_000 - 3_000).toISOString(),
        statusCode: 200,
        outcome: 'success' as const,
        durationMs: 5_000,
        reason: null,
        archiveRequestId: null,
      })),
    },
    3.2
  );
  const providers = summarizeProviders(models, hour.byModel);
  const now = (overrides: Partial<Parameters<typeof NowCard>[0]> = {}) =>
    render(
      createElement(NowCard, {
        activity,
        observedAt,
        hour,
        trafficState: 'ready',
        trafficReceivedAt: null,
        providers,
        runtimeKnown: true,
        routesObservedAt: observedAt,
        routesReceivedAt: null,
        onShowFailures: () => {},
        ...overrides,
      })
    );

  test('the hero answers how busy, compared with usual, and what is throttled', () => {
    const markup = now();
    expect(markup).toContain('Busier than usual');
    expect(markup).toContain('requests / min');
    expect(markup).toContain('614');
    expect(markup).toContain('99%');
    expect(markup).toContain('3.2/min');
    expect(markup).toContain('Throttled: Antigravity');
    expect(markup).toContain('Claude Opus 5.5 still served by Claude OAuth');
    expect(markup).toContain('Quota restriction');
    expect(markup).not.toContain('dashboard_live.');
    expect(markup).not.toContain('NaN');
  });

  test('clear and unknown throttling states are distinct', () => {
    expect(now({ providers: [] })).toContain('Nothing throttled');
    const unknown = now({ runtimeKnown: false });
    expect(unknown).toContain('Throttling status unknown');
    expect(unknown).not.toContain('Nothing throttled');
  });

  test('no data shows dashes and the load state, never zeros', () => {
    const markup = now({ activity: null, hour: null, providers: null, trafficState: 'loading' });
    expect(markup).toContain('Loading observations');
    expect(markup).toContain('—');
    expect(markup).not.toContain('>0<');
    expect(markup).not.toContain('Nothing throttled');
  });

  test('top models show usage share and who serves each model', () => {
    const markup = render(
      createElement(TopModels, {
        summary: hour,
        models,
        window: '1h',
        onWindow: () => {},
        trafficState: 'ready',
        routesObservedAt: observedAt,
        routesReceivedAt: null,
      })
    );
    expect(markup).toContain('Claude Opus 5.5');
    expect(markup).toContain('335');
    expect(markup).toContain('55%');
    expect(markup).toContain('3 failed');
    expect(markup).toContain('data-state="serving"');
    expect(markup).toContain('data-state="cooling"');
    expect(markup).toContain('All models (1)');
    expect(markup).not.toContain('dashboard_live.');
  });

  test('providers lead with what is cooling and name the fallback', () => {
    const markup = render(
      createElement(Providers, {
        providers,
        routesState: 'ready',
        observedAt,
        receivedAt: null,
      })
    );
    expect(markup.indexOf('Antigravity')).toBeLessThan(markup.indexOf('Claude OAuth</strong>'));
    expect(markup).toContain('Cooling down');
    expect(markup).toContain('→ Claude OAuth');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('dashboard_live.');
  });
});
