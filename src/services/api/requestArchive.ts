import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export type ArchiveStatus =
  | 'healthy'
  | 'disabled'
  | 'index_missing'
  | 'index_stale'
  | 'index_invalid'
  | 'degraded'
  | 'storage_low';

export interface ArchiveIndex {
  updatedAt: string;
  records: number;
  archiveFiles: number;
  originalBytes: number;
  archivedBytes: number;
  indexBytes: number;
  diskFreeBytes: number;
  diskTotalBytes: number;
  pendingPlaintextFiles: number;
  latestAt: string | null;
  oldestAt: string | null;
  daily: Array<{ date: string; records: number }>;
}

export interface RequestArchiveStats {
  enabled: boolean;
  status: ArchiveStatus;
  failuresSinceStart: number;
  lastFailureAt: string | null;
  startedAt: string | null;
  version: string;
  commit: string;
  upstreamBase: string;
  index: ArchiveIndex | null;
}

const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const date = (value: unknown): string | null => {
  const result = text(value);
  return result && Number.isFinite(Date.parse(result)) ? result : null;
};
const statuses = new Set<ArchiveStatus>([
  'healthy',
  'disabled',
  'index_missing',
  'index_stale',
  'index_invalid',
  'degraded',
  'storage_low',
]);

export function normalizeRequestArchiveStats(data: unknown): RequestArchiveStats {
  if (!isRecord(data) || data.supported !== true) throw new Error('Invalid archive response');
  if (!statuses.has(data.status as ArchiveStatus)) throw new Error('Invalid archive status');
  const runtime = isRecord(data.runtime) ? data.runtime : {};
  const build = isRecord(data.build) ? data.build : {};
  const source = isRecord(data.index) ? data.index : null;
  if (source) {
    const counters = [
      'records',
      'archive_files',
      'original_bytes',
      'archived_bytes',
      'index_bytes',
      'disk_free_bytes',
      'disk_total_bytes',
    ];
    if (
      !date(source.updated_at) ||
      counters.some(
        (key) =>
          typeof source[key] !== 'number' ||
          !Number.isFinite(source[key]) ||
          Number(source[key]) < 0
      )
    )
      throw new Error('Invalid archive index statistics');
  } else if (data.status === 'healthy') {
    throw new Error('Healthy archive response requires index statistics');
  }

  const index: ArchiveIndex | null = source
    ? {
        updatedAt: date(source.updated_at) ?? '',
        records: number(source.records),
        archiveFiles: number(source.archive_files),
        originalBytes: number(source.original_bytes),
        archivedBytes: number(source.archived_bytes),
        indexBytes: number(source.index_bytes),
        diskFreeBytes: number(source.disk_free_bytes),
        diskTotalBytes: number(source.disk_total_bytes),
        pendingPlaintextFiles: number(source.pending_plaintext_files),
        latestAt: date(source.latest_at),
        oldestAt: date(source.oldest_at),
        daily: Array.isArray(source.daily)
          ? source.daily.flatMap((entry) =>
              isRecord(entry) && /^\d{4}-\d{2}-\d{2}$/.test(text(entry.date))
                ? [{ date: text(entry.date), records: number(entry.records) }]
                : []
            )
          : [],
      }
    : null;
  return {
    enabled: data.enabled === true,
    status: data.status as ArchiveStatus,
    failuresSinceStart: number(runtime.failures_since_start),
    lastFailureAt: date(runtime.last_failure_at),
    startedAt: date(runtime.started_at),
    version: text(build.version),
    commit: text(build.commit),
    upstreamBase: text(build.upstream_base),
    index,
  };
}

export const requestArchiveApi = {
  async get(signal?: AbortSignal): Promise<RequestArchiveStats> {
    const client = apiClient.captureConnection();
    return normalizeRequestArchiveStats(await client.get('/observability/archive', { signal }));
  },
};
