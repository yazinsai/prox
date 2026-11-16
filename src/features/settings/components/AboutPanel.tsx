import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { SectionCard } from '@/features/config/components/SectionCard';
import { versionApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { formatDateTimeValue } from '@/utils/format';
import { getErrorMessage } from '@/utils/helpers';
import { compareVersions } from '../version';
import styles from './SettingsPanels.module.scss';

/** Saved-login keys removed by "Forget this browser", current and legacy. */
const LOGIN_STORAGE_KEYS = [STORAGE_KEY_AUTH, 'isLoggedIn', 'apiBase', 'apiUrl', 'managementKey'];

/** Versions, the connection and signing out: what the old system page held, minus the noise. */
export function AboutPanel({ animateIn }: { animateIn: boolean }) {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const logout = useAuthStore((state) => state.logout);
  const [checking, setChecking] = useState(false);

  const unknown = t('system_info.version_unknown');
  const buildTime = formatDateTimeValue(serverBuildDate, i18n.language) || unknown;
  const host = apiBase.replace(/^https?:\/\//, '') || unknown;

  const checkForUpdates = async () => {
    setChecking(true);
    try {
      const data = await versionApi.checkLatest();
      const raw = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const latest = typeof raw === 'string' ? raw : String(raw ?? '');
      if (!latest) {
        showNotification(t('system_info.version_check_error'), 'error');
        return;
      }
      const comparison = compareVersions(latest, serverVersion);
      if (comparison === null) {
        showNotification(t('system_info.version_current_missing'), 'warning');
      } else if (comparison > 0) {
        showNotification(t('system_info.version_update_available', { version: latest }), 'warning');
      } else {
        showNotification(t('system_info.version_is_latest'), 'success');
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error, '');
      showNotification(
        `${t('system_info.version_check_error')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setChecking(false);
    }
  };

  const forgetBrowser = () => {
    showConfirmation({
      title: t('settings_page.about.forget_title'),
      message: t('settings_page.about.forget_confirm'),
      variant: 'danger',
      confirmText: t('settings_page.about.forget_button'),
      cancelText: t('common.cancel'),
      onConfirm: () => {
        logout();
        LOGIN_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
        showNotification(t('notification.login_storage_cleared'), 'success');
      },
    });
  };

  return (
    <SectionCard
      title={t('settings_page.about.title')}
      description={t('system_info.about_title')}
      animateIn={animateIn}
    >
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{t('settings_page.about.dashboard_version')}</dt>
          <dd className={styles.mono}>{__APP_VERSION__ || unknown}</dd>
        </div>
        <div className={styles.fact}>
          <dt>{t('settings_page.about.proxy_version')}</dt>
          <dd className={styles.factWithAction}>
            <span className={styles.mono}>{serverVersion || unknown}</span>
            <Button
              variant="secondary"
              size="sm"
              loading={checking}
              disabled={connectionStatus !== 'connected'}
              onClick={() => void checkForUpdates()}
            >
              {t('system_info.version_check_button')}
            </Button>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>{t('settings_page.about.built')}</dt>
          <dd>{buildTime}</dd>
        </div>
        <div className={styles.fact}>
          <dt>{t('settings_page.about.connection')}</dt>
          <dd className={styles.connection}>
            <span className={styles.statusDot} data-status={connectionStatus} aria-hidden="true" />
            <span className={styles.mono}>{host}</span>
            <span className={styles.muted}>
              {connectionStatus === 'error'
                ? t('common.error')
                : t(`common.${connectionStatus}_status`)}
            </span>
          </dd>
        </div>
      </dl>

      <div className={styles.signOut}>
        <div className={styles.signOutCopy}>
          <h3>{t('settings_page.about.sign_out_title')}</h3>
          <p>{t('settings_page.about.sign_out_description')}</p>
        </div>
        <div className={styles.signOutActions}>
          <Button variant="secondary" size="sm" onClick={logout}>
            {t('settings_page.about.log_out')}
          </Button>
          <Button variant="ghost" size="sm" className={styles.danger} onClick={forgetBrowser}>
            {t('settings_page.about.forget_button')}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
