import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrant,
  type AnthropicResetGrantStatus,
  type AnthropicResetWindow,
} from '@/services/api/claudeResetGrants';
import { parseIsoToMs } from '@/utils/quota';

/**
 * Reset kinds as Claude Code's `/limit-reset` names them:
 * - `full` refills the 5-hour and 7-day limits;
 * - `session` refills the 5-hour limit; `weekly` the 7-day limit;
 * - `fable` refills the 5-hour and Fable limits and returns what Fable used
 *   to the 7-day limit (`gives_back_weekly`), without clearing the rest of it.
 */
export type ResetGrantKind = 'full' | 'session' | 'weekly' | 'fable' | 'other';

export function resetGrantKind(
  grant: Pick<AnthropicResetGrant, 'clears' | 'type' | 'givesBackWeekly'>
): ResetGrantKind {
  if (grant.givesBackWeekly) return 'fable';
  if (grant.type) return grant.type;
  if (grant.clears.length === 0) return 'other';
  const session = grant.clears.includes('five_hour');
  const longer = grant.clears.some((window) => window !== 'five_hour');
  if (session && !longer) return 'session';
  if (longer && !session) return 'weekly';
  return 'full';
}

/** Windows whose current usage matters before spending this grant. */
export function resetGrantWindows(
  grant: Pick<AnthropicResetGrant, 'clears' | 'givesBackWeekly'>
): AnthropicResetWindow[] {
  const windows = new Set(grant.clears);
  if (grant.givesBackWeekly) windows.add('seven_day');
  return (['five_hour', 'seven_day', 'seven_day_overage_included'] as const).filter((window) =>
    windows.has(window)
  );
}

export interface ResetGrantGroup {
  key: string;
  kind: ResetGrantKind;
  /** Resets left across every grant in the group. */
  left: number;
  endsAt: string | null;
  /** Upstream wording, kept for the tooltip only. */
  labels: string[];
  /** Claude's suggested next grant is in this group. */
  suggested: boolean;
  /** The grant a Use click spends, or undefined when none is usable now. */
  targetId: string | undefined;
}

/**
 * Collapse grants that behave the same and expire together into one row;
 * the suggested group leads, then soonest expiry.
 */
export function groupResetGrants(
  grants: readonly AnthropicResetGrant[],
  suggestedId: string | null | undefined,
  usableIds: readonly string[] = []
): ResetGrantGroup[] {
  const groups = new Map<string, ResetGrantGroup>();
  for (const grant of grants) {
    if (grant.resetsLeft <= 0) continue;
    const kind = resetGrantKind(grant);
    const key = `${kind}|${grant.endsAt ?? ''}`;
    const group = groups.get(key) ?? {
      key,
      kind,
      left: 0,
      endsAt: grant.endsAt,
      labels: [],
      suggested: false,
      targetId: undefined,
    };
    group.left += grant.resetsLeft;
    if (grant.label && !group.labels.includes(grant.label)) group.labels.push(grant.label);
    if (grant.id === suggestedId) group.suggested = true;
    groups.set(key, group);
  }
  for (const id of usableIds) {
    const grant = grants.find((candidate) => candidate.id === id);
    const group = grant && groups.get(`${resetGrantKind(grant)}|${grant.endsAt ?? ''}`);
    if (group && (group.targetId === undefined || id === suggestedId)) group.targetId = id;
  }
  const expiry = (group: ResetGrantGroup) => parseIsoToMs(group.endsAt) ?? Infinity;
  return [...groups.values()].sort(
    (a, b) => Number(b.suggested) - Number(a.suggested) || expiry(a) - expiry(b)
  );
}

export type ResetGrantHint = 'ineligible' | 'none' | 'cooldown' | 'needs_limit' | 'unavailable';

/** Why nothing can be spent right now, when no grant is usable. */
export function resetGrantHint(
  status: AnthropicResetGrantStatus,
  anyUsable: boolean,
  now: number
): ResetGrantHint | null {
  if (anyUsable) return null;
  if (!status.eligible) return 'ineligible';
  if (!status.grants.some((grant) => grant.resetsLeft > 0)) return 'none';
  if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return 'cooldown';
  if (status.grants.some((grant) => anthropicResetGrantBlocker(status, grant.id) === 'not_limited'))
    return 'needs_limit';
  return 'unavailable';
}
