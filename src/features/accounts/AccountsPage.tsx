/**
 * Accounts: every subscription, API key and credential prox can send requests to, in the order it
 * tries them, with what each one is doing right now.
 *
 * The order is the routing board: moves, weights and policy are a local draft until saved as one
 * plan, and the board always reloads afterwards so it shows what actually landed. Account actions
 * (turn off, remove, clear a cooldown, edit) apply immediately, so they wait while a draft is open.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { IconPlus, IconSlidersHorizontal } from '@/components/ui/icons';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { guardConfigConnection } from '@/services/api/configValue';
import { authFilesApi } from '@/services/api/authFiles';
import {
  RoutingConflictError,
  buildRoutingBoard,
  routingApi,
  type RoutingApplyResult,
} from '@/services/api/routing';
import {
  useAuthStore,
  useConfigStore,
  useNotificationStore,
  useQuotaStore,
  useThemeStore,
} from '@/stores';
import type { ResolvedTheme } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type {
  RoutingBoard,
  RoutingDraft,
  RoutingDropTarget,
  RoutingMember,
  RoutingModelCatalog,
  RoutingSettings,
  RoutingTier,
} from '@/types/routing';
import { copyToClipboard } from '@/utils/clipboard';
import { getErrorMessage } from '@/utils/helpers';
import { createSharedClock } from '@/utils/time/sharedClock';
import {
  AUTH_FILES_CHANGED_EVENT,
  notifyAuthFilesChanged,
} from '@/features/authFiles/authFilesEvents';
import { AuthFileDetailsSheet } from '@/features/authFiles/components/AuthFileDetailsSheet';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { PROVIDER_DESCRIPTORS } from '@/features/providers/descriptors';
import {
  ProviderSheet,
  type ProviderSheetHandle,
  type ProviderSheetState,
} from '@/features/providers/sheets/ProviderSheet';
import type { ProviderBrand, ProviderResource } from '@/features/providers/types';
import { useProviderWorkbench } from '@/features/providers/useProviderWorkbench';
import {
  assignPriorities,
  RoutingPriorityError,
  buildRoutingPlan,
  collectModelOptions,
  draftFromBoard,
  moveMember,
  mergeRoutingRuntime,
  neededChannels,
  neededCredentialModels,
  resolveRoute,
  stepMember,
} from '@/features/routing/logic';
import { ChangeReviewDialog } from '@/features/routing/components/ChangeReviewDialog';
import type { MemberAction } from '@/features/routing/components/MemberCard';
import { memberIcon, memberKindLabel } from '@/features/routing/memberPresentation';
import { PolicyPanel } from '@/features/routing/components/PolicyPanel';
import { RoutingSaveBar } from '@/features/routing/components/RoutingSaveBar';
import { TierLadder } from '@/features/routing/components/TierLadder';
import { WeightDialog } from '@/features/routing/components/WeightDialog';
import routingStyles from '@/features/routing/RoutingBoard.module.scss';
import { accountStatus, accountUsage, type AccountStatus } from './accountStatus';
import { OAUTH_PROVIDER_FOR_FAMILY } from './addAccountOptions';
import { AddAccountFlow, type AddAccountTarget } from './components/AddAccountFlow';
import { AccountSheet } from './components/AccountSheet';
import { memberModels, resourceForMember } from './resources';
import styles from './AccountsPage.module.scss';

// Cooldowns count down coarsely; one shared timer for the whole page.
const cooldownClock = createSharedClock({ intervalMs: 5_000 });

const EMPTY_CATALOG: RoutingModelCatalog = { channels: {}, credentials: {} };
const CLOSED_PROVIDER_SHEET: ProviderSheetState = {
  open: false,
  brand: 'codex',
  mode: 'detail',
  resource: null,
};

interface ModelProgress {
  done: number;
  total: number;
}

export function AccountsPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const nowMs = useSyncExternalStore(
    cooldownClock.subscribe,
    cooldownClock.getSnapshot,
    cooldownClock.getSnapshot
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const layoutRef = useRef<HTMLDivElement>(null);
  const pageTransitionLayer = usePageTransitionLayer();
  // A page sliding out must not leave its portalled save bar behind.
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [board, setBoard] = useState<RoutingBoard | null>(null);
  const [draft, setDraft] = useState<RoutingDraft | null>(null);
  const [catalog, setCatalog] = useState<RoutingModelCatalog>(EMPTY_CATALOG);
  const [modelProgress, setModelProgress] = useState<ModelProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [weightEdit, setWeightEdit] = useState<{ key: string; session: number } | null>(null);
  const [weightOpen, setWeightOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addTarget, setAddTarget] = useState<AddAccountTarget | null>(null);
  const [providerSheet, setProviderSheet] = useState<ProviderSheetState>(CLOSED_PROVIDER_SHEET);
  const providerSheetRef = useRef<ProviderSheetHandle>(null);
  const requestRef = useRef(0);
  const catalogRef = useRef<RoutingModelCatalog>(EMPTY_CATALOG);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);

  const connected = connectionStatus === 'connected';
  const workbench = useProviderWorkbench();

  // `?add=1` (old `/oauth` links) opens the picker and `?policy=1` the routing policy, once
  // each; the address is cleaned so a reload does not reopen them.
  useEffect(() => {
    if (!searchParams.get('add') && !searchParams.get('policy')) return;
    if (searchParams.get('add')) setAddTarget({ kind: 'picker' });
    if (searchParams.get('policy')) setPolicyOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    next.delete('policy');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const loadModels = useCallback((next: RoutingBoard, requestId: number) => {
    const isCurrent = () => requestId === requestRef.current;
    const known = catalogRef.current;
    const channels = neededChannels(next).filter((channel) => !(channel in known.channels));
    const credentials = neededCredentialModels(next).filter((name) => !(name in known.credentials));
    const total = channels.length + credentials.length;
    if (total === 0) {
      setModelProgress(null);
      return;
    }
    let done = 0;
    setModelProgress({ done, total });
    const record = (kind: 'channels' | 'credentials', id: string, models: string[] | null) => {
      if (!isCurrent()) return;
      done += 1;
      catalogRef.current = {
        ...catalogRef.current,
        [kind]: { ...catalogRef.current[kind], [id]: models },
      };
      setCatalog(catalogRef.current);
      setModelProgress(done >= total ? null : { done, total });
    };
    void routingApi.loadChannelModels(channels, (id, models) => record('channels', id, models));
    void routingApi.loadCredentialModels(credentials, (id, models) =>
      record('credentials', id, models)
    );
  }, []);

  const load = useCallback(
    async (background = false) => {
      if (background && inFlightRef.current) return;
      const requestId = ++requestRef.current;
      const isCurrent = () => requestId === requestRef.current;
      const assertConnection = guardConfigConnection();
      if (!connected || !apiBase) {
        setLoading(false);
        return;
      }
      setLoading(true);
      inFlightRef.current = true;
      setError(null);
      try {
        const [config, files, discovered] = await Promise.all([
          fetchConfig(true),
          routingApi.listCredentials(),
          routingApi.loadDiscoveredModels(),
        ]);
        if (!isCurrent()) return;
        assertConnection();
        const next = buildRoutingBoard(config.raw ?? {}, files, discovered);
        setFiles(files);
        // Cooldowns and counters keep updating while an arrangement is being edited.
        if (background && dirtyRef.current) {
          setBoard((previous) => (previous ? mergeRoutingRuntime(previous, next) : next));
          return;
        }
        setBoard(next);
        setDraft(draftFromBoard(next));
        // Model aliases and registrations can change without leaving this page.
        catalogRef.current = EMPTY_CATALOG;
        loadModels(next, requestId);
      } catch (err) {
        if (!isCurrent()) return;
        setError(getErrorMessage(err));
      } finally {
        if (isCurrent()) {
          setLoading(false);
          inFlightRef.current = false;
        }
      }
    },
    [connected, fetchConfig, loadModels, apiBase]
  );

  useEffect(() => {
    void load();
    return () => {
      // Late responses from this mount must not land on a later one.
      requestRef.current += 1;
    };
  }, [load]);

  useEffect(() => {
    // Never display one backend's snapshot under another backend's connection.
    catalogRef.current = EMPTY_CATALOG;
    setCatalog(EMPTY_CATALOG);
    setFiles([]);
    setBoard(null);
    setDraft(null);
  }, [connectionStatus, apiBase]);

  const plan = useMemo(
    () => (board && draft ? buildRoutingPlan(board, draft) : null),
    [board, draft]
  );
  const dirty = Boolean(plan && plan.changes.length > 0);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useInterval(
    () => {
      if (document.visibilityState === 'visible') void load(true);
    },
    connected && isCurrentLayer && !saving ? 15_000 : null
  );

  useEffect(() => {
    const resume = () => {
      if (connected && isCurrentLayer && !saving && document.visibilityState === 'visible') {
        void load(true);
      }
    };
    // Sign-ins and imports finish in their dialogs; the new account shows up here.
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, resume);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => {
      window.removeEventListener(AUTH_FILES_CHANGED_EVENT, resume);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, [connected, isCurrentLayer, saving, load]);

  // The global header refresh reloads the board; with a draft it asks first.
  const refresh = useCallback(() => {
    if (!dirty) return load();
    showConfirmation({
      title: t('routing.unsaved_title'),
      message: t('routing.refresh_discards'),
      confirmText: t('routing.refresh'),
      cancelText: t('routing.unsaved_cancel'),
      variant: 'danger',
      onConfirm: () => load(),
    });
  }, [dirty, load, showConfirmation, t]);

  useHeaderRefresh(refresh);

  const { allowNextNavigation } = useUnsavedChangesGuard({
    shouldBlock: dirty,
    dialog: {
      title: t('routing.unsaved_title'),
      message: t('routing.unsaved_message'),
      confirmText: t('routing.unsaved_confirm'),
      cancelText: t('routing.unsaved_cancel'),
      variant: 'danger',
    },
  });

  const members = useMemo(
    () => new Map((board?.members ?? []).map((member) => [member.key, member])),
    [board]
  );
  const filesByName = useMemo(() => new Map(files.map((file) => [file.name, file])), [files]);
  const fileOf = useCallback(
    (member: RoutingMember) =>
      member.location.kind === 'credential' ? filesByName.get(member.location.name) : undefined,
    [filesByName]
  );
  const statuses = useMemo(
    () =>
      new Map<string, AccountStatus>(
        (board?.members ?? []).map((member) => [
          member.key,
          accountStatus(member, fileOf(member), nowMs),
        ])
      ),
    [board, fileOf, nowMs]
  );
  const usage = useMemo(
    () =>
      new Map((board?.members ?? []).map((member) => [member.key, accountUsage(fileOf(member))])),
    [board, fileOf]
  );
  const priorities = useMemo(
    () => (board && draft ? assignPriorities(draft.tiers, board.members) : {}),
    [board, draft]
  );
  const selectedModel = model.trim() || null;
  // Only a picked model has a route; without one the board shows each account's own state.
  const preview = useMemo(
    () =>
      board && draft && selectedModel
        ? resolveRoute(board, draft, catalog, selectedModel, nowMs)
        : null,
    [board, draft, catalog, selectedModel, nowMs]
  );
  const modelOptions = useMemo(
    () => (board ? collectModelOptions(board, catalog) : []),
    [board, catalog]
  );

  const applyTiers = useCallback(
    (tiers: RoutingTier[]) => {
      if (!board || !draft) return;
      try {
        assignPriorities(tiers, board.members);
        setDraft({ ...draft, tiers });
      } catch (err) {
        if (!(err instanceof RoutingPriorityError)) throw err;
        showNotification(t('routing.locked_priority_conflict'), 'warning');
      }
    },
    [board, draft, showNotification, t]
  );

  const handleMove = useCallback(
    (key: string, target: RoutingDropTarget) => {
      if (draft) applyTiers(moveMember(draft.tiers, key, target));
    },
    [draft, applyTiers]
  );

  const handleStep = useCallback(
    (key: string, direction: 'up' | 'down') => {
      if (draft) applyTiers(stepMember(draft.tiers, key, direction));
      // Keep keyboard focus on the moved card after it re-renders in its new tier.
      requestAnimationFrame(() => {
        const card = document.querySelector<HTMLElement>(
          `[data-member-key="${CSS.escape(key)}"] button`
        );
        card?.focus();
      });
    },
    [draft, applyTiers]
  );

  const handleEditWeights = useCallback((key: string) => {
    setWeightEdit((current) => ({ key, session: (current?.session ?? 0) + 1 }));
    setWeightOpen(true);
  }, []);

  const handleApplyWeights = useCallback((key: string, weights: (number | null)[]) => {
    setDraft((current) =>
      current ? { ...current, weights: { ...current.weights, [key]: weights } } : current
    );
  }, []);

  const handleSettings = useCallback((settings: RoutingSettings) => {
    setDraft((current) => (current ? { ...current, settings } : current));
  }, []);

  const discard = () => {
    if (board) setDraft(draftFromBoard(board));
  };

  const reportResult = (result: RoutingApplyResult) => {
    if (!result.failed) {
      showNotification(t('routing.save_success', { count: plan?.changes.length ?? 0 }), 'success');
      return;
    }
    if (result.failed.error instanceof RoutingConflictError) {
      showNotification(t('routing.save_conflict'), 'error');
      return;
    }
    const failedKey = result.failed.key;
    const name =
      failedKey === 'config'
        ? t('routing.config_target')
        : (members.get(failedKey)?.name ?? failedKey);
    showNotification(
      t('routing.save_partial', {
        name,
        message: getErrorMessage(result.failed.error, t('common.unknown_error')),
        applied: result.applied.length,
        skipped: result.notAttempted.length,
      }),
      'error',
      10_000
    );
  };

  const save = async () => {
    if (!board || !plan || saving) return;
    setSaving(true);
    try {
      const result = await routingApi.applyPlan(board, plan);
      reportResult(result);
    } catch (err) {
      showNotification(getErrorMessage(err, t('common.unknown_error')), 'error');
    } finally {
      setSaving(false);
      setReviewOpen(false);
      allowNextNavigation();
      await load();
    }
  };

  /* ---------- account actions ---------- */

  const editor = useAuthFilesPrefixProxyEditor({
    disableControls: !connected,
    loadFiles: () => load(),
    onFilesMutated: (names) => useQuotaStore.getState().clearQuotaCache(names),
  });

  const runAction = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setBusy(true);
      try {
        await action();
        showNotification(success, 'success');
      } catch (err) {
        showNotification(getErrorMessage(err, t('common.unknown_error')), 'error');
      } finally {
        setBusy(false);
        notifyAuthFilesChanged();
        await load();
      }
    },
    [load, showNotification, t]
  );

  const openProviderSheet = useCallback(
    (resource: ProviderResource, mode: 'detail' | 'edit') =>
      setProviderSheet({ open: true, brand: resource.brand, mode, resource }),
    []
  );

  const resourceOf = useCallback(
    (member: RoutingMember) => resourceForMember(member, workbench.snapshot?.groups ?? []),
    [workbench.snapshot]
  );

  const openMember = useCallback((key: string) => {
    setOpenKey(key);
    setSheetOpen(true);
  }, []);

  const confirmRemove = useCallback(
    (member: RoutingMember, remove: () => Promise<unknown>) =>
      showConfirmation({
        title: t('accounts.remove_title', { name: member.name }),
        message: t(
          member.kind === 'credential' ? 'accounts.remove_credential' : 'accounts.remove_api_key'
        ),
        confirmText: t('accounts.remove'),
        cancelText: t('common.cancel'),
        variant: 'danger',
        onConfirm: () => runAction(remove, t('accounts.removed', { name: member.name })),
      }),
    [runAction, showConfirmation, t]
  );

  const memberActions = useCallback(
    (member: RoutingMember): MemberAction[] => {
      // Immediate writes would be lost under an unsaved arrangement, so they wait for it.
      const blocked = dirty || saving || busy || !connected;
      const status = statuses.get(member.key);
      const actions: MemberAction[] = [];
      const file = fileOf(member);
      if (file) {
        actions.push({
          id: 'edit',
          label: t('accounts.action_edit'),
          disabled: !connected,
          onSelect: () => void editor.openPrefixProxyEditor(file),
        });
        const provider = OAUTH_PROVIDER_FOR_FAMILY[member.family.toLowerCase()];
        if (provider) {
          actions.push({
            id: 'signin',
            label: t('accounts.action_sign_in_again'),
            disabled: !connected,
            onSelect: () => setAddTarget({ kind: 'oauth', id: provider }),
          });
        }
        const authIndex =
          file.authIndex === null || file.authIndex === undefined ? '' : String(file.authIndex);
        if ((status?.kind === 'cooling' || status?.kind === 'partial') && authIndex) {
          actions.push({
            id: 'cooldown',
            label: t('accounts.action_clear_cooldown'),
            disabled: blocked,
            onSelect: () =>
              void runAction(
                () => authFilesApi.resetCooldown(authIndex),
                t('accounts.cooldown_cleared', { name: member.name })
              ),
          });
        }
        if (!member.locked) {
          actions.push({
            id: 'toggle',
            label: t(member.disabled ? 'accounts.action_turn_on' : 'accounts.action_turn_off'),
            disabled: blocked,
            onSelect: () =>
              void runAction(
                () => authFilesApi.setStatus(file.name, !member.disabled, authIndex || undefined),
                t(member.disabled ? 'accounts.turned_on' : 'accounts.turned_off', {
                  name: member.name,
                })
              ),
          });
          actions.push({
            id: 'remove',
            label: t('accounts.action_remove'),
            danger: true,
            disabled: blocked,
            onSelect: () => confirmRemove(member, () => authFilesApi.deleteFile(file.name)),
          });
        }
        return actions;
      }

      const resource = resourceOf(member);
      if (!resource) return actions;
      actions.push({
        id: 'edit',
        label: t('accounts.action_edit'),
        disabled: !connected,
        onSelect: () => openProviderSheet(resource, 'edit'),
      });
      if (PROVIDER_DESCRIPTORS[resource.brand].supportsDisabled) {
        actions.push({
          id: 'toggle',
          label: t(member.disabled ? 'accounts.action_turn_on' : 'accounts.action_turn_off'),
          disabled: blocked || workbench.mutating,
          onSelect: () =>
            void runAction(
              () => workbench.toggleDisabled(resource, !member.disabled),
              t(member.disabled ? 'accounts.turned_on' : 'accounts.turned_off', {
                name: member.name,
              })
            ),
        });
      }
      actions.push({
        id: 'remove',
        label: t('accounts.action_remove'),
        danger: true,
        disabled: blocked || workbench.mutating,
        onSelect: () => confirmRemove(member, () => workbench.deleteProvider(resource)),
      });
      return actions;
    },
    [
      dirty,
      saving,
      busy,
      connected,
      statuses,
      fileOf,
      resourceOf,
      editor,
      runAction,
      confirmRemove,
      openProviderSheet,
      workbench,
      t,
    ]
  );

  const importFiles = useCallback(
    (picked: File[]) =>
      void runAction(
        async () => {
          const result = await authFilesApi.uploadFiles(picked);
          if (result.failed.length > 0 && result.uploaded === 0) {
            throw new Error(
              result.failed
                .map((item) => item.error)
                .filter(Boolean)
                .join('; ')
            );
          }
        },
        t('accounts.imported', { count: picked.length })
      ),
    [runAction, t]
  );

  const pickApiKey = useCallback(
    (brand: ProviderBrand) =>
      setProviderSheet({ open: true, brand, mode: 'create', resource: null }),
    []
  );

  const closeProviderSheet = useCallback(() => setProviderSheet(CLOSED_PROVIDER_SHEET), []);
  const providerSaved = useCallback(
    (key: 'providersPage.toast.created' | 'providersPage.toast.updated') => {
      showNotification(t(key), 'success');
      closeProviderSheet();
      void load();
    },
    [closeProviderSheet, load, showNotification, t]
  );

  const copyText = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied ? t('notification.link_copied') : t('notification.copy_failed'),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  /* ---------- rendering ---------- */

  const strategyLabel = draft
    ? t(`routing.strategy_${draft.settings.strategy.replace(/-/g, '_')}`)
    : '';
  const policySummary = draft
    ? draft.settings.sessionAffinity
      ? t('accounts.policy_summary_sticky', { strategy: strategyLabel })
      : strategyLabel
    : t('accounts.policy');

  const entryControl = (
    <div className={routingStyles.modelPicker}>
      <AutocompleteInput
        value={model}
        onChange={setModel}
        options={modelOptions}
        placeholder={t('accounts.lens_placeholder')}
        wrapperClassName={routingStyles.modelInput}
        className={routingStyles.modelField}
        id="accounts-model-lens"
      />
      {modelProgress ? (
        <span className={routingStyles.modelProgress} role="status">
          {t('routing.models_loading', { done: modelProgress.done, total: modelProgress.total })}
        </span>
      ) : null}
    </div>
  );

  const renderBody = () => {
    if (loading && !board) {
      return (
        <div className={styles.skeletons} aria-busy="true" aria-label={t('accounts.loading')}>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} height={index === 0 ? 168 : 96} />
          ))}
        </div>
      );
    }
    if (error !== null && !board) {
      return (
        <EmptyState
          title={t('accounts.load_failed', { message: error || t('common.unknown_error') })}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              {t('routing.retry')}
            </Button>
          }
        />
      );
    }
    if (!board || !draft) return null;
    if (board.members.length === 0) {
      return (
        <EmptyState
          title={t('accounts.empty_title')}
          description={t('accounts.empty_desc')}
          action={
            <Button onClick={() => setAddTarget({ kind: 'picker' })}>{t('accounts.add')}</Button>
          }
        />
      );
    }
    return (
      <div ref={layoutRef} className={styles.board}>
        {error ? (
          <p className={styles.syncError} role="alert">
            {t('accounts.refresh_failed', { message: error })}
          </p>
        ) : null}
        <TierLadder
          members={members}
          draft={draft}
          priorities={priorities}
          model={selectedModel}
          preview={preview}
          nowMs={nowMs}
          theme={resolvedTheme}
          entryControl={entryControl}
          onMove={handleMove}
          onStep={handleStep}
          onEditWeights={handleEditWeights}
          statuses={statuses}
          usage={usage}
          memberActions={memberActions}
          onOpenMember={openMember}
        />
      </div>
    );
  };

  const editingMember = weightEdit ? (members.get(weightEdit.key) ?? null) : null;

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div className={styles.titleBlock}>
          <h1>{t('nav.accounts')}</h1>
          <p>{t('accounts.subtitle')}</p>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={styles.policyButton}
            onClick={() => setPolicyOpen(true)}
            disabled={!draft}
            aria-haspopup="dialog"
            aria-label={t('accounts.policy_open', { summary: policySummary })}
          >
            <IconSlidersHorizontal size={14} aria-hidden="true" />
            <span>{policySummary}</span>
          </button>
          <button
            type="button"
            className={styles.addButton}
            onClick={() => setAddTarget({ kind: 'picker' })}
            disabled={!connected}
            aria-haspopup="dialog"
          >
            <IconPlus size={14} aria-hidden="true" />
            {t('accounts.add')}
          </button>
        </div>
      </header>

      {renderBody()}

      <footer className={styles.pageFoot}>
        <span>{t('accounts.more_tools')}</span>
        <Link to="/auth-files">{t('accounts.tool_credential_files')}</Link>
        <Link to="/auth-files/oauth-model-alias">{t('accounts.tool_aliases')}</Link>
        <Link to="/auth-files/oauth-excluded">{t('accounts.tool_exclusions')}</Link>
      </footer>

      <RoutingSaveBar
        visible={isCurrentLayer && dirty}
        count={plan?.changes.length ?? 0}
        saving={saving}
        saveDisabled={!connected}
        onSave={() => setReviewOpen(true)}
        onDiscard={discard}
        layoutRef={layoutRef}
      />

      {plan ? (
        <ChangeReviewDialog
          open={reviewOpen}
          changes={plan.changes}
          members={members}
          saving={saving}
          onConfirm={() => void save()}
          onClose={() => setReviewOpen(false)}
        />
      ) : null}

      {weightEdit && draft ? (
        <WeightDialog
          key={weightEdit.session}
          open={weightOpen}
          member={editingMember}
          weights={draft.weights[weightEdit.key] ?? []}
          strategy={draft.settings.strategy}
          onApply={handleApplyWeights}
          onClose={() => setWeightOpen(false)}
        />
      ) : null}

      {draft ? (
        <Sheet
          open={policyOpen}
          onClose={() => setPolicyOpen(false)}
          title={t('accounts.policy')}
          description={t('accounts.policy_description')}
          footer={
            <Button variant="secondary" onClick={() => setPolicyOpen(false)}>
              {t('accounts.done')}
            </Button>
          }
        >
          <PolicyPanel bare settings={draft.settings} disabled={saving} onChange={handleSettings} />
        </Sheet>
      ) : null}

      {(() => {
        const member = openKey ? (members.get(openKey) ?? null) : null;
        const tierIndex =
          member && draft
            ? draft.tiers.findIndex((tier) => tier.memberKeys.includes(member.key))
            : -1;
        return (
          <AccountSheet
            open={sheetOpen && member !== null}
            member={member}
            file={member ? fileOf(member) : undefined}
            kindLabel={member ? memberKindLabel(t, member) : ''}
            icon={member ? memberIcon(member, resolvedTheme) : null}
            status={member ? statuses.get(member.key) : undefined}
            usage={member ? usage.get(member.key) : undefined}
            tierIndex={tierIndex >= 0 ? tierIndex : null}
            tierCount={draft?.tiers.length ?? 0}
            models={member ? memberModels(member, catalog) : null}
            nowMs={nowMs}
            actions={member ? memberActions(member) : []}
            onClose={() => setSheetOpen(false)}
          />
        );
      })()}

      <AddAccountFlow
        target={addTarget}
        onTargetChange={setAddTarget}
        onPickApiKey={pickApiKey}
        onImportFiles={importFiles}
      />

      <ProviderSheet
        ref={providerSheetRef}
        state={providerSheet}
        onClose={closeProviderSheet}
        onSwitchToEdit={() =>
          setProviderSheet((state) => (state.resource ? { ...state, mode: 'edit' } : state))
        }
        workbench={workbench}
        onCreated={() => providerSaved('providersPage.toast.created')}
        onUpdated={() => providerSaved('providersPage.toast.updated')}
        mutationDisabled={!connected || workbench.mutating}
      />

      <AuthFileDetailsSheet
        disableControls={!connected}
        editor={editor.prefixProxyEditor}
        updatedText={editor.prefixProxyUpdatedText}
        dirty={editor.prefixProxyDirty}
        onClose={editor.closePrefixProxyEditor}
        onCopyText={copyText}
        onSave={editor.handlePrefixProxySave}
        onChange={editor.handlePrefixProxyChange}
      />
    </div>
  );
}
