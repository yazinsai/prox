import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { DashboardLoadState } from '@/services/api/dashboard';
import { cooldownReasonKey } from '@/features/authFiles/cooldowns';
import type { AffectedModel, ProviderStatus, RoutedModel } from '../insights';
import { Countdown } from './LiveTime';
import styles from '../dashboard.module.scss';

const PREVIEW = 3;

interface Props {
  providers: ProviderStatus[] | null;
  routesState: DashboardLoadState;
  observedAt: string | null;
  receivedAt: number | null;
}

export function Providers({ providers, routesState, observedAt, receivedAt }: Props) {
  const { t } = useTranslation();
  return (
    <section
      id="dashboard-providers"
      className={styles.card}
      aria-labelledby="dashboard-providers-title"
    >
      <header className={styles.cardHead}>
        <h2 id="dashboard-providers-title">{t('dashboard_live.providers_title')}</h2>
        <Link to="/routing" className={styles.textButton}>
          {t('dashboard_live.manage_routing')}
          <span aria-hidden="true"> →</span>
        </Link>
      </header>
      {providers?.length ? (
        <ul className={styles.providers}>
          {providers.map((provider) => (
            <ProviderRow
              key={provider.provider}
              provider={provider}
              observedAt={observedAt}
              receivedAt={receivedAt}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>
          {providers ? t('dashboard_live.no_models') : t(`dashboard_live.state_${routesState}`)}
        </p>
      )}
    </section>
  );
}

function ProviderRow({
  provider,
  observedAt,
  receivedAt,
}: {
  provider: ProviderStatus;
  observedAt: string | null;
  receivedAt: number | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const detailsId = `provider-${provider.provider}-models`;
  const tone =
    provider.state === 'cooling'
      ? provider.stranded > 0
        ? 'critical'
        : 'warning'
      : provider.state === 'serving'
        ? provider.partial
          ? 'partial'
          : 'clear'
        : 'muted';
  const preview: Array<RoutedModel | AffectedModel> =
    provider.state === 'cooling'
      ? provider.cooling
      : provider.state === 'serving'
        ? provider.serving
        : provider.standby;
  const total = provider.serving.length + provider.standby.length + provider.cooling.length;
  const shown = preview.slice(0, PREVIEW);

  return (
    <li className={styles.provider} data-tone={tone}>
      <button
        type="button"
        className={styles.providerToggle}
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.providerHead}>
          <i className={styles.statusDot} aria-hidden="true" />
          <strong>{provider.label}</strong>
          <span className={styles.providerState}>
            {t(
              provider.state === 'cooling' && provider.serving.length
                ? 'dashboard_live.provider_cooling_partial'
                : `dashboard_live.provider_${provider.state}`
            )}
            {provider.state === 'cooling' && provider.retryAt ? (
              <>
                {' · '}
                <Countdown
                  retryAt={provider.retryAt}
                  observedAt={observedAt}
                  receivedAt={receivedAt}
                />
              </>
            ) : null}
          </span>
          <span className={styles.chevron} aria-hidden="true" />
        </span>
        <span className={styles.providerPreview}>
          <span className={styles.previewNames}>
            {provider.state === 'cooling' && provider.reason ? (
              <span className={styles.providerReason}>{t(cooldownReasonKey(provider.reason))}</span>
            ) : provider.partial ? (
              <span className={styles.providerReason}>
                {t('dashboard_live.provider_partial')}
                {provider.retryAt ? (
                  <>
                    {' '}
                    <Countdown
                      retryAt={provider.retryAt}
                      observedAt={observedAt}
                      receivedAt={receivedAt}
                      template="dashboard_live.wait_paren"
                    />
                  </>
                ) : null}
              </span>
            ) : null}
            {shown.map((model) => (
              <ModelName key={model.id} model={model} />
            ))}
          </span>
          {total > shown.length ? (
            <span className={styles.previewMore}>
              {t('dashboard_live.more', { count: total - shown.length })}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <dl id={detailsId} className={styles.providerDetails}>
          {(
            [
              ['cooling', provider.cooling],
              ['serving', provider.serving],
              ['fallback', provider.standby],
            ] as const
          ).map(([key, list]) =>
            list.length ? (
              <div key={key} data-group={key}>
                <dt>{t(`dashboard_live.group_${key}`)}</dt>
                <dd>
                  {list.map((model: RoutedModel | AffectedModel) => (
                    <ModelName key={model.id} model={model} />
                  ))}
                </dd>
              </div>
            ) : null
          )}
        </dl>
      ) : null}
    </li>
  );
}

function ModelName({
  model,
  className,
}: {
  model: RoutedModel | AffectedModel;
  className?: string;
}) {
  const { t } = useTranslation();
  const servedBy = 'servedBy' in model ? model.servedBy : undefined;
  return (
    <span className={className}>
      {model.label}
      {servedBy === undefined ? null : (
        <em data-stranded={servedBy === null}>
          {servedBy === null
            ? ` · ${t('dashboard_live.no_fallback')}`
            : ` ${t('dashboard_live.covered_short', { provider: servedBy })}`}
        </em>
      )}
    </span>
  );
}
