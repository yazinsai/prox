import { useTranslation } from 'react-i18next';
import { IconChevronLeft } from '@/components/ui/icons';
import { useThemeStore } from '@/stores';
import { PROVIDER_LOGOS } from '../brandLogos';
import type { ProviderBrand, ProviderGroup } from '../types';
import styles from './ProviderOverview.module.scss';

export function ProviderOverview({
  groups,
  onSelect,
}: {
  groups: ProviderGroup[];
  onSelect: (brand: ProviderBrand) => void;
}) {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.resolvedTheme);
  return (
    <div className={styles.grid}>
      {groups.map((group) => {
        const logo = PROVIDER_LOGOS[group.id];
        const models = [...new Set(group.resources.flatMap((resource) => resource.models))];
        const active = group.resources.filter((resource) => !resource.disabled).length;
        const endpoints = [
          ...new Set(group.resources.map((resource) => resource.baseUrl).filter(Boolean)),
        ];
        return (
          <button
            type="button"
            key={group.id}
            className={styles.card}
            onClick={() => onSelect(group.id)}
          >
            <span className={styles.heading}>
              {logo && (
                <img
                  src={theme === 'dark' && logo.darkSrc ? logo.darkSrc : logo.src}
                  alt=""
                  className={styles.logo}
                />
              )}
              <span className={styles.name}>{t(`providersPage.providerNames.${group.id}`)}</span>
              <IconChevronLeft size={16} className={styles.arrow} />
            </span>
            <span className={styles.count}>
              {t('providersPage.categories.activeCount', { active, total: group.resources.length })}
            </span>
            {endpoints.length > 0 && (
              <span className={styles.endpoint} title={endpoints.join(', ')}>
                {endpoints[0]}
                {endpoints.length > 1 ? ` · +${endpoints.length - 1}` : ''}
              </span>
            )}
            <span className={styles.models}>
              {models.slice(0, 3).map((model) => (
                <span key={model} className={styles.chip} title={model}>
                  {model}
                </span>
              ))}
              {models.length > 3 && <span className={styles.chip}>+{models.length - 3}</span>}
              {models.length === 0 && (
                <span className={styles.empty}>{t('providersPage.table.metrics.models')}: 0</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
