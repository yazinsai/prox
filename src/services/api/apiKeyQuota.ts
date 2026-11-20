/**
 * Config-backed API keys that a backend quota plugin can report usage for.
 *
 * Config API keys are not credential files, so `GET /credentials` never lists
 * them. The v8 config read annotates each key with its runtime `auth_index`,
 * which is all `POST /plugins/:id/quota` needs.
 */

import { apiClient } from './client';
import { pluginsApi } from './plugins';
import { readProviderGroups } from './providers';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isRecord } from '@/utils/helpers';
import type { AuthFileItem, PluginListEntry } from '@/types';

export interface OpenAICompatQuotaCredential {
  /** Provider group name from `api-keys.openai-compatibility[].name`. */
  name: string;
  /** Runtime provider key, matching the backend's OpenAICompatibleProviderKey. */
  providerKey: string;
  authIndex: string;
  /** Position among the group's keys, used to label groups with several keys. */
  keyNumber: number;
  keyCount: number;
}

const OPENAI_COMPAT_FAMILY = 'openai-compatibility';
const OPENAI_COMPAT_PREFIX = 'openai-compatible-';

/** Mirror of backend util.OpenAICompatibleProviderKey. */
export const openAICompatProviderKey = (name: string): string => {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return OPENAI_COMPAT_FAMILY;
  if (normalized === OPENAI_COMPAT_FAMILY || normalized.startsWith(OPENAI_COMPAT_PREFIX)) {
    return normalized;
  }
  return OPENAI_COMPAT_PREFIX + normalized;
};

const isDisabled = (value: unknown) => value === true || value === 'true';

/** Read enabled openai-compatibility keys and their auth indexes from a v8 config payload. */
export const readOpenAICompatQuotaCredentials = (raw: unknown): OpenAICompatQuotaCredential[] =>
  readProviderGroups(raw, OPENAI_COMPAT_FAMILY).flatMap((group) => {
    if (isDisabled(group.disabled)) return [];
    const name = typeof group.name === 'string' ? group.name.trim() : '';
    const providerKey = openAICompatProviderKey(name);
    const keys = (group.keys as unknown[]).filter(isRecord);
    return keys.flatMap((key, index) => {
      if (isDisabled(key.disabled)) return [];
      const authIndex = normalizeAuthIndex(key['auth_index']);
      if (!authIndex) return [];
      return [
        {
          name: name || providerKey,
          providerKey,
          authIndex,
          keyNumber: index + 1,
          keyCount: keys.length,
        },
      ];
    });
  });

/**
 * Turn quota-capable config keys into the credential shape the Quota page renders.
 * Only keys whose provider key is claimed by a registered quota plugin are kept.
 */
export const buildApiKeyQuotaFiles = (
  credentials: readonly OpenAICompatQuotaCredential[],
  plugins: readonly PluginListEntry[]
): AuthFileItem[] => {
  const pluginByProvider = new Map<string, PluginListEntry>();
  plugins.forEach((plugin) => {
    const provider = plugin.quotaProvider?.trim().toLowerCase();
    if (!plugin.registered || !plugin.supportsQuota || !provider) return;
    if (!pluginByProvider.has(provider)) pluginByProvider.set(provider, plugin);
  });
  return credentials.flatMap((credential) => {
    const plugin = pluginByProvider.get(credential.providerKey);
    if (!plugin) return [];
    const providerName = plugin.metadata?.name?.trim();
    const name =
      credential.keyCount > 1 ? `${credential.name} #${credential.keyNumber}` : credential.name;
    return [
      {
        name,
        type: credential.providerKey,
        provider: credential.providerKey,
        authIndex: credential.authIndex,
        supportsQuota: true,
        quotaProvider: credential.providerKey,
        quotaPluginId: plugin.id,
        ...(providerName ? { quotaProviderName: providerName } : {}),
      },
    ];
  });
};

export const apiKeyQuotaApi = {
  /**
   * Config API keys with plugin-backed quota. Resolves to [] when plugins are
   * unavailable, so the Quota page never fails because of this optional source.
   */
  async listQuotaFiles(): Promise<AuthFileItem[]> {
    const plugins = await pluginsApi.list().then(
      (response) => response.plugins,
      () => [] as PluginListEntry[]
    );
    if (!plugins.some((plugin) => plugin.registered && plugin.supportsQuota)) return [];
    const raw = await apiClient.get('/config');
    return buildApiKeyQuotaFiles(readOpenAICompatQuotaCredentials(raw), plugins);
  },
};
