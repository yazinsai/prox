import { useTranslation } from 'react-i18next';
import type { ProviderRoute } from '../insights';
import { Countdown } from './LiveTime';
import styles from '../dashboard.module.scss';

const CHIP_STATE = {
  ready: 'serving',
  standby: 'fallback',
  cooling: 'cooling',
  unknown: 'unknown',
  unavailable: 'unavailable',
} as const;

interface Props {
  routes: ProviderRoute[];
  observedAt: string | null;
  receivedAt: number | null;
}

/** Who answers this model: serving first, then fallbacks, then anything cooling down. */
export function RouteChips({ routes, observedAt, receivedAt }: Props) {
  const { t } = useTranslation();
  if (!routes.length) {
    return <span className={styles.routeNone}>{t('dashboard_live.no_routes')}</span>;
  }
  return (
    <ul className={styles.routes} aria-label={t('dashboard_live.providers_for_model')}>
      {routes.map((route) => {
        const state = CHIP_STATE[route.status];
        return (
          <li
            key={route.provider}
            className={styles.route}
            data-state={state}
            data-partial={route.partial || undefined}
            title={t(`dashboard_live.chip_${state}_hint`)}
          >
            <i className={styles.routeDot} aria-hidden="true" />
            <span>{route.label}</span>
            <span className={styles.srOnly}>{t(`dashboard_live.chip_${state}`)}</span>
            {route.status === 'cooling' && route.retryAt ? (
              <span className={styles.routeWait}>
                <Countdown
                  retryAt={route.retryAt}
                  observedAt={observedAt}
                  receivedAt={receivedAt}
                  template="dashboard_live.wait_only"
                />
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function RouteLegend() {
  const { t } = useTranslation();
  return (
    <ul className={styles.legend} aria-label={t('dashboard_live.legend')}>
      {(['serving', 'fallback', 'cooling'] as const).map((state) => (
        <li key={state} className={styles.route} data-state={state}>
          <i className={styles.routeDot} aria-hidden="true" />
          {t(`dashboard_live.chip_${state}`)}
        </li>
      ))}
    </ul>
  );
}
