/**
 * Provider quota pools: every credential of a provider pooled into one gauge.
 *
 * Six Claude accounts are one budget of 600%: what matters operationally is how
 * much of it is left, how fast it is burning, when it runs dry, and when resets
 * bring it back. This module answers those questions; the panel only draws them.
 *
 * Pure functions, no React and no clock of its own (`now` is always passed in).
 *
 * Each account contributes its longest quota window that fits the visible span
 * (Claude 7-day, Codex weekly…), the same choice the windows timeline made.
 * Recorded history comes from the backend's archived rate-limit headers; the
 * projection assumes the measured burn continues, scaled by the chosen factor.
 */

import type { QuotaHistoryCredential, QuotaHistorySeries } from '@/services/api/quotaHistory';
import { buildTimelineLane, startOfDay, windowsIn, DAY_MS, HOUR_MS } from '../quotaTimelineModel';
import type { QuotaProviderType } from '../providers/types';

export { DAY_MS, HOUR_MS };

export const POOL_MODES = ['remaining', 'drain'] as const;
export type PoolMode = (typeof POOL_MODES)[number];

export const BURN_WINDOW_HOURS = [1, 3, 6] as const;
export type BurnWindowHours = (typeof BURN_WINDOW_HOURS)[number];

export const FUTURE_USAGE_OPTIONS = ['same', 'half', 'double', 'none'] as const;
export type FutureUsage = (typeof FUTURE_USAGE_OPTIONS)[number];

export const FUTURE_USAGE_FACTOR: Record<FutureUsage, number> = {
  same: 1,
  half: 0.5,
  double: 2,
  none: 0,
};

/** The chart spans two weeks: a few days of record, the rest projection. */
export const POOL_SPAN_DAYS = 14;
export const POOL_DAYS_BEFORE_TODAY = 3;

/** Reset instants within this distance are one reset event. */
const RESET_GROUP_MS = 60 * 1000;
/** History needs this much coverage before a burn rate means anything. */
const MIN_BURN_COVERAGE_MS = 10 * 60 * 1000;
const EPSILON = 0.01;

export interface PoolPoint {
  atMs: number;
  value: number;
}

export interface PoolJump {
  atMs: number;
  /** Percent restored (positive). */
  added: number;
  /** Pool value right after the jump, for label placement. */
  value: number;
}

export interface PoolAccountInput {
  key: string;
  name: string;
  /** Display identity: the email when known, otherwise the file name. */
  label: string;
  provider: QuotaProviderType;
  authIndex: string | null;
  quota: { status?: string } | undefined;
}

export interface PoolAccount {
  key: string;
  name: string;
  label: string;
  provider: QuotaProviderType;
  /** Remaining percent of the pooled window right now; null when unknown. */
  remaining: number | null;
  nextResetMs: number | null;
  periodMs: number | null;
  /** Recorded remaining percent over time; resets appear as two points sharing a time. */
  history: PoolPoint[];
  source: 'live' | 'history' | 'none';
}

/** Visible span: today minus a few days, two weeks long, stepped a week at a time. */
export function poolSpan(offsetWeeks: number, now: number): { startMs: number; endMs: number } {
  const start = new Date(startOfDay(now));
  start.setDate(start.getDate() - POOL_DAYS_BEFORE_TODAY + offsetWeeks * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + POOL_SPAN_DAYS);
  end.setHours(0, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/** Local midnight boundaries inside the span (DST-safe). */
export function poolDays(span: { startMs: number; endMs: number }): number[] {
  const days: number[] = [];
  const cursor = new Date(span.startMs);
  while (cursor.getTime() < span.endMs && days.length <= 62) {
    days.push(cursor.getTime());
    // Re-anchor to midnight: after a midnight DST jump the day starts at 01:00.
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return days;
}

/* ------------------------------------------------------------- accounts */

const clamp = (value: number) => Math.min(100, Math.max(0, value));

const pickSeries = (
  series: QuotaHistorySeries[],
  periodHours: number | null,
  maxPeriodHours: number
): QuotaHistorySeries | null => {
  if (series.length === 0) return null;
  if (periodHours) {
    const minutes = Math.round(periodHours * 60);
    return series.find((item) => item.windowMinutes === minutes) ?? null;
  }
  const fitting = series.filter((item) => item.windowMinutes <= maxPeriodHours * 60);
  const pool = fitting.length > 0 ? fitting : series;
  return pool.reduce((best, item) => (item.windowMinutes > best.windowMinutes ? item : best));
};

/** First window end strictly after `now` for a window anchored at `anchorMs`. */
const nextBoundary = (anchorMs: number, periodMs: number, now: number): number | null =>
  windowsIn(anchorMs, periodMs, now, now + 1).find((window) => window.endMs > now)?.endMs ?? null;

/**
 * Remaining-percent samples from archived readings. A window that rolled
 * between two readings is drawn as a vertical reset at the old reset instant,
 * not a slope across the gap.
 */
export function historySamples(series: QuotaHistorySeries | null): PoolPoint[] {
  if (!series) return [];
  const out: PoolPoint[] = [];
  series.points.forEach((point, index) => {
    const prev = index > 0 ? series.points[index - 1] : null;
    if (
      prev &&
      prev.resetAtMs !== null &&
      point.resetAtMs !== null &&
      point.resetAtMs - prev.resetAtMs > 2 * RESET_GROUP_MS &&
      prev.resetAtMs > prev.atMs &&
      prev.resetAtMs < point.atMs
    ) {
      out.push({ atMs: prev.resetAtMs, value: clamp(100 - prev.usedPercent) });
      out.push({ atMs: prev.resetAtMs, value: 100 });
    }
    out.push({ atMs: point.atMs, value: clamp(100 - point.usedPercent) });
  });
  return out;
}

/** Match a credential to its archived history: auth index first, then file name. */
export function findHistory(
  input: Pick<PoolAccountInput, 'name' | 'authIndex' | 'provider'>,
  credentials: QuotaHistoryCredential[]
): QuotaHistoryCredential | undefined {
  return (
    (input.authIndex
      ? credentials.find((credential) => credential.authIndex === input.authIndex)
      : undefined) ??
    credentials.find(
      (credential) =>
        credential.provider === input.provider &&
        (credential.name === input.name || credential.authId === input.name)
    )
  );
}

export function buildPoolAccount(
  input: PoolAccountInput,
  history: QuotaHistoryCredential | undefined,
  now: number,
  maxPeriodHours = POOL_SPAN_DAYS * 24
): PoolAccount {
  const lane = buildTimelineLane({
    name: input.key,
    displayName: input.label,
    provider: input.provider,
    quota: input.quota,
    maxPeriodHours,
  });
  const series = pickSeries(history?.series ?? [], lane.periodHours, maxPeriodHours);
  const samples = historySamples(series).filter((sample) => sample.atMs <= now);

  const account: PoolAccount = {
    key: input.key,
    name: input.name,
    label: input.label,
    provider: input.provider,
    remaining: null,
    nextResetMs: null,
    periodMs: null,
    history: samples,
    source: 'none',
  };

  if (lane.anchorMs !== null && lane.periodHours && lane.remaining !== null) {
    const periodMs = lane.periodHours * HOUR_MS;
    account.periodMs = periodMs;
    account.source = 'live';
    if (lane.anchorMs > now) {
      account.remaining = lane.remaining;
      account.nextResetMs = lane.anchorMs;
    } else {
      // The reported window already reset; its usage no longer applies.
      account.remaining = 100;
      account.nextResetMs = nextBoundary(lane.anchorMs, periodMs, now);
    }
  } else if (series && series.points.length > 0) {
    const last = series.points[series.points.length - 1];
    const periodMs = series.windowMinutes * 60 * 1000;
    account.periodMs = periodMs;
    account.source = 'history';
    if (last.resetAtMs === null) {
      account.remaining = clamp(100 - last.usedPercent);
    } else if (last.resetAtMs > now) {
      account.remaining = clamp(100 - last.usedPercent);
      account.nextResetMs = last.resetAtMs;
    } else {
      account.remaining = 100;
      account.nextResetMs = nextBoundary(last.resetAtMs, periodMs, now);
    }
  }

  // Close the recorded line at "now" so it meets the projection.
  if (account.remaining !== null && samples.length > 0) {
    const last = series?.points[series.points.length - 1];
    const lastSample = samples[samples.length - 1];
    if (last?.resetAtMs && last.resetAtMs > lastSample.atMs && last.resetAtMs < now) {
      samples.push({ atMs: last.resetAtMs, value: lastSample.value });
      samples.push({ atMs: last.resetAtMs, value: 100 });
    }
    if (samples[samples.length - 1].atMs < now) {
      samples.push({ atMs: now, value: account.remaining });
    }
  }
  return account;
}

/* ------------------------------------------------------------ polylines */

/**
 * Value of a polyline at `t`. Points sharing a time form a vertical jump:
 * `side` picks the value before ('left') or after ('right') it. Outside the
 * polyline the nearest end value is held.
 */
export function valueAt(points: PoolPoint[], t: number, side: 'left' | 'right' = 'right'): number {
  if (points.length === 0) return 0;
  if (t <= points[0].atMs) {
    if (t < points[0].atMs || side === 'left') return points[0].value;
  }
  const last = points[points.length - 1];
  if (t > last.atMs) return last.value;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].atMs < t) lo = mid + 1;
    else hi = mid;
  }
  // lo = first index with atMs >= t
  if (points[lo].atMs === t) {
    if (side === 'left') return points[lo].value;
    let end = lo;
    while (end + 1 < points.length && points[end + 1].atMs === t) end += 1;
    return points[end].value;
  }
  const before = points[lo - 1];
  const after = points[lo];
  const ratio = (t - before.atMs) / (after.atMs - before.atMs);
  return before.value + (after.value - before.value) * ratio;
}

/** Restrict a polyline to [fromMs, toMs], interpolating the cut ends. */
export function clipPolyline(points: PoolPoint[], fromMs: number, toMs: number): PoolPoint[] {
  if (points.length === 0 || toMs <= fromMs) return [];
  const first = points[0].atMs;
  const last = points[points.length - 1].atMs;
  if (last < fromMs || first > toMs) return [];
  const start = Math.max(fromMs, first);
  const end = Math.min(toMs, last);
  const inner = points.filter((point) => point.atMs > start && point.atMs < end);
  const out: PoolPoint[] = [{ atMs: start, value: valueAt(points, start, 'right') }, ...inner];
  if (end > start) out.push({ atMs: end, value: valueAt(points, end, 'left') });
  return out;
}

/** Sum of several polylines, keeping vertical jumps where any of them jumps. */
export function sumPolylines(lines: PoolPoint[][]): { points: PoolPoint[]; jumps: PoolJump[] } {
  const active = lines.filter((line) => line.length > 0);
  if (active.length === 0) return { points: [], jumps: [] };
  const times = Array.from(new Set(active.flatMap((line) => line.map((p) => p.atMs)))).sort(
    (a, b) => a - b
  );
  const points: PoolPoint[] = [];
  const jumps: PoolJump[] = [];
  times.forEach((t) => {
    const left = active.reduce((sum, line) => sum + valueAt(line, t, 'left'), 0);
    const right = active.reduce((sum, line) => sum + valueAt(line, t, 'right'), 0);
    points.push({ atMs: t, value: left });
    if (Math.abs(right - left) > EPSILON) {
      points.push({ atMs: t, value: right });
      if (right - left >= 0.5) jumps.push({ atMs: t, added: right - left, value: right });
    }
  });
  return { points, jumps };
}

/* ---------------------------------------------------------------- burn */

/**
 * Average consumption in percent per hour over the last `windowHours`.
 * Only decreases count: a reset restores quota, it does not un-spend it.
 * Null when history covers too little of the window to say.
 */
export function burnRate(history: PoolPoint[], now: number, windowHours: number): number | null {
  if (history.length === 0) return null;
  const from = Math.max(now - windowHours * HOUR_MS, history[0].atMs);
  if (now - from < MIN_BURN_COVERAGE_MS) return null;
  const segment = clipPolyline(history, from, now);
  let spent = 0;
  for (let i = 1; i < segment.length; i += 1) {
    if (segment[i].atMs > segment[i - 1].atMs) {
      spent += Math.max(0, segment[i - 1].value - segment[i].value);
    }
  }
  return spent / ((now - from) / HOUR_MS);
}

/* ---------------------------------------------------------- projection */

export interface AccountProjection {
  key: string;
  points: PoolPoint[];
  emptyAtMs: number | null;
}

/**
 * Project one account forward from `now` to `endMs`: draining at `burnPerHour`
 * until empty, refilling to 100% at each reset.
 */
export function projectAccount(
  account: PoolAccount,
  burnPerHour: number,
  now: number,
  endMs: number
): AccountProjection {
  const result: AccountProjection = { key: account.key, points: [], emptyAtMs: null };
  if (account.remaining === null || endMs <= now) return result;
  const rate = Math.max(0, burnPerHour) / HOUR_MS;
  let value = account.remaining;
  let t = now;
  let nextReset =
    account.nextResetMs !== null && account.nextResetMs > now ? account.nextResetMs : null;
  const period = account.periodMs && account.periodMs >= HOUR_MS ? account.periodMs : null;
  if (value <= EPSILON) result.emptyAtMs = now;
  result.points.push({ atMs: t, value });

  for (let guard = 0; guard < 2000; guard += 1) {
    const segmentEnd = Math.min(nextReset ?? Infinity, endMs);
    if (rate > 0 && value > 0) {
      const emptyAt = t + value / rate;
      if (emptyAt < segmentEnd) {
        result.points.push({ atMs: emptyAt, value: 0 });
        result.emptyAtMs ??= emptyAt;
        value = 0;
        t = emptyAt;
      }
    }
    value = Math.max(0, value - (segmentEnd - t) * rate);
    t = segmentEnd;
    result.points.push({ atMs: t, value });
    if (t >= endMs || nextReset === null) break;
    value = 100;
    result.points.push({ atMs: t, value });
    nextReset = period ? nextReset + period : null;
  }
  return result;
}

/* ---------------------------------------------------------------- pool */

export interface PoolResetEvent {
  atMs: number;
  added: number;
}

export interface PoolSummary {
  accounts: PoolAccount[];
  /** Accounts whose remaining quota is known. */
  knownCount: number;
  total: number | null;
  capacity: number;
  /** Pool burn over the selected window, percent per hour; null without history. */
  burnPerHour: number | null;
  recorded: PoolPoint[];
  recordedJumps: PoolJump[];
  projected: PoolPoint[];
  projectedJumps: PoolJump[];
  /** Per-account lines (recorded joined with projected), for the accounts overlay. */
  accountLines: { key: string; label: string; points: PoolPoint[] }[];
  poolEmptyAtMs: number | null;
  firstEmpty: { atMs: number; account: PoolAccount } | null;
  nextReset: PoolResetEvent | null;
}

export interface PoolOptions {
  now: number;
  span: { startMs: number; endMs: number };
  burnWindowHours: number;
  futureUsage: FutureUsage;
}

export function summarizePool(accounts: PoolAccount[], options: PoolOptions): PoolSummary {
  const { now, span, burnWindowHours, futureUsage } = options;
  const known = accounts.filter((account) => account.remaining !== null);
  const factor = FUTURE_USAGE_FACTOR[futureUsage];

  const burns = new Map<string, number | null>();
  known.forEach((account) =>
    burns.set(account.key, burnRate(account.history, now, burnWindowHours))
  );
  const measured = Array.from(burns.values()).filter((value): value is number => value !== null);
  const burnPerHour = measured.length > 0 ? measured.reduce((sum, value) => sum + value, 0) : null;

  // Recorded: from the earliest archived reading (inside the span) up to now.
  const recordedEnd = Math.min(now, span.endMs);
  const earliest = known.reduce<number | null>((min, account) => {
    const first = account.history[0]?.atMs;
    return first === undefined || first >= now ? min : min === null ? first : Math.min(min, first);
  }, null);
  const recordedStart = earliest === null ? null : Math.max(span.startMs, earliest);
  const recordedLines = new Map<string, PoolPoint[]>();
  if (recordedStart !== null && recordedEnd > recordedStart) {
    known.forEach((account) => {
      // An account without archived readings was not used through the proxy;
      // hold its current level rather than leave a hole in the pool.
      const line =
        account.history.length > 0
          ? account.history
          : [
              { atMs: recordedStart, value: account.remaining as number },
              { atMs: now, value: account.remaining as number },
            ];
      const padded =
        line[0].atMs > recordedStart
          ? [{ atMs: recordedStart, value: line[0].value }, ...line]
          : line;
      recordedLines.set(account.key, clipPolyline(padded, recordedStart, recordedEnd));
    });
  }
  const recorded = sumPolylines(Array.from(recordedLines.values()));

  // Projected: from now (or the span start, when looking ahead) to the span end.
  const projections = known.map((account) =>
    projectAccount(account, (burns.get(account.key) ?? 0) * factor, now, Math.max(span.endMs, now))
  );
  const projectedStart = Math.max(now, span.startMs);
  const projectedLines = projections.map((projection) =>
    clipPolyline(projection.points, projectedStart, span.endMs)
  );
  const projected = sumPolylines(projectedLines);

  let poolEmptyAtMs: number | null = null;
  if (known.length > 0) {
    const full = sumPolylines(projections.map((projection) => projection.points)).points;
    const index = full.findIndex((point) => point.value <= EPSILON);
    if (index === 0) poolEmptyAtMs = now;
    else if (index > 0) {
      const before = full[index - 1];
      const at = full[index];
      poolEmptyAtMs =
        before.value <= at.value
          ? at.atMs
          : before.atMs + ((at.atMs - before.atMs) * before.value) / (before.value - at.value);
    }
  }

  const firstEmpty = projections.reduce<PoolSummary['firstEmpty']>((best, projection, index) => {
    if (projection.emptyAtMs === null) return best;
    if (best && best.atMs <= projection.emptyAtMs) return best;
    return { atMs: projection.emptyAtMs, account: known[index] };
  }, null);

  const upcoming = known
    .filter((account) => account.nextResetMs !== null && account.nextResetMs > now)
    .sort((a, b) => (a.nextResetMs as number) - (b.nextResetMs as number));
  let nextReset: PoolResetEvent | null = null;
  if (upcoming.length > 0) {
    const atMs = upcoming[0].nextResetMs as number;
    const added = upcoming
      .filter((account) => (account.nextResetMs as number) - atMs <= RESET_GROUP_MS)
      .reduce((sum, account) => {
        const burn = (burns.get(account.key) ?? 0) * factor;
        const before = Math.max(0, (account.remaining as number) - (burn * (atMs - now)) / HOUR_MS);
        return sum + (100 - before);
      }, 0);
    nextReset = { atMs, added };
  }

  return {
    accounts,
    knownCount: known.length,
    total:
      known.length > 0
        ? known.reduce((sum, account) => sum + (account.remaining as number), 0)
        : null,
    capacity: known.length * 100,
    burnPerHour,
    recorded: recorded.points,
    recordedJumps: recorded.jumps,
    projected: projected.points,
    projectedJumps: projected.jumps,
    accountLines: known.map((account, index) => ({
      key: account.key,
      label: account.label,
      points: [...(recordedLines.get(account.key) ?? []), ...projectedLines[index]],
    })),
    poolEmptyAtMs,
    firstEmpty,
    nextReset,
  };
}

/* --------------------------------------------------------------- drain */

/**
 * Consumption rate over time in percent per hour: hourly buckets across the
 * recorded line, then the projected rate as a step line.
 */
export function drainSeries(
  recorded: PoolPoint[],
  projected: PoolPoint[],
  bucketMs = HOUR_MS
): { recorded: PoolPoint[]; projected: PoolPoint[] } {
  const recordedOut: PoolPoint[] = [];
  if (recorded.length > 1) {
    const start = recorded[0].atMs;
    const end = recorded[recorded.length - 1].atMs;
    for (let from = start; from < end; from += bucketMs) {
      const to = Math.min(end, from + bucketMs);
      const segment = clipPolyline(recorded, from, to);
      let spent = 0;
      for (let i = 1; i < segment.length; i += 1) {
        if (segment[i].atMs > segment[i - 1].atMs) {
          spent += Math.max(0, segment[i - 1].value - segment[i].value);
        }
      }
      const rate = spent / ((to - from) / HOUR_MS);
      recordedOut.push({ atMs: from, value: rate }, { atMs: to, value: rate });
    }
  }
  const projectedOut: PoolPoint[] = [];
  for (let i = 1; i < projected.length; i += 1) {
    const a = projected[i - 1];
    const b = projected[i];
    if (b.atMs <= a.atMs) continue;
    const rate = Math.max(0, (a.value - b.value) / ((b.atMs - a.atMs) / HOUR_MS));
    projectedOut.push({ atMs: a.atMs, value: rate }, { atMs: b.atMs, value: rate });
  }
  return { recorded: recordedOut, projected: projectedOut };
}

/** A round axis maximum for drain rates. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}
