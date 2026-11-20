/**
 * Quota page navigation: provider tabs with brand swatches, then one quiet row
 * holding the forecast assumptions (behind a single button) and the date range.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconChevronDown,
  IconChevronLeft,
  IconFilterAll,
  IconSlidersHorizontal,
} from '@/components/ui/icons';
import { getTypeLabel } from '@/features/authFiles/constants';
import { scrollProviderTabs } from '@/features/authFiles/components/providerTabsWheel';
import {
  BURN_WINDOW_HOURS,
  FUTURE_USAGE_OPTIONS,
  type BurnWindowHours,
  type FutureUsage,
} from '../pool/poolModel';
import { POOL_ACCENTS } from '../pool/poolFormat';
import type { QuotaProviderType } from '../providers/types';
import styles from './QuotaControls.module.scss';

export interface QuotaProviderTabsProps {
  types: string[];
  counts: Record<string, number>;
  /** Overrides for the generic provider label, keyed by tab type. */
  labels?: Record<string, string>;
  active: string;
  onChange: (type: string) => void;
}

export function QuotaProviderTabs({
  types,
  counts,
  labels,
  active,
  onChange,
}: QuotaProviderTabsProps) {
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
        const label =
          type === 'all' ? t('auth_files.filter_all') : (labels?.[type] ?? getTypeLabel(t, type));
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
  labelledBy: string;
  onChange: (value: T) => void;
}

function Segmented<T extends string | number>(props: SegmentedProps<T>) {
  const { value, options, label, labelledBy, onChange } = props;
  return (
    <div className={styles.segmented} role="group" aria-labelledby={labelledBy}>
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

interface ForecastMenuProps {
  burnWindowHours: BurnWindowHours;
  futureUsage: FutureUsage;
  onBurnWindowChange: (hours: BurnWindowHours) => void;
  onFutureUsageChange: (usage: FutureUsage) => void;
}

/** The forecast's two assumptions, summarized on one button and set in a small popover. */
function ForecastMenu(props: ForecastMenuProps) {
  const { burnWindowHours, futureUsage, onBurnWindowChange, onFutureUsageChange } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const paceLabelId = `${id}-pace`;
  const usageLabelId = `${id}-usage`;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const summary =
    futureUsage === 'same'
      ? t('quota_management.forecast_summary', { hours: burnWindowHours })
      : t('quota_management.forecast_summary_scaled', {
          hours: burnWindowHours,
          usage: t(`quota_management.future_${futureUsage}`),
        });

  return (
    <div
      ref={rootRef}
      className={styles.forecast}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          close(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.forecastTrigger}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
      >
        <IconSlidersHorizontal size={15} aria-hidden="true" />
        <span className={styles.forecastSummary}>{summary}</span>
        <IconChevronDown size={14} className={styles.chevron} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={panelRef}
          id={`${id}-panel`}
          className={styles.forecastPanel}
          role="group"
          aria-label={t('quota_management.forecast_label')}
        >
          <div className={styles.forecastField}>
            <span id={paceLabelId} className={styles.forecastFieldLabel}>
              {t('quota_management.burn_rate')}
            </span>
            <Segmented
              value={burnWindowHours}
              options={BURN_WINDOW_HOURS}
              label={(hours) => t('quota_management.burn_hours', { hours })}
              labelledBy={paceLabelId}
              onChange={onBurnWindowChange}
            />
          </div>
          <div className={styles.forecastField}>
            <span id={usageLabelId} className={styles.forecastFieldLabel}>
              {t('quota_management.future_usage')}
            </span>
            <Segmented
              value={futureUsage}
              options={FUTURE_USAGE_OPTIONS}
              label={(usage) => t(`quota_management.future_${usage}_short`)}
              labelledBy={usageLabelId}
              onChange={onFutureUsageChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export interface QuotaControlsProps extends ForecastMenuProps {
  rangeLabel: string;
  isCurrentRange: boolean;
  onPrevRange: () => void;
  onNextRange: () => void;
  onToday: () => void;
}

export function QuotaControls(props: QuotaControlsProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.controls}>
      <ForecastMenu
        burnWindowHours={props.burnWindowHours}
        futureUsage={props.futureUsage}
        onBurnWindowChange={props.onBurnWindowChange}
        onFutureUsageChange={props.onFutureUsageChange}
      />

      <div className={styles.range}>
        {!props.isCurrentRange && (
          <button type="button" className={styles.todayButton} onClick={props.onToday}>
            {t('quota_management.windows_today')}
          </button>
        )}
        <button
          type="button"
          className={styles.iconButton}
          onClick={props.onPrevRange}
          aria-label={t('quota_management.range_prev')}
          title={t('quota_management.range_prev')}
        >
          <IconChevronLeft size={16} aria-hidden="true" />
        </button>
        <span className={styles.rangeLabel}>{props.rangeLabel}</span>
        <button
          type="button"
          className={styles.iconButton}
          onClick={props.onNextRange}
          aria-label={t('quota_management.range_next')}
          title={t('quota_management.range_next')}
        >
          <IconChevronLeft size={16} className={styles.flip} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
