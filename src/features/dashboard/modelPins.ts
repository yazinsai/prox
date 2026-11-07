const LIMIT = 4;

export function normalizeModelPins(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) return null;
  return [...new Set(value.map((id) => id.trim()).filter(Boolean))].slice(0, LIMIT);
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
