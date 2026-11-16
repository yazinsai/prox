import { CONFIG_SECTION_IDS, type ConfigTabId } from '@/features/config/constants';

/**
 * Settings sections. The config editor's sections are joined by its YAML source and by the pages
 * that used to live elsewhere: appearance (the old header menus), about (the old system page) and
 * links to the rarely used tools.
 */
export type SettingsSectionId = ConfigTabId | 'source' | 'appearance' | 'tools' | 'about';

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'connect';

export interface SettingsNavGroup {
  id: 'client' | 'proxy' | 'dashboard';
  /** Groups after the first are labelled; the first holds only Connect. */
  labelKey: string | null;
  items: readonly SettingsSectionId[];
}

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  { id: 'client', labelKey: null, items: ['connect'] },
  {
    id: 'proxy',
    labelKey: 'settings_page.nav.group_proxy',
    items: ['connectivity', 'network', 'logging', 'streaming', 'advanced', 'payload', 'source'],
  },
  {
    id: 'dashboard',
    labelKey: 'settings_page.nav.group_dashboard',
    items: ['appearance', 'tools', 'about'],
  },
];

export const SETTINGS_SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_NAV_GROUPS.flatMap(
  (group) => group.items
);

const CONFIG_SECTION_SET: ReadonlySet<string> = new Set(CONFIG_SECTION_IDS);

/** Sections rendered from the visual config draft (they need visual mode). */
export function isVisualConfigSection(id: SettingsSectionId): id is ConfigTabId {
  return CONFIG_SECTION_SET.has(id);
}

/** `?section=` value → section; unknown or missing values fall back to Connect. */
export function parseSettingsSection(raw: string | null): SettingsSectionId {
  return raw !== null && (SETTINGS_SECTION_IDS as readonly string[]).includes(raw)
    ? (raw as SettingsSectionId)
    : DEFAULT_SETTINGS_SECTION;
}
