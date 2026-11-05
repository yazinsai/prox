import { describe, expect, test } from 'bun:test';
import { CONFIG_TAB_IDS } from '@/features/config/constants';
import { configTabForKey } from '@/features/config/configTabNavigation';

describe('responsive config tab keyboard navigation', () => {
  test('both axes traverse and wrap the same section order', () => {
    const first = CONFIG_TAB_IDS[0];
    const last = CONFIG_TAB_IDS.at(-1)!;
    for (const key of ['ArrowRight', 'ArrowDown']) {
      expect(configTabForKey(key, first)).toBe(CONFIG_TAB_IDS[1]);
      expect(configTabForKey(key, last)).toBe(first);
    }
    for (const key of ['ArrowLeft', 'ArrowUp']) {
      expect(configTabForKey(key, first)).toBe(last);
      expect(configTabForKey(key, CONFIG_TAB_IDS[1])).toBe(first);
    }
  });

  test('Home and End select endpoints without intercepting unrelated keys', () => {
    expect(configTabForKey('Home', CONFIG_TAB_IDS[2])).toBe(CONFIG_TAB_IDS[0]);
    expect(configTabForKey('End', CONFIG_TAB_IDS[2])).toBe(CONFIG_TAB_IDS.at(-1)!);
    expect(configTabForKey('Tab', CONFIG_TAB_IDS[2])).toBeNull();
    expect(configTabForKey('Enter', CONFIG_TAB_IDS[2])).toBeNull();
  });
});
