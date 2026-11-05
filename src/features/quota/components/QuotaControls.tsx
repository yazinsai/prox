/**
 * Quota page navigation: provider tabs with brand swatches, then the chart
 * controls (mode, burn window, future usage, accounts overlay) and the date
 * range navigator.
 */

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconFilterAll } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { getTypeLabel } from '@/features/authFiles/constants';
import { scrollProviderTabs } from '@/features/authFiles/components/providerTabsWheel';
import {
  BURN_WINDOW_HOURS,
  FUTURE_USAGE_OPTIONS,
  POOL_MODES,
  type BurnWindowHours,
  type FutureUsage,
  type PoolMode,
} from '../pool/poolModel';
import { POOL_ACCENTS } from '../pool/poolFormat';
import type { QuotaProviderType } from '../providers/types';
import styles from './QuotaControls.module.scss';

export interface QuotaProviderTabsProps {
  types: string[];
  counts: Record<string, number>;
  active: string;
  onChange: (type: string) => void;
}

export function QuotaProviderTabs({ types, counts, active, onChange }: QuotaProviderTabsProps) {
  const { t } = useTranslation();
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => scrollProviderTabs(strip, event);
    // React delegates wheel events passively; a local listener can prevent page scrolling.
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => strip.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={tabsRef}
      className={styles.tabs}
      role="group"
      aria-label={t('quota_management.providers_label')}
    >
      {types.map((type) => {
        const isActive = active === type;
        const label = type === 'all' ? t('auth_files.filter_all') : getTypeLabel(t, type);
        return (
          <button
            key={type}
            type="button"
            className={styles.tab}
            aria-pressed={isActive}
            onClick={() => onChange(type)}
          >
            {type === 'all' ? (
              <IconFilterAll size={15} aria-hidden="true" />
            ) : (
              <span
                className={styles.tabSwatch}
                style={
                  {
                    '--swatch': POOL_ACCENTS[type as QuotaProviderType] ?? 'var(--text-primary)',
                  } as CSSProperties
                }
                aria-hidden="true"
              />
            )}
            <span className={styles.tabLabel}>{label}</span>
            <span className={styles.tabCount}>{counts[type] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedProps<T extends string | number> {
  value: T;
  options: readonly T[];
  label: (value: T) => string;
  ariaLabel: string;
  onChange: (value: T) => void;
}

function Segmented<T extends string | number>(props: SegmentedProps<T>) {
  const { value, options, label, ariaLabel, onChange } = props;
  return (
    <div className={styles.segmented} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={styles.segment}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}

export interface QuotaControlsProps {
  mode: PoolMode;
  burnWindowHours: BurnWindowHours;
  futureUsage: FutureUsage;
  showAccounts: boolean;
  rangeLabel: string;
  isCurrentRange: boolean;
  onModeChange: (mode: PoolMode) => void;
  onBurnWindowChange: (hours: BurnWindowHours) => void;
  onFutureUsageChange: (usage: FutureUsage) => void;
  onToggleAccounts: () => void;
  onPrevRange: () => void;
  onNextRange: () => void;
  onToday: () => void;
}

export function QuotaControls(props: QuotaControlsProps) {
  const { t } = useTranslation();
  const futureLabelId = 'quota-future-label';

  return (
    <div className={styles.controls}>
      <Segmented
        value={props.mode}
        options={POOL_MODES}
        label={(mode) => t(`quota_management.mode_${mode}`)}
        ariaLabel={t('quota_management.mode_label')}
        onChange={props.onModeChange}
      />

      <div className={styles.field}>
        <span className={styles.fieldLabel} aria-hidden="true">
          {t('quota_management.burn_rate')}
        </span>
        <Segmented
          value={props.burnWindowHours}
          options={BURN_WINDOW_HOURS}
          label={(hours) => t('quota_management.burn_hours', { hours })}
          ariaLabel={t('quota_management.burn_rate')}
          onChange={props.onBurnWindowChange}
        />
      </div>

      <div className={styles.field}>
        <span id={futureLabelId} className={styles.fieldLabel}>
          {t('quota_management.future_usage')}
        </span>
        <div className={styles.select}>
          <Select
            value={props.futureUsage}
            options={FUTURE_USAGE_OPTIONS.map((usage) => ({
              value: usage,
              label: t(`quota_management.future_${usage}`),
            }))}
            onChange={(value) => props.onFutureUsageChange(value as FutureUsage)}
            ariaLabelledBy={futureLabelId}
            size="sm"
          />
        </div>
      </div>

      <button
        type="button"
        className={styles.toggle}
        aria-pressed={props.showAccounts}
        onClick={props.onToggleAccounts}
      >
        {t('quota_management.accounts')}
      </button>

      <div className={styles.range}>
        <span className={styles.rangeLabel}>{props.rangeLabel}</span>
        <div className={styles.rangeNav}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={props.onPrevRange}
            aria-label={t('quota_management.range_prev')}
          >
            <IconChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.todayButton}
            onClick={props.onToday}
            disabled={props.isCurrentRange}
          >
            {t('quota_management.windows_today')}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={props.onNextRange}
            aria-label={t('quota_management.range_next')}
          >
            <IconChevronLeft size={16} className={styles.flip} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
