/** Provider-specific catalog names for the same model, used only for presentation. */
const MODEL_IDENTITIES: Record<string, { id: string; label: string }> = {
  'claude-sonnet-5-5': { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  'claude-opus-5-5': { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  'gemini-4-argon': { id: 'gemini-4-argon', label: 'Gemini 4 Argon' },
  'gemini-3.8-flash': { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
};

export function modelIdentity(id: string): { id: string; label?: string } {
  // Preserve namespaces and arbitrary aliases: these can have different routing policies.
  const key = Object.prototype.hasOwnProperty.call(MODEL_IDENTITIES, id)
    ? id
    : id.replace(/-high$/, '');
  const identity = Object.prototype.hasOwnProperty.call(MODEL_IDENTITIES, key)
    ? MODEL_IDENTITIES[key]
    : undefined;
  return identity ?? { id };
}

export function modelLabel(id: string, models: readonly { id: string; label: string }[]): string {
  const identity = modelIdentity(id);
  return models.find((model) => model.id === identity.id)?.label ?? identity.label ?? id;
}
