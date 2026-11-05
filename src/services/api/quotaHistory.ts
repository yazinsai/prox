/**
 * Quota history: per-credential quota usage over time.
 *
 * The backend reconstructs it from the rate-limit headers kept in its request
 * archive, so it only exists while archiving is on and only for providers whose
 * responses carry quota headers (Claude, Codex). An older backend answers 404;
 * that is reported as `null` so the page can still draw projections.
 */
import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';

export interface QuotaHistoryPoint {
  atMs: number;
  usedPercent: number;
  /** Reset instant of the window this reading belongs to, when reported. */
  resetAtMs: number | null;
}

export interface QuotaHistorySeries {
  /** Matches the live window ids: five-hour, seven-day (Claude), weekly (Codex). */
  id: string;
  windowMinutes: number;
  points: QuotaHistoryPoint[];
}

export interface QuotaHistoryCredential {
  authId: string;
  authIndex: string | null;
  /** Credential file name when the credential still exists. */
  name: string | null;
  provider: string;
  series: QuotaHistorySeries[];
}

export interface QuotaHistory {
  /** Whether the backend is currently archiving requests (new history accrues). */
  recording: boolean;
  sinceMs: number;
  untilMs: number;
  oldestMs: number | null;
  credentials: QuotaHistoryCredential[];
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const timestamp = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const normalizePoint = (value: unknown): QuotaHistoryPoint | null => {
  if (!Array.isArray(value)) return null;
  const atMs = finite(value[0]);
  const usedPercent = finite(value[1]);
  if (atMs === null || usedPercent === null) return null;
  const resetAtMs = finite(value[2]);
  return {
    atMs,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetAtMs: resetAtMs && resetAtMs > 0 ? resetAtMs : null,
  };
};

const normalizeSeries = (value: unknown): QuotaHistorySeries | null => {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const windowMinutes = finite(value.window_minutes);
  if (!id || !windowMinutes || windowMinutes <= 0) return null;
  const points = (Array.isArray(value.points) ? value.points : [])
    .map(normalizePoint)
    .filter((point): point is QuotaHistoryPoint => point !== null)
    .sort((a, b) => a.atMs - b.atMs);
  return { id, windowMinutes, points };
};

const normalizeCredential = (value: unknown): QuotaHistoryCredential | null => {
  if (!isRecord(value)) return null;
  const authId = text(value.auth_id);
  const provider = text(value.provider);
  if (!authId || !provider) return null;
  return {
    authId,
    authIndex: text(value.auth_index),
    name: text(value.name),
    provider: provider.toLowerCase(),
    series: (Array.isArray(value.series) ? value.series : [])
      .map(normalizeSeries)
      .filter((series): series is QuotaHistorySeries => series !== null),
  };
};

export const normalizeQuotaHistory = (value: unknown): QuotaHistory | null => {
  if (!isRecord(value)) return null;
  const sinceMs = timestamp(value.since);
  const untilMs = timestamp(value.until);
  if (sinceMs === null || untilMs === null) return null;
  return {
    recording: value.recording === true,
    sinceMs,
    untilMs,
    oldestMs: timestamp(value.oldest_at),
    credentials: (Array.isArray(value.credentials) ? value.credentials : [])
      .map(normalizeCredential)
      .filter((credential): credential is QuotaHistoryCredential => credential !== null),
  };
};

const statusOf = (error: unknown): number | undefined =>
  isRecord(error) && typeof error.status === 'number' ? error.status : undefined;

export const quotaHistoryApi = {
  /** Resolves to null when the backend predates the history endpoint. */
  get: async (sinceMs: number): Promise<QuotaHistory | null> => {
    try {
      const payload = await apiClient.get<unknown>('/credentials/quota/history', {
        params: { since: new Date(sinceMs).toISOString().replace(/\.\d{3}Z$/, 'Z') },
      });
      return normalizeQuotaHistory(payload);
    } catch (error: unknown) {
      if (statusOf(error) === 404) return null;
      throw error;
    }
  },
};
