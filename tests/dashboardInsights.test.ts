import { describe, expect, spyOn, test } from 'bun:test';
import type {
  DashboardModel,
  DashboardRequest,
  DashboardRoute,
  DashboardSummary,
} from '../src/services/api/dashboard';
import { dashboardApi } from '../src/services/api/dashboard';
import { loadRecentActivity } from '../src/features/dashboard/hooks/useDashboardData';
import {
  PULSE_MINUTES,
  baselinePerMinute,
  collapseRoutes,
  summarizeActivity,
  summarizeProviders,
  topModels,
  waitParts,
} from '../src/features/dashboard/insights';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;

let sequence = 0;
const request = (
  completedAgo: number,
  durationMs = 2000,
  outcome: DashboardRequest['outcome'] = 'success'
): DashboardRequest => ({
  id: `r-${(sequence += 1)}`,
  traceId: '',
  model: 'm',
  provider: 'p',
  startedAt: at(completedAgo + durationMs),
  completedAt: at(completedAgo),
  statusCode: outcome === 'failed' ? 429 : 200,
  outcome,
  durationMs,
  reason: null,
  archiveRequestId: null,
});

const summary = (overrides: Partial<DashboardSummary>): DashboardSummary => ({
  observedAt: at(0),
  coverageStart: at(24 * 60 * MIN),
  partial: false,
  window: '24h',
  total: 0,
  success: 0,
  failed: 0,
  byModel: [],
  byProvider: [],
  ...overrides,
});

const route = (overrides: Partial<DashboardRoute>): DashboardRoute => ({
  provider: 'p',
  providerLabel: 'P',
  priority: 0,
  readyCredentials: 1,
  status: 'ready',
  cooldownReason: null,
  retryAt: null,
  ...overrides,
});

describe('activity pulse', () => {
  test('bins completions per minute, newest last, and splits failures', () => {
    const activity = summarizeActivity(
      {
        observedAt: at(0),
        complete: true,
        requests: [request(10_000), request(20_000, 2000, 'failed'), request(3 * MIN + 5_000)],
      },
      null
    );
    expect(activity.bins).toHaveLength(PULSE_MINUTES);
    expect(activity.bins.at(-1)).toEqual({ success: 1, failed: 1, known: true });
    expect(activity.bins.at(-4)).toEqual({ success: 1, failed: 0, known: true });
    expect(activity.peak).toBe(2);
    expect(activity.pacePerMinute).toBeCloseTo(3 / 5);
    expect(activity.lastCompletedAgoMs).toBe(10_000);
    expect(activity.level).toBe('active');
  });

  test('concurrency follows Little’s law and clips requests that began before the window', () => {
    const activity = summarizeActivity(
      {
        observedAt: at(0),
        complete: true,
        // 60s inside the window + only the last 5 minutes of a 10-minute stream.
        requests: [request(0, 60_000), request(0, 10 * MIN)],
      },
      null
    );
    expect(activity.concurrency).toBeCloseTo((60_000 + 5 * MIN) / (5 * MIN));
  });

  test('a capped feed marks unloaded minutes unknown and the pace as a lower bound', () => {
    const requests = Array.from({ length: 400 }, (_, index) => request(index * 500));
    const activity = summarizeActivity({ observedAt: at(0), complete: false, requests }, 10);
    // 400 rows reach back 199.5s: minutes older than that are not observed.
    expect(activity.bins.at(-1)?.known).toBe(true);
    expect(activity.bins.at(-4)?.known).toBe(false);
    expect(activity.bins[0].known).toBe(false);
    expect(activity.paceIsLowerBound).toBe(true);
    expect(activity.concurrency).toBeNull();
    expect(activity.level).toBe('busy');
  });

  test('compares the current pace with the 24-hour baseline', () => {
    const feed = (count: number) => ({
      observedAt: at(0),
      complete: true,
      requests: Array.from({ length: count }, (_, index) => request(index * 1000)),
    });
    expect(summarizeActivity(feed(0), 2).level).toBe('idle');
    expect(summarizeActivity(feed(5), 2).level).toBe('quiet'); // 1/min
    expect(summarizeActivity(feed(10), 2).level).toBe('steady'); // 2/min
    expect(summarizeActivity(feed(20), 2).level).toBe('busy'); // 4/min
  });

  test('the baseline uses only the covered span and refuses a too-short history', () => {
    expect(baselinePerMinute(summary({ total: 1440 }))).toBeCloseTo(1);
    expect(baselinePerMinute(summary({ total: 120, coverageStart: at(60 * MIN) }))).toBeCloseTo(2);
    expect(baselinePerMinute(summary({ total: 50, coverageStart: at(10 * MIN) }))).toBeNull();
    expect(baselinePerMinute(null)).toBeNull();
  });

  test('empty feeds have no NaN and no invented last request', () => {
    const activity = summarizeActivity({ observedAt: at(0), complete: true, requests: [] }, null);
    expect(activity.pacePerMinute).toBe(0);
    expect(activity.concurrency).toBe(0);
    expect(activity.lastCompletedAgoMs).toBeNull();
    expect(activity.peak).toBe(1);
    expect(activity.level).toBe('idle');
  });
});

describe('route collapsing', () => {
  test('merged variants keep each provider once with its best status and soonest retry', () => {
    const routes = collapseRoutes([
      route({
        provider: 'a',
        status: 'cooling',
        readyCredentials: 0,
        retryAt: at(-10 * MIN),
        cooldownReason: 'quota',
      }),
      route({ provider: 'b', status: 'standby', priority: -1 }),
      route({
        provider: 'a',
        status: 'cooling',
        readyCredentials: 0,
        retryAt: at(-2 * MIN),
        cooldownReason: 'credential_quota',
      }),
      route({ provider: 'c', status: 'ready' }),
    ]);
    expect(routes.map((entry) => [entry.provider, entry.status])).toEqual([
      ['c', 'ready'],
      ['b', 'standby'],
      ['a', 'cooling'],
    ]);
    expect(routes[2].retryAt).toBe(at(-2 * MIN));
    expect(routes[2].reason).toBe('credential_quota');
  });

  test('a ready tier with a retry timer is still serving, only partially cooling', () => {
    const [entry] = collapseRoutes([route({ status: 'ready', retryAt: at(-MIN) })]);
    expect(entry.status).toBe('ready');
    expect(entry.partial).toBe(true);
  });
});

describe('provider status', () => {
  const models: DashboardModel[] = [
    {
      id: 'opus',
      label: 'Opus',
      lastUsedProvider: null,
      routes: [
        route({
          provider: 'anti',
          providerLabel: 'Antigravity',
          status: 'cooling',
          readyCredentials: 0,
          retryAt: at(-3 * MIN),
          cooldownReason: 'quota',
        }),
        route({ provider: 'oauth', providerLabel: 'Claude OAuth' }),
      ],
    },
    {
      id: 'gemini',
      label: 'Gemini',
      lastUsedProvider: null,
      routes: [
        route({
          provider: 'anti',
          providerLabel: 'Antigravity',
          status: 'cooling',
          readyCredentials: 0,
          retryAt: at(-9 * MIN),
          cooldownReason: 'credential_quota',
        }),
      ],
    },
    {
      id: 'sol',
      label: 'Sol',
      lastUsedProvider: null,
      routes: [
        route({ provider: 'codex', providerLabel: 'Codex' }),
        route({ provider: 'api', providerLabel: 'OpenAI API', status: 'standby', priority: -20 }),
      ],
    },
  ];

  test('groups cooling routes per provider with fallbacks, usage order and soonest retry', () => {
    const providers = summarizeProviders(models, [
      { id: 'sol', total: 50, success: 50, failed: 0 },
      { id: 'opus', total: 9, success: 9, failed: 0 },
    ]);
    expect(providers.map((provider) => [provider.label, provider.state])).toEqual([
      ['Antigravity', 'cooling'],
      ['Codex', 'serving'],
      ['Claude OAuth', 'serving'],
      ['OpenAI API', 'standby'],
    ]);
    const [anti] = providers;
    expect(anti.cooling).toEqual([
      { id: 'opus', label: 'Opus', requests: 9, servedBy: 'Claude OAuth' },
      { id: 'gemini', label: 'Gemini', requests: 0, servedBy: null },
    ]);
    expect(anti.stranded).toBe(1);
    expect(anti.retryAt).toBe(at(-3 * MIN));
    expect(anti.reason).toBe('quota');
    expect(providers[3].standby.map((model) => model.id)).toEqual(['sol']);
  });

  test('a provider never counts itself as the fallback for its own cooling route', () => {
    const [entry] = summarizeProviders([
      {
        id: 'x',
        label: 'X',
        lastUsedProvider: null,
        routes: [route({ status: 'cooling', readyCredentials: 0, retryAt: at(-MIN) })],
      },
    ]);
    expect(entry.cooling[0].servedBy).toBeNull();
  });
});

describe('top models', () => {
  test('ranks used models, ignores unattributed rows, and shares against every request', () => {
    const rows = topModels(
      summary({
        total: 10,
        success: 10,
        byModel: [
          { id: 'b', total: 2, success: 2, failed: 0 },
          { id: '', total: 4, success: 4, failed: 0 },
          { id: 'a', total: 4, success: 3, failed: 1 },
          { id: 'z', total: 0, success: 0, failed: 0 },
        ],
      }),
      [{ id: 'a', label: 'Model A', lastUsedProvider: null, routes: [route({})] }]
    );
    expect(rows.map((row) => [row.id, row.label, row.share])).toEqual([
      ['a', 'Model A', 40],
      ['b', 'b', 20],
    ]);
    expect(rows[0].routes).toHaveLength(1);
    expect(rows[1].routes).toEqual([]);
    expect(topModels(null, [])).toEqual([]);
  });
});

describe('wait formatting', () => {
  test('uses at most two units and never overstates the remaining time', () => {
    expect(waitParts(0)).toEqual({ unit: 'now' });
    expect(waitParts(-5)).toEqual({ unit: 'now' });
    expect(waitParts(1_200)).toEqual({ unit: 'seconds', seconds: 2 });
    expect(waitParts(59 * MIN + 59_000)).toEqual({ unit: 'minutes', minutes: 59 });
    expect(waitParts(2 * 60 * MIN + 5 * MIN)).toEqual({ unit: 'hours', hours: 2, minutes: 5 });
    expect(waitParts((3 * 24 + 23) * 60 * MIN + 30 * MIN)).toEqual({
      unit: 'days',
      days: 3,
      hours: 23,
    });
  });
});

describe('recent activity loader', () => {
  const page = (agesMs: number[], nextCursor: string | null) => ({
    observedAt: at(0),
    coverageStart: at(60 * MIN),
    partial: false,
    window: '1h' as const,
    nextCursor,
    requests: agesMs.map((age) => request(age)),
  });

  test('follows cursors until the pulse horizon, then stops', async () => {
    const pages = [
      page([0, 5 * MIN], 'c1'),
      page([10 * MIN, 16 * MIN], 'c2'),
      page([20 * MIN], null),
    ];
    const cursors: Array<string | null | undefined> = [];
    const spy = spyOn(dashboardApi, 'getRequests').mockImplementation(async (query) => {
      cursors.push(query.cursor);
      return pages[cursors.length - 1];
    });
    try {
      const recent = await loadRecentActivity(new AbortController().signal);
      expect(cursors).toEqual([undefined, 'c1']);
      expect(recent.requests).toHaveLength(4);
      expect(recent.complete).toBe(true);
      expect(recent.observedAt).toBe(at(0));
    } finally {
      spy.mockRestore();
    }
  });

  test('a capped page budget reports an incomplete horizon instead of an empty one', async () => {
    let call = 0;
    const spy = spyOn(dashboardApi, 'getRequests').mockImplementation(async () => {
      call += 1;
      return page([call * 1000], `c${call}`);
    });
    try {
      const recent = await loadRecentActivity(new AbortController().signal);
      expect(call).toBe(4);
      expect(recent.complete).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
