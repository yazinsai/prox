import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export type DashboardWindow = '1h' | '8h' | '24h';
export type DashboardOutcome = 'all' | 'failed';
export type DashboardLoadState = 'loading' | 'ready' | 'unsupported' | 'error' | 'disconnected';
export type DashboardRouteStatus = 'ready' | 'standby' | 'cooling' | 'unavailable' | 'unknown';
export type DashboardRequestOutcome = 'success' | 'failed' | 'interrupted';
export type DashboardRequestReason =
  | 'rate_limited'
  | 'unauthorized'
  | 'upstream_error'
  | 'invalid_request'
  | 'cancelled'
  | 'stream_interrupted'
  | 'unknown';

export interface DashboardRoute {
  provider: string;
  providerLabel: string;
  priority: number;
  readyCredentials: number;
  status: DashboardRouteStatus;
  cooldownReason: string | null;
  retryAt: string | null;
}

export interface DashboardModel {
  id: string;
  label: string;
  routes: DashboardRoute[];
  lastUsedProvider: string | null;
}

export interface DashboardRoutes {
  observedAt: string;
  runtimeKnown: boolean;
  models: DashboardModel[];
}

export interface DashboardRequestAttempt {
  id: string;
  model: string;
  provider: string;
  startedAt: string;
  completedAt: string;
  statusCode: number;
  outcome: DashboardRequestOutcome;
  durationMs: number;
  reason: DashboardRequestReason | null;
}

export interface DashboardRequest extends DashboardRequestAttempt {
  traceId: string;
  archiveRequestId: string | null;
}

export interface DashboardRequestDetail extends DashboardRequest {
  attempts: DashboardRequestAttempt[];
}

interface DashboardCoverage {
  observedAt: string;
  coverageStart: string;
  partial: boolean;
  window: DashboardWindow;
}

export interface DashboardRequests extends DashboardCoverage {
  requests: DashboardRequest[];
  nextCursor: string | null;
}

export interface DashboardBreakdown {
  id: string;
  total: number;
  success: number;
  failed: number;
}

export interface DashboardSummary extends DashboardCoverage {
  total: number;
  success: number;
  failed: number;
  byModel: DashboardBreakdown[];
  byProvider: DashboardBreakdown[];
}

export interface DashboardRequestsQuery {
  window: DashboardWindow;
  outcome?: DashboardOutcome;
  cursor?: string | null;
  limit?: number;
}

const invalid = (): never => {
  throw new Error('Invalid dashboard response');
};
const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : invalid());
const text = (value: unknown): string => (typeof value === 'string' ? value : invalid());
const identifier = (value: unknown): string => {
  const result = text(value);
  return result.trim() ? result : invalid();
};
const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid();
const integer = (value: unknown): number => {
  const result = number(value);
  return Number.isSafeInteger(result) ? result : invalid();
};
const date = (value: unknown): string => {
  const result = text(value);
  return result && Number.isFinite(Date.parse(result)) ? result : invalid();
};
const optionalText = (value: unknown): string | null =>
  value === undefined || value === null || value === '' ? null : text(value);
const list = <T>(value: unknown, normalize: (entry: unknown) => T): T[] =>
  Array.isArray(value) ? value.map(normalize) : invalid();
const boolean = (value: unknown): boolean => (typeof value === 'boolean' ? value : invalid());
const windows = new Set<DashboardWindow>(['1h', '8h', '24h']);
const routeStatuses = new Set<DashboardRouteStatus>([
  'ready',
  'standby',
  'cooling',
  'unavailable',
  'unknown',
]);
const outcomes = new Set<DashboardRequestOutcome>(['success', 'failed', 'interrupted']);
const reasons = new Set<DashboardRequestReason>([
  'rate_limited',
  'unauthorized',
  'upstream_error',
  'invalid_request',
  'cancelled',
  'stream_interrupted',
  'unknown',
]);

function normalizeCoverage(data: Record<string, unknown>): DashboardCoverage {
  if (data.supported !== true || !windows.has(data.window as DashboardWindow)) invalid();
  return {
    observedAt: date(data.observed_at),
    coverageStart: date(data.coverage_start),
    partial: boolean(data.partial),
    window: data.window as DashboardWindow,
  };
}

export function normalizeDashboardRoutes(value: unknown): DashboardRoutes {
  const data = record(value);
  const runtimeKnown = boolean(data.runtime_known);
  return {
    observedAt: date(data.observed_at),
    runtimeKnown,
    models: list(data.models, (entry) => {
      const model = record(entry);
      return {
        id: identifier(model.id),
        label: optionalText(model.label) ?? identifier(model.id),
        lastUsedProvider: optionalText(model.last_used_provider),
        routes: list(model.routes, (entry) => {
          const route = record(entry);
          const status = route.status as DashboardRouteStatus;
          if (!routeStatuses.has(status)) invalid();
          if (typeof route.priority !== 'number' || !Number.isSafeInteger(route.priority))
            invalid();
          const readyCredentials = integer(route.ready_credentials);
          const retryAt = optionalText(route.retry_at);
          return {
            provider: identifier(route.provider),
            providerLabel: optionalText(route.provider_label) ?? identifier(route.provider),
            priority: route.priority as number,
            readyCredentials: runtimeKnown ? readyCredentials : 0,
            status: runtimeKnown ? status : 'unknown',
            cooldownReason: optionalText(route.cooldown_reason),
            retryAt: retryAt ? date(retryAt) : null,
          };
        }),
      };
    }),
  };
}

function normalizeAttempt(value: unknown): DashboardRequestAttempt {
  const data = record(value);
  const outcome = data.outcome as DashboardRequestOutcome;
  if (!outcomes.has(outcome)) invalid();
  const statusCode = integer(data.status_code);
  if (statusCode !== 0 && (statusCode < 100 || statusCode > 599)) invalid();
  // Public reasons are enums; arbitrary upstream errors never cross into the UI.
  const reason = optionalText(data.reason);
  return {
    id: identifier(data.id),
    model: text(data.model),
    provider: text(data.provider),
    startedAt: date(data.started_at),
    completedAt: date(data.completed_at),
    statusCode,
    outcome,
    durationMs: number(data.duration_ms),
    reason:
      reason && reasons.has(reason as DashboardRequestReason)
        ? (reason as DashboardRequestReason)
        : reason
          ? 'unknown'
          : null,
  };
}

function normalizeRequest(value: unknown): DashboardRequest {
  const data = record(value);
  return {
    ...normalizeAttempt(data),
    traceId: text(data.trace_id),
    archiveRequestId: optionalText(data.archive_request_id),
  };
}

export function normalizeDashboardRequests(value: unknown): DashboardRequests {
  const data = record(value);
  return {
    ...normalizeCoverage(data),
    requests: list(data.requests, normalizeRequest),
    nextCursor: optionalText(data.next_cursor),
  };
}

export function normalizeDashboardRequestDetail(value: unknown): DashboardRequestDetail {
  const data = record(value);
  if (data.supported !== true) invalid();
  const request = record(data.request);
  return {
    ...normalizeRequest(request),
    attempts: list(request.attempts, normalizeAttempt),
  };
}

function normalizeCounts(data: Record<string, unknown>) {
  const total = integer(data.total);
  const success = integer(data.success);
  const failed = integer(data.failed);
  if (success + failed !== total) invalid();
  return { total, success, failed };
}

export function normalizeDashboardSummary(value: unknown): DashboardSummary {
  const data = record(value);
  const breakdown = (entry: unknown): DashboardBreakdown => {
    const row = record(entry);
    return { id: text(row.id), ...normalizeCounts(row) };
  };
  return {
    ...normalizeCoverage(data),
    ...normalizeCounts(data),
    byModel: list(data.by_model, breakdown),
    byProvider: list(data.by_provider, breakdown),
  };
}

const PATH = '/observability/dashboard';

export const dashboardApi = {
  async getRoutes(signal?: AbortSignal): Promise<DashboardRoutes> {
    const client = apiClient.captureConnection();
    return normalizeDashboardRoutes(await client.get(`${PATH}/routes`, { signal }));
  },
  async getSummary(window: DashboardWindow, signal?: AbortSignal): Promise<DashboardSummary> {
    const client = apiClient.captureConnection();
    const summary = normalizeDashboardSummary(
      await client.get(`${PATH}/summary`, {
        params: { window },
        signal,
      })
    );
    if (summary.window !== window) invalid();
    return summary;
  },
  async getRequests(
    query: DashboardRequestsQuery,
    signal?: AbortSignal
  ): Promise<DashboardRequests> {
    const client = apiClient.captureConnection();
    const requests = normalizeDashboardRequests(
      await client.get(`${PATH}/requests`, {
        params: {
          window: query.window,
          outcome: query.outcome === 'failed' ? 'failed' : undefined,
          cursor: query.cursor || undefined,
          limit: query.limit ?? 8,
        },
        signal,
      })
    );
    if (requests.window !== query.window) invalid();
    return requests;
  },
  async getRequest(id: string, signal?: AbortSignal): Promise<DashboardRequestDetail> {
    const client = apiClient.captureConnection();
    return normalizeDashboardRequestDetail(
      await client.get(`${PATH}/requests/${encodeURIComponent(id)}`, { signal })
    );
  },
};
