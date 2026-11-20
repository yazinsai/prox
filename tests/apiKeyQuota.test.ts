import { describe, expect, test } from 'bun:test';
import {
  buildApiKeyQuotaFiles,
  openAICompatProviderKey,
  readOpenAICompatQuotaCredentials,
} from '@/services/api/apiKeyQuota';
import {
  classifyQuotaFiles,
  mergeQuotaFiles,
  resolveQuotaTypeLabels,
} from '@/features/quota/logic';
import type { AuthFileItem, PluginListEntry } from '@/types';

const plugin = (extra: Partial<PluginListEntry>): PluginListEntry =>
  ({
    id: 'opencode-go-quota',
    registered: true,
    supportsQuota: true,
    quotaProvider: 'openai-compatible-opencode-go',
    metadata: { name: 'OpenCode Go' },
    ...extra,
  }) as PluginListEntry;

const config = {
  'api-keys': {
    'openai-compatibility': [
      {
        name: 'OpenCode-Go',
        'base-url': 'https://opencode.ai/inference/go/openai/v1',
        keys: [{ 'api-key': 'secret-a', auth_index: 'idx-a' }],
      },
      {
        name: 'venice',
        keys: [
          { 'api-key': 'secret-b', auth_index: 'idx-b' },
          { 'api-key': 'secret-c', auth_index: 'idx-c' },
          { 'api-key': 'secret-d' },
        ],
      },
      { name: 'off', disabled: true, keys: [{ 'api-key': 'secret-e', auth_index: 'idx-e' }] },
    ],
  },
};

describe('openai-compatibility API-key quota', () => {
  test('mirrors the backend provider key', () => {
    expect(openAICompatProviderKey(' OpenCode-Go ')).toBe('openai-compatible-opencode-go');
    expect(openAICompatProviderKey('openai-compatible-x')).toBe('openai-compatible-x');
    expect(openAICompatProviderKey('')).toBe('openai-compatibility');
  });

  test('reads enabled keys with their auth indexes', () => {
    const credentials = readOpenAICompatQuotaCredentials(config);
    expect(credentials.map((c) => [c.providerKey, c.authIndex, c.keyNumber])).toEqual([
      ['openai-compatible-opencode-go', 'idx-a', 1],
      ['openai-compatible-venice', 'idx-b', 1],
      ['openai-compatible-venice', 'idx-c', 2],
    ]);
  });

  test('keeps only keys claimed by a registered quota plugin, without exposing the key', () => {
    const credentials = readOpenAICompatQuotaCredentials(config);
    const files = buildApiKeyQuotaFiles(credentials, [
      plugin({}),
      plugin({ id: 'unregistered', registered: false, quotaProvider: 'openai-compatible-venice' }),
    ]);
    expect(files).toEqual([
      {
        name: 'OpenCode-Go',
        type: 'openai-compatible-opencode-go',
        provider: 'openai-compatible-opencode-go',
        authIndex: 'idx-a',
        supportsQuota: true,
        quotaProvider: 'openai-compatible-opencode-go',
        quotaPluginId: 'opencode-go-quota',
        quotaProviderName: 'OpenCode Go',
      },
    ]);
    expect(JSON.stringify(files)).not.toContain('secret');
    const entries = classifyQuotaFiles(files);
    expect(entries.map((entry) => entry.type)).toEqual(['plugin']);
    expect(resolveQuotaTypeLabels(entries)).toEqual({ plugin: 'OpenCode Go' });
  });

  test('numbers cards when a group has several quota keys', () => {
    const files = buildApiKeyQuotaFiles(readOpenAICompatQuotaCredentials(config), [
      plugin({ id: 'venice-quota', quotaProvider: 'openai-compatible-venice' }),
    ]);
    expect(files.map((f) => f.name)).toEqual(['venice #1', 'venice #2']);
  });

  test('merging keeps credential files first and drops duplicate auth indexes', () => {
    const fileEntry = { name: 'a.json', provider: 'codex', authIndex: 'idx-a' } as AuthFileItem;
    const extra = { name: 'OpenCode-Go', authIndex: 'idx-a' } as AuthFileItem;
    const other = { name: 'venice', authIndex: 'idx-b' } as AuthFileItem;
    expect(mergeQuotaFiles([fileEntry], [extra, other, other])).toEqual([fileEntry, other]);
    const files = [fileEntry];
    expect(mergeQuotaFiles(files, [])).toBe(files);
  });

  test('plugin label stays generic when plugin cards come from different providers', () => {
    const entry = (name?: string) => ({
      type: 'plugin' as const,
      file: { name: 'x', quotaProviderName: name } as AuthFileItem,
    });
    expect(resolveQuotaTypeLabels([entry('OpenCode Go'), entry('Other')])).toEqual({});
    expect(resolveQuotaTypeLabels([entry('OpenCode Go'), entry()])).toEqual({});
    expect(resolveQuotaTypeLabels([])).toEqual({});
  });
});
