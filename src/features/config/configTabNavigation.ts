import { CONFIG_TAB_IDS, type ConfigTabId } from './constants';

/** Both arrow axes work as the tab list switches from a desktop rail to a mobile row. */
export function configTabForKey(key: string, current: ConfigTabId): ConfigTabId | null {
  const index = CONFIG_TAB_IDS.indexOf(current);
  const count = CONFIG_TAB_IDS.length;
  if (key === 'Home') return CONFIG_TAB_IDS[0];
  if (key === 'End') return CONFIG_TAB_IDS[count - 1];
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return CONFIG_TAB_IDS[(index + 1) % count];
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return CONFIG_TAB_IDS[(index - 1 + count) % count];
  }
  return null;
}
