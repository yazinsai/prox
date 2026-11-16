import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/features/config/components/SectionCard';
import { useAuthStore } from '@/stores';
import { IconChevronRight } from './settingsIcons';
import { settingsTools } from '../tools';
import styles from './SettingsPanels.module.scss';

/** Pages most people never need, one line each. Plugins appear only when the backend has them. */
export function ToolsPanel({ animateIn }: { animateIn: boolean }) {
  const { t } = useTranslation();
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  const tools = settingsTools(supportsPlugin);

  return (
    <SectionCard
      title={t('settings_page.tools.title')}
      description={t('settings_page.tools.description')}
      animateIn={animateIn}
    >
      <ul className={styles.links}>
        {tools.map((tool) => (
          <li key={tool.id}>
            <Link to={tool.to} className={styles.link}>
              <span className={styles.linkCopy}>
                <span className={styles.linkTitle}>{t(`settings_page.tools.${tool.id}`)}</span>
                <span className={styles.linkDescription}>
                  {t(`settings_page.tools.${tool.id}_desc`)}
                </span>
              </span>
              <IconChevronRight size={16} className={styles.linkChevron} />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
