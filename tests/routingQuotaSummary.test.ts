import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import type { ClaudeQuotaState, KimiQuotaState, MetaQuotaState, XaiQuotaState } from '../src/types';
import { nextQuotaReset, summarizeQuota } from '../src/features/routing/quotaSummary';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '../src/features/quota/types';
import { QuotaObservationRow } from '../src/features/routing/components/QuotaObservationRow';

const claude: ClaudeQuotaState = {
  status: 'success',
  windows: [
    {
      id: 'seven-day-opus',
      label: 'Opus',
      usedPercent: 95,
      resetLabel: 'soon',
      periodHours: 168,
      resetAtMs: 20_000,
    },
    {
      id: 'five-hour',
      label: '5-hour',
      usedPercent: 40,
      resetLabel: 'soon',
      periodHours: 5,
      resetAtMs: 10_000,
    },
    {
      id: 'seven-day',
      label: '7-day',
      usedPercent: 10,
      resetLabel: 'later',
      periodHours: 168,
      resetAtMs: 30_000,
    },
  ],
};

describe('compact routing quota summaries', () => {
  test('chooses account-wide short and weekly windows before model-specific limits', () => {
    const windows = summarizeQuota('claude', claude);
    expect(windows.map((window) => window.id)).toEqual(['five-hour', 'seven-day']);
    expect(windows.map((window) => window.remaining)).toEqual([60, 90]);
    expect(nextQuotaReset(windows, 1_000)).toBe(10_000);
  });

  test('keeps measured percentages even when the provider did not report a reset time', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        { id: 'five-hour', label: '5-hour', usedPercent: 25, resetLabel: '—', periodHours: 5 },
      ],
    };
    expect(summarizeQuota('claude', quota)[0].remaining).toBe(75);
    expect(nextQuotaReset(summarizeQuota('claude', quota), 0)).toBeNull();
  });

  test('unknown and invalid percentages are never displayed as full availability', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        { id: 'five-hour', label: '5-hour', usedPercent: null, resetLabel: '—' },
        { id: 'seven-day', label: 'weekly', usedPercent: NaN, resetLabel: '—' },
      ],
    };
    expect(summarizeQuota('claude', quota).map((window) => window.remaining)).toEqual([null, null]);
    expect(summarizeQuota('claude', undefined)).toEqual([]);
    expect(summarizeQuota('claude', { status: 'error', error: 'HTTP 429' })).toEqual([]);
  });

  test('converts Meta seconds and used percentage without inventing a reset', () => {
    const quota: MetaQuotaState = {
      status: 'success',
      data: {
        windows: [
          { id: 'window', usedPercent: 20, resetAt: 50, durationMinutes: 300 },
          { id: 'weekly', usedPercent: null },
        ],
      },
    };
    const windows = summarizeQuota('meta', quota);
    expect(windows[0]).toMatchObject({ remaining: 80, resetAtMs: 50_000, periodHours: 5 });
    expect(windows[1]).toMatchObject({ remaining: null, resetAtMs: null, periodHours: 168 });
  });

  test('derives Kimi counts while treating a zero limit as unknown', () => {
    const quota: KimiQuotaState = {
      status: 'success',
      rows: [
        { id: 'short', used: 30, limit: 100, periodHours: 5 },
        { id: 'weekly', used: 0, limit: 0, periodHours: 168 },
        { id: 'extra', used: 1, limit: 100, periodHours: 168 },
      ],
    };
    expect(summarizeQuota('kimi', quota).map((window) => window.remaining)).toEqual([70, null]);
  });

  test('a paid xAI health observation without rate limits has no synthetic window', () => {
    const quota: XaiQuotaState = { status: 'success', billing: null };
    expect(summarizeQuota('xai', quota)).toEqual([]);
  });

  test('preserves model group context for provider and plugin quota windows', () => {
    const groups = [
      {
        id: 'models',
        label: 'Claude and GPT models',
        buckets: [
          { id: 'weekly', label: 'Weekly limit', remainingFraction: 0.5, periodHours: 168 },
        ],
      },
    ];
    for (const provider of ['antigravity', 'plugin'] as const) {
      const windows = summarizeQuota(provider, { status: 'success', groups, summary: [] });
      expect(windows[0].label).toBe('Claude and GPT models · Weekly limit');
      expect(windows[0].remaining).toBe(50);
    }
  });

  test('expired resets are not rolled forward or shown as the next reset', () => {
    const windows = summarizeQuota('claude', claude);
    expect(nextQuotaReset(windows, 15_000)).toBe(30_000);
    expect(nextQuotaReset(windows, 31_000)).toBeNull();
  });

  test('native credential disclosure retains plan, full model quota, errors and counters', () => {
    const file = { name: 'test-claude.json', type: 'claude', successCount: 12, failureCount: 2 };
    const markup = renderToStaticMarkup(
      createElement(QuotaObservationRow, {
        file,
        entry: { file, type: 'claude' },
        observation: {
          quota: { ...claude, planType: 'plan_max' },
          observedAt: 1_000,
          error: 'HTTP 429',
        },
        connected: true,
        nowMs: 2_000,
        loading: false,
        classes: bindQuotaClasses(
          Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
          'test-host'
        ),
      })
    );
    expect(markup).toContain('<details');
    expect(markup).not.toContain('<details open');
    expect(markup).toContain('<summary');
    expect(markup).toContain(i18n.t('routing.observation_stale'));
    expect(markup).toContain('HTTP 429');
    expect(markup).toContain('Opus');
    expect(markup).toContain(i18n.t('claude_quota.plan_max'));
    expect(markup).toContain(i18n.t('routing.request_counts', { success: 12, failed: 2 }));
  });
});
