import { modelIdentity } from '@/utils/modelIdentity';

const LIMIT = 5;

export function normalizeModelPins(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) return null;
  return [...new Set(value.map((id) => modelIdentity(id.trim()).id).filter(Boolean))].slice(
    0,
    LIMIT
  );
}

export function readModelPins(connection: string): string[] | null {
  try {
    return normalizeModelPins(
      JSON.parse(localStorage.getItem(pinStorageKey(connection)) ?? 'null')
    );
  } catch {
    return null;
  }
}

export function pinStorageKey(connection: string): string {
  return `prox:dashboard:pins:${encodeURIComponent(connection)}`;
}

/** Prefer the models in the Paper design when they are actually discovered. */
export function defaultModelPins(discovered: readonly string[]): string[] {
  const choices = [
    ['claude-opus-5-5'],
    ['gpt-6.1-sol'],
    ['gpt-6-astra'],
    ['devin/deepseek-v4-1-flash-1017', 'deepseek-v4.1-flash'],
  ];
  const preferred = choices.flatMap((variants) => {
    const id = variants.find((candidate) => discovered.includes(candidate));
    return id ? [id] : [];
  });
  return [...new Set([...preferred, ...discovered])].slice(0, LIMIT);
}
