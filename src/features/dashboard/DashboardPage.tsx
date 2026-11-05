import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconBot,
  IconFileText,
  IconSidebarConfig,
  IconSidebarLogs,
  IconSidebarQuota,
  IconSidebarSystem,
} from '@/components/ui/icons';
import { useAuthStore } from '@/stores';
import { useDashboardCooldownClock } from './hooks/useDashboardCooldownClock';
import { summarizeProviderRequests, summarizeProviderThrottling } from './operations';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { formatCompactNumber, formatDateValue, formatPercent } from '@/utils/format';
import { useDashboardOverview } from './hooks/useDashboardOverview';
import { Meter } from './components/Meter';
import { ThroughputChart } from './components/ThroughputChart';
import { useCountUp, useRevealGroup, useRevealOnScroll } from '@/hooks/motion';
import { providerLabel, splitWindowMinutes, toneForSuccessRate, type MeterTone } from './utils';
import { RequestArchivePanel } from './components/RequestArchivePanel';
import styles from './dashboard.module.scss';

const DASH = '—';

/** KPI 卡左上角色签：有语义色调的卡用状态色，其余保持中性 */
const TILE_ACCENTS: Record<MeterTone, string> = {
  good: 'var(--success-color)',
  warning: 'var(--amber-color)',
  critical: 'var(--viz-failure)',
  idle: 'var(--text-quaternary)',
};

/** 大数字：六位以内用千分位，再往上压缩，避免撑破排版 */
const formatHeadline = (value: number): string =>
  value < 100_000 ? value.toLocaleString() : formatCompactNumber(value);

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);

  const {
    connectionStatus,
    connected,
    config,
    counts,
    traffic,
    providers,
    credentials,
    authFiles,
    refresh,
  } = useDashboardOverview();
  const nowMs = useDashboardCooldownClock(connected);
  const hasRequests = connected && (authFiles !== null || providers.length > 0);
  const throttling = useMemo(
    () => summarizeProviderThrottling(authFiles, nowMs),
    [authFiles, nowMs]
  );
  const requests = useMemo(() => summarizeProviderRequests(providers), [providers]);

  useHeaderRefresh(refresh, connected);

  /* Hero 与静态网格走分组级联；异步内容区（图表/供应商）保持整块 reveal */
  const heroRef = useRevealGroup<HTMLElement>();
  const statsRef = useRevealGroup<HTMLElement>(0.12);
  const trafficRef = useRevealOnScroll<HTMLElement>();
  const fleetRef = useRevealOnScroll<HTMLElement>();
  const detailRef = useRevealGroup<HTMLElement>();
  const ctaRef = useRevealGroup<HTMLElement>();

  const animatedTotal = useCountUp(traffic.total, connected);

  const windowLabel = useMemo(() => {
    if (traffic.windowMinutes <= 0) return DASH;
    const { hours, minutes } = splitWindowMinutes(traffic.windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [traffic.windowMinutes, t]);

  const routingStrategy = useMemo(() => {
    const raw = config?.routingStrategy?.trim() ?? '';
    if (!raw) return DASH;
    if (raw === 'round-robin') return t('basic_settings.routing_strategy_round_robin');
    if (raw === 'weighted-round-robin') {
      return t('basic_settings.routing_strategy_weighted_round_robin');
    }
    if (raw === 'fill-first') return t('basic_settings.routing_strategy_fill_first');
    return raw;
  }, [config?.routingStrategy, t]);

  const unknownProviderLabel = t('dashboard.provider_unknown');
  const successRateTone = toneForSuccessRate(traffic.successRate);

  /** 标题是算出来的判词，不是写死的口号；句尾句号充当状态灯 */
  const verdict = useMemo(() => {
    if (!connected) {
      return connectionStatus === 'connecting'
        ? { key: 'hero_verdict_connecting', accent: 'var(--amber-color)' }
        : { key: 'hero_verdict_offline', accent: 'var(--text-quaternary)' };
    }
    if (throttling.providers.length > 0) {
      return { key: 'hero_verdict_throttled', accent: 'var(--amber-color)' };
    }
    if (
      !throttling.loaded ||
      throttling.unknownCredentials > 0 ||
      throttling.expiredCredentials > 0
    ) {
      return { key: 'hero_verdict_unknown', accent: 'var(--text-secondary)' };
    }
    if (throttling.otherCooldownCredentials > 0) {
      return { key: 'hero_verdict_critical', accent: 'var(--amber-color)' };
    }
    if (traffic.total === 0 || traffic.successRate === null) {
      return { key: 'hero_verdict_idle', accent: 'var(--text-quaternary)' };
    }
    const keyByTone: Record<MeterTone, string> = {
      good: 'hero_verdict_good',
      warning: 'hero_verdict_warning',
      critical: 'hero_verdict_critical',
      idle: 'hero_verdict_idle',
    };
    return { key: keyByTone[successRateTone], accent: TILE_ACCENTS[successRateTone] };
  }, [
    connected,
    connectionStatus,
    traffic.total,
    traffic.successRate,
    successRateTone,
    throttling,
  ]);

  /* 句号状态灯只在「有活着的流量」时呼吸；离线/静默时保持安静 */
  const heroAlive = connected && traffic.total > 0;

  const connectionLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );
  const versionLabel = serverVersion ? `v${serverVersion.trim().replace(/^[vV]+/, '')}` : null;
  const heroMetaLine = [versionLabel, connectionLabel].filter(Boolean).join(' · ');

  const statTiles = [
    {
      key: 'success',
      label: t('stats.success'),
      value: hasRequests ? requests.success.toLocaleString() : DASH,
      hint: t('dashboard.cumulative_counts'),
      meter: null,
      tone: 'good' as const,
    },
    {
      key: 'failure',
      label: t('stats.failure'),
      value: hasRequests ? requests.failure.toLocaleString() : DASH,
      hint: t('dashboard.cumulative_counts'),
      meter: null,
      tone: requests.failure > 0 ? ('critical' as const) : ('idle' as const),
    },
    {
      key: 'throttled',
      label: t('dashboard.throttled_providers'),
      value: connected && throttling.loaded ? String(throttling.providers.length) : DASH,
      hint: t('dashboard.throttle_affected', { count: throttling.affectedCredentials }),
      meter: null,
      tone: throttling.providers.length > 0 ? ('warning' as const) : ('idle' as const),
    },
    {
      key: 'rate',
      label: t('dashboard.success_rate'),
      value: requests.successRate === null ? DASH : formatPercent(requests.successRate),
      hint: t('dashboard.cumulative_counts'),
      meter: requests.successRate,
      tone: toneForSuccessRate(requests.successRate),
    },
  ];

  const runtimeRows: Array<{ label: string; value: string; mono?: boolean }> = [
    {
      label: t('dashboard.stat_credentials'),
      value: counts.credentials === null ? DASH : String(counts.credentials),
    },
    {
      label: t('dashboard.stat_provider_keys'),
      value: counts.providerKeys === null ? DASH : String(counts.providerKeys),
    },
    {
      label: t('dashboard.stat_models'),
      value: counts.models === null ? DASH : String(counts.models),
    },
    { label: t('dashboard.runtime_routing'), value: routingStrategy },
    { label: t('dashboard.runtime_retry'), value: String(config?.requestRetry ?? 0) },
    {
      label: t('dashboard.runtime_management_keys'),
      value: counts.managementKeys === null ? DASH : String(counts.managementKeys),
    },
    { label: t('dashboard.runtime_version'), value: serverVersion?.trim() || DASH },
    {
      label: t('dashboard.runtime_build'),
      value: formatDateValue(serverBuildDate, i18n.language) || DASH,
    },
    { label: t('dashboard.runtime_proxy'), value: config?.proxyUrl?.trim() || DASH, mono: true },
  ];

  const runtimeToggles = config
    ? [
        { label: t('dashboard.runtime_debug'), on: Boolean(config.debug) },
        { label: t('dashboard.runtime_file_logging'), on: Boolean(config.loggingToFile) },
        { label: t('dashboard.runtime_request_log'), on: Boolean(config.requestLog) },
        { label: t('dashboard.runtime_ws_auth'), on: Boolean(config.wsAuth) },
        { label: t('dashboard.runtime_model_prefix'), on: Boolean(config.forceModelPrefix) },
      ]
    : [];

  const ctaCards = [
    {
      to: '/ai-providers',
      icon: <IconBot size={20} />,
      title: t('nav.ai_providers'),
      description: t('dashboard.cta_providers_desc'),
    },
    {
      to: '/auth-files',
      icon: <IconFileText size={20} />,
      title: t('nav.auth_files'),
      description: t('dashboard.cta_auth_files_desc'),
    },
    {
      to: '/config',
      icon: <IconSidebarConfig size={20} />,
      title: t('nav.config_management'),
      description: t('dashboard.cta_config_desc'),
    },
    {
      to: '/quota',
      icon: <IconSidebarQuota size={20} />,
      title: t('nav.quota_management'),
      description: t('dashboard.cta_quota_desc'),
    },
    {
      to: '/logs',
      icon: <IconSidebarLogs size={20} />,
      title: t('nav.logs'),
      description: t('dashboard.cta_logs_desc'),
    },
    {
      to: '/system',
      icon: <IconSidebarSystem size={20} />,
      title: t('nav.system_info'),
      description: t('dashboard.cta_system_desc'),
    },
  ];

  return (
    <div className={styles.page}>
      <section className={styles.hero} ref={heroRef}>
        <div className={styles.heroCopy}>
          <div className={styles.heroStatus} data-reveal>
            {connected && (
              <span className={styles.liveBadge}>
                <i className={styles.liveDot} aria-hidden="true" />
                {t('dashboard.hero_live')}
              </span>
            )}
            <span>{t('dashboard.hero_window_meta', { window: windowLabel })}</span>
          </div>
          <h1 className={styles.heroTitle} data-reveal>
            {t(`dashboard.${verdict.key}`)}
            <span
              className={`${styles.heroPeriod} ${heroAlive ? styles.heroPeriodLive : ''}`}
              style={{ color: verdict.accent }}
            >
              {t('dashboard.hero_period')}
            </span>
          </h1>
          <p className={styles.heroMeta} data-reveal>
            <strong>{connected ? formatHeadline(animatedTotal) : DASH}</strong>{' '}
            {t('dashboard.hero_requests_label')} · {heroMetaLine}
          </p>
        </div>
        <div className={styles.heroActions} data-reveal>
          <Link to="/logs" className={styles.ghostAction}>
            <IconSidebarLogs size={16} aria-hidden="true" />
            {t('dashboard.cta_inspect_logs')}
          </Link>
          <Link to="/ai-providers" className={styles.primaryAction}>
            <IconBot size={16} aria-hidden="true" />
            {t('dashboard.cta_manage_providers')}
          </Link>
        </div>
      </section>

      <section
        className={styles.throttleSection}
        data-active={throttling.providers.length > 0}
        aria-label={t('dashboard.throttled_providers')}
      >
        <header className={styles.throttleHeading}>
          <div>
            <h2>{t('dashboard.throttled_providers')}</h2>
            <p>{t('dashboard.throttle_scope')}</p>
          </div>
          <Link to="/auth-files" className={styles.ghostAction}>
            {t('nav.auth_files')}
          </Link>
        </header>
        {!connected || !throttling.loaded ? (
          <p className={styles.throttleNote}>{t('dashboard.throttle_unknown')}</p>
        ) : throttling.providers.length === 0 ? (
          <p className={styles.throttleNote}>{t('dashboard.throttle_none')}</p>
        ) : (
          <ul className={styles.throttleProviders}>
            {throttling.providers.map((provider) => (
              <li key={provider.id}>
                <strong>{providerLabel(provider.id, unknownProviderLabel)}</strong>
                <span>
                  {t('dashboard.throttle_partial', {
                    affected: provider.affectedCredentials,
                    total: provider.credentialCount,
                  })}
                </span>
                <span>
                  {t('dashboard.throttle_wait', {
                    minutes: Math.ceil(provider.earliestSeconds / 60),
                  })}
                </span>
                {provider.models.length > 0 ? (
                  <span className={styles.throttleModels}>
                    {t('dashboard.throttle_models', { models: provider.models.join(', ') })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.throttleNotes}>
          {throttling.unknownCredentials > 0 ? (
            <span>
              {t('dashboard.throttle_unknown_count', { count: throttling.unknownCredentials })}
            </span>
          ) : null}
          {throttling.expiredCredentials > 0 ? (
            <span>{t('dashboard.throttle_expired', { count: throttling.expiredCredentials })}</span>
          ) : null}
          {throttling.otherCooldownCredentials > 0 ? (
            <span>
              {t('dashboard.throttle_other', { count: throttling.otherCooldownCredentials })}
            </span>
          ) : null}
        </div>
      </section>

      {/* ---------- KPI ---------- */}
      <section className={styles.statsRow} ref={statsRef} aria-label={t('dashboard.stats_aria')}>
        {statTiles.map((tile) => (
          <article
            key={tile.key}
            className={styles.statTile}
            data-reveal
            style={
              {
                '--tile-accent': tile.tone ? TILE_ACCENTS[tile.tone] : 'var(--border-hover)',
              } as React.CSSProperties
            }
          >
            <span className={styles.statLabel}>{tile.label}</span>
            <strong className={styles.statValue}>{tile.value}</strong>
            {tile.meter !== null && tile.meter !== undefined && (
              <Meter
                value={tile.meter}
                tone={tile.tone}
                ariaLabel={tile.label}
                className={styles.statMeter}
              />
            )}
            <span className={styles.statHint}>{tile.hint}</span>
          </article>
        ))}
      </section>

      {/* ---------- Provider fleet ---------- */}
      <section className={styles.dataSection} ref={fleetRef}>
        <header className={styles.sectionHead}>
          <span className={styles.eyebrow}>{t('dashboard.provider_split_title')}</span>
          <h2 className={styles.sectionTitle}>{t('dashboard.fleet_title')}</h2>
          <p className={styles.sectionDescription}>
            {t('dashboard.provider_split_scope', { total: requests.total.toLocaleString() })}
          </p>
        </header>
        <div className={styles.panel}>
          {providers.length === 0 ? (
            <p className={styles.emptyNote}>{t('dashboard.fleet_empty')}</p>
          ) : (
            <>
              <div className={styles.fleetColumns} aria-hidden="true">
                <span>{t('dashboard.provider_split_provider')}</span>
                <span>{t('dashboard.provider_split_share')}</span>
                <span>{t('stats.success')}</span>
                <span>{t('stats.failure')}</span>
                <span>{t('dashboard.provider_split_total')}</span>
              </div>
              <ul className={styles.fleetList}>
                {requests.providers.map((provider) => (
                  <li key={provider.id} className={styles.fleetRow}>
                    <div className={styles.fleetIdentity}>
                      <span className={styles.fleetName}>
                        {providerLabel(provider.id, unknownProviderLabel)}
                      </span>
                      <span className={styles.fleetMeta}>
                        {t('dashboard.fleet_credentials', { value: provider.credentials })}
                      </span>
                    </div>
                    <div className={styles.fleetShareCell}>
                      <span className={styles.fleetShareValue}>
                        {formatPercent(provider.share)}
                      </span>
                      <div className={styles.fleetShare} aria-hidden="true">
                        <span style={{ width: `${provider.share}%` }} />
                      </div>
                    </div>
                    <div className={styles.fleetNumbers}>
                      <span className={styles.fleetSuccess}>
                        {provider.success.toLocaleString()}
                      </span>
                      <span className={styles.fleetMobileLabel}>{t('stats.success')}</span>
                    </div>
                    <div className={styles.fleetNumbers}>
                      <span
                        className={provider.failure > 0 ? styles.fleetFailure : styles.fleetTotal}
                      >
                        {provider.failure.toLocaleString()}
                      </span>
                      <span className={styles.fleetMobileLabel}>{t('stats.failure')}</span>
                    </div>
                    <div className={styles.fleetNumbers}>
                      <span className={styles.fleetTotal}>{provider.total.toLocaleString()}</span>
                      <span className={styles.fleetMobileLabel}>
                        {t('dashboard.provider_split_total')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      {/* ---------- Traffic ---------- */}
      <section className={styles.dataSection} ref={trafficRef}>
        <header className={styles.sectionHead}>
          <span className={styles.eyebrow}>{t('dashboard.traffic_eyebrow')}</span>
          <h2 className={styles.sectionTitle}>{t('dashboard.traffic_title')}</h2>
          <p className={styles.sectionDescription}>
            {t('dashboard.traffic_description', { window: windowLabel })}
          </p>
        </header>
        <div className={styles.panel}>
          <ThroughputChart traffic={traffic} />
        </div>
      </section>

      <RequestArchivePanel />

      {/* ---------- Credential health + runtime ---------- */}
      <section className={styles.detailGrid} ref={detailRef}>
        <div className={styles.panel} data-reveal>
          <header className={styles.panelHead}>
            <span className={styles.eyebrow}>{t('dashboard.health_eyebrow')}</span>
            <h2 className={styles.panelTitle}>{t('dashboard.health_title')}</h2>
          </header>
          {!credentials || credentials.total === 0 ? (
            <p className={styles.emptyNote}>{t('dashboard.health_empty')}</p>
          ) : (
            <>
              <div className={styles.healthBar}>
                {credentials.active > 0 && (
                  <span
                    className={`${styles.healthSegment} ${styles.healthActive}`}
                    style={{ flexGrow: credentials.active }}
                  />
                )}
                {credentials.unavailable > 0 && (
                  <span
                    className={`${styles.healthSegment} ${styles.healthUnavailable}`}
                    style={{ flexGrow: credentials.unavailable }}
                  />
                )}
                {credentials.disabled > 0 && (
                  <span
                    className={`${styles.healthSegment} ${styles.healthDisabled}`}
                    style={{ flexGrow: credentials.disabled }}
                  />
                )}
              </div>
              <ul className={styles.healthLegend}>
                <li>
                  <i className={`${styles.healthKey} ${styles.healthActive}`} aria-hidden="true" />
                  {t('dashboard.health_active')}
                  <b>{credentials.active.toLocaleString()}</b>
                </li>
                <li>
                  <i
                    className={`${styles.healthKey} ${styles.healthUnavailable}`}
                    aria-hidden="true"
                  />
                  {t('dashboard.health_unavailable')}
                  <b>{credentials.unavailable.toLocaleString()}</b>
                </li>
                <li>
                  <i
                    className={`${styles.healthKey} ${styles.healthDisabled}`}
                    aria-hidden="true"
                  />
                  {t('dashboard.health_disabled')}
                  <b>{credentials.disabled.toLocaleString()}</b>
                </li>
              </ul>
              <div className={styles.typeBreakdown}>
                <span className={styles.typeBreakdownLabel}>{t('dashboard.health_by_type')}</span>
                <ul className={styles.typeList}>
                  {credentials.byType.map((entry) => (
                    <li key={entry.type} className={styles.typeChip}>
                      {providerLabel(entry.type, unknownProviderLabel)}
                      <b>{entry.count.toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
              </div>
              <Link to="/auth-files" className={styles.panelLink}>
                {t('dashboard.health_link')}{' '}
                <span className={styles.linkArrow} aria-hidden="true">
                  →
                </span>
              </Link>
            </>
          )}
        </div>

        <div className={styles.panel} data-reveal>
          <header className={styles.panelHead}>
            <span className={styles.eyebrow}>{t('dashboard.runtime_eyebrow')}</span>
            <h2 className={styles.panelTitle}>{t('dashboard.runtime_title')}</h2>
          </header>
          <dl className={styles.specList}>
            {runtimeRows.map((row) => (
              <div key={row.label} className={styles.specRow}>
                <dt className={styles.specLabel}>{row.label}</dt>
                <dd className={`${styles.specValue} ${row.mono ? styles.specMono : ''}`}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {runtimeToggles.length > 0 && (
            <ul className={styles.toggleList}>
              {runtimeToggles.map((toggle) => (
                <li
                  key={toggle.label}
                  className={`${styles.togglePill} ${toggle.on ? styles.toggleOn : styles.toggleOff}`}
                >
                  {toggle.label}
                  <b>{toggle.on ? t('common.yes') : t('common.no')}</b>
                </li>
              ))}
            </ul>
          )}
          <Link to="/config" className={styles.panelLink}>
            {t('dashboard.runtime_link')}{' '}
            <span className={styles.linkArrow} aria-hidden="true">
              →
            </span>
          </Link>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className={styles.section} ref={ctaRef}>
        <header className={styles.sectionHead} data-reveal>
          <span className={styles.eyebrow}>{t('dashboard.cta_eyebrow')}</span>
          <h2 className={styles.sectionTitle}>{t('dashboard.cta_title')}</h2>
        </header>
        <div className={styles.ctaGrid}>
          {ctaCards.map((card) => (
            <Link key={card.to} to={card.to} className={styles.ctaCard} data-reveal>
              <span className={styles.ctaIcon}>{card.icon}</span>
              <span className={styles.ctaTitle}>{card.title}</span>
              <span className={styles.ctaDescription}>{card.description}</span>
              <span className={styles.ctaArrow} aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
