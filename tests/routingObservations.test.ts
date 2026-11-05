import { describe, expect, test } from 'bun:test';
import i18n from '../src/i18n/index';
import type { QuotaAdapter } from '../src/features/quota/providers';
import type { QuotaFileEntry } from '../src/features/quota/logic';
import {
  mergeQuotaObservation,
  isObservationStale,
  readQuotaObservations,
  type QuotaObservation,
} from '../src/features/routing/observations';
import {
  activeCooldownSeconds,
  draftFromBoard,
  buildRoutingPlan,
  mergeRoutingRuntime,
  moveMember,
} from '../src/features/routing/logic';
import { buildRoutingBoard } from '../src/services/api/routing';

const adapter = (fetchQuota: QuotaAdapter['fetchQuota']): QuotaAdapter => ({
  type: 'antigravity',
  i18nPrefix: 'antigravity_quota',
  filterFn: () => true,
  fetchQuota,
  storeSelector: () => ({}),
  storeSetter: 'setAntigravityQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', ...Object(data) }),
  buildErrorState: (error) => ({ status: 'error', error }),
  Body: () => null,
});
const entry = (name: string): QuotaFileEntry => ({ file: { name }, type: 'antigravity' });

describe('measured quota observations', () => {
  test('keeps exhausted measurements and timestamps them without calculating traffic shares', async () => {
    const results: QuotaObservation[] = [];
    await readQuotaObservations(
      [entry('ag.json')],
      {
        antigravity: adapter(async () => ({ groups: [{ remainingFraction: 0 }] })),
      },
      i18n.t,
      () => true,
      (_, result) => results.push(result)
    );
    expect(results[0].quota).toEqual({ status: 'success', groups: [{ remainingFraction: 0 }] });
    expect(results[0].observedAt).toBeGreaterThan(0);
    expect(results[0]).not.toHaveProperty('share');
  });

  test('cached provider timestamps are not presented as a new measurement', async () => {
    const results: QuotaObservation[] = [];
    await readQuotaObservations(
      [entry('cached')],
      {
        antigravity: adapter(async () => ({ observedAtMs: 1_000 })),
      },
      i18n.t,
      () => true,
      (_, result) => results.push(result)
    );
    expect(results[0].observedAt).toBe(1_000);
    expect(isObservationStale(results[0], 62_000, true)).toBe(true);
  });

  test('a failed refresh retains the previous measurement and marks it stale', () => {
    const previous = { quota: { status: 'success' as const }, observedAt: 1_000 };
    const failed = mergeQuotaObservation(previous, { observedAt: null, error: 'HTTP 429' });
    expect(failed.quota).toBe(previous.quota);
    expect(failed.observedAt).toBe(1_000);
    expect(isObservationStale(failed, 2_000, true)).toBe(true);
    expect(isObservationStale(previous, 2_000, true)).toBe(false);
    expect(isObservationStale(previous, 62_000, true)).toBe(true);
    expect(isObservationStale(previous, 2_000, false)).toBe(true);
    expect(isObservationStale(undefined, 2_000, true)).toBe(true);
  });

  test('a failed provider does not prevent other observations from landing', async () => {
    const results: string[] = [];
    await readQuotaObservations(
      [entry('bad'), entry('good')],
      {
        antigravity: adapter(async (file) => {
          if (file.name === 'bad') throw new Error('upstream');
          return {};
        }),
      },
      i18n.t,
      () => true,
      (item, result) => results.push(`${item.file.name}:${result.error ?? 'ok'}`)
    );
    expect(results.sort()).toEqual(['bad:upstream', 'good:ok']);
  });

  test('late results from a previous session are discarded and queued reads stop', async () => {
    let current = true;
    let reads = 0;
    const results: QuotaObservation[] = [];
    await readQuotaObservations(
      Array.from({ length: 8 }, (_, n) => entry(String(n))),
      {
        antigravity: adapter(async () => {
          reads++;
          current = false;
          return {};
        }),
      },
      i18n.t,
      () => current,
      (_, result) => results.push(result)
    );
    expect(results).toEqual([]);
    expect(reads).toBe(1);
  });

  test('bounds concurrent provider reads', async () => {
    let active = 0;
    let peak = 0;
    await readQuotaObservations(
      Array.from({ length: 8 }, (_, n) => entry(String(n))),
      {
        antigravity: adapter(async () => {
          active++;
          peak = Math.max(peak, active);
          await Promise.resolve();
          active--;
          return {};
        }),
      },
      i18n.t,
      () => true,
      () => {}
    );
    expect(peak).toBe(3);
  });
});

describe('observed cooldowns', () => {
  const config = {
    oauth: {
      'model-alias': {
        antigravity: [{ name: 'claude-opus-5-5-high', alias: 'claude-opus-5-5', fork: false }],
      },
    },
  };
  const file = {
    name: 'ag.json',
    type: 'antigravity',
    prefix: 'ag',
    cooldownSnapshot: {
      receivedAtMs: 1_000,
      records: [
        {
          scope: 'model' as const,
          modelKey: 'claude-opus-5-5-high',
          reason: 'quota',
          retryAt: '',
          remainingSeconds: 60,
        },
      ],
    },
  };
  test('an upstream cooldown applies to the configured alias, including a request suffix and prefix', () => {
    const member = buildRoutingBoard(config, [file]).members[0];
    expect(activeCooldownSeconds(member, 'ag/claude-opus-5-5(high)', 2_000)).toBe(59);
    expect(activeCooldownSeconds(member, 'claude-opus-5-5-high', 2_000)).toBe(59);
    expect(activeCooldownSeconds(member, 'gemini', 2_000)).toBe(0);
    expect(activeCooldownSeconds(member, 'claude-opus-5-5', 62_000)).toBe(0);
    const other = buildRoutingBoard(config, [{ ...file, type: 'claude' }]).members[0];
    expect(activeCooldownSeconds(other, 'claude-opus-5-5', 2_000)).toBe(0);
  });
  test('runtime refresh preserves pending edits and the configuration baseline', () => {
    const board = buildRoutingBoard(config, [
      file,
      { name: 'other', type: 'claude', priority: -10 },
    ]);
    const draft = draftFromBoard(board);
    draft.tiers = moveMember(draft.tiers, 'cred:ag.json', { kind: 'gap', index: 2 });
    const before = buildRoutingPlan(board, draft);
    const observed = buildRoutingBoard({}, [{ ...file, priority: 50, unavailable: true }]);
    const merged = mergeRoutingRuntime(board, observed);
    expect(merged.members[0].unavailable).toBe(true);
    expect(merged.members[0].priority).toBe(0);
    expect(merged.members).toHaveLength(2);
    expect(buildRoutingPlan(merged, draft)).toEqual(before);
  });
});
