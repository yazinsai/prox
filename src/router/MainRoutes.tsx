import { Navigate, useRoutes, type Location } from 'react-router-dom';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { RequestsPage } from '@/features/requests/RequestsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AuthFilesPage } from '@/features/authFiles/AuthFilesPage';
import { AuthFilesOAuthExcludedEditPage } from '@/pages/AuthFilesOAuthExcludedEditPage';
import { AuthFilesOAuthModelAliasEditPage } from '@/pages/AuthFilesOAuthModelAliasEditPage';
import { QuotaPage } from '@/features/quota/QuotaPage';
import { PluginResourcePage } from '@/features/plugins/PluginResourcePage';
import { PluginsPage } from '@/features/plugins/PluginsPage';
import { PluginStorePage } from '@/features/plugins/PluginStorePage';
import { useAuthStore } from '@/stores';

/**
 * Four everyday pages (overview, quota, accounts, requests) and settings. Older addresses
 * redirect to the page that now answers the same question; credential files, model rules and
 * plugins stay reachable from settings and the accounts menu.
 */
const createMainRoutes = (supportsPlugin: boolean) => [
  { path: '/', element: <DashboardPage /> },
  { path: '/dashboard', element: <Navigate to="/" replace /> },
  { path: '/quota', element: <QuotaPage /> },
  { path: '/accounts', element: <AccountsPage /> },
  { path: '/requests', element: <RequestsPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/auth-files', element: <AuthFilesPage /> },
  { path: '/auth-files/oauth-excluded', element: <AuthFilesOAuthExcludedEditPage /> },
  { path: '/auth-files/oauth-model-alias', element: <AuthFilesOAuthModelAliasEditPage /> },
  { path: '/routing', element: <Navigate to="/accounts" replace /> },
  { path: '/oauth', element: <Navigate to="/accounts?add=1" replace /> },
  { path: '/ai-providers/*', element: <Navigate to="/accounts" replace /> },
  { path: '/quick-start/*', element: <Navigate to="/accounts" replace /> },
  { path: '/logs', element: <Navigate to="/requests?tab=server" replace /> },
  { path: '/config', element: <Navigate to="/settings" replace /> },
  { path: '/api-keys', element: <Navigate to="/settings" replace /> },
  { path: '/system', element: <Navigate to="/settings?section=about" replace /> },
  ...(supportsPlugin
    ? [
        { path: '/plugin-pages/:pluginId/:menuIndex', element: <PluginResourcePage /> },
        { path: '/plugins', element: <PluginsPage /> },
        { path: '/plugin-store', element: <PluginStorePage /> },
        { path: '/plugins/*', element: <Navigate to="/plugins" replace /> },
      ]
    : [
        { path: '/plugin-pages/*', element: <Navigate to="/" replace /> },
        { path: '/plugins/*', element: <Navigate to="/" replace /> },
        { path: '/plugin-store', element: <Navigate to="/" replace /> },
      ]),
  { path: '*', element: <Navigate to="/" replace /> },
];

export function MainRoutes({ location }: { location?: Location }) {
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);
  return useRoutes(createMainRoutes(supportsPlugin), location);
}
