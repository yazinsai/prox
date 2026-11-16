import { useId, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileText, IconInfo, type IconProps } from '@/components/ui/icons';
import { CONFIG_TAB_ICONS } from '@/features/config/constants';
import { SETTINGS_NAV_GROUPS, isVisualConfigSection, type SettingsSectionId } from '../sections';
import { IconPalette, IconWrench } from './settingsIcons';
import styles from './SettingsNav.module.scss';

const SECTION_ICONS: Record<SettingsSectionId, ComponentType<IconProps>> = {
  ...CONFIG_TAB_ICONS,
  source: IconFileText,
  appearance: IconPalette,
  tools: IconWrench,
  about: IconInfo,
};

export type SettingsNavProps = {
  active: SettingsSectionId;
  /** Validation errors per section; a count shows as a badge. */
  errorCounts: Partial<Record<SettingsSectionId, number>>;
  /** Sections holding unsaved edits; each gets an amber dot. */
  dirtySections: ReadonlySet<SettingsSectionId>;
  disabled?: boolean;
  onSelect: (id: SettingsSectionId) => void;
};

/**
 * Section navigation: a grouped list on wide screens, a native select on narrow ones (both are
 * rendered; CSS shows one, and `display: none` keeps the other out of the accessibility tree).
 */
export function SettingsNav({
  active,
  errorCounts,
  dirtySections,
  disabled = false,
  onSelect,
}: SettingsNavProps) {
  const { t } = useTranslation();
  const selectId = useId();
  const label = (id: SettingsSectionId) => t(`settings_page.nav.${id}`);

  const describe = (id: SettingsSectionId) => {
    const errors = errorCounts[id] ?? 0;
    return [
      label(id),
      errors > 0 ? t('config_management.meta_errors', { count: errors }) : null,
      dirtySections.has(id) ? t('config_management.status_dirty_short') : null,
    ]
      .filter(Boolean)
      .join(', ');
  };

  return (
    <>
      <nav className={styles.nav} aria-label={t('settings_page.nav.label')}>
        {SETTINGS_NAV_GROUPS.map((group) => (
          <div key={group.id} className={styles.group}>
            {group.labelKey ? (
              <h2 className={styles.groupLabel} id={`${selectId}-${group.id}`}>
                {t(group.labelKey)}
              </h2>
            ) : null}
            <ul
              className={styles.list}
              aria-labelledby={group.labelKey ? `${selectId}-${group.id}` : undefined}
            >
              {group.items.map((id) => {
                const Icon = SECTION_ICONS[id];
                const isActive = id === active;
                const errors = errorCounts[id] ?? 0;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className={styles.item}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={describe(id)}
                      // Switching into visual sections is refused while YAML edits are open, so
                      // the whole list only locks during save and load.
                      disabled={disabled && isVisualConfigSection(id)}
                      onClick={() => onSelect(id)}
                    >
                      <Icon size={15} className={styles.icon} />
                      <span className={styles.itemLabel}>{label(id)}</span>
                      {errors > 0 ? (
                        <span className={styles.badge} aria-hidden="true">
                          {errors}
                        </span>
                      ) : null}
                      {dirtySections.has(id) ? (
                        <span className={styles.dirtyDot} aria-hidden="true" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={styles.compact}>
        <label className={styles.srOnly} htmlFor={selectId}>
          {t('settings_page.nav.label')}
        </label>
        <select
          id={selectId}
          className={styles.select}
          value={active}
          onChange={(event) => onSelect(event.target.value as SettingsSectionId)}
        >
          {SETTINGS_NAV_GROUPS.map((group) => {
            const options = group.items.map((id) => (
              <option
                key={id}
                value={id}
                disabled={disabled && isVisualConfigSection(id) && id !== active}
              >
                {describe(id)}
              </option>
            ));
            return group.labelKey ? (
              <optgroup key={group.id} label={t(group.labelKey)}>
                {options}
              </optgroup>
            ) : (
              options
            );
          })}
        </select>
        <span className={styles.selectChevron} aria-hidden="true" />
      </div>
    </>
  );
}
