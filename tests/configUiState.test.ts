import { describe, expect, test } from 'bun:test';
import { CONFIG_SECTION_IDS, FIELD_VALUE_KEYS } from '@/features/config/constants';
import {
  CONFIG_FIELD_SEARCH_INDEX,
  findConfigFieldById,
  searchConfigFields,
} from '@/features/config/searchIndex';
import {
  buildHeaderMeta,
  countSectionErrors,
  countTotalErrors,
  resolveDirtyTabs,
  resolveStatus,
  type ConfigStatusInput,
} from '@/features/config/uiState';
import type { VisualConfigValidationErrors } from '@/types/visualConfig';
import { LANGUAGE_ORDER } from '@/utils/constants';

const statusInput = (overrides: Partial<ConfigStatusInput> = {}): ConfigStatusInput => ({
  disconnected: false,
  loading: false,
  loadFailed: false,
  yamlError: false,
  validationBlocked: false,
  saving: false,
  dirty: false,
  ...overrides,
});

describe('resolveStatus', () => {
  test('follows the legacy precedence chain top-down', () => {
    // disconnected > loading > load_failed > yaml_error > validation_blocked > saving > dirty > synced
    expect(resolveStatus(statusInput({ disconnected: true, loading: true })).key).toBe(
      'disconnected'
    );
    expect(resolveStatus(statusInput({ loading: true, loadFailed: true })).key).toBe('loading');
    expect(resolveStatus(statusInput({ loadFailed: true, yamlError: true })).key).toBe(
      'load_failed'
    );
    expect(resolveStatus(statusInput({ yamlError: true, validationBlocked: true })).key).toBe(
      'yaml_error'
    );
    expect(resolveStatus(statusInput({ validationBlocked: true, saving: true })).key).toBe(
      'validation_blocked'
    );
    expect(resolveStatus(statusInput({ saving: true, dirty: true })).key).toBe('saving');
    expect(resolveStatus(statusInput({ dirty: true })).key).toBe('dirty');
    expect(resolveStatus(statusInput()).key).toBe('synced');
  });

  test('validation_blocked short key lives at config_management top level (regression: old .visual. path bug)', () => {
    const status = resolveStatus(statusInput({ validationBlocked: true }));
    expect(status.shortLabelKey).toBe('config_management.validation_blocked_short');
    expect(status.labelKey).toBe('config_management.visual.validation.validation_blocked');
    expect(status.tone).toBe('error');
  });

  test('every status resolves label keys that exist in all supported locales', async () => {
    const locales = LANGUAGE_ORDER;
    const inputs: Partial<ConfigStatusInput>[] = [
      { disconnected: true },
      { loading: true },
      { loadFailed: true },
      { yamlError: true },
      { validationBlocked: true },
      { saving: true },
      { dirty: true },
      {},
    ];
    for (const locale of locales) {
      const json = (await Bun.file(`src/i18n/locales/${locale}.json`).json()) as Record<
        string,
        unknown
      >;
      const resolveKey = (path: string): unknown =>
        path.split('.').reduce<unknown>((node, part) => {
          if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
          return undefined;
        }, json);
      for (const overrides of inputs) {
        const status = resolveStatus(statusInput(overrides));
        expect(typeof resolveKey(status.labelKey)).toBe('string');
        expect(typeof resolveKey(status.shortLabelKey)).toBe('string');
      }
    }
  });
});

describe('countSectionErrors', () => {
  test('buckets field errors by section', () => {
    const errors: VisualConfigValidationErrors = {
      port: 'port_range',
      requestRetry: 'non_negative_integer',
      'streaming.keepaliveSeconds': 'non_negative_integer',
    };
    const counts = countSectionErrors(errors, false);
    expect(counts.connectivity).toBe(1);
    expect(counts.network).toBe(1);
    expect(counts.streaming).toBe(1);
    expect(counts.logging).toBe(0);
    expect(counts).not.toHaveProperty('quota');
    expect(counts.advanced).toBe(0);
    expect(counts.payload).toBe(0);
    expect(counts.connect).toBe(0);
  });

  test('payload flag adds one to the payload tab only', () => {
    const counts = countSectionErrors(undefined, true);
    expect(counts.payload).toBe(1);
    expect(counts.connectivity).toBe(0);
  });

  test('undefined error entries do not count', () => {
    const errors: VisualConfigValidationErrors = { port: undefined };
    const counts = countSectionErrors(errors, false);
    expect(counts.connectivity).toBe(0);
  });
});

describe('countTotalErrors', () => {
  test('sums field errors plus the payload flag', () => {
    const errors: VisualConfigValidationErrors = {
      port: 'port_range',
      maxRetryInterval: 'non_negative_integer',
      logsMaxTotalSizeMb: undefined,
    };
    expect(countTotalErrors(errors, false)).toBe(2);
    expect(countTotalErrors(errors, true)).toBe(3);
    expect(countTotalErrors(undefined, false)).toBe(0);
  });
});

describe('resolveDirtyTabs', () => {
  test('maps dirty value keys to their canonical sections', () => {
    const tabs = resolveDirtyTabs(new Set(['rmSecretKey', 'streaming.bootstrapRetries']));
    expect(tabs.has('connectivity')).toBe(true);
    expect(tabs.has('streaming')).toBe(true);
    expect(tabs.size).toBe(2);
  });

  test('client API keys light Connect only', () => {
    expect([...resolveDirtyTabs(new Set(['apiKeysText']))]).toEqual(['connect']);

    expect([...resolveDirtyTabs(new Set(['quotaAntigravityCredits']))]).toEqual(['advanced']);
    expect(resolveDirtyTabs(new Set(['quotaSwitchProject', 'quotaSwitchPreviewModel'])).size).toBe(
      0
    );
  });

  test('unknown keys are ignored instead of crashing', () => {
    const tabs = resolveDirtyTabs(new Set(['not-a-real-key']));
    expect(tabs.size).toBe(0);
  });
});

describe('Antigravity credits UI and search', () => {
  test('removes the quota section', () => {
    expect(CONFIG_SECTION_IDS).not.toContain('quota');
    expect(CONFIG_FIELD_SEARCH_INDEX.some((entry) => String(entry.sectionId) === 'quota')).toBe(
      false
    );
    for (const field of ['quotaSwitchProject', 'quotaSwitchPreviewModel']) {
      expect(findConfigFieldById(field)).toBeUndefined();
      expect(FIELD_VALUE_KEYS).not.toHaveProperty(field);
    }
    for (const query of ['switch-project', 'switch-preview-model', 'quota-exceeded']) {
      expect(searchConfigFields(query, (key) => key)).toEqual([]);
    }
  });

  test('credits search targets Advanced in every locale', async () => {
    const entry = findConfigFieldById('quotaAntigravityCredits');
    expect(entry?.sectionId).toBe('advanced');
    expect(entry?.labelKey).toBe('config_management.visual.sections.advanced.antigravity_credits');
    for (const locale of LANGUAGE_ORDER) {
      const json = await Bun.file(`src/i18n/locales/${locale}.json`).json();
      const sections = json.config_management.visual.sections;
      expect(sections).not.toHaveProperty('quota');
      expect(typeof sections.advanced.antigravity_credits).toBe('string');
      const translate = (key: string): string =>
        key === entry?.labelKey ? sections.advanced.antigravity_credits : key;
      for (const query of [sections.advanced.antigravity_credits, 'antigravity-credits']) {
        expect(searchConfigFields(query, translate)).toContainEqual(entry);
      }
    }
  });

  test('renders credits inside the Advanced Antigravity group, not common', async () => {
    const root = 'src/features/config';
    const advanced = await Bun.file(`${root}/components/sections/SectionAdvanced.tsx`).text();
    const group = advanced.slice(
      advanced.indexOf("label={t('config_management.visual.sections.advanced.antigravity_title')}"),
      advanced.indexOf("label={t('config_management.visual.sections.advanced.devin_title')}")
    );
    expect(group).toContain('fieldId="quotaAntigravityCredits"');
    expect(group).toContain('checked={values.quotaAntigravityCredits}');
    expect(group).toContain(
      'onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}'
    );
    expect(group).toContain('config_management.visual.sections.advanced.antigravity_credits');
    for (const file of ['components/fields/sharedFields.tsx', '../settings/SettingsPage.tsx']) {
      const source = await Bun.file(`${root}/${file}`).text();
      expect(source).not.toMatch(/QuotaSwitch|quotaSwitch|SectionQuota|case 'quota'/);
    }
    expect(await Bun.file(`${root}/components/sections/SectionQuota.tsx`).exists()).toBe(false);
  });
});

describe('buildHeaderMeta', () => {
  const base = {
    status: resolveStatus(statusInput()),
    dirtyCount: 0,
    sourceDirty: false,
    errorCount: 0,
  };

  test('blocking statuses come directly from the page status machine', () => {
    for (const key of ['disconnected', 'loading', 'load_failed'] as const) {
      const status = resolveStatus(
        statusInput({
          disconnected: key === 'disconnected',
          loading: key === 'loading',
          loadFailed: key === 'load_failed',
        })
      );
      const meta = buildHeaderMeta({ ...base, status, dirtyCount: 3 });
      expect(meta.map((segment) => segment.key)).toEqual([key]);
    }
  });

  test('clean state ends with a synced segment', () => {
    const meta = buildHeaderMeta(base);
    expect(meta.map((segment) => segment.key)).toEqual(['synced']);
    expect(meta[0].tone).toBe('ok');
  });

  test('dirty and errors stack in order', () => {
    const status = resolveStatus(statusInput({ validationBlocked: true, dirty: true }));
    const meta = buildHeaderMeta({ ...base, status, dirtyCount: 3, errorCount: 2 });
    expect(meta.map((segment) => segment.key)).toEqual(['dirty', 'errors']);
    expect(meta[0].count).toBe(3);
    expect(meta[0].tone).toBe('warning');
    expect(meta[1].count).toBe(2);
    expect(meta[1].tone).toBe('error');
  });

  test('source dirty supersedes the visual dirty count', () => {
    const status = resolveStatus(statusInput({ dirty: true }));
    const meta = buildHeaderMeta({ ...base, status, dirtyCount: 3, sourceDirty: true });
    expect(meta.map((segment) => segment.key)).toEqual(['dirty_source']);
  });

  test('yaml error shows without a synced tail', () => {
    const status = resolveStatus(statusInput({ yamlError: true }));
    const meta = buildHeaderMeta({ ...base, status });
    expect(meta.map((segment) => segment.key)).toEqual(['yaml_error']);
  });
});
