import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { CONFIG_SECTION_IDS } from '@/features/config/constants';
import { clientEndpoints } from '@/features/config/clientEndpoints';
import { SettingsNav } from '@/features/settings/components/SettingsNav';
import { ToolsPanel } from '@/features/settings/components/ToolsPanel';
import { settingsTools } from '@/features/settings/tools';
import { AppearancePanel } from '@/features/settings/components/AppearancePanel';
import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTION_IDS,
  isVisualConfigSection,
  parseSettingsSection,
} from '@/features/settings/sections';
import { compareVersions } from '@/features/settings/version';
import { LANGUAGE_ORDER } from '@/utils/constants';

const noop = () => {};
const en = i18n.cloneInstance({ lng: 'en' });

describe('settings sections', () => {
  test('Connect comes first and is the default', () => {
    expect(DEFAULT_SETTINGS_SECTION).toBe('connect');
    expect(SETTINGS_SECTION_IDS[0]).toBe('connect');
  });

  test('every config section is listed once, followed by the YAML source', () => {
    const proxy = SETTINGS_NAV_GROUPS.find((group) => group.id === 'proxy')!;
    expect(proxy.items.at(-1)).toBe('source');
    expect(new Set(SETTINGS_SECTION_IDS).size).toBe(SETTINGS_SECTION_IDS.length);
    for (const id of CONFIG_SECTION_IDS) expect(SETTINGS_SECTION_IDS).toContain(id);
    expect(SETTINGS_SECTION_IDS).toEqual(
      expect.arrayContaining(['source', 'appearance', 'tools', 'about'])
    );
  });

  test('?section= values parse, and stale ones fall back to Connect', () => {
    expect(parseSettingsSection('about')).toBe('about');
    expect(parseSettingsSection('payload')).toBe('payload');
    for (const stale of ['common', 'system', '', null]) {
      expect(parseSettingsSection(stale)).toBe('connect');
    }
  });

  test('only config sections need the visual editor', () => {
    expect(isVisualConfigSection('connect')).toBe(true);
    expect(isVisualConfigSection('network')).toBe(true);
    for (const id of ['source', 'appearance', 'tools', 'about'] as const) {
      expect(isVisualConfigSection(id)).toBe(false);
    }
  });

  test('every nav label and group exists in all locales', () => {
    for (const language of LANGUAGE_ORDER) {
      const t = i18n.getFixedT(language);
      for (const id of SETTINGS_SECTION_IDS) {
        expect(i18n.exists(`settings_page.nav.${id}`, { lng: language, fallbackLng: [] })).toBe(
          true
        );
        expect(t(`settings_page.nav.${id}`)).not.toBe(`settings_page.nav.${id}`);
      }
      for (const group of SETTINGS_NAV_GROUPS) {
        if (group.labelKey) {
          expect(i18n.exists(group.labelKey, { lng: language, fallbackLng: [] })).toBe(true);
        }
      }
    }
  });
});

describe('settings navigation', () => {
  const render = (props: Partial<Parameters<typeof SettingsNav>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(SettingsNav, {
        active: 'network',
        errorCounts: {},
        dirtySections: new Set(),
        onSelect: noop,
        ...props,
      })
    );

  test('marks the current section and announces errors and unsaved edits', () => {
    const markup = render({ errorCounts: { streaming: 2 }, dirtySections: new Set(['streaming']) });
    expect(markup).toContain(
      `aria-current="page" aria-label="${i18n.t('settings_page.nav.network')}"`
    );
    const label = [
      i18n.t('settings_page.nav.streaming'),
      i18n.t('config_management.meta_errors', { count: 2 }),
      i18n.t('config_management.status_dirty_short'),
    ].join(', ');
    expect(markup).toContain(`aria-label="${label}"`);
  });

  test('offers a labelled select for narrow screens with the same sections', () => {
    const markup = render();
    expect(markup).toContain('<select');
    expect(markup.match(/<option /g)).toHaveLength(SETTINGS_SECTION_IDS.length);
    expect(markup).toMatch(/<label[^>]*for="([^"]+)"[\s\S]*<select[^>]*id="\1"/);
  });

  test('locks only visual sections while the config saves or loads', () => {
    const markup = render({ disabled: true });
    const button = (id: string) =>
      markup.match(
        new RegExp(`<button[^>]*aria-label="${i18n.t(`settings_page.nav.${id}`)}"[^>]*>`)
      )?.[0];
    expect(button('payload')).toContain('disabled=""');
    expect(button('about')).not.toContain('disabled');
    expect(button('source')).not.toContain('disabled');
  });
});

describe('connect', () => {
  test('derives the OpenAI and Anthropic base URLs from the connection', () => {
    expect(clientEndpoints('http://localhost:8317/')).toEqual({
      openai: 'http://localhost:8317/v1',
      anthropic: 'http://localhost:8317',
    });
    expect(clientEndpoints('localhost:8317/v8/management')?.openai).toBe(
      'http://localhost:8317/v1'
    );
    expect(clientEndpoints('')).toBeNull();
  });
});

describe('tools and appearance', () => {
  const renderTools = () =>
    renderToStaticMarkup(
      createElement(MemoryRouter, null, createElement(ToolsPanel, { animateIn: false }))
    );

  test('lists the credential tools, and plugin pages only when the backend has plugins', () => {
    const markup = renderTools();
    for (const href of [
      '/auth-files',
      '/auth-files/oauth-excluded',
      '/auth-files/oauth-model-alias',
    ]) {
      expect(markup).toContain(`href="${href}"`);
    }
    expect(markup).not.toContain('href="/plugins"');
    expect(settingsTools(true).map((tool) => tool.to)).toEqual([
      '/auth-files',
      '/auth-files/oauth-excluded',
      '/auth-files/oauth-model-alias',
      '/plugins',
      '/plugin-store',
    ]);
    for (const tool of settingsTools(true)) {
      expect(en.exists(`settings_page.tools.${tool.id}`)).toBe(true);
      expect(en.exists(`settings_page.tools.${tool.id}_desc`)).toBe(true);
    }
  });

  test('theme and language are native radio groups, each language named in itself', () => {
    const markup = renderToStaticMarkup(createElement(AppearancePanel, { animateIn: false }));
    expect(markup.match(/name="settings-theme"/g)).toHaveLength(4);
    expect(markup.match(/name="settings-language"/g)).toHaveLength(LANGUAGE_ORDER.length);
    expect(markup).toContain('<legend');
    for (const name of [
      '简体中文',
      '繁體中文',
      'English',
      'Русский',
      'Tiếng Việt',
      '한국어',
      'Türkçe',
    ]) {
      expect(markup).toContain(name);
    }
  });
});

describe('about', () => {
  test('compares proxy versions, including fork build suffixes', () => {
    expect(compareVersions('v8.0.57', 'v8.0.56-14-gb435c88a+archive')).toBe(1);
    expect(compareVersions('v8.0.56', 'v8.0.56-14-gb435c88a+archive')).toBe(-1);
    expect(compareVersions('8.1.0', 'v8.1.0')).toBe(0);
    expect(compareVersions('', 'v8.1.0')).toBeNull();
  });
});

describe('settings page contract', () => {
  const page = readFileSync('src/features/settings/SettingsPage.tsx', 'utf8');

  test('section switches stay on the page; only leaving it asks about unsaved edits', () => {
    expect(page).toContain('currentLocation.pathname !== nextLocation.pathname');
    expect(page).toContain('{ replace: true }');
    expect(page).toContain("next.delete('field')");
  });

  test('removes the sponsor link and the old pages', () => {
    const shared = readFileSync('src/features/config/components/fields/sharedFields.tsx', 'utf8');
    expect(shared).not.toMatch(/sponsor/i);
    for (const removed of [
      'src/pages/SystemPage.tsx',
      'src/features/config/ConfigPage.tsx',
      'src/features/config/components/sections/SectionCommon.tsx',
      'src/features/config/sponsors.ts',
    ]) {
      expect(() => readFileSync(removed)).toThrow();
    }
  });

  test('styles respect reduced motion', () => {
    for (const file of [
      'src/features/settings/SettingsPage.module.scss',
      'src/features/settings/components/SettingsNav.module.scss',
      'src/features/settings/components/SettingsPanels.module.scss',
    ]) {
      expect(readFileSync(file, 'utf8')).toContain('@media (prefers-reduced-motion: reduce)');
    }
  });

  test('English copy reads as plain language', () => {
    expect(en.t('settings_page.connect.title')).toBe('Connect a client');
    expect(en.t('config_management.visual.api_keys.label')).toBe('Client API keys');
  });
});
