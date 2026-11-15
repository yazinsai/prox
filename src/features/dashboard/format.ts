import type { TFunction } from 'i18next';
import { waitParts } from './insights';

/** Compact remaining time: `42s`, `18m`, `2h 5m`, `3d 23h`. */
export function formatWait(t: TFunction, ms: number): string {
  const parts = waitParts(ms);
  switch (parts.unit) {
    case 'now':
      return t('dashboard_live.wait_now');
    case 'seconds':
      return t('dashboard_live.wait_seconds', { count: parts.seconds });
    case 'minutes':
      return t('dashboard_live.wait_minutes', { count: parts.minutes });
    case 'hours':
      return parts.minutes
        ? t('dashboard_live.wait_hours', { hours: parts.hours, minutes: parts.minutes })
        : t('dashboard_live.wait_hours_whole', { count: parts.hours });
    case 'days':
      return parts.hours
        ? t('dashboard_live.wait_days', { days: parts.days, hours: parts.hours })
        : t('dashboard_live.wait_days_whole', { count: parts.days });
  }
}

/** Compact age: `just now`, `12s ago`, `4m ago`, `2h ago`. */
export function formatAgo(t: TFunction, ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  if (seconds < 5) return t('dashboard_live.just_now');
  if (seconds < 60) return t('dashboard_live.ago_seconds', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('dashboard_live.ago_minutes', { count: minutes });
  return t('dashboard_live.ago_hours', { count: Math.floor(minutes / 60) });
}

/** One decimal below ten so a quiet proxy still reads as a rate, not a rounding error. */
export function formatRate(value: number, language: string): string {
  return value.toLocaleString(language, {
    maximumFractionDigits: value > 0 && value < 10 ? 1 : 0,
  });
}

export function formatPercent(value: number, language: string): string {
  return value.toLocaleString(language, {
    maximumFractionDigits: value > 0 && value < 1 ? 1 : 0,
  });
}
