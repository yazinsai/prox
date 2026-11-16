import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconEllipsis, IconGripVertical, IconLock } from '@/components/ui/icons';
import { formatWait } from '@/features/dashboard/format';
import {
  ACCOUNT_TONE,
  type AccountStatus,
  type AccountUsage,
} from '@/features/accounts/accountStatus';
import type { ResolvedTheme } from '@/types';
import type { RouteMember, RoutingMember, RoutingStrategy } from '@/types/routing';
import { memberIcon, memberKindLabel } from '../memberPresentation';
import styles from './MemberCard.module.scss';

/** An account action offered from the card's menu, after the arrangement moves. */
export interface MemberAction {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export interface MemberCardProps {
  member: RoutingMember;
  route: RouteMember | undefined;
  /** Account state without a picked model; the route chip replaces it while one is picked. */
  status?: AccountStatus;
  usage?: AccountUsage | null;
  actions?: readonly MemberAction[];
  onOpen?: (key: string) => void;
  strategy: RoutingStrategy;
  weights: readonly (number | null)[];
  cooldownSeconds: number;
  theme: ResolvedTheme;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
  onDragStart: (key: string) => void;
  onDragEnd: () => void;
  onStep: (key: string, direction: 'up' | 'down') => void;
  onEditWeights: (key: string) => void;
}

export function MemberCard({
  member,
  route,
  status,
  usage,
  actions = [],
  onOpen,
  strategy,
  weights,
  cooldownSeconds,
  theme,
  canMoveUp,
  canMoveDown,
  dragging,
  onDragStart,
  onDragEnd,
  onStep,
  onEditWeights,
}: MemberCardProps) {
  const { t, i18n } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const icon = memberIcon(member, theme);
  const state = route?.state;

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) menuButtonRef.current?.focus();
  };

  const runMenuAction = (action: () => void) => {
    closeMenu(true);
    action();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  const handleHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' && canMoveUp) {
      event.preventDefault();
      onStep(member.key, 'up');
    } else if (event.key === 'ArrowDown' && canMoveDown) {
      event.preventDefault();
      onStep(member.key, 'down');
    }
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (member.locked) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', member.key);
    onDragStart(member.key);
  };

  const kindLabel = memberKindLabel(t, member);
  const usageLabel = usage
    ? t('accounts.usage_requests', {
        count: usage.total,
        formatted: usage.total.toLocaleString(i18n.language),
      })
    : null;
  const failedLabel =
    usage && usage.failed > 0
      ? t('accounts.usage_failed', {
          count: usage.failed,
          formatted: usage.failed.toLocaleString(i18n.language),
        })
      : null;

  // Disabled is configuration, reliable for every member. Cooldown and availability are runtime
  // state CPA exposes only for credentials, so an enabled config API key says it has none. That
  // note lives in the tooltip (and the footnote): repeating it on every card is only noise.
  const showNoRuntimeState = member.kind !== 'credential' && !member.disabled;

  let chip: string | null = null;
  if (state === 'disabled') chip = t('routing.state_disabled');
  else if (state === 'cooling') {
    chip = t('routing.state_cooling', { time: formatWait(t, cooldownSeconds * 1000) });
  } else if (state === 'blocked') chip = t('routing.state_blocked');
  else if (state === 'unknown') chip = t('routing.state_unknown');
  else if (state === 'excluded') chip = t('routing.state_excluded');
  else if (state === 'ineligible') chip = t('routing.state_ineligible');
  else if (state === 'serving') chip = t('routing.state_serving');

  const singleWeight = member.weights.length === 1 ? weights[0] : null;
  const showWeight =
    strategy === 'weighted-round-robin' &&
    singleWeight !== null &&
    singleWeight !== undefined &&
    state !== 'excluded';
  const muted = state === 'disabled' || state === 'ineligible' || status?.kind === 'off';

  const className = [
    styles.card,
    state === 'serving' ? styles.serving : '',
    muted ? styles.muted : '',
    dragging ? styles.dragging : '',
    member.locked ? styles.locked : '',
  ]
    .filter(Boolean)
    .join(' ');

  const tooltip = [
    member.name,
    member.detail,
    showNoRuntimeState ? t('routing.no_runtime_state') : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Without a picked model the card reports the account itself; with one, where the request goes.
  const statusLabel = (() => {
    if (!status) return null;
    switch (status.kind) {
      case 'off':
        return t('routing.state_disabled');
      case 'problem':
        return t('accounts.status_problem');
      case 'cooling':
        return t('accounts.status_cooling', { time: formatWait(t, status.seconds * 1000) });
      case 'partial':
        return t('accounts.status_partial', {
          count: status.models,
          time: formatWait(t, status.seconds * 1000),
        });
      case 'ready':
        return t('accounts.status_ready');
      default:
        return t('accounts.status_on');
    }
  })();
  const statusTitle =
    status?.kind === 'problem' && status.message
      ? status.message
      : (status?.kind === 'cooling' || status?.kind === 'partial') && status.reason
        ? t('accounts.status_reason', { reason: status.reason })
        : undefined;
  const showStatus = statusLabel !== null;
  // Narrow screens keep the countdown and drop the model count.
  const statusShort =
    status?.kind === 'partial'
      ? t('accounts.status_cooling', { time: formatWait(t, status.seconds * 1000) })
      : null;
  const dangerActions = actions.filter((action) => action.danger);

  const bodyContent = (
    <>
      <span className={styles.name}>{member.name}</span>
      <span className={styles.kind}>
        {kindLabel}
        {showWeight ? (
          <span className={styles.weight}>
            {' · '}
            {t('routing.weight_badge', { weight: singleWeight })}
          </span>
        ) : null}
        {usageLabel ? (
          <span className={styles.usage}>
            {' · '}
            {usageLabel}
          </span>
        ) : null}
        {failedLabel ? (
          <span className={styles.failed}>
            {' · '}
            {failedLabel}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <div
      ref={rootRef}
      className={className}
      draggable={!member.locked}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      title={tooltip}
      data-member-key={member.key}
      data-state={state}
    >
      {member.locked ? (
        <span
          className={styles.handle}
          role="img"
          aria-label={t('routing.locked')}
          title={t('routing.locked')}
        >
          <IconLock size={13} />
        </span>
      ) : (
        <button
          type="button"
          className={styles.handle}
          aria-label={t('routing.drag_handle', { name: member.name })}
          onKeyDown={handleHandleKeyDown}
        >
          <IconGripVertical size={14} />
        </button>
      )}

      <span className={styles.icon} aria-hidden="true">
        {icon ? <img src={icon} alt="" /> : <span>{member.name.charAt(0).toUpperCase()}</span>}
      </span>

      {onOpen ? (
        <button
          type="button"
          className={`${styles.body} ${styles.bodyButton}`}
          onClick={() => onOpen(member.key)}
          aria-label={t('accounts.open_account', { name: member.name, kind: kindLabel })}
          draggable={false}
        >
          {bodyContent}
        </button>
      ) : (
        <span className={styles.body}>{bodyContent}</span>
      )}

      {showStatus ? (
        <span
          className={styles.status}
          data-tone={status ? ACCOUNT_TONE[status.kind] : undefined}
          title={statusTitle}
        >
          <i aria-hidden="true" />
          {statusShort ? (
            <>
              <span className={styles.statusLong}>{statusLabel}</span>
              <span className={styles.statusShort} aria-hidden="true">
                {statusShort}
              </span>
            </>
          ) : (
            statusLabel
          )}
        </span>
      ) : chip ? (
        <span
          className={state === 'serving' ? `${styles.chip} ${styles.chipServing}` : styles.chip}
        >
          {chip}
        </span>
      ) : null}

      <span className={styles.menuWrap}>
        <button
          ref={menuButtonRef}
          type="button"
          className={styles.menuButton}
          aria-label={t('routing.member_actions', { name: member.name })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <IconEllipsis size={16} />
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            className={styles.menu}
            onKeyDown={handleMenuKeyDown}
          >
            {actions
              .filter((action) => !action.danger)
              .map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => runMenuAction(action.onSelect)}
                >
                  {action.label}
                </button>
              ))}
            {actions.some((action) => !action.danger) ? (
              <span className={styles.menuSeparator} role="separator" />
            ) : null}
            {member.locked ? <p className={styles.menuNote}>{t('routing.locked')}</p> : null}
            <button
              type="button"
              role="menuitem"
              disabled={member.locked || !canMoveUp}
              onClick={() => runMenuAction(() => onStep(member.key, 'up'))}
            >
              {t('routing.move_up')}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={member.locked || !canMoveDown}
              onClick={() => runMenuAction(() => onStep(member.key, 'down'))}
            >
              {t('routing.move_down')}
            </button>
            {/* Weights only steer weighted round-robin; elsewhere the item is noise. */}
            {member.weights.length > 0 && strategy === 'weighted-round-robin' ? (
              <button
                type="button"
                role="menuitem"
                disabled={member.locked}
                onClick={() => runMenuAction(() => onEditWeights(member.key))}
              >
                {t('routing.edit_weight')}
              </button>
            ) : null}
            {dangerActions.length > 0 ? (
              <span className={styles.menuSeparator} role="separator" />
            ) : null}
            {dangerActions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={styles.menuDanger}
                disabled={action.disabled}
                onClick={() => runMenuAction(action.onSelect)}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </span>
    </div>
  );
}
