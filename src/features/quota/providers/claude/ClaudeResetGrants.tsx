import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores/useAuthStore';
import { useNotificationStore } from '@/stores';
import { apiClient } from '@/services/api/client';
import { type AnthropicResetGrantStatus } from '@/services/api/claudeResetGrants';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/quota';
import {
  resetGrantOperations,
  RETRY_WINDOW_MS,
  ResetGrantPreflightError,
  resetGrantFailureMessageKey,
} from './resetGrantOperations';
import { selectResetGrant, usableResetGrants } from './selectResetGrant';
import {
  groupResetGrants,
  resetGrantHint,
  resetGrantKind,
  resetGrantWindows,
} from './resetGrantSummary';

/**
 * Grants arrive with the card's own usage read (`cedar_ember=1`), so the card makes no
 * extra rate-limited call. The session-scoped journal owns spending and ambiguous retries.
 */
export function useClaudeResetGrants(
  file: AuthFileItem,
  grants: AnthropicResetGrantStatus | null | undefined,
  enabled: boolean,
  disabled: boolean,
  onRefresh: () => void
) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [session] = useState(() => apiClient.getConnectionRevision());
  const sessionActive =
    connectionStatus === 'connected' && session === apiClient.getConnectionRevision();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const now = useNow();
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  const key = JSON.stringify([file.name, authIndex]);
  const status = enabled && sessionActive && authIndex ? (grants ?? null) : null;
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  // Each new read (or account) invalidates confirmations opened against the old one.
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
  }, [key, grants, sessionActive]);

  const operation = resetGrantOperations.inspect(key);
  const pending = operation && !operation.code ? operation : undefined;
  const expired = Boolean(pending && now - pending.createdAt >= RETRY_WINDOW_MS);
  const usable = status && !pending ? usableResetGrants(status, now) : [];
  const suggested = status ? (selectResetGrant(status, now)?.id ?? status.nextGrantId) : null;
  const unavailable = disabled || !sessionActive || !authIndex || busy;
  const left = status?.grants.reduce((sum, grant) => sum + grant.resetsLeft, 0) ?? null;
  const describe = (grantId: string) => {
    const grant = status?.grants.find((item) => item.id === grantId);
    if (!grant) return t('claude_reset.confirm_other', { name: file.name, left: '--' });
    const usage = resetGrantWindows(grant)
      .filter((window) => grant.percentUsed[window] !== undefined)
      .map((window) => t(`claude_reset.usage_${window}`, { percent: grant.percentUsed[window] }))
      .join(', ');
    return [
      t(`claude_reset.confirm_${resetGrantKind(grant)}`, {
        name: file.name,
        left: Math.max(0, (left ?? 1) - 1),
      }),
      t('claude_reset.weekly_day_note'),
      usage ? t('claude_reset.confirm_usage', { usage }) : '',
    ]
      .filter(Boolean)
      .join(' ');
  };
  /** Spend a specific grant, or retry the pending ambiguous claim with its original grant. */
  const confirm = (requested?: string) => {
    const grantId = pending ? pending.grantId : requested;
    if (unavailable || expired || lock.current || !grantId || !authIndex) return;
    if (!pending && !usable.some((grant) => grant.id === grantId)) return;
    const version = generation.current;
    const current = () =>
      session === apiClient.getConnectionRevision() && version === generation.current;
    showConfirmation({
      title: t('claude_reset.title'),
      message: pending ? t('claude_reset.retry_confirm', { name: file.name }) : describe(grantId),
      confirmText: t(pending ? 'claude_reset.retry' : 'claude_reset.confirm'),
      variant: 'primary',
      onConfirm: async () => {
        if (!current() || lock.current || useAuthStore.getState().connectionStatus !== 'connected')
          return;
        lock.current = true;
        setBusy(true);
        try {
          const answer = await resetGrantOperations.run(key, authIndex, grantId);
          if (!current()) return;
          showNotification(
            answer.code === 'cooldown_clear_failed'
              ? t('auth_files.cooldown_reset_failed', {
                  name: file.name,
                  message: t('common.unknown_error'),
                })
              : t(`claude_reset.${answer.unresolved ? 'unknown' : answer.code}`),
            !answer.unresolved && (answer.code === 'reset' || answer.code === 'already_used')
              ? 'success'
              : 'error'
          );
        } catch (error: unknown) {
          if (!current()) return;
          const unresolved = resetGrantOperations.inspect(key);
          showNotification(
            t(
              unresolved && !unresolved.code
                ? 'claude_reset.unknown'
                : resetGrantFailureMessageKey(error),
              {
                code: error instanceof ResetGrantPreflightError ? error.reason : '',
              }
            ),
            'error'
          );
        } finally {
          lock.current = false;
          // A concurrent page-wide refresh can invalidate this read generation.
          // Release the local lock regardless, but never refresh a replacement account.
          setBusy(false);
          if (current()) onRefresh();
        }
      },
    });
  };
  return {
    loaded: status !== null,
    left,
    groups: status
      ? groupResetGrants(
          status.grants,
          suggested,
          usable.map((grant) => grant.id)
        )
      : [],
    hint: status && !pending ? resetGrantHint(status, usable.length > 0, now) : null,
    cooldownUntil: status?.cooldownUntil ?? null,
    busy,
    /** Row Use buttons are inert while anything is in flight or unresolved. */
    useDisabled: unavailable || Boolean(pending),
    confirm,
    pending: Boolean(pending),
    retryBlocked: unavailable || expired,
    message: pending ? (expired ? 'expired' : 'unknown') : '',
  };
}
