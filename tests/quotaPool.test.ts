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
  evenPaceLine,
  findHistory,
  historySamples,
  poolDays,
  poolSpan,
  projectAccount,
  projectPool,
  summarizePool,
  windowAverageBurn,
  HOUR_MS,
  type PoolAccount,
} from '../src/features/quota/pool/poolModel';
import { formatDateRange, formatDuration } from '../src/features/quota/pool/poolFormat';
import { QuotaPoolPanel } from '../src/features/quota/components/QuotaPoolPanel';
import { describeOutlook, paceVersus } from '../src/features/quota/pool/poolOutlookCopy';
import { dayLabelStep, splitAtJumps } from '../src/features/quota/pool/chartGeometry';

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
    // Once busy is dry its 10%/h moves to idle, which lasts 8h more: the pool is dry
    // from 11h until busy's reset at 48h refills it.
    expect(summary.poolEmptyAtMs).toBeCloseTo(NOW + 11 * H, -2);
    expect(summary.dry[0]).toMatchObject({ endMs: NOW + 48 * H, refilled: true });
    expect(summary.nextReset?.atMs).toBe(NOW + 48 * H);
    expect(summary.nextReset?.added).toBeCloseTo(100, 6);
    expect(summary.outlook.kind).toBe('runs-out');
    expect(summary.outlook.refillAtMs).toBe(NOW + 48 * H);
    expect(summary.allowancePerHour).toBeCloseTo(200 / 168, 6);
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

  test("moves a dry account's demand onto the accounts that still have quota", () => {
    const projection = projectPool(
      [
        account({ key: 'a', remaining: 10, nextResetMs: NOW + 20 * H, periodMs: 24 * H }),
        account({ key: 'b', remaining: 30, nextResetMs: NOW + 40 * H, periodMs: 24 * H }),
      ],
      [5, 0],
      NOW,
      NOW + 30 * H
    );
    const [a, b] = projection.accounts;
    expect(a.emptyAtMs).toBe(NOW + 2 * H);
    // b picks up a's 5%/h at 2h and runs dry 6h later.
    expect(b.emptyAtMs).toBe(NOW + 8 * H);
    expect(projection.dry).toEqual([{ startMs: NOW + 8 * H, endMs: NOW + 20 * H, refilled: true }]);
    // After a refills at 20h it carries the whole demand again.
    expect(a.points.at(-1)).toEqual({ atMs: NOW + 30 * H, value: 50 });
  });

  test('draws the even pace that spends each window exactly by its reset', () => {
    const span = { startMs: NOW, endMs: NOW + 30 * H };
    const line = evenPaceLine({ nextResetMs: NOW + 6 * H, periodMs: 24 * H }, span);
    expect(line).toEqual([
      { atMs: NOW, value: 25 },
      { atMs: NOW + 6 * H, value: 0 },
      { atMs: NOW + 6 * H, value: 100 },
      { atMs: NOW + 30 * H, value: 0 },
    ]);
    expect(evenPaceLine({ nextResetMs: null, periodMs: 24 * H }, span)).toBeNull();
    expect(splitAtJumps(line ?? [])).toHaveLength(2);
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

  test('leads with the outlook, then left, pace and allowance, then the chart', () => {
    const markup = renderToStaticMarkup(createElement(QuotaPoolPanel, props));
    expect(markup).toContain('data-tone="danger"');
    expect(markup).toContain('Runs out in 11h');
    expect(markup).toContain('before it resets');
    expect(markup).toContain('110%');
    expect(markup).toContain('of 200%');
    expect(markup).toContain('2 accounts');
    expect(markup).toContain('Pace · last 3h');
    expect(markup).toContain('10%/h');
    expect(markup).toContain('8.4× allowance');
    expect(markup).toContain('200% per 7d');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('Forecast');
    expect(markup).toContain('Even pace');
    expect(markup).toContain('Out of quota');
    expect(markup.indexOf('Runs out in 11h')).toBeLessThan(markup.indexOf('role="img"'));
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

describe('pool outlook', () => {
  const originalLanguage = i18n.language;
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage(originalLanguage);
  });
  const span = { startMs: NOW - 3 * 24 * H, endMs: NOW + 11 * 24 * H };
  const options = { now: NOW, span, burnWindowHours: 3, futureUsage: 'same' as const };
  const burning = (remaining: number, perHour: number, resetInHours: number) =>
    account({
      remaining,
      nextResetMs: NOW + resetInHours * H,
      history: [
        { atMs: NOW - 3 * H, value: remaining + 3 * perHour },
        { atMs: NOW, value: remaining },
      ],
    });
  const copyOf = (accounts: PoolAccount[], usage: 'same' | 'none' = 'same') => {
    const summary = summarizePool(accounts, { ...options, futureUsage: usage });
    return { summary, copy: describeOutlook(summary, NOW, 3, i18n.t, 'en') };
  };

  test('runs out before the reset: when, and how long until it refills', () => {
    const { summary, copy } = copyOf([burning(30, 2, 48)]);
    expect(summary.outlook).toMatchObject({
      kind: 'runs-out',
      emptyAtMs: NOW + 15 * H,
      refillAtMs: NOW + 48 * H,
    });
    expect(copy.tone).toBe('danger');
    expect(copy.title).toBe('Runs out in 15h');
    expect(copy.detail).toContain('1d 9h before it resets');
  });

  test('lasts until the reset, tight when little is left, and warns about the next cycle', () => {
    const lasts = copyOf([burning(60, 0.5, 48)]);
    expect(lasts.summary.outlook.kind).toBe('lasts');
    expect(lasts.copy.tone).toBe('success');
    expect(lasts.copy.title).toBe('Lasts until the reset');
    expect(lasts.copy.detail).toContain('About 36% left when it resets');

    const tight = copyOf([burning(30, 0.6, 48)]);
    expect(tight.summary.outlook.kind).toBe('tight');
    expect(tight.copy.tone).toBe('warning');
    expect(tight.copy.title).toBe('Just lasts until the reset');
    expect(tight.copy.detail).toContain('About 1% left');
    // 100% at 0.6%/h lasts about 167h of the next 168h window: no dry spell yet.
    const harder = copyOf([burning(30, 0.62, 48)]);
    expect(harder.summary.outlook.kind).toBe('tight');
    expect(harder.copy.note).toContain('the next cycle runs out');
  });

  test('a pool reports its low point rather than its level at the last reset', () => {
    const { summary, copy } = copyOf([
      { ...burning(80, 1, 20), key: 'a' },
      { ...burning(90, 0, 60), key: 'b' },
    ]);
    expect(summary.outlook.kind).toBe('lasts');
    expect(summary.outlook.lowest).toEqual({ atMs: NOW + 20 * H, value: 150 });
    expect(copy.detail).toContain('Lowest point about 150%');
  });

  test('says empty, idle, unmeasured and not loaded plainly', () => {
    expect(copyOf([burning(0, 0, 30)]).copy).toMatchObject({
      tone: 'danger',
      title: 'Out of quota',
    });
    expect(copyOf([burning(0, 0, 30)]).copy.detail).toContain('Refills');
    expect(copyOf([burning(50, 0, 30)]).summary.outlook.kind).toBe('idle');
    // No history and a window opened moments ago: too soon even to average.
    expect(
      copyOf([account({ remaining: 90, nextResetMs: NOW + 168 * H - 5 * 60_000 })]).copy.title
    ).toBe('No pace to forecast from yet');
    // A "none" what-if keeps the measured pace but projects no use: it lasts.
    expect(copyOf([burning(30, 2, 48)], 'none').summary.outlook.kind).toBe('lasts');
    expect(copyOf([account({ remaining: null, loaded: true })]).copy.title).toBe(
      'Nothing counting down'
    );
  });

  test('compares pace with the allowance in a few words', () => {
    expect(paceVersus(null, i18n.t)).toBe('Needs history');
    expect(paceVersus(0, i18n.t)).toBe('Idle');
    expect(paceVersus(1.02, i18n.t)).toBe('On pace');
    expect(paceVersus(1.18, i18n.t)).toBe('18% over');
    expect(paceVersus(0.6, i18n.t)).toBe('40% under');
    expect(paceVersus(3.24, i18n.t)).toBe('3.2× allowance');
  });

  test('formats durations and ranges compactly', () => {
    expect(formatDuration(3 * H, 'en')).toBe('3h');
    expect(formatDuration(3 * H + 5 * 60_000, 'en')).toBe('3h 5m');
    expect(formatDuration(48 * H, 'en')).toBe('2d');
    expect(formatDuration(51 * H, 'en')).toBe('2d 3h');
    expect(
      formatDateRange(new Date(2026, 10, 12).getTime(), new Date(2026, 10, 25).getTime(), 'en')
    ).toBe('Nov 12 – 25');
  });

  test('thins day labels to fit narrow charts', () => {
    expect(dayLabelStep(75)).toBe(1);
    expect(dayLabelStep(24)).toBe(3);
    expect(dayLabelStep(10)).toBe(7);
  });
});

describe('window-average pace without history', () => {
  const originalLanguage = i18n.language;
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage(originalLanguage);
  });
  const span = { startMs: NOW - 3 * 24 * H, endMs: NOW + 11 * 24 * H };
  const options = { now: NOW, span, burnWindowHours: 3, futureUsage: 'same' as const };
  // A weekly window opened 40h ago with 20% used: 0.5%/h so far.
  const opened40h = account({ remaining: 80, nextResetMs: NOW + 128 * H });

  test('averages what the open window has used over the time it has been open', () => {
    expect(windowAverageBurn(opened40h, NOW)).toBeCloseTo(0.5, 6);
    expect(windowAverageBurn({ ...opened40h, source: 'history' }, NOW)).toBeNull();
    expect(windowAverageBurn({ ...opened40h, nextResetMs: null }, NOW)).toBeNull();
    expect(
      windowAverageBurn({ ...opened40h, nextResetMs: NOW + 168 * H - 60_000 }, NOW)
    ).toBeNull();
  });

  test('forecasts a pool with no history from the window average', () => {
    const summary = summarizePool([opened40h], options);
    expect(summary.burnSource).toBe('window');
    expect(summary.burnPerHour).toBeCloseTo(0.5, 6);
    // 80% at 0.5%/h lasts 160h, past the reset in 128h.
    expect(summary.outlook.kind).toBe('lasts');
    expect(summary.recorded).toEqual([]);
  });

  test('keeps recorded pace when any account in the pool has history', () => {
    const recorded = account({
      key: 'recorded',
      remaining: 70,
      nextResetMs: NOW + 48 * H,
      history: [
        { atMs: NOW - 3 * H, value: 76 },
        { atMs: NOW, value: 70 },
      ],
    });
    const summary = summarizePool([recorded, { ...opened40h, key: 'other' }], options);
    expect(summary.burnSource).toBe('recent');
    expect(summary.burnPerHour).toBeCloseTo(2, 6);
  });

  test('labels the pace by its source', () => {
    const summary = summarizePool([{ ...opened40h, remaining: 100 }], options);
    expect(summary.outlook.kind).toBe('idle');
    expect(describeOutlook(summary, NOW, 3, i18n.t).detail).toContain('Nothing used this window');
    const html = renderToStaticMarkup(
      createElement(QuotaPoolPanel, {
        providerLabel: 'OpenCode Go',
        accent: 'var(--text-primary)',
        accountCount: 1,
        summary: summarizePool([opened40h], options),
        mode: 'remaining' as const,
        burnWindowHours: 3,
        span,
        days: poolDays(span),
        now: NOW,
        showAccounts: false,
        showEmails: false,
      })
    );
    expect(html).toContain('Pace · this window');
  });
});
