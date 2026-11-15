/**
 * Last successful Claude usage per credential, kept across reloads so a
 * rate-limited first read can show a stale-marked snapshot instead of nothing.
 *
 * Scoped to one management connection and cleared on logout. Reset grants are
 * never stored: spending decisions must come from a fresh read.
 */

import type { ClaudeQuotaState } from '@/types';

const STORAGE_KEY = 'quota.claude.snapshots.v1';
/** Older readings say little about current limits; drop them. */
export const CLAUDE_SNAPSHOT_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;

type Snapshot = Pick<
  ClaudeQuotaState,
  'windows' | 'extraUsage' | 'dollarWindows' | 'planType' | 'observedAt'
>;
type Stored = { connection: string; entries: Record<string, Snapshot> };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function createClaudeQuotaSnapshots(storage: () => StorageLike | null = defaultStorage) {
  const read = (connection: string): Record<string, Snapshot> => {
    try {
      const raw = storage()?.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.connection !== connection || !isRecord(parsed.entries))
        return {};
      return parsed.entries as Record<string, Snapshot>;
    } catch {
      return {};
    }
  };
  const write = (connection: string, entries: Record<string, Snapshot>) => {
    try {
      const target = storage();
      if (!target) return;
      if (Object.keys(entries).length === 0) target.removeItem(STORAGE_KEY);
      else target.setItem(STORAGE_KEY, JSON.stringify({ connection, entries } satisfies Stored));
    } catch {
      // Quota or privacy-mode failures only lose the convenience copy.
    }
  };

  return {
    get(connection: string, key: string, now = Date.now()): ClaudeQuotaState | undefined {
      if (!connection) return undefined;
      const entry = read(connection)[key];
      if (!isRecord(entry) || !Array.isArray(entry.windows) || typeof entry.observedAt !== 'string')
        return undefined;
      const observed = Date.parse(entry.observedAt);
      if (!Number.isFinite(observed) || now - observed > CLAUDE_SNAPSHOT_MAX_AGE_MS)
        return undefined;
      return { status: 'success', ...entry };
    },
    save(connection: string, key: string, quota: ClaudeQuotaState) {
      if (!connection || quota.status !== 'success' || !quota.observedAt) return;
      // A different connection's entries are replaced wholesale, never mixed.
      const entries = { ...read(connection) };
      entries[key] = {
        windows: quota.windows,
        extraUsage: quota.extraUsage ?? null,
        dollarWindows: quota.dollarWindows ?? [],
        planType: quota.planType ?? null,
        observedAt: quota.observedAt,
      };
      write(connection, entries);
    },
    remove(connection: string, matches: (key: string) => boolean) {
      if (!connection) return;
      const entries = read(connection);
      const kept = Object.fromEntries(Object.entries(entries).filter(([key]) => !matches(key)));
      if (Object.keys(kept).length !== Object.keys(entries).length) write(connection, kept);
    },
    clear() {
      try {
        storage()?.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    },
  };
}

export const claudeQuotaSnapshots = createClaudeQuotaSnapshots();
