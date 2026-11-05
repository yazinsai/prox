import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { apiClient } from '../src/services/api/client';
import { normalizeQuotaHistory, quotaHistoryApi } from '../src/services/api/quotaHistory';
import type { QuotaHistoryCredential } from '../src/services/api/quotaHistory';
import {
  buildPoolAccount,
  burnRate,
  drainSeries,
  findHistory,
  historySamples,
  niceCeiling,
  poolDays,
  poolSpan,
  projectAccount,
  summarizePool,
  HOUR_MS,
  type PoolAccount,
} from '../src/features/quota/pool/poolModel';
import { QuotaPoolPanel } from '../src/features/quota/components/QuotaPoolPanel';

const NOW = new Date(2026, 10, 5, 12).getTime();
const H = HOUR_MS;

const account = (overrides: Partial<PoolAccount>): PoolAccount => ({
  key: 'a.json',
  name: 'a.json',
  label: 'a@example.com',
  provider: 'claude',
  remaining: 50,
  nextResetMs: null,
  periodMs: 168 * H,
  history: [],
  source: 'live',
  ...overrides,
});

const claudeQuota = (usedPercent: number, resetAtMs: number) => ({
  status: 'success',
  windows: [
    { id: 'five-hour', label: '5h', usedPercent: 10, resetAtMs: NOW + 2 * H, periodHours: 5 },
    { id: 'seven-day', label: '7d', usedPercent, resetAtMs, periodHours: 168 },
  ],
});

describe('quota history API', () => {
  const originalGet = apiClient.get;
  afterEach(() => {
    apiClient.get = originalGet;
  });

  test('normalizes the snake_case payload and drops malformed entries', () => {
    const history = normalizeQuotaHistory({
      recording: true,
      since: '2026-11-01T00:00:00Z',
      until: '2026-11-05T12:00:00Z',
      oldest_at: '2026-11-05T11:39:10Z',
      credentials: [
        {
          auth_id: 'claude-a.json',
          auth_index: 'abc',
          name: 'claude-a.json',
          provider: 'Claude',
          series: [
            {
              id: 'seven-day',
              window_minutes: 10080,
              points: [[2000, 61, 9000], [1000, 47, 9000], ['x']],
            },
            { id: '', window_minutes: 300, points: [] },
          ],
        },
        { provider: 'codex' },
      ],
    });
    expect(history?.recording).toBe(true);
    expect(history?.oldestMs).toBe(Date.parse('2026-11-05T11:39:10Z'));
    expect(history?.credentials).toHaveLength(1);
    const [credential] = history!.credentials;
    expect(credential.provider).toBe('claude');
    expect(credential.series).toHaveLength(1);
    expect(credential.series[0].points.map((point) => point.atMs)).toEqual([1000, 2000]);
    expect(credential.series[0].points[0]).toEqual({
      atMs: 1000,
      usedPercent: 47,
      resetAtMs: 9000,
    });
  });

  test('reports an older backend without the endpoint as null, other failures as errors', async () => {
    apiClient.get = (async () => {
      throw Object.assign(new Error('not found'), { status: 404 });
    }) as typeof apiClient.get;
    expect(await quotaHistoryApi.get(NOW)).toBeNull();

    apiClient.get = (async () => {
      throw Object.assign(new Error('boom'), { status: 500 });
    }) as typeof apiClient.get;
    await expect(quotaHistoryApi.get(NOW)).rejects.toThrow('boom');
  });

  test('requests the span start as an RFC 3339 timestamp', async () => {
    let seen: unknown;
    apiClient.get = (async (url: string, config?: { params?: unknown }) => {
      seen = { url, params: config?.params };
      return { since: '2026-11-01T00:00:00Z', until: '2026-11-05T00:00:00Z', credentials: [] };
    }) as typeof apiClient.get;
    await quotaHistoryApi.get(Date.parse('2026-11-01T00:00:00.500Z'));
    expect(seen).toEqual({
      url: '/credentials/quota/history',
      params: { since: '2026-11-01T00:00:00Z' },
    });
  });
});

describe('pool accounts', () => {
  test('draws a window that rolled between readings as a vertical reset', () => {
    const samples = historySamples({
      id: 'five-hour',
      windowMinutes: 300,
      points: [
        { atMs: 1 * H, usedPercent: 100, resetAtMs: 2 * H },
        { atMs: 3 * H, usedPercent: 10, resetAtMs: 7 * H },
      ],
    });
    expect(samples).toEqual([
      { atMs: 1 * H, value: 0 },
      { atMs: 2 * H, value: 0 },
      { atMs: 2 * H, value: 100 },
      { atMs: 3 * H, value: 90 },
    ]);
  });

  test('uses live quota for the longest window that fits the span', () => {
    const built = buildPoolAccount(
      {
        key: 'a',
        name: 'a.json',
        label: 'a',
        provider: 'claude',
        authIndex: null,
        quota: claudeQuota(40, NOW + 24 * H),
      },
      undefined,
      NOW
    );
    expect(built).toMatchObject({
      remaining: 60,
      nextResetMs: NOW + 24 * H,
      periodMs: 168 * H,
      source: 'live',
    });
  });

  test('treats a live window whose reset already passed as full, next reset one period on', () => {
    const built = buildPoolAccount(
      {
        key: 'a',
        name: 'a.json',
        label: 'a',
        provider: 'claude',
        authIndex: null,
        quota: claudeQuota(90, NOW - H),
      },
      undefined,
      NOW
    );
    expect(built.remaining).toBe(100);
    expect(built.nextResetMs).toBe(NOW - H + 168 * H);
  });

  test('falls back to the latest archived reading when quota is not loaded', () => {
    const history: QuotaHistoryCredential = {
      authId: 'claude-a.json',
      authIndex: 'idx-1',
      name: 'claude-a.json',
      provider: 'claude',
      series: [
        {
          id: 'five-hour',
          windowMinutes: 300,
          points: [{ atMs: NOW - H, usedPercent: 80, resetAtMs: NOW + H }],
        },
        {
          id: 'seven-day',
          windowMinutes: 10080,
          points: [
            { atMs: NOW - 2 * H, usedPercent: 50, resetAtMs: NOW + 48 * H },
            { atMs: NOW - H, usedPercent: 55, resetAtMs: NOW + 48 * H },
          ],
        },
      ],
    };
    const input = {
      key: 'k',
      name: 'claude-a.json',
      label: 'a',
      provider: 'claude' as const,
      authIndex: 'idx-1',
      quota: undefined,
    };
    expect(findHistory(input, [history])).toBe(history);
    expect(findHistory({ ...input, authIndex: null }, [history])).toBe(history);
    expect(
      findHistory({ ...input, authIndex: 'other', name: 'b.json' }, [history])
    ).toBeUndefined();

    const built = buildPoolAccount(input, history, NOW);
    expect(built).toMatchObject({ remaining: 45, nextResetMs: NOW + 48 * H, source: 'history' });
    // Recorded line ends at now so it meets the projection.
    expect(built.history.at(-1)).toEqual({ atMs: NOW, value: 45 });
  });
});

describe('burn and projection', () => {
  test('counts only consumption, ignoring resets, over the covered part of the window', () => {
    const history = [
      { atMs: NOW - 3 * H, value: 80 },
      { atMs: NOW - 2 * H, value: 70 },
      { atMs: NOW - 2 * H, value: 100 },
      { atMs: NOW, value: 90 },
    ];
    expect(burnRate(history, NOW, 3)).toBeCloseTo(20 / 3, 6);
    expect(burnRate(history, NOW, 1)).toBeCloseTo(5, 6);
    expect(
      burnRate(
        [
          { atMs: NOW - 60_000, value: 50 },
          { atMs: NOW, value: 49 },
        ],
        NOW,
        3
      )
    ).toBeNull();
    expect(burnRate([], NOW, 3)).toBeNull();
  });

  test('drains to empty, then refills at each reset', () => {
    const projection = projectAccount(
      account({ remaining: 20, nextResetMs: NOW + 10 * H, periodMs: 24 * H }),
      4,
      NOW,
      NOW + 36 * H
    );
    expect(projection.emptyAtMs).toBe(NOW + 5 * H);
    expect(projection.points).toContainEqual({ atMs: NOW + 10 * H, value: 0 });
    expect(projection.points).toContainEqual({ atMs: NOW + 10 * H, value: 100 });
    expect(projection.points).toContainEqual({ atMs: NOW + 34 * H, value: 4 });
    expect(projection.points).toContainEqual({ atMs: NOW + 34 * H, value: 100 });
    expect(projection.points.at(-1)).toEqual({ atMs: NOW + 36 * H, value: 92 });
  });

  test('summarizes the pool: total, resets, first and pool empty', () => {
    const span = { startMs: NOW - 3 * 24 * H, endMs: NOW + 11 * 24 * H };
    const busy = account({
      key: 'busy',
      remaining: 30,
      nextResetMs: NOW + 48 * H,
      history: [
        { atMs: NOW - 3 * H, value: 60 },
        { atMs: NOW, value: 30 },
      ],
    });
    const idle = account({
      key: 'idle',
      label: 'idle@example.com',
      remaining: 80,
      nextResetMs: NOW + 48 * H + 30_000,
    });
    const summary = summarizePool([busy, idle], {
      now: NOW,
      span,
      burnWindowHours: 3,
      futureUsage: 'same',
    });

    expect(summary.total).toBe(110);
    expect(summary.capacity).toBe(200);
    expect(summary.burnPerHour).toBeCloseTo(10, 6);
    expect(summary.firstEmpty?.account.key).toBe('busy');
    expect(summary.firstEmpty?.atMs).toBe(NOW + 3 * H);
    // Both resets fall within a minute: one event restoring busy (empty) + idle (unused).
    expect(summary.nextReset?.atMs).toBe(NOW + 48 * H);
    expect(summary.nextReset?.added).toBeCloseTo(100 + 20, 6);
    expect(summary.poolEmptyAtMs).toBeNull();
    expect(summary.recorded[0]).toEqual({ atMs: NOW - 3 * H, value: 140 });
    expect(summary.projectedJumps.length).toBeGreaterThan(0);

    const doubled = summarizePool([busy, idle], {
      now: NOW,
      span,
      burnWindowHours: 3,
      futureUsage: 'double',
    });
    expect(doubled.firstEmpty?.atMs).toBe(NOW + 1.5 * H);
    const none = summarizePool([busy, idle], {
      now: NOW,
      span,
      burnWindowHours: 3,
      futureUsage: 'none',
    });
    expect(none.firstEmpty).toBeNull();
  });

  test('finds when the whole pool runs dry', () => {
    const span = { startMs: NOW, endMs: NOW + 14 * 24 * H };
    const draining = account({
      remaining: 20,
      history: [
        { atMs: NOW - 2 * H, value: 40 },
        { atMs: NOW, value: 20 },
      ],
    });
    const summary = summarizePool([draining], {
      now: NOW,
      span,
      burnWindowHours: 3,
      futureUsage: 'same',
    });
    expect(summary.poolEmptyAtMs).toBe(NOW + 2 * H);
  });

  test('derives drain-rate steps from the recorded and projected pool', () => {
    const drain = drainSeries(
      [
        { atMs: 0, value: 100 },
        { atMs: H, value: 90 },
        { atMs: H, value: 190 },
        { atMs: 2 * H, value: 185 },
      ],
      [
        { atMs: 2 * H, value: 185 },
        { atMs: 4 * H, value: 175 },
      ]
    );
    expect(drain.recorded.map((point) => point.value)).toEqual([10, 10, 5, 5]);
    expect(drain.projected).toEqual([
      { atMs: 2 * H, value: 5 },
      { atMs: 4 * H, value: 5 },
    ]);
    expect(niceCeiling(7.3)).toBe(10);
    expect(niceCeiling(0)).toBe(1);
  });

  test('spans two weeks starting three days before today, stepping by weeks', () => {
    const span = poolSpan(0, NOW);
    expect(new Date(span.startMs).getDate()).toBe(2);
    expect(poolDays(span)).toHaveLength(14);
    expect(poolSpan(-1, NOW).endMs).toBe(new Date(2026, 10, 9).getTime());
  });
});

describe('pool panel', () => {
  const originalLanguage = i18n.language;
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage(originalLanguage);
  });
  const span = { startMs: NOW - 3 * 24 * H, endMs: NOW + 11 * 24 * H };
  const summary = summarizePool(
    [
      account({
        key: 'a',
        label: 'first@example.com',
        remaining: 30,
        nextResetMs: NOW + 48 * H,
        history: [
          { atMs: NOW - 3 * H, value: 60 },
          { atMs: NOW, value: 30 },
        ],
      }),
      account({ key: 'b', label: 'second@example.com', remaining: 80, nextResetMs: NOW + 72 * H }),
    ],
    { now: NOW, span, burnWindowHours: 3, futureUsage: 'same' }
  );
  const props = {
    providerLabel: 'Claude',
    accent: 'var(--accent-claude)',
    accountCount: 2,
    summary,
    mode: 'remaining' as const,
    burnWindowHours: 3,
    span,
    days: poolDays(span),
    now: NOW,
    showAccounts: false,
    showEmails: false,
  };

  test('renders the pooled figure, the four stats and the chart', () => {
    const markup = renderToStaticMarkup(createElement(QuotaPoolPanel, props));
    expect(markup).toContain('110%');
    expect(markup).toContain('of 200%');
    expect(markup).toContain('2 accounts');
    expect(markup).toContain('Pool empty');
    expect(markup).toContain('First empty');
    expect(markup).toContain('in 3h 0m');
    expect(markup).toContain('Burn, last 3h');
    expect(markup).toContain('10%/h');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('Recorded');
    expect(markup).toContain('Projected');
  });

  test('hides account emails until asked, then shows them', () => {
    const hidden = renderToStaticMarkup(
      createElement(QuotaPoolPanel, { ...props, showAccounts: true })
    );
    expect(hidden).not.toContain('first@example.com');
    expect(hidden).toContain('aria-label="Email hidden"');

    const shown = renderToStaticMarkup(
      createElement(QuotaPoolPanel, { ...props, showAccounts: true, showEmails: true })
    );
    expect(shown).toContain('first@example.com');
    expect(shown).toContain('second@example.com');
  });

  test('explains an unloaded pool instead of drawing an empty chart', () => {
    const empty = summarizePool([account({ remaining: null, source: 'none' })], {
      now: NOW,
      span,
      burnWindowHours: 3,
      futureUsage: 'same',
    });
    const markup = renderToStaticMarkup(
      createElement(QuotaPoolPanel, { ...props, summary: empty })
    );
    expect(markup).toContain('Not loaded yet');
    expect(markup).not.toContain('role="img"');
  });
});
