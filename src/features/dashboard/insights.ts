import type {
  DashboardBreakdown,
  DashboardModel,
  DashboardRequest,
  DashboardRoute,
  DashboardRouteStatus,
  DashboardSummary,
} from '@/services/api/dashboard';
import { modelLabel } from '@/utils/modelIdentity';
import { rankRequestBreakdown } from './requestBreakdown';
import { DAY_MS, MINUTE_MS } from '@/utils/time/durations';

/** One-minute bars drawn in the activity pulse. */
export const PULSE_MINUTES = 15;
/** The "right now" pace and concurrency are measured over this trailing window. */
export const PACE_MINUTES = 5;
/** A shorter history makes "usual" meaningless. */
const MIN_BASELINE_MINUTES = 30;

/** Completed requests, newest first, fetched until the pulse horizon or a page cap. */
export interface RecentActivity {
  observedAt: string;
  requests: DashboardRequest[];
  /** True when every request completed inside the pulse horizon is present. */
  complete: boolean;
}

export interface PulseBin {
  success: number;
  failed: number;
  /** False when the page cap stopped before this minute was fully covered. */
  known: boolean;
}

export type ActivityLevel = 'idle' | 'quiet' | 'steady' | 'busy' | 'active';

export interface ActivitySnapshot {
  /** Oldest first; the last bin ends at the observation instant. */
  bins: PulseBin[];
  peak: number;
  pacePerMinute: number;
  /** The page cap was hit inside the pace window: the true pace is higher. */
  paceIsLowerBound: boolean;
  /** Average completed requests in flight over the pace window (Little's law). */
  concurrency: number | null;
  /** Server-relative age of the newest completion at observation time. */
  lastCompletedAgoMs: number | null;
  baselinePerMinute: number | null;
  level: ActivityLevel;
}

const failed = (request: DashboardRequest) => request.outcome !== 'success';

/** Average requests per minute across the summary's actually covered span. */
export function baselinePerMinute(summary: DashboardSummary | null): number | null {
  if (!summary) return null;
  const observed = Date.parse(summary.observedAt);
  const start = Math.max(Date.parse(summary.coverageStart), observed - DAY_MS);
  const minutes = (observed - start) / MINUTE_MS;
  if (!Number.isFinite(minutes) || minutes < MIN_BASELINE_MINUTES) return null;
  return summary.total / minutes;
}

export function summarizeActivity(feed: RecentActivity, baseline: number | null): ActivitySnapshot {
  const observed = Date.parse(feed.observedAt);
  const oldest = feed.requests.length
    ? Math.min(...feed.requests.map((request) => Date.parse(request.completedAt)))
    : observed;
  // Without completeness, only the span back to the oldest fetched row is known.
  const knownFrom = feed.complete ? -Infinity : oldest;

  const bins: PulseBin[] = Array.from({ length: PULSE_MINUTES }, (_, index) => ({
    success: 0,
    failed: 0,
    known: observed - (PULSE_MINUTES - index) * MINUTE_MS >= knownFrom,
  }));
  for (const request of feed.requests) {
    const age = observed - Date.parse(request.completedAt);
    if (age < 0 || age >= PULSE_MINUTES * MINUTE_MS) continue;
    const bin = bins[PULSE_MINUTES - 1 - Math.floor(age / MINUTE_MS)];
    if (failed(request)) bin.failed += 1;
    else bin.success += 1;
  }

  const paceStart = observed - PACE_MINUTES * MINUTE_MS;
  const paceKnown = paceStart >= knownFrom;
  let recent = 0;
  let busyMs = 0;
  for (const request of feed.requests) {
    const completed = Date.parse(request.completedAt);
    if (completed <= paceStart || completed > observed) continue;
    recent += 1;
    busyMs += completed - Math.max(Date.parse(request.startedAt), paceStart);
  }
  const pacePerMinute = recent / PACE_MINUTES;
  const newest = feed.requests.length
    ? Math.max(...feed.requests.map((request) => Date.parse(request.completedAt)))
    : null;

  let level: ActivityLevel;
  if (recent === 0) level = 'idle';
  else if (baseline === null || baseline <= 0) level = 'active';
  else if (!paceKnown || pacePerMinute >= baseline * 1.6) level = 'busy';
  else if (pacePerMinute <= baseline * 0.6) level = 'quiet';
  else level = 'steady';

  return {
    bins,
    peak: Math.max(1, ...bins.map((bin) => bin.success + bin.failed)),
    pacePerMinute,
    paceIsLowerBound: !paceKnown,
    concurrency: paceKnown ? busyMs / (PACE_MINUTES * MINUTE_MS) : null,
    lastCompletedAgoMs: newest === null ? null : Math.max(0, observed - newest),
    baselinePerMinute: baseline,
    level,
  };
}

/** One provider's view of a model, after merging equivalent model variants. */
export interface ProviderRoute {
  provider: string;
  label: string;
  status: DashboardRouteStatus;
  readyCredentials: number;
  reason: string | null;
  retryAt: string | null;
  /** Still eligible, but some of its credentials are cooling down. */
  partial: boolean;
}

const STATUS_RANK: Record<DashboardRouteStatus, number> = {
  ready: 0,
  standby: 1,
  cooling: 2,
  unknown: 3,
  unavailable: 4,
};

/** Merged variants can list one provider twice; keep its best status and soonest retry. */
export function collapseRoutes(routes: readonly DashboardRoute[]): ProviderRoute[] {
  const byProvider = new Map<string, ProviderRoute & { order: number }>();
  routes.forEach((route, order) => {
    const existing = byProvider.get(route.provider);
    const retryAt =
      existing?.retryAt && route.retryAt
        ? Date.parse(existing.retryAt) <= Date.parse(route.retryAt)
          ? existing.retryAt
          : route.retryAt
        : (existing?.retryAt ?? route.retryAt);
    const reason =
      retryAt && retryAt === route.retryAt ? route.cooldownReason : (existing?.reason ?? null);
    const better = !existing || STATUS_RANK[route.status] < STATUS_RANK[existing.status];
    const status = better ? route.status : existing.status;
    byProvider.set(route.provider, {
      provider: route.provider,
      label: route.providerLabel,
      status,
      readyCredentials: Math.max(existing?.readyCredentials ?? 0, route.readyCredentials),
      reason,
      retryAt,
      partial: false,
      order: existing ? Math.min(existing.order, order) : order,
    });
  });
  return [...byProvider.values()]
    .map(({ order, ...route }) => ({
      route: {
        ...route,
        partial: Boolean(route.retryAt) && (route.status === 'ready' || route.status === 'standby'),
      },
      order,
    }))
    .sort((a, b) => STATUS_RANK[a.route.status] - STATUS_RANK[b.route.status] || a.order - b.order)
    .map(({ route }) => route);
}

export interface ModelUsage {
  id: string;
  label: string;
  total: number;
  failed: number;
  /** Percentage of every request in the window, including unattributed ones. */
  share: number;
  routes: ProviderRoute[];
}

export function topModels(
  summary: DashboardSummary | null,
  models: readonly DashboardModel[],
  limit = 5
): ModelUsage[] {
  if (!summary) return [];
  // Unattributed rows (no model ID) still count toward the share denominator.
  const rows = summary.byModel.filter((row) => row.id && row.total > 0);
  return rankRequestBreakdown(rows, limit).map((row) => ({
    id: row.id,
    label: modelLabel(row.id, models),
    total: row.total,
    failed: row.failed,
    share: summary.total > 0 ? (row.total / summary.total) * 100 : 0,
    routes: collapseRoutes(models.find((model) => model.id === row.id)?.routes ?? []),
  }));
}

export interface RoutedModel {
  id: string;
  label: string;
  /** Requests in the reference window; zero for models nobody is calling. */
  requests: number;
}

export interface AffectedModel extends RoutedModel {
  /** Another ready provider that keeps the model working, or null when nothing can. */
  servedBy: string | null;
}

export type ProviderState = 'cooling' | 'serving' | 'standby' | 'unknown' | 'unavailable';

export interface ProviderStatus {
  provider: string;
  label: string;
  state: ProviderState;
  /** Models this provider is first in line for right now, most-used first. */
  serving: RoutedModel[];
  /** Models it would serve only if a higher-priority provider fails. */
  standby: RoutedModel[];
  /** Models it cannot serve until a cooldown passes, most-used first. */
  cooling: AffectedModel[];
  /** Cooling models with no other ready provider. */
  stranded: number;
  /** Eligible, but some of its credentials are cooling. */
  partial: boolean;
  reason: string | null;
  /** Soonest scheduled retry across cooling or partially cooling routes. */
  retryAt: string | null;
}

const byUsage = (a: RoutedModel, b: RoutedModel) =>
  b.requests - a.requests || a.label.localeCompare(b.label);

const PROVIDER_ORDER: Record<ProviderState, number> = {
  cooling: 0,
  serving: 1,
  standby: 2,
  unknown: 3,
  unavailable: 4,
};

/**
 * Re-index the route snapshot by provider: one exhausted account becomes one
 * line naming the models it affects, instead of a warning on forty model rows.
 */
export function summarizeProviders(
  models: readonly DashboardModel[],
  usage: readonly DashboardBreakdown[] = []
): ProviderStatus[] {
  const requests = new Map(usage.map((row) => [row.id, row.total]));
  const groups = new Map<string, ProviderStatus & { unknown: number }>();
  for (const model of models) {
    const routes = collapseRoutes(model.routes);
    for (const route of routes) {
      const group = groups.get(route.provider) ?? {
        provider: route.provider,
        label: route.label,
        state: 'unavailable' as ProviderState,
        serving: [],
        standby: [],
        cooling: [],
        stranded: 0,
        partial: false,
        reason: null,
        retryAt: null,
        unknown: 0,
      };
      groups.set(route.provider, group);
      const entry = { id: model.id, label: model.label, requests: requests.get(model.id) ?? 0 };
      if (route.status === 'ready') group.serving.push(entry);
      else if (route.status === 'standby') group.standby.push(entry);
      else if (route.status === 'unknown') group.unknown += 1;
      group.partial ||= route.partial;
      if (route.status === 'cooling') {
        const servedBy =
          routes.find((other) => other.status === 'ready' && other.provider !== route.provider)
            ?.label ?? null;
        group.cooling.push({ ...entry, servedBy });
        if (!servedBy) group.stranded += 1;
      }
      if (
        (route.status === 'cooling' || route.partial) &&
        route.retryAt &&
        (!group.retryAt || Date.parse(route.retryAt) < Date.parse(group.retryAt))
      ) {
        group.retryAt = route.retryAt;
        group.reason = route.reason;
      }
    }
  }
  const result: ProviderStatus[] = [];
  for (const { unknown, ...group } of groups.values()) {
    group.state = group.cooling.length
      ? 'cooling'
      : group.serving.length
        ? 'serving'
        : group.standby.length
          ? 'standby'
          : unknown
            ? 'unknown'
            : 'unavailable';
    group.cooling.sort(
      (a, b) =>
        b.requests - a.requests ||
        Number(a.servedBy !== null) - Number(b.servedBy !== null) ||
        a.label.localeCompare(b.label)
    );
    group.serving.sort(byUsage);
    group.standby.sort(byUsage);
    result.push(group);
  }
  const traffic = (group: ProviderStatus) =>
    [...group.cooling, ...group.serving].reduce((sum, model) => sum + model.requests, 0);
  return result.sort(
    (a, b) =>
      PROVIDER_ORDER[a.state] - PROVIDER_ORDER[b.state] ||
      traffic(b) - traffic(a) ||
      b.stranded - a.stranded ||
      b.cooling.length - a.cooling.length ||
      b.serving.length - a.serving.length ||
      b.standby.length - a.standby.length ||
      a.label.localeCompare(b.label)
  );
}

export type WaitParts =
  | { unit: 'now' }
  | { unit: 'seconds'; seconds: number }
  | { unit: 'minutes'; minutes: number }
  | { unit: 'hours'; hours: number; minutes: number }
  | { unit: 'days'; days: number; hours: number };

/** Two significant units at most; never claims more time than remains. */
export function waitParts(ms: number): WaitParts {
  if (!Number.isFinite(ms) || ms <= 0) return { unit: 'now' };
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return { unit: 'seconds', seconds };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: 'minutes', minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', hours, minutes: minutes % 60 };
  return { unit: 'days', days: Math.floor(hours / 24), hours: hours % 24 };
}
