import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type SVGProps,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageTransition } from '@/components/common/PageTransition';
import { MainRoutes } from '@/router/MainRoutes';
import { pluginsApi } from '@/services/api';
import { IconSidebarSettings } from '@/components/ui/icons';
import proxMark from '@/assets/prox-mark.svg';
import {
  useAuthStore,
  useLoginTransitionStore,
  useConfigStore,
  useNotificationStore,
  useThemeStore,
} from '@/stores';
import {
  collectPluginResourceEntries,
  PLUGIN_RESOURCES_REFRESH_EVENT,
  type PluginResourceEntry,
} from '@/features/plugins/pluginResources';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import type { Theme } from '@/types';

interface TopNavItem {
  path: string;
  label: string;
  /** Plugin resource pages carry their own description as a tooltip. */
  title?: string;
}

const iconProps: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

const icons = {
  refresh: (
    <svg {...iconProps}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  ),
  sun: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  ),
  moon: (
    <svg {...iconProps}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  ),
  whiteTheme: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  ),
  autoTheme: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  ),
};

const THEME_CARDS: Array<{
  key: Theme;
  labelKey: string;
  colors: { bg: string; card: string; border: string; textMuted: string };
}> = [
  {
    key: 'auto',
    labelKey: 'theme.auto',
    colors: {
      bg: 'linear-gradient(135deg, #ffffff 0 50%, #111111 50% 100%)',
      card: 'linear-gradient(135deg, #ffffff 0 50%, #1a1a1a 50% 100%)',
      border: '#bdbdbd',
      textMuted: 'linear-gradient(135deg, #c9c9c9 0 50%, #5a5a5a 50% 100%)',
    },
  },
  {
    key: 'white',
    labelKey: 'theme.white',
    colors: { bg: '#ffffff', card: '#ffffff', border: '#e5e5e5', textMuted: '#a29c95' },
  },
  {
    key: 'light',
    labelKey: 'theme.light',
    colors: { bg: '#faf9f5', card: '#f0eee8', border: '#e3e1db', textMuted: '#a29c95' },
  },
  {
    key: 'dark',
    labelKey: 'theme.dark',
    colors: { bg: '#000000', card: '#0e0e0e', border: '#1c1c1c', textMuted: '#a0a0a0' },
  },
];

/** Close a popover on an outside press or Escape. */
function useMenuDismiss(
  open: boolean,
  menuRef: RefObject<HTMLDivElement | null>,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, menuRef, onClose]);
}

const normalizePath = (pathname: string) => {
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return trimmed === '/dashboard' ? '/' : trimmed;
};

/**
 * The app frame: one quiet bar across the top with the four everyday pages, and the page below
 * it at full width. Settings, refresh and theme sit at the bar's right edge; nothing else competes
 * with the page for space.
 */
export function MainLayout() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const location = useLocation();

  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);

  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);

  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [pluginResources, setPluginResources] = useState<PluginResourceEntry[]>([]);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  const arrivingFromLogin = useLoginTransitionStore((state) => state.phase === 'revealing');
  // The server log scrolls inside a full-height viewport; every other view scrolls the page.
  const isLogsPage =
    location.pathname === '/requests' &&
    new URLSearchParams(location.search).get('tab') === 'server';
  const isPluginResourcePage = location.pathname.startsWith('/plugin-pages');

  // Overlays and sticky elements offset themselves by the bar's measured height.
  useLayoutEffect(() => {
    const update = () => {
      const height = headerRef.current?.offsetHeight;
      if (height) document.documentElement.style.setProperty('--header-height', `${height}px`);
    };
    update();
    const observer =
      typeof ResizeObserver !== 'undefined' && headerRef.current
        ? new ResizeObserver(update)
        : null;
    if (observer && headerRef.current) observer.observe(headerRef.current);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // Bottom overlays (save bars) centre on the content column.
  useLayoutEffect(() => {
    const update = () => {
      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      document.documentElement.style.setProperty(
        '--content-center-x',
        `${rect.left + rect.width / 2}px`
      );
    };
    update();
    const observer =
      typeof ResizeObserver !== 'undefined' && contentRef.current
        ? new ResizeObserver(update)
        : null;
    if (observer && contentRef.current) observer.observe(contentRef.current);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--content-center-x');
    };
  }, []);

  const closeThemeMenu = useCallback(() => setThemeMenuOpen(false), []);
  useMenuDismiss(themeMenuOpen, themeMenuRef, closeThemeMenu);

  useEffect(() => {
    fetchConfig().catch(() => {
      // Ignore the initial failure; the login flow shows the user-facing prompt.
    });
  }, [fetchConfig]);

  const loadPluginResources = useCallback(async () => {
    if (connectionStatus !== 'connected' || !supportsPlugin) {
      setPluginResources([]);
      return;
    }
    try {
      const plugins = await pluginsApi.list();
      setPluginResources(collectPluginResourceEntries(plugins.plugins));
    } catch {
      setPluginResources([]);
    }
  }, [connectionStatus, supportsPlugin]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPluginResources(), 0);
    window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);
    };
  }, [apiBase, loadPluginResources]);

  const navItems: TopNavItem[] = [
    { path: '/', label: t('nav.overview') },
    { path: '/quota', label: t('nav.quota') },
    { path: '/accounts', label: t('nav.accounts') },
    { path: '/requests', label: t('nav.requests') },
    // Plugins that ship their own pages join the bar after the built-in ones.
    ...(supportsPlugin
      ? pluginResources.map((resource) => ({
          path: resource.route,
          label: resource.label,
          title: resource.description,
        }))
      : []),
  ];
  const navOrder = [...navItems.map((item) => item.path), '/settings'];

  const getRouteOrder = (pathname: string) => {
    const path = normalizePath(pathname);
    const exact = navOrder.indexOf(path);
    if (exact !== -1) return exact;
    const nested = navOrder.findIndex((item) => item !== '/' && path.startsWith(`${item}/`));
    return nested === -1 ? null : nested;
  };

  const getTransitionVariant = useCallback((fromPathname: string, toPathname: string) => {
    const isAuthFiles = (pathname: string) =>
      pathname === '/auth-files' || pathname.startsWith('/auth-files/');
    return isAuthFiles(normalizePath(fromPathname)) && isAuthFiles(normalizePath(toPathname))
      ? 'ios'
      : 'vertical';
  }, []);

  const handleRefreshAll = async () => {
    clearCache();
    const results = await Promise.allSettled([
      fetchConfig(true),
      loadPluginResources(),
      triggerHeaderRefresh(),
    ]);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && rejected.status === 'rejected') {
      const reason = rejected.reason;
      const message =
        typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
      showNotification(
        `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
      return;
    }
    showNotification(t('notification.data_refreshed'), 'success');
  };

  const host = apiBase.replace(/^https?:\/\//, '');
  const connectionTitle = [host, serverVersion, t(`common.${connectionStatus}`)]
    .filter(Boolean)
    .join(' · ');
  const themeIcon =
    theme === 'auto'
      ? icons.autoTheme
      : theme === 'dark'
        ? icons.moon
        : theme === 'white'
          ? icons.whiteTheme
          : icons.sun;

  return (
    <div
      className={`app-shell${isPluginResourcePage ? ' plugin-resource-shell' : ''}${
        arrivingFromLogin ? ' app-shell--arriving' : ''
      }`}
    >
      <header className="topbar" ref={headerRef}>
        <div className="topbar-inner">
          <NavLink to="/" className="topbar-brand" aria-label={t('nav.overview')}>
            <img src={proxMark} alt="" />
            <span>prox</span>
          </NavLink>

          <nav className="topbar-nav" aria-label={t('nav.main_navigation')}>
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                title={item.title}
                className={({ isActive }) => `topbar-link${isActive ? ' active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar-actions">
            {/* Silent while connected; the state is spelled out the moment it is not. */}
            <span
              className={`topbar-connection ${connectionStatus}`}
              title={connectionTitle}
              role="status"
            >
              <i className={`connection-dot ${connectionStatus}`} aria-hidden="true" />
              <span className={connectionStatus === 'connected' ? 'sr-only' : undefined}>
                {connectionStatus === 'connected'
                  ? connectionTitle
                  : t(`common.${connectionStatus}`)}
              </span>
            </span>
            <button
              type="button"
              className="topbar-icon topbar-icon-refresh"
              onClick={() => void handleRefreshAll()}
              title={t('header.refresh_all')}
              aria-label={t('header.refresh_all')}
            >
              {icons.refresh}
            </button>
            <div className={`theme-menu${themeMenuOpen ? ' open' : ''}`} ref={themeMenuRef}>
              <button
                type="button"
                className="topbar-icon"
                onClick={() => setThemeMenuOpen((open) => !open)}
                title={t('theme.switch')}
                aria-label={t('theme.switch')}
                aria-haspopup="menu"
                aria-expanded={themeMenuOpen}
              >
                {themeIcon}
              </button>
              {themeMenuOpen ? (
                <div className="theme-menu-popover" role="menu" aria-label={t('theme.switch')}>
                  {THEME_CARDS.map((card) => (
                    <button
                      key={card.key}
                      type="button"
                      className={`theme-card${theme === card.key ? ' active' : ''}`}
                      onClick={() => {
                        setTheme(card.key);
                        setThemeMenuOpen(false);
                      }}
                      role="menuitemradio"
                      aria-checked={theme === card.key}
                    >
                      <span
                        className="theme-card-preview"
                        style={{
                          background: card.colors.bg,
                          border: `1px solid ${card.colors.border}`,
                        }}
                      >
                        <span
                          className="theme-card-header"
                          style={{
                            background: card.colors.card,
                            borderBottom: `1px solid ${card.colors.border}`,
                          }}
                        />
                        <span className="theme-card-content">
                          <span
                            className="theme-card-line"
                            style={{ background: card.colors.textMuted }}
                          />
                          <span
                            className="theme-card-line short"
                            style={{ background: card.colors.textMuted }}
                          />
                        </span>
                      </span>
                      <span className="theme-card-label">{t(card.labelKey)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <NavLink
              to="/settings"
              className={({ isActive }) => `topbar-icon${isActive ? ' active' : ''}`}
              title={t('nav.settings')}
              aria-label={t('nav.settings')}
            >
              <IconSidebarSettings size={16} aria-hidden="true" />
            </NavLink>
          </div>
        </div>
      </header>

      <div
        className={`content${isLogsPage ? ' content-logs' : ''}${
          isPluginResourcePage ? ' content-plugin-resource' : ''
        }`}
        ref={contentRef}
      >
        <main
          className={`main-content${isLogsPage ? ' main-content-logs' : ''}${
            isPluginResourcePage ? ' main-content-plugin-resource' : ''
          }`}
        >
          <PageTransition
            render={(currentLocation) => <MainRoutes location={currentLocation} />}
            getRouteOrder={getRouteOrder}
            getTransitionVariant={getTransitionVariant}
            scrollContainerRef={contentRef}
          />
        </main>
      </div>
    </div>
  );
}
