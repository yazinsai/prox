import type { AuthFileItem } from '@/types/authFile';
import type { RoutingMember } from '@/types/routing';

/**
 * What one account can do right now, independent of any model.
 *
 * Only credentials carry runtime state; an enabled API key is simply "on" because the proxy does
 * not report cooldowns for it, and claiming it is healthy would overstate what is known.
 */
export type AccountStatus =
  | { kind: 'off' }
  | { kind: 'problem'; message: string }
  | { kind: 'cooling'; seconds: number; reason: string }
  | { kind: 'partial'; models: number; seconds: number; reason: string }
  | { kind: 'ready' }
  | { kind: 'on' };

export type AccountTone = 'ready' | 'neutral' | 'warning' | 'danger' | 'muted';

export const ACCOUNT_TONE: Record<AccountStatus['kind'], AccountTone> = {
  off: 'muted',
  problem: 'danger',
  cooling: 'warning',
  partial: 'warning',
  ready: 'ready',
  on: 'neutral',
};

const remaining = (seconds: number, elapsed: number) => Math.ceil(seconds - elapsed);

export function accountStatus(
  member: RoutingMember,
  file: AuthFileItem | undefined,
  nowMs: number
): AccountStatus {
  if (member.disabled) return { kind: 'off' };
  if (member.kind !== 'credential') return { kind: 'on' };

  const snapshot = member.cooldowns;
  const elapsed = snapshot ? Math.max(0, nowMs - snapshot.receivedAtMs) / 1000 : 0;
  const active = (snapshot?.records ?? []).filter(
    (record) => remaining(record.remainingSeconds, elapsed) > 0
  );
  const whole = active.filter((record) => record.scope === 'credential');
  if (whole.length > 0) {
    const longest = whole.reduce((a, b) => (b.remainingSeconds > a.remainingSeconds ? b : a));
    return {
      kind: 'cooling',
      seconds: remaining(longest.remainingSeconds, elapsed),
      reason: longest.reason,
    };
  }
  if (member.unavailable) {
    return { kind: 'problem', message: (file?.statusMessage ?? '').trim() };
  }
  if (active.length > 0) {
    const models = new Set(active.map((record) => record.modelKey ?? '')).size;
    // The soonest return is what the operator waits for; later ones follow on their own.
    const soonest = active.reduce((a, b) => (b.remainingSeconds < a.remainingSeconds ? b : a));
    return {
      kind: 'partial',
      models,
      seconds: remaining(soonest.remainingSeconds, elapsed),
      reason: soonest.reason,
    };
  }
  return { kind: 'ready' };
}

export interface AccountUsage {
  total: number;
  failed: number;
}

/** Recorded totals for credentials; config API keys have no per-key counters. */
export function accountUsage(file: AuthFileItem | undefined): AccountUsage | null {
  if (!file) return null;
  const ok = typeof file.successCount === 'number' ? file.successCount : 0;
  const failed = typeof file.failureCount === 'number' ? file.failureCount : 0;
  if (ok + failed === 0) return null;
  return { total: ok + failed, failed };
}

/** Accounts that need the operator, worst first: used for the header summary. */
export function attentionCount(statuses: readonly AccountStatus[]): number {
  return statuses.filter((status) => status.kind === 'problem' || status.kind === 'cooling').length;
}
