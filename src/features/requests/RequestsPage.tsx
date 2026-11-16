import { useCallback, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/useAuthStore';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { LogsPage } from '@/features/logs/LogsPage';
import { useRequestHistory } from './hooks/useRequestHistory';
import { RequestHistory } from './components/RequestHistory';
import { readRequestsView, writeRequestsView, type RequestsTab, type RequestsView } from './params';
import styles from './RequestsPage.module.scss';

const TABS: RequestsTab[] = ['history', 'server'];

/**
 * What happened to my requests, and why did one fail? History lists completed requests with
 * their outcome and opens each one; the server log is the raw proxy output behind them.
 * The whole view lives in the URL so the overview can link straight to, say, the last hour's
 * failures.
 */
export function RequestsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const view = readRequestsView(params);
  const id = useId();
  const tabRefs = useRef<Record<RequestsTab, HTMLButtonElement | null>>({
    history: null,
    server: null,
  });

  const change = useCallback(
    (next: Partial<RequestsView>) => {
      // Switching tabs is navigation (Back returns); filters replace the entry.
      setParams((current) => writeRequestsView(current, next), {
        replace: next.tab === undefined,
      });
    },
    [setParams]
  );

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(view.tab);
    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowLeft'
        ? TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
        : event.key === 'Home'
          ? TABS[0]
          : event.key === 'End'
            ? TABS[TABS.length - 1]
            : null;
    if (!target) return;
    event.preventDefault();
    if (target !== view.tab) change({ tab: target });
    tabRefs.current[target]?.focus();
  };

  return (
    <div className={styles.page} data-tab={view.tab}>
      <header className={styles.pageHead}>
        <h1>{t('requests_page.title')}</h1>
        <div className={styles.tabs} role="tablist" aria-label={t('requests_page.title')}>
          {TABS.map((tab) => (
            <button
              key={tab}
              ref={(node) => {
                tabRefs.current[tab] = node;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${tab}`}
              aria-selected={view.tab === tab}
              aria-controls={`${id}-panel-${tab}`}
              tabIndex={view.tab === tab ? 0 : -1}
              onClick={() => {
                if (view.tab !== tab) change({ tab });
              }}
              onKeyDown={onTabKeyDown}
            >
              {t(`requests_page.tab_${tab}`)}
            </button>
          ))}
        </div>
      </header>

      <div
        role="tabpanel"
        id={`${id}-panel-${view.tab}`}
        aria-labelledby={`${id}-tab-${view.tab}`}
        className={view.tab === 'server' ? styles.serverPanel : styles.historyPanel}
      >
        {view.tab === 'server' ? (
          <LogsPage embedded />
        ) : (
          <HistoryTab view={view} onChange={change} />
        )}
      </div>
    </div>
  );
}

function HistoryTab({
  view,
  onChange,
}: {
  view: RequestsView;
  onChange: (change: Partial<RequestsView>) => void;
}) {
  const connected = useAuthStore((state) => state.connectionStatus === 'connected');
  const history = useRequestHistory(view.window, view.status);
  useHeaderRefresh(history.refresh, connected);
  return <RequestHistory view={view} history={history} onChange={onChange} />;
}
