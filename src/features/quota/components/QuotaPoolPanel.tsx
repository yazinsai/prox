/**
 * One provider's quota pool, leading with the answer: does it last until the
 * reset at the current pace, and if not, when does it run out and for how long.
 * Below that, three facts (left, pace, allowance) and the chart.
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { PoolSummary } from '../pool/poolModel';
import {
  formatDayLabel,
  formatPercent,
  formatPeriod,
  formatRate,
  formatWhen,
} from '../pool/poolFormat';
import { OVER_ALLOWANCE, describeOutlook, paceVersus } from '../pool/poolOutlookCopy';
import { QuotaPoolChart, type ChartPointKind } from './QuotaPoolChart';
import styles from './QuotaPoolPanel.module.scss';

export interface QuotaPoolPanelProps {
  providerLabel: string;
  accent: string;
  accountCount: number;
  summary: PoolSummary;
  burnWindowHours: number;
  span: { startMs: number; endMs: number };
  days: number[];
  now: number;
  showAccounts: boolean;
  showEmails: boolean;
  /** Why recorded history is missing (archiving off, old backend…). */
  historyNote?: string | null;
}

const sharedPeriod = (summary: PoolSummary): number | null => {
  const periods = summary.accounts
    .filter((account) => account.remaining !== null)
    .map((account) => account.periodMs);
  const first = periods[0];
  return first && periods.every((period) => period === first) ? first : null;
};

export function QuotaPoolPanel(props: QuotaPoolPanelProps) {
  const {
    providerLabel,
    accent,
    accountCount,
    summary,
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

  const hasData = summary.total !== null;
  const copy = describeOutlook(summary, now, burnWindowHours, t, locale);
  const pace = summary.burnPerHour;
  const allowance = summary.allowancePerHour;
  const ratio = pace !== null && allowance ? pace / allowance : null;
  const period = sharedPeriod(summary);
  const hasDry = summary.dry.some(
    (spell) => spell.endMs > span.startMs && spell.startMs < span.endMs
  );

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

  const describe = (atMs: number, value: number, kind: ChartPointKind) => ({
    title: formatWhen(atMs, now, locale),
    detail:
      kind === 'dry'
        ? t('quota_management.pool_tooltip_dry')
        : t(
            kind === 'projected'
              ? 'quota_management.pool_tooltip_forecast'
              : 'quota_management.pool_tooltip_used',
            { value: formatPercent(value) }
          ),
  });

  return (
    <section
      className={styles.panel}
      style={{ '--pool-accent': accent } as CSSProperties}
      data-tone={copy.tone}
      aria-label={providerLabel}
    >
      <div className={styles.layout}>
        <header className={styles.head}>
          <span className={styles.swatch} aria-hidden="true" />
          <h2 className={styles.title}>{providerLabel}</h2>
          <span className={styles.count}>
            {t('quota_management.pool_accounts', { count: accountCount })}
          </span>
        </header>

        <div className={styles.verdict}>
          <p className={styles.verdictTitle}>
            <span className={styles.toneDot} aria-hidden="true" />
            {copy.title}
          </p>
          <p className={styles.verdictDetail}>{copy.detail}</p>
          {copy.note && <p className={styles.verdictNote}>{copy.note}</p>}
        </div>

        {hasData && (
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>{t('quota_management.fact_left')}</dt>
              <dd className={styles.factValue}>{formatPercent(summary.total as number)}</dd>
              <dd className={styles.factSub}>
                {t('quota_management.pool_of', { capacity: formatPercent(summary.capacity) })}
              </dd>
            </div>
            <div className={styles.fact}>
              <dt>
                {summary.burnSource === 'window'
                  ? t('quota_management.fact_pace_window')
                  : t('quota_management.fact_pace', { hours: burnWindowHours })}
              </dt>
              <dd
                className={styles.factValue}
                data-over={ratio !== null && ratio > OVER_ALLOWANCE ? 'true' : undefined}
              >
                {pace === null ? '—' : formatRate(pace)}
              </dd>
              <dd className={styles.factSub}>{paceVersus(ratio, t)}</dd>
            </div>
            <div className={styles.fact}>
              <dt>{t('quota_management.fact_allowance')}</dt>
              <dd className={styles.factValue}>
                {allowance === null ? '—' : formatRate(allowance)}
              </dd>
              <dd className={styles.factSub}>
                {period === null
                  ? t('quota_management.fact_allowance_detail')
                  : t('quota_management.fact_allowance_period', {
                      capacity: formatPercent(summary.capacity),
                      period: formatPeriod(period, locale),
                    })}
              </dd>
            </div>
          </dl>
        )}

        {hasData && (
          <div className={styles.chart}>
            <QuotaPoolChart
              span={span}
              days={days}
              now={now}
              yMax={Math.max(100, summary.capacity)}
              accent={accent}
              recorded={summary.recorded}
              projected={summary.projected}
              evenPace={summary.evenPace}
              dry={summary.dry}
              formatAxis={formatPercent}
              formatDay={(ms) => formatDayLabel(ms, locale)}
              describe={describe}
              nowLabel={t('quota_management.pool_now')}
              ariaLabel={t('quota_management.pool_chart_label', {
                provider: providerLabel,
                total: formatPercent(summary.total as number),
                capacity: formatPercent(summary.capacity),
                outlook: `${copy.title}. ${copy.detail}`,
              })}
            />
          </div>
        )}

        {hasData && (
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden="true">
                <line x1="1" x2="15" y1="4" y2="4" className={styles.legendUsed} />
              </svg>
              {t('quota_management.pool_used')}
            </span>
            <span className={styles.legendItem}>
              <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden="true">
                <line x1="0" x2="16" y1="4" y2="4" className={styles.legendForecast} />
              </svg>
              {t('quota_management.pool_forecast')}
            </span>
            {summary.evenPace.length > 1 && (
              <span className={styles.legendItem}>
                <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden="true">
                  <line x1="1" x2="15" y1="4" y2="4" className={styles.legendEven} />
                </svg>
                {t('quota_management.pool_even_pace')}
              </span>
            )}
            {hasDry && (
              <span className={styles.legendItem}>
                <span className={styles.legendDry} aria-hidden="true" />
                {t('quota_management.pool_dry')}
              </span>
            )}
            {historyNote && <span className={styles.legendNote}>{historyNote}</span>}
          </div>
        )}

        {showAccounts && summary.accounts.length > 1 && (
          <ul className={styles.accounts}>
            {summary.accounts.map((account) => (
              <li key={account.key} className={styles.account}>
                {identity(account.label)}
                <span className={styles.accountBar} aria-hidden="true">
                  <span style={{ width: `${account.remaining ?? 0}%` }} />
                </span>
                <span className={styles.accountValue}>
                  {account.remaining === null ? '—' : formatPercent(account.remaining)}
                </span>
                <span className={styles.accountReset}>
                  {account.nextResetMs === null
                    ? ''
                    : t('quota_management.pool_resets', {
                        when: formatWhen(account.nextResetMs, now, locale),
                      })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
