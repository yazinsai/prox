import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, formatInstantShort, parseIsoToMs } from '@/utils/quota';
import type { QuotaClassMap } from '../../types';
import type { ResetGrantGroup, ResetGrantHint } from './resetGrantSummary';
import styles from './ClaudeResetGrantDetails.module.scss';

interface ClaudeResetGrantDetailsProps {
  left: number | null;
  groups: readonly ResetGrantGroup[];
  hint: ResetGrantHint | null;
  cooldownUntil: string | null;
  /** Every Use button is inert (busy, disconnected, or an unresolved claim). */
  useDisabled: boolean;
  busy: boolean;
  onUse: (grantId: string) => void;
  classes: QuotaClassMap;
}

/**
 * One row per kind of reset: what it refills, how many are left, when they
 * expire, and a Use button for that kind. Claude's suggestion is marked, not forced.
 */
export function ClaudeResetGrantDetails({
  left,
  groups,
  hint,
  cooldownUntil,
  useDisabled,
  busy,
  onUse,
  classes,
}: ClaudeResetGrantDetailsProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();

  return (
    <section className={styles.section} aria-label={t('claude_reset.section_title')}>
      <div className={styles.header}>
        <span className={classes.quotaModel}>{t('claude_reset.section_title')}</span>
        <span className={classes.quotaPercent}>
          {t('claude_reset.left', { left: left ?? '--' })}
        </span>
      </div>
      {groups.map((group) => {
        const display = buildResetDisplay(
          null,
          parseIsoToMs(group.endsAt),
          now,
          i18n.resolvedLanguage
        );
        const kind = t(`claude_reset.kind_${group.kind}`);
        const expiry = display
          ? t('claude_reset.expires', { when: display.relative || display.absolute })
          : t('claude_reset.expiry_unknown');
        const targetId = group.targetId;
        return (
          <div
            key={group.key}
            className={group.suggested ? `${styles.row} ${styles.rowSuggested}` : styles.row}
            title={group.labels.join('\n') || undefined}
          >
            <div className={styles.line}>
              <span className={styles.name}>
                {kind}
                {group.left > 1 && <span className={styles.count}>×{group.left}</span>}
              </span>
              {group.suggested && (
                <span className={styles.suggestedBadge} title={t('claude_reset.suggested_hint')}>
                  {t('claude_reset.suggested')}
                </span>
              )}
              <span className={styles.expiry} title={display?.absolute}>
                {expiry}
              </span>
            </div>
            <div className={styles.line}>
              <span className={styles.clears}>{t(`claude_reset.clears_${group.kind}`)}</span>
              <button
                type="button"
                className={styles.use}
                disabled={useDisabled || !targetId}
                aria-busy={busy || undefined}
                aria-label={t('claude_reset.use_aria', { kind, expiry })}
                title={targetId ? undefined : t('claude_reset.not_usable_now')}
                onClick={() => targetId && onUse(targetId)}
              >
                {t('claude_reset.use')}
              </button>
            </div>
          </div>
        );
      })}
      {groups.length > 0 && <div className={styles.note}>{t('claude_reset.weekly_day_note')}</div>}
      {hint && (
        <div className={styles.hint}>
          {t(`claude_reset.hint_${hint}`, {
            time: cooldownUntil ? formatInstantShort(Date.parse(cooldownUntil)) : '--',
          })}
        </div>
      )}
    </section>
  );
}
