import { useTranslation } from 'react-i18next';
import type { DashboardLoadState, DashboardSummary } from '@/services/api/dashboard';
import { cooldownReasonKey } from '@/features/authFiles/cooldowns';
import { MINUTE_MS } from '@/utils/time/durations';
import {
  PACE_MINUTES,
  PULSE_MINUTES,
  type ActivitySnapshot,
  type ProviderStatus,
} from '../insights';
import { formatPercent, formatRate } from '../format';
import { Ago, Countdown } from './LiveTime';
import styles from '../dashboard.module.scss';

interface Props {
  activity: ActivitySnapshot | null;
  /** Observation instant of the activity feed. */
  observedAt: string | null;
  hour: DashboardSummary | null;
  trafficState: DashboardLoadState;
  trafficReceivedAt: number | null;
  providers: ProviderStatus[] | null;
  runtimeKnown: boolean;
  routesObservedAt: string | null;
  routesReceivedAt: number | null;
  onShowFailures: () => void;
}

export function NowCard(props: Props) {
  const { t, i18n } = useTranslation();
  const { activity, hour } = props;
  const lang = i18n.language;
  const level = activity?.level ?? null;
  const successRate = hour && hour.total > 0 ? (hour.success / hour.total) * 100 : null;

  return (
    <section className={`${styles.card} ${styles.now}`} aria-labelledby="dashboard-now-title">
      <h2 id="dashboard-now-title" className={styles.srOnly}>
        {t('dashboard_live.now_title')}
      </h2>
      <div className={styles.nowMain}>
        <div className={styles.nowCopy} aria-live="polite">
          <p className={styles.verdict} data-level={level ?? 'unknown'}>
            <i className={styles.liveDot} aria-hidden="true" />
            {level
              ? t(`dashboard_live.level_${level}`)
              : t(`dashboard_live.state_${props.trafficState}`)}
          </p>
          <p
            className={styles.pace}
            title={t('dashboard_live.pace_hint', { minutes: PACE_MINUTES })}
          >
            <strong>
              {activity
                ? formatRate(activity.pacePerMinute, lang) + (activity.paceIsLowerBound ? '+' : '')
                : '—'}
            </strong>
            <span>{t('dashboard_live.per_minute')}</span>
          </p>
          <p className={styles.nowMeta}>
            {activity && activity.level !== 'idle' && activity.concurrency !== null ? (
              <span title={t('dashboard_live.concurrency_hint', { minutes: PACE_MINUTES })}>
                {t('dashboard_live.concurrency', {
                  value: formatRate(Math.max(activity.concurrency, 0.1), lang),
                })}
              </span>
            ) : activity?.level === 'idle' ? (
              <span>{t('dashboard_live.no_recent', { minutes: PACE_MINUTES })}</span>
            ) : null}
            {activity?.lastCompletedAgoMs != null ? (
              <span>
                <Ago
                  ageMs={activity.lastCompletedAgoMs}
                  receivedAt={props.trafficReceivedAt}
                  template="dashboard_live.last_request"
                />
              </span>
            ) : null}
          </p>
        </div>
        <Pulse activity={activity} observedAt={props.observedAt} />
      </div>

      <dl className={styles.nowStats}>
        <div>
          <dt>{t('dashboard_live.window_hour')}</dt>
          <dd>{hour ? hour.total.toLocaleString(lang) : '—'}</dd>
        </div>
        <div>
          <dt>{t('dashboard.success_rate')}</dt>
          <dd>{successRate === null ? '—' : `${formatPercent(successRate, lang)}%`}</dd>
        </div>
        <div>
          <dt>{t('dashboard_live.failed')}</dt>
          <dd>
            {hour && hour.failed > 0 ? (
              <button type="button" className={styles.failedLink} onClick={props.onShowFailures}>
                {hour.failed.toLocaleString(lang)}
                <span aria-hidden="true">↗</span>
                <span className={styles.srOnly}>{t('dashboard_live.show_failures')}</span>
              </button>
            ) : hour ? (
              '0'
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div title={t('dashboard_live.usual_hint')}>
          <dt>{t('dashboard_live.usual')}</dt>
          <dd>
            {activity?.baselinePerMinute != null
              ? `${formatRate(activity.baselinePerMinute, lang)}/min`
              : '—'}
          </dd>
        </div>
      </dl>

      <ThrottleVerdict {...props} />
    </section>
  );
}

function Pulse({
  activity,
  observedAt,
}: {
  activity: ActivitySnapshot | null;
  observedAt: string | null;
}) {
  const { t, i18n } = useTranslation();
  const bins = activity?.bins ?? [];
  const observed = observedAt ? Date.parse(observedAt) : null;
  const total = bins.reduce((sum, bin) => sum + bin.success + bin.failed, 0);
  const minuteLabel = (index: number) =>
    observed === null
      ? ''
      : new Date(observed - (PULSE_MINUTES - 1 - index) * MINUTE_MS).toLocaleTimeString(
          i18n.language,
          { hour: '2-digit', minute: '2-digit' }
        );

  return (
    <figure className={styles.pulse}>
      <div
        className={styles.bars}
        role="img"
        aria-label={t('dashboard_live.pulse_label', { minutes: PULSE_MINUTES, total })}
      >
        {(bins.length ? bins : Array.from({ length: PULSE_MINUTES }, () => null)).map(
          (bin, index) => {
            const count = bin ? bin.success + bin.failed : 0;
            const height = bin && activity ? (count / activity.peak) * 100 : 0;
            return (
              <span
                key={index}
                className={styles.bar}
                data-known={bin ? bin.known : false}
                data-empty={count === 0}
                title={
                  bin?.known
                    ? `${minuteLabel(index)} · ${t('dashboard_live.pulse_bin', { total: bin.success + bin.failed, failed: bin.failed })}`
                    : t('dashboard_live.pulse_partial')
                }
              >
                <span className={styles.barFill} style={{ height: `${height}%` }}>
                  {bin && bin.failed > 0 ? (
                    <span
                      className={styles.barFailed}
                      style={{ height: `${(bin.failed / count) * 100}%` }}
                    />
                  ) : null}
                </span>
              </span>
            );
          }
        )}
      </div>
      <figcaption className={styles.pulseAxis} aria-hidden="true">
        <span>{t('dashboard_live.pulse_start', { minutes: PULSE_MINUTES })}</span>
        <span>{t('dashboard_live.pulse_end')}</span>
      </figcaption>
    </figure>
  );
}

function ThrottleVerdict({ providers, runtimeKnown, routesObservedAt, routesReceivedAt }: Props) {
  const { t } = useTranslation();
  if (!providers) return null;
  const cooling = providers.filter((provider) => provider.state === 'cooling');
  const lead = cooling[0];
  const stranded = cooling.flatMap((provider) =>
    provider.cooling.filter((model) => !model.servedBy && model.requests > 0)
  );

  if (!runtimeKnown) {
    return (
      <div className={styles.throttle} data-tone="unknown" role="status">
        <i className={styles.statusDot} aria-hidden="true" />
        <div>
          <p className={styles.throttleTitle}>{t('dashboard_live.throttle_unknown')}</p>
          <p className={styles.throttleDetail}>{t('dashboard_live.default_policy')}</p>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className={styles.throttle} data-tone="clear" role="status">
        <i className={styles.statusDot} aria-hidden="true" />
        <div>
          <p className={styles.throttleTitle}>{t('dashboard_live.throttle_clear')}</p>
          <p className={styles.throttleDetail}>{t('dashboard_live.throttle_clear_detail')}</p>
        </div>
      </div>
    );
  }

  const used = lead.cooling.filter((model) => model.requests > 0);
  const example = used[0] ?? lead.cooling[0];
  return (
    <a
      href="#dashboard-providers"
      className={styles.throttle}
      data-tone={stranded.length ? 'critical' : 'warning'}
      onClick={(event) => {
        event.preventDefault();
        document
          .getElementById('dashboard-providers')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
    >
      <i className={styles.statusDot} aria-hidden="true" />
      <div>
        <p className={styles.throttleTitle}>
          {t('dashboard_live.throttled', {
            names: cooling.map((provider) => provider.label).join(', '),
          })}
        </p>
        <p className={styles.throttleDetail}>
          {[
            lead.reason ? t(cooldownReasonKey(lead.reason)) : null,
            example
              ? example.servedBy
                ? t('dashboard_live.covered', { model: example.label, provider: example.servedBy })
                : t('dashboard_live.stranded', { model: example.label })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {lead.retryAt ? (
        <span className={styles.throttleWait}>
          <Countdown
            retryAt={lead.retryAt}
            observedAt={routesObservedAt}
            receivedAt={routesReceivedAt}
          />
        </span>
      ) : null}
    </a>
  );
}
