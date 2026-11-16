import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/features/oauth/components/CopyButton';
import { useAuthStore } from '@/stores';
import { clientEndpoints } from '../../clientEndpoints';
import type { ConfigSectionProps } from '../../types';
import { SectionCard } from '../SectionCard';
import { ApiKeysField } from '../fields/sharedFields';
import styles from './SectionConnect.module.scss';

/**
 * Connect: what a client needs to talk to the proxy. The addresses come from the connection this
 * dashboard uses; the keys are the proxy's `access.api-keys`, edited as part of the config draft.
 */
export function SectionConnect({ values, disabled, animateIn, onChange }: ConfigSectionProps) {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const endpoints = clientEndpoints(apiBase);
  const rows = endpoints
    ? [
        {
          id: 'openai',
          label: t('settings_page.connect.openai_label'),
          hint: t('settings_page.connect.openai_hint'),
          value: endpoints.openai,
        },
        {
          id: 'anthropic',
          label: t('settings_page.connect.anthropic_label'),
          hint: t('settings_page.connect.anthropic_hint'),
          value: endpoints.anthropic,
        },
      ]
    : [];

  return (
    <SectionCard
      title={t('settings_page.connect.title')}
      description={t('settings_page.connect.description')}
      animateIn={animateIn}
    >
      {rows.length > 0 ? (
        <dl className={styles.endpoints}>
          {rows.map((row) => (
            <div key={row.id} className={styles.endpoint}>
              <dt className={styles.label}>
                <span>{row.label}</span>
                <span className={styles.hint}>{row.hint}</span>
              </dt>
              <dd className={styles.value}>
                <code translate="no">{row.value}</code>
                <CopyButton
                  value={row.value}
                  label={t('settings_page.connect.copy', { name: row.label })}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <ApiKeysField values={values} disabled={disabled} onChange={onChange} />
    </SectionCard>
  );
}
