import type { TFunction } from 'i18next';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { PROVIDER_LOGOS } from '@/features/providers/brandLogos';
import type { ProviderBrand } from '@/features/providers/types';
import type { ResolvedTheme } from '@/types';
import type { RoutingMember } from '@/types/routing';

const FAMILY_BRANDS: Record<string, ProviderBrand> = {
  gemini: 'gemini',
  interactions: 'interactions',
  codex: 'codex',
  meta: 'meta',
  xai: 'xai',
  claude: 'claude',
  vertex: 'vertex',
  'openai-compatibility': 'openaiCompatibility',
};

export function memberIcon(member: RoutingMember, theme: ResolvedTheme): string | null {
  if (member.kind === 'credential') return getAuthFileIcon(member.family, theme);
  const logo = PROVIDER_LOGOS[FAMILY_BRANDS[member.family]];
  if (!logo) return null;
  return theme === 'dark' && logo.darkSrc ? logo.darkSrc : logo.src;
}

/** "Claude · Subscription", "Codex · API key", "OpenAI-compatible · 2 keys". */
export function memberKindLabel(t: TFunction, member: RoutingMember): string {
  if (member.kind === 'credential') {
    return t(
      member.family === 'vertex' ? 'accounts.kind_service_account' : 'accounts.kind_subscription',
      { provider: getTypeLabel(t, member.family) }
    );
  }
  if (member.kind === 'compat') return t('accounts.kind_compat', { count: member.keyCount });
  const brand = FAMILY_BRANDS[member.family];
  return t('accounts.kind_api_key', {
    provider: brand ? t(`providersPage.providerNames.${brand}`) : member.family,
  });
}
