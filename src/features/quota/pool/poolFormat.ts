/** Locale-aware labels for the quota pool panels. */

import { DAY_MS, HOUR_MS } from './poolModel';
import type { QuotaProviderType } from '../providers/types';

/** Provider accent used for swatches and chart lines; neutral brands follow the text color. */
export const POOL_ACCENTS: Record<QuotaProviderType, string> = {
  claude: 'var(--accent-claude)',
  codex: 'var(--accent-codex)',
  antigravity: '#4f8cf7',
  meta: '#4f8cf7',
  xai: 'var(--text-primary)',
  kimi: 'var(--text-primary)',
  devin: 'var(--text-primary)',
  plugin: 'var(--text-primary)',
};

const cache = new Map<string, Intl.DateTimeFormat>();
const dateFormat = (locale: string | undefined, options: Intl.DateTimeFormatOptions) => {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let format = cache.get(key);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(locale, options);
    } catch {
      format = new Intl.DateTimeFormat(undefined, options);
    }
    cache.set(key, format);
  }
  return format;
};

export const formatPercent = (value: number) => `${Math.round(value)}%`;

export const formatRate = (value: number) =>
  `${value < 10 ? (Math.round(value * 10) / 10).toFixed(1) : Math.round(value)}%/h`;

/** "Sun 4:39 PM" */
export const formatClock = (ms: number, locale?: string) =>
  dateFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(ms);

/** "Nov 9" */
export const formatDate = (ms: number, locale?: string) =>
  dateFormat(locale, { month: 'short', day: 'numeric' }).format(ms);

/** "Fri 23" */
export const formatDayLabel = (ms: number, locale?: string) => {
  const parts = dateFormat(locale, { weekday: 'short', day: 'numeric' }).formatToParts(ms);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return `${weekday} ${day}`.trim();
};

/** Instant within the coming week as weekday + time, further out as a date. */
export const formatWhen = (ms: number, now: number, locale?: string) =>
  ms - now < 6 * DAY_MS ? formatClock(ms, locale) : formatDate(ms, locale);

const unit = (value: number, name: 'day' | 'hour' | 'minute', locale?: string) => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: name,
      unitDisplay: 'narrow',
    }).format(value);
  } catch {
    return `${value}${name[0]}`;
  }
};

/** Compact duration: "2d 18h", "15h 49m", "12m". */
export const formatDuration = (ms: number, locale?: string) => {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${unit(days, 'day', locale)} ${unit(hours, 'hour', locale)}`;
  if (ms >= HOUR_MS) return `${unit(hours, 'hour', locale)} ${unit(mins, 'minute', locale)}`;
  return unit(mins, 'minute', locale);
};
