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
  /** Live quota loaded, even if it reported no window this pool can use. */
  loaded?: boolean;
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
    loaded: input.quota?.status === 'success',
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

/** How far ahead the outlook looks, whatever range the chart shows. */
export const OUTLOOK_HORIZON_MS = POOL_SPAN_DAYS * DAY_MS;

/** Below this many percent the remaining quota counts as gone. */
const DRY = EPSILON;

export interface AccountProjection {
  key: string;
  points: PoolPoint[];
  emptyAtMs: number | null;
}

/** A stretch where every account in the pool is out of quota. */
export interface DrySpell {
  startMs: number;
  /** When a reset brings quota back; the projection end when none does. */
  endMs: number;
  refilled: boolean;
}

export interface PoolProjection {
  accounts: AccountProjection[];
  dry: DrySpell[];
}

/**
 * Project accounts forward from `now` to `endMs`, each draining at its rate in
 * percent per hour and refilling to 100% at every reset. When one runs dry its
 * demand moves, evenly, onto the accounts that still have quota, the way the
 * proxy routes around an exhausted credential; the pool is dry only when all are.
 */
export function projectPool(
  accounts: PoolAccount[],
  ratesPerHour: number[],
  now: number,
  endMs: number
): PoolProjection {
  const known = accounts.filter((account) => account.remaining !== null);
  const result: PoolProjection = {
    accounts: known.map((account) => ({ key: account.key, points: [], emptyAtMs: null })),
    dry: [],
  };
  if (known.length === 0 || endMs <= now) return result;

  const value = known.map((account) => Math.max(0, account.remaining as number));
  const base = known.map((account) => {
    const rate = ratesPerHour[accounts.indexOf(account)] ?? 0;
    return Math.max(0, Number.isFinite(rate) ? rate : 0) / HOUR_MS;
  });
  const period = known.map((account) =>
    account.periodMs && account.periodMs >= HOUR_MS ? account.periodMs : null
  );
  const reset = known.map((account) =>
    account.nextResetMs !== null && account.nextResetMs > now ? account.nextResetMs : null
  );
  const lines = result.accounts;
  const isDry = () => value.every((amount) => amount <= DRY);

  lines.forEach((line, i) => {
    line.points.push({ atMs: now, value: value[i] });
    if (value[i] <= DRY) line.emptyAtMs = now;
  });
  let dryStart: number | null = isDry() ? now : null;
  let t = now;

  for (let guard = 0; guard < 5000 && t < endMs; guard += 1) {
    const active = value.flatMap((amount, i) => (amount > DRY ? [i] : []));
    const orphaned = base.reduce((sum, rate, i) => (value[i] > DRY ? sum : sum + rate), 0);
    const effective = value.map((amount, i) =>
      amount > DRY ? base[i] + orphaned / active.length : 0
    );

    let next = endMs;
    reset.forEach((at) => {
      if (at !== null && at < next) next = at;
    });
    active.forEach((i) => {
      if (effective[i] > 0) next = Math.min(next, t + value[i] / effective[i]);
    });

    const elapsed = next - t;
    active.forEach((i) => {
      const left = value[i] - effective[i] * elapsed;
      value[i] = left <= 1e-9 ? 0 : left;
      if (value[i] <= DRY) lines[i].emptyAtMs ??= next;
    });
    t = next;
    lines.forEach((line, i) => line.points.push({ atMs: t, value: value[i] }));
    if (dryStart === null && isDry()) dryStart = t;

    reset.forEach((at, i) => {
      if (at === null || at > t) return;
      value[i] = 100;
      lines[i].points.push({ atMs: t, value: 100 });
      reset[i] = period[i] ? at + (period[i] as number) : null;
    });
    if (dryStart !== null && !isDry()) {
      result.dry.push({ startMs: dryStart, endMs: t, refilled: true });
      dryStart = null;
    }
  }
  if (dryStart !== null) result.dry.push({ startMs: dryStart, endMs: endMs, refilled: false });
  return result;
}

/** One account on its own: drains at `burnPerHour`, refills at each reset. */
export function projectAccount(
  account: PoolAccount,
  burnPerHour: number,
  now: number,
  endMs: number
): AccountProjection {
  return (
    projectPool([account], [burnPerHour], now, endMs).accounts[0] ?? {
      key: account.key,
      points: [],
      emptyAtMs: null,
    }
  );
}

/* ----------------------------------------------------------- allowance */

/**
 * The pace that spends each window exactly by its reset: 100% at the window's
 * start falling to 0% at its end, repeated every period. Null when the account
 * has no known reset schedule.
 */
export function evenPaceLine(
  account: Pick<PoolAccount, 'nextResetMs' | 'periodMs'>,
  span: { startMs: number; endMs: number }
): PoolPoint[] | null {
  const { nextResetMs: resetMs, periodMs } = account;
  if (resetMs === null || !periodMs || periodMs < HOUR_MS || span.endMs <= span.startMs) {
    return null;
  }
  const level = (boundary: number, t: number) => (100 * (boundary - t)) / periodMs;
  let boundary = resetMs - Math.floor((resetMs - span.startMs) / periodMs) * periodMs;
  const points: PoolPoint[] = [{ atMs: span.startMs, value: level(boundary, span.startMs) }];
  for (let guard = 0; guard < 2000 && boundary <= span.endMs; guard += 1) {
    if (boundary > span.startMs) points.push({ atMs: boundary, value: 0 });
    if (boundary < span.endMs) points.push({ atMs: boundary, value: 100 });
    boundary += periodMs;
  }
  const last = points[points.length - 1];
  if (last.atMs < span.endMs) points.push({ atMs: span.endMs, value: level(boundary, span.endMs) });
  return points;
}

/* ---------------------------------------------------------------- pool */

export interface PoolResetEvent {
  atMs: number;
  added: number;
}

/**
 * The answer the page leads with.
 * - `runs-out`: the pool goes dry before every account has had its next reset.
 * - `lasts` / `tight`: it makes it to that reset (tight: under a tenth left).
 * - `empty`: dry right now. `idle`: no recent use. `unmeasured`: too little
 *   history to measure a pace. `unknown`: quota not loaded.
 */
export type PoolOutlookKind =
  'unknown' | 'empty' | 'unmeasured' | 'idle' | 'runs-out' | 'tight' | 'lasts';

export interface PoolOutlook {
  kind: PoolOutlookKind;
  /** When the pool runs dry: 'runs-out' (future) or 'empty' (now). */
  emptyAtMs: number | null;
  /** When quota comes back after running dry; null when no reset is known. */
  refillAtMs: number | null;
  /** The reset closing the current cycle: every account has refilled by then. */
  resetAtMs: number | null;
  /** Pool left just before `resetAtMs` at the projected pace. */
  leftAtReset: number | null;
  /** The pool's low point between now and `resetAtMs`. */
  lowest: PoolPoint | null;
  /** A dry spell after the current cycle, still within the outlook horizon. */
  laterEmptyAtMs: number | null;
  /** End of the outlook horizon, for "not before …" copy. */
  horizonMs: number;
}

export interface PoolSummary {
  accounts: PoolAccount[];
  /** Accounts whose remaining quota is known. */
  knownCount: number;
  total: number | null;
  capacity: number;
  /** Pool burn over the selected window, percent per hour; null without history. */
  burnPerHour: number | null;
  /** Pace that spends every window exactly by its reset, percent per hour. */
  allowancePerHour: number | null;
  recorded: PoolPoint[];
  recordedJumps: PoolJump[];
  projected: PoolPoint[];
  projectedJumps: PoolJump[];
  /** Even-pace reference across the span; empty when a reset schedule is unknown. */
  evenPace: PoolPoint[];
  /** Spells with every account dry, unclipped. */
  dry: DrySpell[];
  poolEmptyAtMs: number | null;
  firstEmpty: { atMs: number; account: PoolAccount } | null;
  nextReset: PoolResetEvent | null;
  outlook: PoolOutlook;
}

export interface PoolOptions {
  now: number;
  span: { startMs: number; endMs: number };
  burnWindowHours: number;
  futureUsage: FutureUsage;
}

/** Share of capacity below which making it to the reset counts as tight. */
const TIGHT_SHARE = 0.1;
/** Measured burn below this (percent per hour) is no use at all. */
const IDLE_BURN = 0.005;

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

  const periods = known.flatMap((account) =>
    account.periodMs && account.periodMs >= HOUR_MS ? [account.periodMs] : []
  );
  const allowancePerHour =
    periods.length > 0 ? periods.reduce((sum, period) => sum + (100 * HOUR_MS) / period, 0) : null;

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

  // Projected: far enough to cover the span, the outlook horizon and every next reset.
  const upcoming = known
    .map((account) => account.nextResetMs)
    .filter((at): at is number => at !== null && at > now)
    .sort((a, b) => a - b);
  const cycleEnd = upcoming.length > 0 ? upcoming[upcoming.length - 1] : null;
  const horizonMs = Math.max(span.endMs, now + OUTLOOK_HORIZON_MS, (cycleEnd ?? now) + HOUR_MS);
  const projection = projectPool(
    known,
    known.map((account) => (burns.get(account.key) ?? 0) * factor),
    now,
    horizonMs
  );
  const projectedStart = Math.max(now, span.startMs);
  const projectedLines = projection.accounts.map((line) =>
    clipPolyline(line.points, projectedStart, span.endMs)
  );
  const projected = sumPolylines(projectedLines);
  const full = sumPolylines(projection.accounts.map((line) => line.points)).points;

  const firstEmpty = projection.accounts.reduce<PoolSummary['firstEmpty']>((best, line, index) => {
    if (line.emptyAtMs === null) return best;
    if (best && best.atMs <= line.emptyAtMs) return best;
    return { atMs: line.emptyAtMs, account: known[index] };
  }, null);

  let nextReset: PoolResetEvent | null = null;
  if (upcoming.length > 0 && full.length > 0) {
    const atMs = upcoming[0];
    nextReset = { atMs, added: valueAt(full, atMs, 'right') - valueAt(full, atMs, 'left') };
  }

  const evenLines = known.map((account) => evenPaceLine(account, span));
  const evenPace =
    known.length > 0 && evenLines.every((line) => line !== null)
      ? sumPolylines(evenLines as PoolPoint[][]).points
      : [];

  const total =
    known.length > 0
      ? known.reduce((sum, account) => sum + (account.remaining as number), 0)
      : null;
  const capacity = known.length * 100;
  const firstDry = projection.dry[0] ?? null;

  const outlook: PoolOutlook = {
    kind: 'unknown',
    emptyAtMs: null,
    refillAtMs: null,
    resetAtMs: cycleEnd,
    leftAtReset: null,
    lowest: null,
    laterEmptyAtMs: null,
    horizonMs,
  };
  if (total === null) {
    outlook.kind = 'unknown';
  } else if (total <= DRY) {
    outlook.kind = 'empty';
    outlook.emptyAtMs = now;
    outlook.refillAtMs = firstDry?.refilled ? firstDry.endMs : null;
  } else if (burnPerHour === null) {
    outlook.kind = 'unmeasured';
  } else if (burnPerHour < IDLE_BURN) {
    outlook.kind = 'idle';
  } else if (firstDry && (cycleEnd === null || firstDry.startMs < cycleEnd)) {
    outlook.kind = 'runs-out';
    outlook.emptyAtMs = firstDry.startMs;
    outlook.refillAtMs = firstDry.refilled ? firstDry.endMs : null;
  } else {
    if (cycleEnd !== null) {
      outlook.leftAtReset = valueAt(full, cycleEnd, 'left');
      outlook.lowest = full.reduce<PoolPoint>(
        (low, point) =>
          point.atMs > now && point.atMs <= cycleEnd && point.value < low.value ? point : low,
        { atMs: now, value: total }
      );
    }
    outlook.laterEmptyAtMs = firstDry?.startMs ?? null;
    outlook.kind =
      outlook.lowest !== null && outlook.lowest.value < capacity * TIGHT_SHARE ? 'tight' : 'lasts';
  }

  return {
    accounts,
    knownCount: known.length,
    total,
    capacity,
    burnPerHour,
    allowancePerHour,
    recorded: recorded.points,
    recordedJumps: recorded.jumps,
    projected: projected.points,
    projectedJumps: projected.jumps,
    evenPace,
    dry: projection.dry,
    poolEmptyAtMs: firstDry?.startMs ?? null,
    firstEmpty,
    nextReset,
    outlook,
  };
}
