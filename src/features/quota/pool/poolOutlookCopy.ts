/**
 * Words for a pool's outlook: the headline, its explanation and a tone, plus
 * the pace-versus-allowance phrase. Pure, so it can be tested without React.
 */

import type { TFunction } from 'i18next';
import type { PoolSummary } from './poolModel';
import { formatDate, formatDuration, formatPercent, formatWhen } from './poolFormat';

export type OutlookTone = 'danger' | 'warning' | 'success' | 'neutral';

export interface OutlookCopy {
  tone: OutlookTone;
  title: string;
  detail: string;
  /** What happens after this cycle, when that matters. */
  note: string | null;
}

/** Pace within this share of the allowance reads as on it. */
const ON_PACE = 0.05;
export const OVER_ALLOWANCE = 1 + ON_PACE;

/** Pace measured against the allowance: "17% over", "40% under", "On pace". */
export function paceVersus(ratio: number | null, t: TFunction): string {
  if (ratio === null) return t('quota_management.fact_pace_unmeasured');
  if (ratio < ON_PACE) return t('quota_management.fact_pace_idle');
  if (Math.abs(ratio - 1) <= ON_PACE) return t('quota_management.fact_pace_on');
  if (ratio >= 2) {
    return t('quota_management.fact_pace_times', {
      ratio: ratio < 10 ? ratio.toFixed(1) : Math.round(ratio),
    });
  }
  const percent = formatPercent(Math.abs(ratio - 1) * 100);
  return ratio > 1
    ? t('quota_management.fact_pace_over', { percent })
    : t('quota_management.fact_pace_under', { percent });
}

/** Turn the model's outlook into the headline, its explanation and a tone. */
export function describeOutlook(
  summary: PoolSummary,
  now: number,
  burnWindowHours: number,
  t: TFunction,
  locale?: string
): OutlookCopy {
  const { outlook } = summary;
  const when = (ms: number) => formatWhen(ms, now, locale);
  const until = (ms: number) => formatDuration(ms - now, locale);
  const resetAt = outlook.resetAtMs;
  const noReset = t('quota_management.outlook_no_reset');

  switch (outlook.kind) {
    case 'unknown':
      // Loaded but windowless (e.g. nothing counting down) is not the same as not loaded.
      return summary.accounts.some((account) => account.loaded)
        ? {
            tone: 'neutral',
            title: t('quota_management.outlook_no_window'),
            detail: t('quota_management.outlook_no_window_detail'),
            note: null,
          }
        : {
            tone: 'neutral',
            title: t('quota_management.outlook_unknown'),
            detail: t('quota_management.outlook_unknown_detail'),
            note: null,
          };
    case 'empty':
      return {
        tone: 'danger',
        title: t('quota_management.outlook_empty'),
        detail:
          outlook.refillAtMs === null
            ? noReset
            : t('quota_management.outlook_refills', {
                when: when(outlook.refillAtMs),
                duration: until(outlook.refillAtMs),
              }),
        note: null,
      };
    case 'unmeasured':
      return {
        tone: 'neutral',
        title: t('quota_management.outlook_unmeasured'),
        detail: t('quota_management.outlook_unmeasured_detail'),
        note: null,
      };
    case 'idle':
      return {
        tone: 'neutral',
        title: t('quota_management.outlook_idle'),
        detail:
          summary.burnSource === 'window'
            ? resetAt === null
              ? t('quota_management.outlook_idle_detail_window')
              : t('quota_management.outlook_idle_detail_window_reset', { when: when(resetAt) })
            : resetAt === null
              ? t('quota_management.outlook_idle_detail', { hours: burnWindowHours })
              : t('quota_management.outlook_idle_detail_reset', {
                  hours: burnWindowHours,
                  when: when(resetAt),
                }),
        note: null,
      };
    case 'runs-out': {
      const emptyAt = outlook.emptyAtMs as number;
      return {
        tone: 'danger',
        title: t('quota_management.outlook_runs_out', { duration: until(emptyAt) }),
        detail:
          outlook.refillAtMs === null
            ? t('quota_management.outlook_runs_out_detail_no_reset', { when: when(emptyAt) })
            : t('quota_management.outlook_runs_out_detail', {
                when: when(emptyAt),
                gap: formatDuration(outlook.refillAtMs - emptyAt, locale),
                reset: when(outlook.refillAtMs),
              }),
        note: null,
      };
    }
    case 'tight':
    case 'lasts': {
      if (resetAt === null || outlook.leftAtReset === null || outlook.lowest === null) {
        return {
          tone: 'success',
          title: t('quota_management.outlook_lasts_past', {
            date: formatDate(outlook.horizonMs, locale),
          }),
          detail: noReset,
          note: null,
        };
      }
      const left = outlook.leftAtReset;
      const { lowest } = outlook;
      // A pool refills account by account; its low point says more than its level at the end.
      const isPool = summary.knownCount > 1;
      return {
        tone: outlook.kind === 'tight' ? 'warning' : 'success',
        title: t(
          outlook.kind === 'tight'
            ? 'quota_management.outlook_tight'
            : 'quota_management.outlook_lasts'
        ),
        detail: isPool
          ? t('quota_management.outlook_lowest_pool', {
              left: formatPercent(lowest.value),
              when: when(lowest.atMs),
            })
          : left < 1
            ? t('quota_management.outlook_left_under', { when: when(resetAt) })
            : t('quota_management.outlook_left_at_reset', {
                left: formatPercent(left),
                when: when(resetAt),
              }),
        note:
          outlook.laterEmptyAtMs === null
            ? null
            : t('quota_management.outlook_later', { when: when(outlook.laterEmptyAtMs) }),
      };
    }
  }
}
