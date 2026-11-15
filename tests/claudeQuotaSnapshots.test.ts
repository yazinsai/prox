import { afterEach, describe, expect, test } from 'bun:test';
import {
  CLAUDE_SNAPSHOT_MAX_AGE_MS,
  claudeQuotaSnapshots,
  createClaudeQuotaSnapshots,
} from '@/services/storage/claudeQuotaSnapshots';
import { apiClient } from '@/services/api/client';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { ClaudeQuotaState } from '@/types';

const memory = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
};
const observedAt = new Date().toISOString();
const good: ClaudeQuotaState = {
  status: 'success',
  windows: [
    { id: 'five-hour', label: '5-hour', usedPercent: 31, resetLabel: 'soon', resetAtMs: null },
  ],
  extraUsage: null,
  dollarWindows: [],
  planType: 'plan_max_5x',
  observedAt,
  stale: false,
  resetGrants: { eligible: true } as ClaudeQuotaState['resetGrants'],
};

describe('Claude quota snapshots', () => {
  test('round-trips usage per connection without reset grants', () => {
    const storage = memory();
    const snapshots = createClaudeQuotaSnapshots(() => storage);
    snapshots.save('https://a', 'acct', good);
    const restored = snapshots.get('https://a', 'acct');
    expect(restored).toMatchObject({ status: 'success', planType: 'plan_max_5x', observedAt });
    expect(restored?.windows).toEqual(good.windows);
    expect(restored?.resetGrants).toBeUndefined();
    expect(snapshots.get('https://b', 'acct')).toBeUndefined();
    expect(snapshots.get('', 'acct')).toBeUndefined();
  });

  test('ignores failures, old readings, and corrupt storage; clears on demand', () => {
    const storage = memory();
    const snapshots = createClaudeQuotaSnapshots(() => storage);
    snapshots.save('c', 'err', { ...good, status: 'error' });
    expect(storage.map.size).toBe(0);
    snapshots.save('c', 'acct', good);
    expect(
      snapshots.get('c', 'acct', Date.parse(observedAt) + CLAUDE_SNAPSHOT_MAX_AGE_MS + 1)
    ).toBeUndefined();
    snapshots.save('other', 'x', good);
    expect(snapshots.get('c', 'acct')).toBeUndefined();
    snapshots.remove('other', (key) => key === 'x');
    expect(storage.map.size).toBe(0);
    storage.setItem('quota.claude.snapshots.v1', '{bad');
    expect(snapshots.get('c', 'acct')).toBeUndefined();
    snapshots.save('c', 'acct', good);
    snapshots.clear();
    expect(storage.map.size).toBe(0);
    expect(createClaudeQuotaSnapshots(() => null).get('c', 'acct')).toBeUndefined();
  });
});

describe('Claude quota store after a reload', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    claudeQuotaSnapshots.clear();
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    apiClient.setConfig({ apiBase: '', managementKey: '' });
    useQuotaStore.getState().clearQuotaCache();
  });

  test('a rate-limited first read shows the persisted reading as stale', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory() });
    apiClient.setConfig({ apiBase: 'http://127.0.0.1:8317', managementKey: 'test' });
    const store = useQuotaStore.getState();
    store.setClaudeQuota({ acct: good });
    // Simulate a reload: memory is gone, storage is not.
    store.clearQuotaCache();
    store.setClaudeQuota({ acct: { status: 'loading', windows: [] } });
    expect(useQuotaStore.getState().claudeQuota.acct).toMatchObject({
      status: 'loading',
      observedAt,
    });
    expect(useQuotaStore.getState().claudeQuota.acct.stale).toBeFalsy();
    store.setClaudeQuota({
      acct: { status: 'error', windows: [], error: 'Rate limited', errorStatus: 429 },
    });
    const shown = useQuotaStore.getState().claudeQuota.acct;
    expect(shown).toMatchObject({ status: 'error', errorStatus: 429, stale: true, observedAt });
    expect(shown.windows).toEqual(good.windows);
    expect(shown.resetGrants).toBeUndefined();

    store.clearQuotaCache(['acct']);
    store.setClaudeQuota({ acct: { status: 'loading', windows: [] } });
    expect(useQuotaStore.getState().claudeQuota.acct.observedAt).toBeUndefined();
  });
});
