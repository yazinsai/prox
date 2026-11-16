import { normalizeApiBase } from '@/utils/connection';

/** Client endpoints served by the proxy: OpenAI-style clients add `/v1`, Anthropic SDKs do not. */
export function clientEndpoints(apiBase: string): { openai: string; anthropic: string } | null {
  const origin = normalizeApiBase(apiBase);
  return origin ? { openai: `${origin}/v1`, anthropic: origin } : null;
}
