import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';

/** Grants that could be spent right now, in stable ID order. */
export function usableResetGrants(status: AnthropicResetGrantStatus, now: number) {
  if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return [];
  return status.grants
    .filter(
      (grant) =>
        !anthropicResetGrantBlocker(status, grant.id) &&
        (!grant.startsAt || Date.parse(grant.startsAt) <= now) &&
        (!grant.endsAt || Date.parse(grant.endsAt) > now)
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Prefer the upstream recommendation; otherwise use stable ID ordering. */
export function selectResetGrant(status: AnthropicResetGrantStatus, now: number) {
  const usable = usableResetGrants(status, now);
  return usable.find((grant) => grant.id === status.nextGrantId) ?? usable[0];
}
