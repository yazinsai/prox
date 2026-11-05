import { Fragment, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import type { RoutingDraft, RoutingDropTarget, RoutingMember } from '@/types/routing';
import { activeCooldownSeconds, canStepMember, tierIndexOf } from '../logic';
import { useDragAutoScroll } from '../useDragAutoScroll';
import { MemberCard } from './MemberCard';
import styles from '../RoutingPage.module.scss';

export interface TierLadderProps {
  members: ReadonlyMap<string, RoutingMember>;
  draft: RoutingDraft;
  priorities: Readonly<Record<string, number>>;
  model: string | null;
  nowMs: number;
  theme: ResolvedTheme;
  entryControl: ReactNode;
  onMove: (key: string, target: RoutingDropTarget) => void;
  onStep: (key: string, direction: 'up' | 'down') => void;
  onEditWeights: (key: string) => void;
}

const sameTarget = (left: RoutingDropTarget | null, right: RoutingDropTarget) =>
  left !== null &&
  left.kind === right.kind &&
  (left.kind === 'tier'
    ? left.tierId === (right as { tierId: string }).tierId
    : left.index === (right as { index: number }).index);

export function TierLadder({
  members,
  draft,
  priorities,
  model,
  nowMs,
  theme,
  entryControl,
  onMove,
  onStep,
  onEditWeights,
}: TierLadderProps) {
  const { t } = useTranslation();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [hover, setHover] = useState<RoutingDropTarget | null>(null);
  const ladderRef = useRef<HTMLOListElement>(null);
  useDragAutoScroll(dragKey !== null, ladderRef);
  const tiers = draft.tiers;

  const isValidTarget = (target: RoutingDropTarget): boolean => {
    if (!dragKey) return false;
    const from = tierIndexOf(tiers, dragKey);
    if (from < 0) return false;
    if (target.kind === 'tier') return tiers[from].id !== target.tierId;
    const alone = tiers[from].memberKeys.length === 1;
    return !(alone && (target.index === from || target.index === from + 1));
  };

  const dropHandlers = (target: RoutingDropTarget) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!isValidTarget(target)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!sameTarget(hover, target)) setHover(target);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      if (sameTarget(hover, target)) setHover(null);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (dragKey && isValidTarget(target)) onMove(dragKey, target);
      setDragKey(null);
      setHover(null);
    },
  });

  const endDrag = () => {
    setDragKey(null);
    setHover(null);
  };

  const renderGap = (index: number) => {
    const target: RoutingDropTarget = { kind: 'gap', index };
    const valid = isValidTarget(target);
    const hovered = sameTarget(hover, target);
    const between = index > 0;
    const className = [
      styles.gap,
      dragKey && valid ? styles.gapOpen : '',
      hovered ? styles.gapHover : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <li className={className} {...dropHandlers(target)} aria-hidden={!between || undefined}>
        <span className={styles.rail} aria-hidden="true" />
        {dragKey && valid ? (
          <span className={styles.gapDrop}>{t('routing.drop_new_tier')}</span>
        ) : between ? (
          // The rail already draws the fall-through; the sentence is for assistive tech only.
          <span className={styles.srOnly}>{t('routing.connector')}</span>
        ) : null}
      </li>
    );
  };

  return (
    <ol ref={ladderRef} className={styles.ladder}>
      <li className={styles.entry}>
        <span className={styles.entryLabel}>{t('routing.configuration_title')}</span>
        <div className={styles.entryControl}>{entryControl}</div>
      </li>
      {tiers.map((tier, index) => {
        const target: RoutingDropTarget = { kind: 'tier', tierId: tier.id };
        const tierMembers = tier.memberKeys.flatMap((key) => members.get(key) ?? []);
        const priority = priorities[tier.memberKeys[0]] ?? 0;
        const originals = new Set(tierMembers.map((member) => member.priority));
        const original = originals.size === 1 ? [...originals][0] : null;
        const changed = tierMembers.some((member) => priorities[member.key] !== member.priority);
        const className = [styles.tier, sameTarget(hover, target) ? styles.tierHover : '']
          .filter(Boolean)
          .join(' ');
        const label = index === 0 ? t('routing.tier_primary') : t('routing.tier_backup', { index });
        return (
          <Fragment key={tier.id}>
            {renderGap(index)}
            <li className={className} {...dropHandlers(target)} aria-label={label}>
              <div className={styles.tierHead}>
                <span className={styles.tierIndex} aria-hidden="true">
                  {index + 1}
                </span>
                <span className={styles.tierName}>{label}</span>
                <span className={changed ? styles.tierPriorityChanged : styles.tierPriority}>
                  {changed && original !== null
                    ? t('routing.tier_priority_changed', { from: original, to: priority })
                    : t('routing.tier_priority', { priority })}
                </span>
              </div>
              <div className={styles.tierMembers}>
                {tierMembers.map((member) => (
                  <MemberCard
                    key={member.key}
                    member={member}
                    route={
                      member.disabled
                        ? { key: member.key, state: 'disabled', share: null }
                        : activeCooldownSeconds(member, model, nowMs) > 0
                          ? { key: member.key, state: 'cooling', share: null }
                          : undefined
                    }
                    strategy={draft.settings.strategy}
                    weights={draft.weights[member.key] ?? []}
                    cooldownSeconds={activeCooldownSeconds(member, model, nowMs)}
                    theme={theme}
                    canMoveUp={!member.locked && canStepMember(tiers, member.key, 'up')}
                    canMoveDown={!member.locked && canStepMember(tiers, member.key, 'down')}
                    dragging={dragKey === member.key}
                    onDragStart={setDragKey}
                    onDragEnd={endDrag}
                    onStep={onStep}
                    onEditWeights={onEditWeights}
                  />
                ))}
              </div>
            </li>
          </Fragment>
        );
      })}
      {renderGap(tiers.length)}
    </ol>
  );
}
