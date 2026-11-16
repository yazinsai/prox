import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, type BlockerFunction } from 'react-router-dom';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { IconRefreshCw } from '@/components/ui/icons';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useVisualConfig } from '@/hooks/useVisualConfig';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import { ConfigSearch } from '@/features/config/components/ConfigSearch';
import { DiffModal } from '@/features/config/components/DiffModal';
import { FloatingSaveBar } from '@/features/config/components/FloatingSaveBar';
import { SourcePanel, SourceSearchBar } from '@/features/config/components/SourcePanel';
import { SectionAdvanced } from '@/features/config/components/sections/SectionAdvanced';
import { SectionConnect } from '@/features/config/components/sections/SectionConnect';
import { SectionConnectivity } from '@/features/config/components/sections/SectionConnectivity';
import { SectionLogging } from '@/features/config/components/sections/SectionLogging';
import { SectionNetwork } from '@/features/config/components/sections/SectionNetwork';
import { SectionPayload } from '@/features/config/components/sections/SectionPayload';
import { SectionStreaming } from '@/features/config/components/sections/SectionStreaming';
import { RETIRED_STORAGE_KEYS, type ConfigEditorMode } from '@/features/config/constants';
import {
  shouldReloadVisualDraft,
  useConfigDocument,
} from '@/features/config/hooks/useConfigDocument';
import { useFieldJump } from '@/features/config/hooks/useFieldJump';
import { useSourceSearch } from '@/features/config/hooks/useSourceSearch';
import { findConfigFieldById } from '@/features/config/searchIndex';
import {
  buildHeaderMeta,
  countSectionErrors,
  countTotalErrors,
  resolveDirtyTabs,
  resolveStatus,
} from '@/features/config/uiState';
import { AboutPanel } from './components/AboutPanel';
import { AppearancePanel } from './components/AppearancePanel';
import { RequestLogCard } from './components/RequestLogCard';
import { SettingsNav } from './components/SettingsNav';
import { ToolsPanel } from './components/ToolsPanel';
import { isVisualConfigSection, parseSettingsSection, type SettingsSectionId } from './sections';
import styles from './SettingsPage.module.scss';

/** The first card fades in once; after this budget, switching sections mounts without motion. */
const ENTRANCE_BUDGET_MS = 800;

/**
 * Settings: client connection first, then the proxy configuration (visual sections and the raw
 * YAML), then the dashboard's own preferences. The section lives in `?section=`; `?field=` jumps
 * to one config field. Config edits stay a single draft across sections, saved from one bar.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = parseSettingsSection(searchParams.get('section'));
  const requestedField = findConfigFieldById(searchParams.get('field'));
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const {
    visualValues,
    visualDirty,
    visualDirtyFields,
    visualParseError,
    visualValidationErrors,
    visualHasPayloadValidationErrors,
    loadVisualValuesFromYaml,
    rebaseVisualValuesFromYaml,
    applyVisualChangesToYaml,
    setVisualValues,
  } = useVisualConfig();

  // Which editor the draft is saved from. Only Source and the visual sections change it; the
  // dashboard sections leave it alone, so a YAML draft survives a look at Appearance.
  const [mode, setMode] = useState<ConfigEditorMode>(() =>
    section === 'source' && !requestedField ? 'source' : 'visual'
  );
  const [animateCards, setAnimateCards] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnimateCards(false), ENTRANCE_BUDGET_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    RETIRED_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  }, []);

  const doc = useConfigDocument({
    mode,
    visualDirty,
    visualParseError,
    loadVisualValuesFromYaml,
    rebaseVisualValuesFromYaml,
    applyVisualChangesToYaml,
  });
  const sourceSearch = useSourceSearch();

  const disableControls = connectionStatus !== 'connected';
  const hasVisualValidationErrors =
    mode === 'visual' &&
    (Object.values(visualValidationErrors).some(Boolean) || visualHasPayloadValidationErrors);

  // Sections share one draft, so only leaving the page asks about unsaved changes.
  const shouldBlockLeaving = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      doc.isDirty && currentLocation.pathname !== nextLocation.pathname,
    [doc.isDirty]
  );
  useUnsavedChangesGuard({
    enabled: isCurrentLayer,
    shouldBlock: shouldBlockLeaving,
    dialog: useMemo(
      () => ({
        title: t('common.unsaved_changes_title'),
        message: t('common.unsaved_changes_message'),
        confirmText: t('common.confirm'),
        cancelText: t('common.cancel'),
      }),
      [t]
    ),
  });

  /**
   * Visual ↔ source hand-off. To source: materialize visual edits for viewing without counting
   * them as source edits. To visual: a source draft must be saved or discarded first.
   * Returns whether the switch happened.
   */
  const switchMode = useCallback(
    (nextMode: ConfigEditorMode): boolean => {
      if (nextMode === mode) return true;
      if (nextMode === 'visual' && doc.sourceDirty) {
        showNotification(t('config_management.source_changes_before_visual'), 'warning');
        return false;
      }
      if (nextMode === 'source') {
        if (visualDirty) {
          // content may be an earlier local source preview, not a server readback.
          const nextContent = applyVisualChangesToYaml(doc.content, 'draft');
          if (nextContent !== doc.content) doc.syncContentFromVisual(nextContent);
        }
      } else if (shouldReloadVisualDraft(doc.sourceDirty, visualParseError)) {
        const result = loadVisualValuesFromYaml(doc.content);
        if (!result.ok) {
          showNotification(
            t('config_management.visual_mode_unavailable_detail', { message: result.error }),
            'error'
          );
          return false;
        }
      }
      setMode(nextMode);
      return true;
    },
    [
      applyVisualChangesToYaml,
      doc,
      loadVisualValuesFromYaml,
      mode,
      showNotification,
      t,
      visualDirty,
      visualParseError,
    ]
  );

  const writeSection = useCallback(
    (id: SettingsSectionId) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('section', id);
          next.delete('field');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const selectSection = useCallback(
    (id: SettingsSectionId) => {
      if (id === 'source' && !switchMode('source')) return;
      if (isVisualConfigSection(id) && !switchMode('visual')) return;
      writeSection(id);
    },
    [switchMode, writeSection]
  );

  // The URL can also change from outside (a deep link or redirect): bring the mode along, or
  // return to the YAML when its unsaved draft blocks a visual section.
  useEffect(() => {
    if (requestedField) return;
    if (section === 'source' && mode === 'visual') switchMode('source');
    else if (isVisualConfigSection(section) && mode === 'source' && !switchMode('visual')) {
      writeSection('source');
    }
  }, [mode, requestedField, section, switchMode, writeSection]);

  // A YAML that cannot be parsed has no visual form: show it as source so it can be fixed.
  useEffect(() => {
    if (mode !== 'visual' || !visualParseError) return;
    setMode('source');
    if (isVisualConfigSection(section)) writeSection('source');
    showNotification(
      t('config_management.visual_mode_unavailable_detail', { message: visualParseError }),
      'error'
    );
    // Only a new parse error should move the page; section changes are handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, visualParseError]);

  const { jumpToField } = useFieldJump({ values: visualValues, setActiveSection: selectSection });

  const handledFieldRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedField || handledFieldRef.current === requestedField.fieldId) return;
    handledFieldRef.current = requestedField.fieldId;
    jumpToField(requestedField);
  }, [jumpToField, requestedField]);

  const errorCounts = useMemo(
    () => countSectionErrors(visualValidationErrors, visualHasPayloadValidationErrors),
    [visualHasPayloadValidationErrors, visualValidationErrors]
  );
  const dirtySections = useMemo(() => {
    const sections = new Set<SettingsSectionId>(resolveDirtyTabs(visualDirtyFields));
    if (doc.sourceDirty) sections.add('source');
    return sections;
  }, [doc.sourceDirty, visualDirtyFields]);
  const totalErrors = useMemo(
    () => countTotalErrors(visualValidationErrors, visualHasPayloadValidationErrors),
    [visualHasPayloadValidationErrors, visualValidationErrors]
  );

  const status = resolveStatus({
    disconnected: disableControls,
    loading: doc.loading,
    loadFailed: Boolean(doc.error),
    yamlError: Boolean(visualParseError),
    validationBlocked: hasVisualValidationErrors,
    saving: doc.saving,
    dirty: doc.isDirty,
  });
  const headerMeta = buildHeaderMeta({
    status,
    dirtyCount: visualDirtyFields.size,
    sourceDirty: doc.sourceDirty,
    errorCount: mode === 'visual' ? totalErrors : 0,
  });

  const saveDisabled =
    disableControls ||
    doc.loading ||
    doc.saving ||
    !doc.isDirty ||
    doc.diffModalOpen ||
    Boolean(visualParseError && mode === 'visual') ||
    hasVisualValidationErrors;

  const sectionProps = {
    values: visualValues,
    validationErrors: visualValidationErrors,
    disabled:
      disableControls || doc.loading || doc.saving || doc.diffModalOpen || doc.recoveryRequired,
    animateIn: animateCards,
    onChange: setVisualValues,
  };

  const renderSection = () => {
    switch (section) {
      case 'connect':
        return <SectionConnect {...sectionProps} />;
      case 'connectivity':
        return <SectionConnectivity {...sectionProps} />;
      case 'network':
        return <SectionNetwork {...sectionProps} />;
      case 'logging':
        return (
          <>
            <SectionLogging {...sectionProps} />
            <RequestLogCard
              onSaved={() => {
                // The YAML on screen predates this write; refresh it unless it holds a draft.
                if (!doc.isDirty) doc.handleReload();
              }}
            />
          </>
        );
      case 'streaming':
        return <SectionStreaming {...sectionProps} />;
      case 'advanced':
        return <SectionAdvanced {...sectionProps} />;
      case 'payload':
        return (
          <SectionPayload
            {...sectionProps}
            hasPayloadValidationErrors={visualHasPayloadValidationErrors}
          />
        );
      case 'source':
        return (
          <div className={styles.source}>
            <div className={styles.sourceHead}>
              <div>
                <h2>{t('settings_page.source.title')}</h2>
                <p>{t('settings_page.source.description')}</p>
              </div>
              <SourceSearchBar search={sourceSearch} disabled={disableControls || doc.loading} />
            </div>
            <SourcePanel
              search={sourceSearch}
              value={doc.content}
              onChange={doc.handleChange}
              theme={resolvedTheme}
              editable={!disableControls && !doc.loading && !doc.saving && !doc.diffModalOpen}
            />
          </div>
        );
      case 'appearance':
        return <AppearancePanel animateIn={animateCards} />;
      case 'tools':
        return <ToolsPanel animateIn={animateCards} />;
      case 'about':
        return <AboutPanel animateIn={animateCards} />;
    }
  };

  const toneClass = {
    muted: styles.metaMuted,
    warning: styles.metaWarning,
    error: styles.metaError,
    ok: styles.metaOk,
  } as const;

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div className={styles.titleRow}>
          <h1>{t('settings_page.title')}</h1>
          <p className={styles.meta} role="status">
            {headerMeta.map((segment, index) => (
              <Fragment key={segment.key}>
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                <span className={toneClass[segment.tone]}>
                  {segment.tone === 'ok' ? (
                    <i className={styles.statusDot} aria-hidden="true" />
                  ) : null}
                  {segment.count !== undefined
                    ? t(segment.labelKey, { count: segment.count })
                    : t(segment.labelKey)}
                </span>
              </Fragment>
            ))}
          </p>
        </div>
        <div className={styles.actions}>
          {section !== 'source' ? (
            <ConfigSearch disabled={disableControls || doc.loading} onJump={jumpToField} />
          ) : null}
          <button
            type="button"
            className={styles.reload}
            onClick={doc.handleReload}
            disabled={doc.loading || doc.saving}
            title={t('settings_page.reload_hint')}
          >
            <IconRefreshCw size={14} className={doc.loading ? styles.spinning : undefined} />
            {t('config_management.reload')}
          </button>
        </div>
      </header>

      {doc.error ? (
        <div className="error-box" role="alert">
          {doc.error}
        </div>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.rail}>
          <SettingsNav
            active={section}
            errorCounts={errorCounts}
            dirtySections={dirtySections}
            disabled={doc.saving || doc.loading}
            onSelect={selectSection}
          />
        </div>
        <section
          className={styles.panel}
          aria-label={t(`settings_page.nav.${section}`)}
          key={section}
        >
          {renderSection()}
        </section>
      </div>

      <FloatingSaveBar
        visible={isCurrentLayer && doc.isDirty}
        statusText={t(
          doc.recoveryRequired
            ? 'config_management.precise_save_recovery_required'
            : isMobile
              ? status.shortLabelKey
              : status.labelKey
        )}
        statusTone={status.tone}
        saving={doc.saving}
        saveDisabled={saveDisabled}
        discardDisabled={doc.loading || doc.saving}
        onSave={doc.handleSave}
        onDiscard={doc.handleDiscard}
      />

      <DiffModal
        open={doc.diffModalOpen}
        original={doc.serverYaml}
        modified={doc.mergedYaml}
        onConfirm={doc.handleConfirmSave}
        onCancel={doc.closeDiff}
        loading={doc.saving}
      />
    </div>
  );
}
