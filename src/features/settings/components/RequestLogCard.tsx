import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/features/config/components/SectionCard';
import { SettingList, ToggleSetting } from '@/features/config/components/fields/FieldPrimitives';
import { configApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';

/**
 * Request logging has its own endpoint and saves on toggle, outside the config draft. It was
 * hidden behind seven taps on the old system page; it belongs with the other logging settings.
 */
export function RequestLogCard({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation();
  const enabled = useConfigStore((state) => state.config?.requestLog ?? false);
  const loaded = useConfigStore((state) => state.config !== null);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (connected) fetchConfig().catch(() => undefined);
  }, [connected, fetchConfig]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    updateConfigValue('request-log', next);
    try {
      await configApi.updateRequestLog(next);
      clearCache('request-log');
      showNotification(t('notification.request_log_updated'), 'success');
      onSaved();
    } catch (error: unknown) {
      updateConfigValue('request-log', !next);
      const message = getErrorMessage(error, '');
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title={t('settings_page.request_log.title')}
      description={t('settings_page.request_log.description')}
    >
      <SettingList>
        <ToggleSetting
          fieldId="requestLog"
          wide
          label={t('basic_settings.request_log_enable')}
          description={t('settings_page.request_log.toggle_hint')}
          checked={enabled}
          disabled={!connected || !loaded || saving}
          onChange={(next) => void toggle(next)}
        />
      </SettingList>
    </SectionCard>
  );
}
