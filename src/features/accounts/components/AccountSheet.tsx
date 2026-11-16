import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Sheet } from '@/components/ui/Sheet';
import { formatWait } from '@/features/dashboard/format';
import type { MemberAction } from '@/features/routing/components/MemberCard';
import type { AuthFileItem } from '@/types/authFile';
import type { RoutingMember } from '@/types/routing';
import { ACCOUNT_TONE, type AccountStatus, type AccountUsage } from '../accountStatus';
import styles from './AccountSheet.module.scss';

const MODEL_PREVIEW = 18;

export interface AccountSheetProps {
  open: boolean;
  member: RoutingMember | null;
  file?: AuthFileItem;
  kindLabel: string;
  icon: string | null;
  status: AccountStatus | undefined;
  usage: AccountUsage | null | undefined;
  /** Tier position, 0 = preferred; null while the member is not on the board. */
  tierIndex: number | null;
  tierCount: number;
  /** Callable models, or null while they load. */
  models: string[] | null;
  nowMs: number;
  actions: readonly MemberAction[];
  onClose: () => void;
}

/**
 * One account at a glance: whether it can take requests and why not, what it has done, where it
 * sits in the order and which models it answers. Raw settings sit one step further, behind the
 * edit action, so opening an account never shows tokens.
 */
export function AccountSheet({
  open,
  member,
  file,
  kindLabel,
  icon,
  status,
  usage,
  tierIndex,
  tierCount,
  models,
  nowMs,
  actions,
  onClose,
}: AccountSheetProps) {
  const { t, i18n } = useTranslation();
  if (!member) return null;
  const action = (id: string) => actions.find((item) => item.id === id);
  const run = (item: MemberAction | undefined, closeFirst = false) => {
    if (!item) return;
    if (closeFirst) onClose();
    item.onSelect();
  };

  const cooldown = action('cooldown');
  const signIn = action('signin');
  const toggle = action('toggle');
  const edit = action('edit');
  const remove = action('remove');

  const tone = status ? ACCOUNT_TONE[status.kind] : 'neutral';
  const headline = (() => {
    switch (status?.kind) {
      case 'off':
        return t('accounts.sheet_off');
      case 'problem':
        return t('accounts.sheet_problem');
      case 'cooling':
        return t('accounts.sheet_cooling', { time: formatWait(t, status.seconds * 1000) });
      case 'partial':
        return t('accounts.sheet_partial', {
          count: status.models,
          time: formatWait(t, status.seconds * 1000),
        });
      case 'ready':
        return t('accounts.sheet_ready');
      default:
        return t('accounts.sheet_on');
    }
  })();
  const detail =
    status?.kind === 'problem'
      ? status.message || t('accounts.sheet_problem_hint')
      : status?.kind === 'off'
        ? t('accounts.sheet_off_hint')
        : status?.kind === 'on'
          ? t('accounts.sheet_on_hint')
          : null;

  const snapshot = member.cooldowns;
  const elapsed = snapshot ? Math.max(0, nowMs - snapshot.receivedAtMs) / 1000 : 0;
  const cooling = (snapshot?.records ?? [])
    .map((record) => ({ ...record, left: Math.ceil(record.remainingSeconds - elapsed) }))
    .filter((record) => record.left > 0)
    .sort((a, b) => a.left - b.left);

  const failedShare = usage && usage.total > 0 ? usage.failed / usage.total : 0;
  const tierName =
    tierIndex === null
      ? null
      : tierIndex === 0
        ? t('routing.tier_primary')
        : t('routing.tier_backup', { index: tierIndex });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      eyebrow={kindLabel}
      title={
        <span className={styles.title}>
          {icon ? (
            <span className={styles.icon} aria-hidden="true">
              <img src={icon} alt="" />
            </span>
          ) : null}
          <span className={styles.titleText}>{member.name}</span>
        </span>
      }
      description={member.detail || undefined}
      footer={
        <div className={styles.footer}>
          {remove ? (
            <button
              type="button"
              className={styles.danger}
              disabled={remove.disabled}
              onClick={() => run(remove)}
            >
              {t('accounts.remove')}
            </button>
          ) : (
            <span />
          )}
          <div className={styles.footerEnd}>
            {edit ? (
              <button
                type="button"
                className={styles.secondary}
                disabled={edit.disabled}
                onClick={() => run(edit, true)}
              >
                {member.kind === 'credential'
                  ? t('accounts.sheet_advanced')
                  : t('accounts.sheet_edit_key')}
              </button>
            ) : null}
            <button type="button" className={styles.primary} onClick={onClose}>
              {t('accounts.done')}
            </button>
          </div>
        </div>
      }
    >
      <div className={styles.body}>
        <section className={styles.status} data-tone={tone} aria-live="polite">
          <div className={styles.statusHead}>
            <i aria-hidden="true" />
            <div className={styles.statusText}>
              <strong>{headline}</strong>
              {detail ? <span>{detail}</span> : null}
            </div>
          </div>
          {cooling.length > 0 ? (
            <ul className={styles.cooldowns}>
              {cooling.map((record, index) => (
                <li key={`${record.scope}:${record.modelKey ?? ''}:${index}`}>
                  <span className={styles.cooldownModel}>
                    {record.scope === 'credential'
                      ? t('accounts.sheet_whole_account')
                      : record.modelKey || t('accounts.sheet_unknown_model')}
                  </span>
                  <span className={styles.cooldownReason}>{record.reason}</span>
                  <span className={styles.cooldownTime}>
                    {t('accounts.sheet_back_in', { time: formatWait(t, record.left * 1000) })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {cooldown || signIn || toggle ? (
            <div className={styles.statusActions}>
              {cooldown ? (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={cooldown.disabled}
                  onClick={() => run(cooldown)}
                >
                  {cooldown.label}
                </button>
              ) : null}
              {signIn ? (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={signIn.disabled}
                  onClick={() => run(signIn, true)}
                >
                  {signIn.label}
                </button>
              ) : null}
              {toggle ? (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={toggle.disabled}
                  onClick={() => run(toggle)}
                >
                  {toggle.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        <dl className={styles.facts}>
          {member.kind === 'credential' ? (
            <>
              <div>
                <dt>{t('accounts.sheet_requests')}</dt>
                <dd>{usage ? usage.total.toLocaleString(i18n.language) : '0'}</dd>
              </div>
              <div>
                <dt>{t('accounts.sheet_failed')}</dt>
                <dd data-bad={usage ? usage.failed > 0 : undefined}>
                  {usage ? usage.failed.toLocaleString(i18n.language) : '0'}
                  {usage && usage.failed > 0 ? (
                    <small>
                      {t('accounts.sheet_failed_share', {
                        share: (failedShare * 100).toLocaleString(i18n.language, {
                          maximumFractionDigits: failedShare < 0.1 ? 1 : 0,
                        }),
                      })}
                    </small>
                  ) : null}
                </dd>
              </div>
            </>
          ) : (
            <>
              {/* The proxy keeps no per-key counters, so keys show their shape instead. */}
              <div>
                <dt>{t('accounts.sheet_keys')}</dt>
                <dd>{member.keyCount.toLocaleString(i18n.language)}</dd>
              </div>
              <div>
                <dt>{t('accounts.sheet_models_count')}</dt>
                <dd>{models ? models.length.toLocaleString(i18n.language) : '—'}</dd>
              </div>
            </>
          )}
          <div>
            <dt>{t('accounts.sheet_order')}</dt>
            <dd>
              {tierName ?? '—'}
              {tierIndex !== null ? (
                <small>
                  {t('accounts.sheet_order_of', { position: tierIndex + 1, count: tierCount })}
                </small>
              ) : null}
            </dd>
          </div>
        </dl>

        <section className={styles.models}>
          <h3>
            {t('accounts.sheet_models')}
            {models ? <span>{models.length}</span> : null}
          </h3>
          {models === null ? (
            <p className={styles.muted}>{t('accounts.sheet_models_loading')}</p>
          ) : models.length === 0 ? (
            <p className={styles.muted}>{t('accounts.sheet_models_none')}</p>
          ) : (
            <ul className={styles.modelList}>
              {models.slice(0, MODEL_PREVIEW).map((model) => (
                <li key={model}>{model}</li>
              ))}
              {models.length > MODEL_PREVIEW ? (
                <li className={styles.more}>
                  {t('accounts.sheet_models_more', { count: models.length - MODEL_PREVIEW })}
                </li>
              ) : null}
            </ul>
          )}
        </section>

        {member.kind === 'credential' && file ? (
          <p className={styles.quotaLink}>
            <Link to="/quota" onClick={onClose}>
              {t('accounts.sheet_quota')}
            </Link>
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
