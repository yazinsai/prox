import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '../src/services/api/client';
import {
  dashboardApi,
  normalizeDashboardRequestDetail,
  normalizeDashboardRequests,
  normalizeDashboardRoutes,
  normalizeDashboardSummary,
} from '../src/services/api/dashboard';

const now = '2026-11-07T12:00:00Z';
const coverage = {
  supported: true,
  observed_at: now,
  coverage_start: '2026-11-07T10:00:00Z',
  partial: true,
  window: '8h',
};
const request = {
  id: 'request-fixture',
  trace_id: 'trace-fixture',
  model: 'exact-model-id',
  provider: 'public-provider-group',
  started_at: '2026-11-07T11:59:58Z',
  completed_at: now,
  status_code: 200,
  outcome: 'interrupted',
  duration_ms: 2000,
  reason: 'stream_interrupted',
  archive_request_id: null,
};
const feed = { ...coverage, requests: [request], next_cursor: 'opaque-cursor' };
const summary = {
  ...coverage,
  total: 3,
  success: 2,
  failed: 1,
  by_model: [
    { id: 'alias-a', total: 2, success: 1, failed: 1 },
    { id: 'alias-b', total: 1, success: 1, failed: 0 },
  ],
  by_provider: [{ id: 'public-provider-group', total: 3, success: 2, failed: 1 }],
};
const routes = {
  observed_at: now,
  runtime_known: true,
  models: [
    {
      id: 'exact-model-id',
      label: 'Model display alias',
      last_used_provider: 'public-provider-group',
      routes: [
        {
          provider: 'oauth-provider',
          provider_label: 'OAuth provider',
          priority: 5,
          ready_credentials: 2,
          status: 'ready',
        },
        {
          provider: 'compatibility-provider',
          provider_label: 'Compatibility group',
          priority: -1,
          ready_credentials: 0,
          status: 'cooling',
          cooldown_reason: 'quota',
          retry_at: '2026-11-07T12:04:00Z',
        },
      ],
    },
  ],
};

afterEach(() => {
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

describe('dashboard contracts', () => {
  test('all seven locales preserve dashboard keys and interpolation parameters', () => {
    const read = (locale: string): Record<string, string> =>
      JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      ).dashboard_live;
    const english = read('en');
    for (const locale of ['zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const translated = read(locale);
      expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english)) {
        const parameters = (value: string) =>
          [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
        expect(parameters(translated[key])).toEqual(parameters(english[key]));
      }
    }
    for (const reason of [
      'rate_limited',
      'unauthorized',
      'upstream_error',
      'invalid_request',
      'cancelled',
      'stream_interrupted',
      'unknown',
    ]) {
      expect(english[`reason_${reason}`]).toBeString();
    }
  });
  test('preserves exact IDs, tier priority, cooldown time and observation timestamp', () => {
    const normalized = normalizeDashboardRoutes(routes);
    expect(normalized.observedAt).toBe(now);
    expect(normalized.models[0].id).toBe('exact-model-id');
    expect(normalized.models[0].lastUsedProvider).toBe('public-provider-group');
    expect(normalized.models[0].routes[0]).toEqual({
      provider: 'oauth-provider',
      providerLabel: 'OAuth provider',
      priority: 5,
      readyCredentials: 2,
      status: 'ready',
      cooldownReason: null,
      retryAt: null,
    });
    expect(normalized.models[0].routes[1].priority).toBe(-1);
    expect(normalized.models[0].routes[1].retryAt).toBe('2026-11-07T12:04:00Z');
  });

  test('unknown scheduler state cannot imply eligible credentials', () => {
    const normalized = normalizeDashboardRoutes({ ...routes, runtime_known: false });
    expect(normalized.runtimeKnown).toBe(false);
    for (const route of normalized.models[0].routes) {
      expect(route.status).toBe('unknown');
      expect(route.readyCredentials).toBe(0);
    }
    expect(() => normalizeDashboardRoutes({ ...routes, runtime_known: undefined })).toThrow();
  });

  test('counts terminal stream failures separately from HTTP status and retains coverage', () => {
    const normalized = normalizeDashboardRequests(feed);
    expect(normalized.partial).toBe(true);
    expect(normalized.coverageStart).toBe(coverage.coverage_start);
    expect(normalized.requests[0].statusCode).toBe(200);
    expect(normalized.requests[0].outcome).toBe('interrupted');
    expect(normalized.nextCursor).toBe('opaque-cursor');
    const detail = normalizeDashboardRequestDetail({
      supported: true,
      request: {
        ...request,
        attempts: [
          {
            ...request,
            id: 'attempt-fixture',
            status_code: 429,
            outcome: 'failed',
            reason: 'rate_limited',
          },
        ],
      },
    });
    expect(detail.attempts[0].statusCode).toBe(429);
    expect(detail.attempts[0].reason).toBe('rate_limited');
    expect(detail.archiveRequestId).toBeNull();
  });

  test('whitelists fields and hides arbitrary upstream error text', () => {
    const normalized = normalizeDashboardRequestDetail({
      supported: true,
      request: {
        ...request,
        reason: 'raw upstream secret fixture',
        headers: { Authorization: 'fixture-auth' },
        body: 'fixture body',
        attempts: [{ ...request, token: 'fixture-token', reason: 'raw upstream secret fixture' }],
      },
    });
    expect(normalized.reason).toBe('unknown');
    expect(normalized.attempts[0].reason).toBe('unknown');
    const encoded = JSON.stringify(normalized);
    for (const value of [
      'raw upstream secret fixture',
      'fixture-auth',
      'fixture body',
      'fixture-token',
    ]) {
      expect(encoded).not.toContain(value);
    }
  });

  test('does not merge distinct requested model IDs and rejects fabricated totals', () => {
    const normalized = normalizeDashboardSummary(summary);
    expect(normalized.byModel.map((row) => row.id)).toEqual(['alias-a', 'alias-b']);
    expect(normalized.total).toBe(3);
    for (const invalid of [
      { ...summary, total: 4 },
      { ...summary, success: -1 },
      { ...summary, failed: Number.NaN },
      { ...summary, total: 3.5 },
      { ...summary, window: 'legacy' },
      { ...summary, coverage_start: '' },
      { ...summary, supported: false },
    ]) {
      expect(() => normalizeDashboardSummary(invalid)).toThrow();
    }
    const empty = normalizeDashboardSummary({
      ...summary,
      total: 0,
      success: 0,
      failed: 0,
      by_model: [],
      by_provider: [],
    });
    expect(empty.total).toBe(0);
    expect(empty.byModel).toEqual([]);
  });

  test('rejects malformed route eligibility and request timing', () => {
    expect(() => normalizeDashboardRoutes({ ...routes, observed_at: 'invalid' })).toThrow();
    expect(() =>
      normalizeDashboardRoutes({
        ...routes,
        models: [
          {
            ...routes.models[0],
            routes: [{ ...routes.models[0].routes[0], ready_credentials: -1 }],
          },
        ],
      })
    ).toThrow();
    for (const invalid of [
      { ...request, outcome: 'unknown' },
      { ...request, duration_ms: Infinity },
      { ...request, status_code: 999 },
      { ...request, completed_at: '' },
      { ...request, id: '' },
    ]) {
      expect(() => normalizeDashboardRequests({ ...feed, requests: [invalid] })).toThrow();
    }
  });

  test('queries the v8 dashboard feed with a shared window, error outcome and opaque cursor', async () => {
    apiClient.setConfig({ apiBase: 'https://proxy.invalid', managementKey: 'fixture-only' });
    const captured = apiClient.captureConnection();
    const capture = spyOn(apiClient, 'captureConnection').mockReturnValue(captured);
    const get = spyOn(captured, 'get').mockResolvedValue(feed);
    const controller = new AbortController();
    try {
      await dashboardApi.getRequests(
        { window: '8h', outcome: 'failed', cursor: 'opaque-cursor', limit: 32 },
        controller.signal
      );
      expect(get).toHaveBeenCalledWith('/observability/dashboard/requests', {
        params: { window: '8h', outcome: 'failed', cursor: 'opaque-cursor', limit: 32 },
        signal: controller.signal,
      });
      get.mockResolvedValue({ ...feed, window: '1h' });
      await expect(dashboardApi.getRequests({ window: '8h' })).rejects.toThrow();
    } finally {
      get.mockRestore();
      capture.mockRestore();
    }
  });
});
