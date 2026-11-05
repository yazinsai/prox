import { useTranslation } from 'react-i18next';
import { IconExternalLink } from '@/components/ui/icons';
import type { SponsorCardSite } from './SponsorCard';
import styles from './OAuthSponsorSites.module.scss';

export function OAuthSponsorSites({
  sites,
  selectedId,
  onSelect,
}: {
  sites: SponsorCardSite[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.sites} role="group" aria-label={t('auth_login.sponsor_kimi_caption')}>
      {sites.map((site) => (
        <div className={styles.site} key={site.id}>
          <button
            type="button"
            className={`${styles.region} ${selectedId === site.id ? styles.selected : ''}`}
            aria-label={site.name}
            aria-pressed={selectedId === site.id}
            onClick={() => onSelect(site.id)}
          >
            <span>{site.region}</span>
            <span className={styles.domain}>{site.domain}</span>
          </button>
          <a
            className={styles.join}
            href={site.signUpUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${t('auth_login.sponsor_sign_up')} · ${site.name}`}
          >
            {t('auth_login.sponsor_sign_up')}
            <IconExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      ))}
    </div>
  );
}
