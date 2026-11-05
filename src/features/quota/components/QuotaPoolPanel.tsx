/**
 * One provider's quota pool: headline remaining, the four numbers that decide
 * what to do next (pool empty, first account empty, next reset, burn), and the
 * recorded + projected chart.
 */

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { drainSeries, niceCeiling } from '../pool/poolModel';
import type { PoolMode, PoolSummary } from '../pool/poolModel';
import {
  formatDate,
  formatDayLabel,
  formatDuration,
  formatPercent,
  formatRate,
  formatWhen,
} from '../pool/poolFormat';
import { QuotaPoolChart } from './QuotaPoolChart';
import styles from './QuotaPoolPanel.module.scss';

export interface QuotaPoolPanelProps {
  providerLabel: string;
  accent: string;
  accountCount: number;
  summary: PoolSummary;
  mode: PoolMode;
  burnWindowHours: number;
  span: { startMs: number; endMs: number };
  days: number[];
  now: number;
  showAccounts: boolean;
  showEmails: boolean;
  /** Note shown beside the legend (history unavailable, archiving off…). */
  historyNote?: string | null;
}

export function QuotaPoolPanel(props: QuotaPoolPanelProps) {
  const {
    providerLabel,
    accent,
    accountCount,
    summary,
    mode,
    burnWindowHours,
    span,
    days,
    now,
    showAccounts,
    showEmails,
    historyNote,
  } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const isDrain = mode === 'drain';

  const drain = useMemo(
    () => (isDrain ? drainSeries(summary.recorded, summary.projected) : null),
    [isDrain, summary.recorded, summary.projected]
  );
  const recorded = drain ? drain.recorded : summary.recorded;
  const projected = drain ? drain.projected : summary.projected;
  const yMax = drain
    ? niceCeiling(Math.max(0, ...recorded.map((p) => p.value), ...projected.map((p) => p.value)))
    : Math.max(100, summary.capacity);

  const hasData = summary.total !== null;
  const identity = (label: string) =>
    showEmails ? (
      <span className={styles.identity} title={label}>
        {label}
      </span>
    ) : (
      <span
        className={styles.redacted}
        role="img"
        aria-label={t('quota_management.pool_email_hidden')}
      />
    );

  const poolEmptyValue =
    summary.poolEmptyAtMs === null
      ? t('quota_management.pool_empty_never', { date: formatDate(span.endMs - 1, locale) })
      : summary.poolEmptyAtMs <= now
        ? t('quota_management.pool_empty_now')
        : formatWhen(summary.poolEmptyAtMs, now, locale);

  const stats = hasData
    ? [
        { key: 'pool', label: t('quota_management.pool_empty_label'), value: poolEmptyValue },
        {
          key: 'first',
          label: t('quota_management.pool_first_empty'),
          value: summary.firstEmpty ? (
            <>
              {identity(summary.firstEmpty.account.label)}
              {summary.firstEmpty.atMs <= now
                ? t('quota_management.pool_empty_now')
                : t('quota_management.pool_in', {
                    duration: formatDuration(summary.firstEmpty.atMs - now, locale),
                  })}
            </>
          ) : (
            t('quota_management.pool_none')
          ),
        },
        {
          key: 'reset',
          label: t('quota_management.pool_next_reset'),
          value: summary.nextReset
            ? `+${formatPercent(summary.nextReset.added)} ${formatWhen(summary.nextReset.atMs, now, locale)}`
            : t('quota_management.pool_none'),
        },
        {
          key: 'burn',
          label: t('quota_management.pool_burn', { hours: burnWindowHours }),
          value: summary.burnPerHour === null ? '—' : formatRate(summary.burnPerHour),
        },
      ]
    : [];

  const describe = (atMs: number, value: number, isProjected: boolean) => {
    const kind = t(
      isProjected ? 'quota_management.pool_kind_projected' : 'quota_management.pool_kind_recorded'
    );
    const when = formatWhen(atMs, now, locale);
    return isDrain
      ? t('quota_management.pool_tooltip_rate', { when, value: formatRate(value), kind })
      : t('quota_management.pool_tooltip_left', { when, value: formatPercent(value), kind });
  };

  return (
    <section className={styles.panel} style={{ '--pool-accent': accent } as CSSProperties}>
      <div className={styles.top}>
        <div className={styles.titleRow}>
          <span className={styles.swatch} aria-hidden="true" />
          <h2 className={styles.title}>{providerLabel}</h2>
          <span className={styles.count}>
            {t('quota_management.pool_accounts', { count: accountCount })}
          </span>
        </div>

        <div className={styles.figures}>
          <div className={styles.headline}>
            <span className={hasData ? styles.total : `${styles.total} ${styles.totalEmpty}`}>
              {hasData ? formatPercent(summary.total as number) : '—'}
            </span>
            <span className={styles.capacity}>
              {hasData
                ? t('quota_management.pool_of', { capacity: formatPercent(summary.capacity) })
                : t('quota_management.pool_not_loaded')}
            </span>
          </div>
          {stats.map((stat) => (
            <div key={stat.key} className={styles.stat}>
              <span className={styles.statLabel}>{stat.label}</span>
              <span className={styles.statValue}>{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      {hasData && (
        <QuotaPoolChart
          span={span}
          days={days}
          now={now}
          yMax={yMax}
          accent={accent}
          recorded={recorded}
          projected={projected}
          jumps={isDrain ? [] : [...summary.recordedJumps, ...summary.projectedJumps]}
          accountLines={showAccounts && !isDrain ? summary.accountLines : []}
          emptyMarker={
            !isDrain && summary.poolEmptyAtMs !== null && summary.poolEmptyAtMs > now
              ? {
                  atMs: summary.poolEmptyAtMs,
                  label: t('quota_management.pool_empty_marker', {
                    when: formatWhen(summary.poolEmptyAtMs, now, locale),
                  }),
                }
              : null
          }
          formatAxis={isDrain ? formatRate : formatPercent}
          formatDay={(ms) => formatDayLabel(ms, locale)}
          describe={describe}
          nowLabel={t('quota_management.pool_now')}
          ariaLabel={t('quota_management.pool_chart_label', {
            provider: providerLabel,
            total: formatPercent(summary.total as number),
            capacity: formatPercent(summary.capacity),
          })}
        />
      )}

      {hasData && (
        <div className={styles.legend}>
          <span className={styles.legendTitle}>{t('quota_management.pool_legend')}</span>
          <span className={styles.legendItem}>
            <span className={styles.legendSolid} aria-hidden="true" />
            {t('quota_management.pool_recorded')}
          </span>
          <span className={styles.legendItem}>
            <svg width="18" height="2" viewBox="0 0 18 2" aria-hidden="true">
              <line x1="0" x2="18" y1="1" y2="1" className={styles.legendDash} />
            </svg>
            {t('quota_management.pool_projected')}
          </span>
          {historyNote && <span className={styles.legendNote}>{historyNote}</span>}
        </div>
      )}

      {showAccounts && summary.accounts.length > 0 && (
        <ul className={styles.accounts}>
          {summary.accounts.map((account) => (
            <li key={account.key} className={styles.account}>
              {identity(account.label)}
              <span className={styles.accountValue}>
                {account.remaining === null ? '—' : formatPercent(account.remaining)}
              </span>
              {account.nextResetMs !== null && (
                <span className={styles.accountReset}>
                  {t('quota_management.pool_resets', {
                    when: formatWhen(account.nextResetMs, now, locale),
                  })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
