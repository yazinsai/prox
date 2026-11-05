import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '@/i18n/locales/en.json';
import { ProviderOverview } from '@/features/providers/components/ProviderOverview';
import { ProviderResourceTable } from '@/features/providers/components/ProviderResourceTable';
import type { ProviderResource } from '@/features/providers/types';

const credential: ProviderResource = {
  id: 'claude-test',
  brand: 'claude',
  originalIndex: 0,
  name: null,
  identifier: 'sk-test…masked',
  apiKeyPreview: 'sk-test…masked',
  apiKey: 'sk-private-not-for-rendering',
  authIndex: 'fixture-credential',
  baseUrl: 'https://upstream.example',
  proxyUrl: null,
  prefix: 'team',
  modelCount: 2,
  models: ['claude-test-a', 'claude-test-b'],
  priority: 0,
  headerCount: 0,
  excludedModelCount: 0,
  apiKeyEntryCount: 1,
  disabled: true,
  flags: {},
  selector: { brand: 'claude', apiKey: 'sk-private-not-for-rendering', index: 0 },
  raw: {},
};

async function render(node: ReturnType<typeof createElement>) {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, node));
}

describe('provider design retains real credential data and actions', () => {
  test('provider tabs keep intrinsic widths inside their scroll container', () => {
    const css = readFileSync(
      'src/features/providers/components/ProviderCategoryList.module.scss',
      'utf8'
    );
    expect(css).toContain('overflow-x: auto');
    expect(css).toMatch(/\.aside,\s*\.list,\s*\.item\s*{\s*flex-shrink: 0;/);
  });
  test('overview includes empty brands and actual configured endpoints and model names', async () => {
    const markup = await render(
      createElement(ProviderOverview, {
        groups: [
          { id: 'claude', resources: [credential] },
          { id: 'gemini', resources: [] },
        ],
        onSelect: () => {},
      })
    );
    expect(markup).toContain('Claude');
    expect(markup).toContain('Gemini');
    expect(markup).toContain('https://upstream.example');
    expect(markup).toContain('claude-test-a');
    expect(markup).not.toContain(credential.apiKey!);
  });

  test('resource cards keep masked identity, disabled status, and every management action', async () => {
    const markup = await render(
      createElement(ProviderResourceTable, {
        resources: [credential],
        disableMutations: true,
        onView: () => {},
        onEdit: () => {},
        onDelete: () => {},
        onToggleDisabled: () => {},
      })
    );
    expect(markup).toContain('sk-test…masked');
    expect(markup).not.toContain(credential.apiKey!);
    expect(markup).toContain('claude-test-b');
    expect(markup).toContain('team');
    expect(markup).toContain(en.providersPage.status.disabled);
    for (const action of ['view', 'edit', 'delete', 'enable'] as const) {
      expect(markup).toContain(`aria-label="${en.providersPage.actions[action]}"`);
    }
    expect(markup).toContain('disabled=""');
  });
});
