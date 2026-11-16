import type { ProviderGroup, ProviderResource } from '@/features/providers/types';
import type { RoutingMember, RoutingModelCatalog } from '@/types/routing';

/**
 * The provider resource a configured routing member edits through.
 *
 * Both models read the same configuration: an API key member is one key of a family, matched by
 * the key itself; an OpenAI-compatible member is one provider, matched by position and name.
 * Credentials have no provider resource.
 */
export function resourceForMember(
  member: RoutingMember,
  groups: readonly ProviderGroup[]
): ProviderResource | null {
  const location = member.location;
  if (location.kind === 'apiKey') {
    const group = groups.find((candidate) => candidate.id === location.family);
    const matches = group?.resources.filter((resource) => resource.apiKey === location.apiKey);
    if (!matches?.length) return null;
    return matches.find((resource) => resource.name === member.name) ?? matches[0];
  }
  if (location.kind === 'compat') {
    const group = groups.find((candidate) => candidate.id === 'openaiCompatibility');
    return (
      group?.resources.find(
        (resource) =>
          resource.originalIndex === location.groupIndex && (resource.name ?? '') === location.name
      ) ??
      group?.resources.find((resource) => (resource.name ?? '') === location.name) ??
      null
    );
  }
  return null;
}

/** The models a member answers, or null while its list is still loading. */
export function memberModels(member: RoutingMember, catalog: RoutingModelCatalog): string[] | null {
  const source = member.modelSource;
  const models =
    source.type === 'list'
      ? source.models
      : source.type === 'channel'
        ? catalog.channels[source.channel]
        : source.type === 'credential'
          ? catalog.credentials[source.name]
          : [];
  if (models === undefined || models === null) return models === null ? [] : null;
  return [...new Set(models)].sort((a, b) => a.localeCompare(b));
}
