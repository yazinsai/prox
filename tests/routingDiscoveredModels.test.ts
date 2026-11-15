import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { buildRoutingBoard, routingApi } from '../src/services/api/routing';

const compatRaw = (discovery?: unknown) => ({
  'api-keys': {
    'openai-compatibility': [
      {
        name: 'OpenCode-Go',
        'base-url': 'https://opencode.example/v1',
        keys: [{ 'api-key': 'sk-test' }],
        models: [
          { name: 'deepseek-v4.1-flash', alias: 'deepseek-v4.1-flash' },
          { name: 'deepseek-v4.1-flash', alias: 'codex-auto-review' },
        ],
        ...(discovery === undefined ? {} : { 'models-discovery': discovery }),
      },
    ],
  },
});

const discovered = { 'opencode-go': ['DeepSeek-V4.1-Flash', 'gpt-6-luna', 'kimi-k3'] };

describe('compat model discovery on the routing board', () => {
  test('an enabled provider offers configured aliases plus discovered models', () => {
    const member = buildRoutingBoard(compatRaw({ enabled: true }), [], discovered).members[0];
    expect(member.modelSource).toEqual({
      type: 'list',
      models: ['deepseek-v4.1-flash', 'codex-auto-review', 'gpt-6-luna', 'kimi-k3'],
    });
  });

  test('a provider without discovery keeps its configured list', () => {
    for (const discovery of [undefined, { enabled: false }]) {
      const member = buildRoutingBoard(compatRaw(discovery), [], discovered).members[0];
      expect(member.modelSource).toEqual({
        type: 'list',
        models: ['deepseek-v4.1-flash', 'codex-auto-review'],
      });
    }
  });
});

describe('routingApi.loadDiscoveredModels', () => {
  const restores: Array<{ mockRestore: () => void }> = [];
  afterEach(() => restores.splice(0).forEach((spy) => spy.mockRestore()));

  test('keys catalogs by lower-cased provider name and drops malformed entries', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({
      providers: [
        { name: 'OpenCode-Go', models: ['gpt-6-luna', '', 7] },
        { name: '', models: ['ignored'] },
        'bogus',
      ],
    });
    restores.push(get);
    expect(await routingApi.loadDiscoveredModels()).toEqual({ 'opencode-go': ['gpt-6-luna'] });
    expect(get).toHaveBeenCalledWith('/routing/discovered-models');
  });

  test('an older backend without the endpoint reports no catalogs', async () => {
    restores.push(spyOn(apiClient, 'get').mockRejectedValue(new Error('404')));
    expect(await routingApi.loadDiscoveredModels()).toEqual({});
  });
});
