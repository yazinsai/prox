import type { AuthFileCooldown, AuthFileItem } from '@/types/authFile';
import { cooldownRemainingSeconds } from '@/features/authFiles/cooldowns';
import type { ProviderTraffic } from './types';

export interface ThrottledProvider {
  id: string;
  credentialCount: number;
  affectedCredentials: number;
  credentialWide: number;
  modelScoped: number;
  models: string[];
  earliestSeconds: number;
}

export function isThrottleCooldown(record: AuthFileCooldown): boolean {
  if (record.reason === 'quota' || record.reason === 'credential_quota') return true;
  if (
    [
      'unauthorized',
      'invalid_grant',
      'cloudflare_challenge',
      'payment_required',
      'not_found',
      'model_not_supported',
    ].includes(record.reason)
  )
    return false;
  return record.httpStatus === 429;
}

/** Runtime snapshots describe restrictions, never whether an entire provider is available. */
export function summarizeProviderThrottling(files: readonly AuthFileItem[] | null, nowMs: number) {
  const groups = new Map<string, ThrottledProvider>();
  let unknownCredentials = 0;
  let expiredCredentials = 0;
  let otherCooldownCredentials = 0;
  for (const file of files ?? []) {
    if (file.disabled) continue;
    const id =
      String(file.type ?? file.provider ?? 'unknown')
        .trim()
        .toLowerCase() || 'unknown';
    const group = groups.get(id) ?? {
      id,
      credentialCount: 0,
      affectedCredentials: 0,
      credentialWide: 0,
      modelScoped: 0,
      models: [],
      earliestSeconds: Infinity,
    };
    group.credentialCount += 1;
    groups.set(id, group);
    const snapshot = file.cooldownSnapshot;
    if (!snapshot || snapshot.records === null) {
      unknownCredentials += 1;
      continue;
    }
    const rows = snapshot.records.map((record) => ({
      record,
      seconds: cooldownRemainingSeconds(record, snapshot.receivedAtMs, nowMs),
    }));
    const active = rows.filter((row) => row.seconds > 0);
    const throttles = active.filter((row) => isThrottleCooldown(row.record));
    if (rows.some((row) => row.seconds === 0)) expiredCredentials += 1;
    if (active.some((row) => !isThrottleCooldown(row.record))) otherCooldownCredentials += 1;
    if (!throttles.length) continue;
    group.affectedCredentials += 1;
    if (throttles.some((row) => row.record.scope === 'credential')) group.credentialWide += 1;
    if (throttles.some((row) => row.record.scope === 'model')) group.modelScoped += 1;
    for (const row of throttles) {
      group.earliestSeconds = Math.min(group.earliestSeconds, row.seconds);
      if (
        row.record.scope === 'model' &&
        row.record.modelKey &&
        !group.models.includes(row.record.modelKey)
      ) {
        group.models.push(row.record.modelKey);
      }
    }
  }
  const providers = [...groups.values()]
    .filter((provider) => provider.affectedCredentials > 0)
    .sort((a, b) => b.affectedCredentials - a.affectedCredentials || a.id.localeCompare(b.id));
  return {
    providers,
    affectedCredentials: providers.reduce((sum, provider) => sum + provider.affectedCredentials, 0),
    unknownCredentials,
    expiredCredentials,
    otherCooldownCredentials,
    loaded: files !== null,
  };
}

/** Provider counters are cumulative; the rolling chart total is a separate scope. */
export function summarizeProviderRequests(providers: readonly ProviderTraffic[]) {
  const success = providers.reduce((sum, provider) => sum + provider.success, 0);
  const failure = providers.reduce((sum, provider) => sum + provider.failure, 0);
  const total = success + failure;
  return {
    success,
    failure,
    total,
    successRate: total > 0 ? (success / total) * 100 : null,
    providers: providers.map((provider) => ({
      ...provider,
      total: provider.success + provider.failure,
      share: total > 0 ? ((provider.success + provider.failure) / total) * 100 : 0,
    })),
  };
}
