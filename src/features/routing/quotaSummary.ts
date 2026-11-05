import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  XaiQuotaState,
} from '@/types';
import type { QuotaCardState } from '@/features/quota/providers';
import type { QuotaProviderType } from '@/features/quota/providers/types';

export interface QuotaSummaryWindow {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  remaining: number | null;
  periodHours: number | null;
  resetAtMs: number | null;
}

const finite = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const percent = (value: number | null | undefined): number | null => {
  const result = finite(value);
  return result === null ? null : Math.max(0, Math.min(100, result));
};
const remainingOf = (used: number | null | undefined) => {
  const value = finite(used);
  return value === null ? null : percent(100 - value);
};

/** Read normalized provider states only; preserve unknown quota rather than implying 100%. */
function windowsFor(provider: QuotaProviderType, quota: QuotaCardState): QuotaSummaryWindow[] {
  if (provider === 'claude' || provider === 'codex') {
    return (quota as ClaudeQuotaState | CodexQuotaState).windows.map((window) => ({
      id: window.id,
      label: window.label,
      labelKey: window.labelKey,
      labelParams: 'labelParams' in window ? window.labelParams : undefined,
      remaining: remainingOf(window.usedPercent),
      periodHours: finite(window.periodHours),
      resetAtMs: finite(window.resetAtMs),
    }));
  }
  if (provider === 'devin') {
    return (quota as DevinQuotaState).windows.map((window) => ({
      id: window.id,
      label: window.label ?? window.id,
      remaining: percent(window.remainingPercent),
      periodHours: finite(window.periodHours),
      resetAtMs: finite(window.resetAtMs),
    }));
  }
  if (provider === 'meta') {
    return ((quota as MetaQuotaState).data?.windows ?? []).map((window) => ({
      id: window.id,
      label: window.id,
      labelKey: `meta_quota.${window.id}`,
      remaining: remainingOf(window.usedPercent),
      periodHours: window.id === 'weekly' ? 168 : finite((window.durationMinutes ?? NaN) / 60),
      resetAtMs: finite((window.resetAt ?? NaN) * 1000),
    }));
  }
  if (provider === 'kimi') {
    return (quota as KimiQuotaState).rows.map((row) => ({
      id: row.id,
      label: row.label ?? row.id,
      labelKey: row.labelKey,
      labelParams: row.labelParams,
      remaining: row.limit > 0 ? percent(((row.limit - row.used) / row.limit) * 100) : null,
      periodHours: finite(row.periodHours),
      resetAtMs: finite(row.resetAtMs),
    }));
  }
  if (provider === 'xai') {
    const billing = (quota as XaiQuotaState).billing;
    // A monthly spend cap is not a remaining rate-limit window.
    if (!billing || billing.periodType !== 'weekly') return [];
    return [
      {
        id: 'weekly',
        label: 'weekly',
        labelKey: 'routing.summary_weekly',
        remaining: remainingOf(billing.usagePercent),
        periodHours: finite(billing.periodHours) ?? 168,
        resetAtMs: finite(billing.resetAtMs),
      },
    ];
  }
  return (quota as AntigravityQuotaState).groups.flatMap((group) =>
    group.buckets.map((bucket) => ({
      id: `${group.id}:${bucket.id}`,
      label: group.label ? `${group.label} · ${bucket.label}` : bucket.label,
      remaining: percent(bucket.remainingFraction * 100),
      periodHours: finite(bucket.periodHours),
      resetAtMs: finite(bucket.resetAtMs),
    }))
  );
}

/** Keep account-wide short and weekly windows ahead of model-specific details. */
export function summarizeQuota(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined
): QuotaSummaryWindow[] {
  if (!quota || quota.status !== 'success') return [];
  const windows = windowsFor(provider, quota);
  const short =
    windows.find((window) => ['five-hour', 'window', 'daily'].includes(window.id)) ??
    windows.find((window) => window.periodHours !== null && window.periodHours <= 24);
  const weekly =
    windows.find((window) => ['weekly', 'seven-day'].includes(window.id)) ??
    windows.find(
      (window) =>
        window.periodHours !== null && window.periodHours >= 144 && window.periodHours <= 192
    );
  const picked = [
    ...new Set([short, weekly].filter((window): window is QuotaSummaryWindow => Boolean(window))),
  ];
  // Per-model providers may not expose standard windows; show two constraints,
  // while every remaining model stays available in the credential disclosure.
  for (const window of windows) {
    if (picked.length === 2) break;
    if (!picked.includes(window)) picked.push(window);
  }
  return picked;
}

/** Only a future reported reset is a next reset; never roll stale values forward. */
export function nextQuotaReset(
  windows: readonly QuotaSummaryWindow[],
  nowMs: number
): number | null {
  const times = windows
    .map((window) => window.resetAtMs)
    .filter((time): time is number => time !== null && time > nowMs);
  return times.length ? Math.min(...times) : null;
}
