import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/features/config/components/SectionCard';
import { useLanguageStore, useThemeStore } from '@/stores';
import type { Language, Theme } from '@/types';
import { LANGUAGE_ORDER } from '@/utils/constants';
import styles from './SettingsPanels.module.scss';

type ThemeSwatch = { bg: string; card: string; border: string; text: string };

/** Miniature of each theme: page, sidebar and two text lines in the theme's own colours. */
const THEMES: ReadonlyArray<{ key: Theme; labelKey: string; swatch: ThemeSwatch }> = [
  {
    key: 'auto',
    labelKey: 'theme.auto',
    swatch: {
      bg: 'linear-gradient(135deg, #ffffff 0 50%, #111111 50% 100%)',
      card: 'linear-gradient(135deg, #f0eee8 0 50%, #1a1a1a 50% 100%)',
      border: '#bdbdbd',
      text: '#8a8a8a',
    },
  },
  {
    key: 'white',
    labelKey: 'theme.white',
    swatch: { bg: '#ffffff', card: '#f5f5f5', border: '#e5e5e5', text: '#c4c4c4' },
  },
  {
    key: 'light',
    labelKey: 'theme.light',
    swatch: { bg: '#faf9f5', card: '#f0eee8', border: '#e3e1db', text: '#c9c3bb' },
  },
  {
    key: 'dark',
    labelKey: 'theme.dark',
    swatch: { bg: '#000000', card: '#0e0e0e', border: '#262626', text: '#3a3a3a' },
  },
];

/** Each language in its own name and script, so it can be found from any current language. */
const LANGUAGE_NAMES: Record<Language, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ru: 'Русский',
  vi: 'Tiếng Việt',
  ko: '한국어',
  tr: 'Türkçe',
};

/** Theme and language: what used to live in the header menus. Both apply at once. */
export function AppearancePanel({ animateIn }: { animateIn: boolean }) {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  return (
    <SectionCard
      title={t('settings_page.appearance.title')}
      description={t('settings_page.appearance.description')}
      animateIn={animateIn}
    >
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{t('settings_page.appearance.theme')}</legend>
        <div className={styles.themeGrid}>
          {THEMES.map(({ key, labelKey, swatch }) => (
            <label key={key} className={styles.themeOption}>
              <input
                type="radio"
                name="settings-theme"
                value={key}
                checked={theme === key}
                onChange={() => setTheme(key)}
                className={styles.srOnly}
              />
              <span
                className={styles.themePreview}
                style={{ background: swatch.bg, borderColor: swatch.border }}
                aria-hidden="true"
              >
                <span
                  className={styles.themePreviewSidebar}
                  style={{ background: swatch.card, borderColor: swatch.border }}
                />
                <span className={styles.themePreviewLines}>
                  <span style={{ background: swatch.text }} />
                  <span style={{ background: swatch.text }} />
                </span>
              </span>
              <span className={styles.themeLabel}>{t(labelKey)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{t('settings_page.appearance.language')}</legend>
        <div className={styles.languageList}>
          {LANGUAGE_ORDER.map((code) => (
            <label key={code} className={styles.languageOption} lang={code}>
              <input
                type="radio"
                name="settings-language"
                value={code}
                checked={language === code}
                onChange={() => setLanguage(code)}
                className={styles.srOnly}
              />
              <span className={styles.languageName}>{LANGUAGE_NAMES[code]}</span>
              <span className={styles.check} aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>
    </SectionCard>
  );
}
