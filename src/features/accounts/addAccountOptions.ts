import type { ProviderBrand } from '@/features/providers/types';

/** API key families, most common first. Sponsor brands are not offered here. */
export const API_KEY_BRANDS: ProviderBrand[] = [
  'claude',
  'codex',
  'gemini',
  'openaiCompatibility',
  'xai',
  'vertex',
  'meta',
  'interactions',
];

/** OAuth provider that issues credentials of a family, for "sign in again". */
export const OAUTH_PROVIDER_FOR_FAMILY: Record<string, string> = {
  claude: 'anthropic',
  codex: 'codex',
  antigravity: 'antigravity',
  xai: 'xai',
  meta: 'meta',
  devin: 'devin',
  kimi: 'kimi',
};
