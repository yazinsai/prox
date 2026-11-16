export interface Tool {
  id: string;
  to: string;
}

const CREDENTIAL_TOOLS: readonly Tool[] = [
  { id: 'credential_files', to: '/auth-files' },
  { id: 'model_exclusions', to: '/auth-files/oauth-excluded' },
  { id: 'model_aliases', to: '/auth-files/oauth-model-alias' },
];

const PLUGIN_TOOLS: readonly Tool[] = [
  { id: 'plugins', to: '/plugins' },
  { id: 'plugin_store', to: '/plugin-store' },
];

/** The tool links to show; plugin pages exist only when the backend supports plugins. */
export function settingsTools(supportsPlugin: boolean): readonly Tool[] {
  return supportsPlugin ? [...CREDENTIAL_TOOLS, ...PLUGIN_TOOLS] : CREDENTIAL_TOOLS;
}
