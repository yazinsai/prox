import { describe, expect, test } from 'bun:test';
import type { AuthFileCooldown, AuthFileItem } from '../src/types/authFile';
import type { ProviderTraffic } from '../src/features/dashboard/types';
import {
  isThrottleCooldown,
  summarizeProviderRequests,
  summarizeProviderThrottling,
} from '../src/features/dashboard/operations';

const cooldown = (changes: Partial<AuthFileCooldown> = {}): AuthFileCooldown => ({
  scope: 'credential',
  reason: 'quota',
  remainingSeconds: 120,
  retryAt: '2099-01-01T00:00:00Z',
  ...changes,
});
const file = (
  name: string,
  records: AuthFileCooldown[] | null,
  changes: Partial<AuthFileItem> = {}
): AuthFileItem => ({
  name,
  type: 'claude',
  cooldownSnapshot: { receivedAtMs: 1_000, records },
  ...changes,
});
const provider = (id: string, success: number, failure: number): ProviderTraffic => ({
  id,
  success,
  failure,
  total: success + failure,
  credentials: 1,
  successRate: success + failure ? (success / (success + failure)) * 100 : null,
  buckets: [],
});

describe('dashboard throttling', () => {
  test('identifies active quota and HTTP 429 cooldowns without treating access errors as throttling', () => {
    expect(isThrottleCooldown(cooldown({ reason: 'credential_quota' }))).toBe(true);
    expect(isThrottleCooldown(cooldown({ reason: 'unknown', httpStatus: 429 }))).toBe(true);
    for (const reason of [
      'unauthorized',
      'invalid_grant',
      'cloudflare_challenge',
      'payment_required',
      'not_found',
      'model_not_supported',
    ]) {
      expect(isThrottleCooldown(cooldown({ reason, httpStatus: 429 }))).toBe(false);
    }
    const result = summarizeProviderThrottling(
      [
        file('quota', [cooldown()]),
        file('unauthorized', [cooldown({ reason: 'unauthorized', httpStatus: 401 })], {
          type: 'codex',
        }),
      ],
      2_000
    );
    expect(result.providers.map((item) => item.id)).toEqual(['claude']);
    expect(result.otherCooldownCredentials).toBe(1);
  });

  test('excludes disabled credentials from restrictions and the enabled denominator', () => {
    const result = summarizeProviderThrottling(
      [
        file('active', [cooldown()]),
        file('disabled', [cooldown()], { disabled: true }),
        file('unknown-disabled', null, { disabled: true }),
      ],
      2_000
    );
    expect(result.providers[0]).toMatchObject({ affectedCredentials: 1, credentialCount: 1 });
    expect(result.unknownCredentials).toBe(0);
  });

  test('reports partial model restrictions without calling the whole provider down', () => {
    const result = summarizeProviderThrottling(
      [
        file('model-only', [
          cooldown({ scope: 'model', modelKey: 'claude-opus' }),
          cooldown({ scope: 'model', modelKey: 'claude-opus' }),
        ]),
        file('other-model', [cooldown({ scope: 'model', modelKey: 'claude-sonnet' })]),
        file('unrestricted', []),
      ],
      2_000
    );
    expect(result.affectedCredentials).toBe(2);
    expect(result.providers[0]).toMatchObject({
      affectedCredentials: 2,
      credentialCount: 3,
      credentialWide: 0,
      modelScoped: 2,
      models: ['claude-opus', 'claude-sonnet'],
      earliestSeconds: 119,
    });
  });

  test('elapsed timers require confirmation rather than claiming quota recovered', () => {
    const result = summarizeProviderThrottling(
      [file('expired', [cooldown({ remainingSeconds: 1 })])],
      2_001
    );
    expect(result.providers).toEqual([]);
    expect(result.expiredCredentials).toBe(1);
    expect(result).not.toHaveProperty('recovered');
    expect(result).not.toHaveProperty('available');
  });

  test('uses local receipt-relative remaining time, never the retry-at wall clock', () => {
    const result = summarizeProviderThrottling(
      [
        file('future-server-clock', [
          cooldown({ remainingSeconds: 1, retryAt: '2099-01-01T00:00:00Z' }),
        ]),
      ],
      3_000
    );
    expect(result.providers).toHaveLength(0);
    expect(result.expiredCredentials).toBe(1);
  });

  test('absent and null runtime snapshots stay unknown, while an empty snapshot is known', () => {
    const result = summarizeProviderThrottling(
      [{ name: 'older-server', type: 'claude' }, file('unknown', null), file('known-empty', [])],
      2_000
    );
    expect(result.providers).toEqual([]);
    expect(result.unknownCredentials).toBe(2);
    expect(result.loaded).toBe(true);
    expect(summarizeProviderThrottling(null, 2_000).loaded).toBe(false);
  });
});

describe('dashboard provider request split', () => {
  test('shares and totals use the same cumulative success/failure denominator', () => {
    const result = summarizeProviderRequests([provider('claude', 75, 5), provider('codex', 18, 2)]);
    expect(result).toMatchObject({ success: 93, failure: 7, total: 100, successRate: 93 });
    expect(result.providers.map((row) => row.share)).toEqual([80, 20]);
    expect(result.providers.reduce((sum, row) => sum + row.share, 0)).toBe(100);
    // Rolling chart buckets do not change cumulative provider shares.
    const withRecent = provider('claude', 75, 5);
    withRecent.buckets = [{ time: '2026-08-01T00:00:00Z', success: 1, failed: 0 }];
    expect(
      summarizeProviderRequests([withRecent, provider('codex', 18, 2)]).providers[0].share
    ).toBe(80);
  });

  test('empty counters have no invented success rate or NaN shares', () => {
    expect(summarizeProviderRequests([])).toMatchObject({
      total: 0,
      successRate: null,
      providers: [],
    });
    expect(summarizeProviderRequests([provider('codex', 0, 0)]).providers[0].share).toBe(0);
  });
});
