import type { TFunction } from 'i18next';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaAdapter, QuotaCardState } from '@/features/quota/providers';

export interface QuotaObservation {
  quota?: QuotaCardState;
  observedAt: number | null;
  error?: string;
}

/** Prefer a provider's observation time when a fetcher returns a cached snapshot. */
function observationTime(quota: QuotaCardState): number | null {
  if ('observedAtMs' in quota) {
    return typeof quota.observedAtMs === 'number' && Number.isFinite(quota.observedAtMs)
      ? quota.observedAtMs
      : null;
  }
  if ('observedAt' in quota) {
    const timestamp = typeof quota.observedAt === 'string' ? Date.parse(quota.observedAt) : NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return Date.now();
}

/** Each credential commits independently; a slow provider cannot hide faster observations. */
export async function readQuotaObservations(
  entries: readonly QuotaFileEntry[],
  adapters: Readonly<Record<string, QuotaAdapter>>,
  t: TFunction,
  isCurrent: () => boolean,
  onResult: (entry: QuotaFileEntry, result: QuotaObservation) => void
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, entries.length) }, async () => {
      while (next < entries.length && isCurrent()) {
        const entry = entries[next++];
        const adapter = adapters[entry.type];
        let result: QuotaObservation;
        try {
          const data = await adapter.fetchQuota(entry.file, t);
          const quota = adapter.buildSuccessState(data);
          result = { quota, observedAt: observationTime(quota) };
        } catch (error) {
          result = {
            observedAt: null,
            error: error instanceof Error ? error.message : t('common.unknown_error'),
          };
        }
        if (isCurrent()) onResult(entry, result);
      }
    })
  );
}

/** Failed reads retain their last measurement, but never its claim of freshness. */
export function mergeQuotaObservation(
  previous: QuotaObservation | undefined,
  next: QuotaObservation
): QuotaObservation {
  return next.error
    ? { ...previous, error: next.error, observedAt: previous?.observedAt ?? null }
    : next;
}

export function isObservationStale(
  observation: QuotaObservation | undefined,
  nowMs: number,
  connected: boolean
): boolean {
  return (
    !connected ||
    !observation?.observedAt ||
    Boolean(observation.error) ||
    nowMs - observation.observedAt > 60_000
  );
}
