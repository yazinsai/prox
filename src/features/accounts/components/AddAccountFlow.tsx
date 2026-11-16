import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { IconChevronRight } from '@/components/ui/icons';
import iconVertex from '@/assets/icons/vertex.svg';
import { BrandGlyph } from '@/features/oauth/components/BrandGlyph';
import { OAuthFlowDialog } from '@/features/oauth/components/OAuthFlowDialog';
import { SiwcBindDialog } from '@/features/oauth/components/SiwcBindDialog';
import { VertexImportDialog } from '@/features/oauth/components/VertexImportDialog';
import { useOAuthFlows, usePluginOAuthProviders } from '@/features/oauth/hooks/useOAuthFlows';
import { useVertexImport } from '@/features/oauth/hooks/useVertexImport';
import {
  OAUTH_PROVIDERS,
  resolveThemedIcon,
  supportsManualCallback,
  type OAuthProviderCard,
} from '@/features/oauth/providers';
import { PROVIDER_LOGOS } from '@/features/providers/brandLogos';
import type { ProviderBrand } from '@/features/providers/types';
import { API_KEY_BRANDS } from '../addAccountOptions';
import { useAuthStore, useThemeStore } from '@/stores';
import styles from './AddAccountFlow.module.scss';

/** What the add flow is showing: the picker, or one way of adding an account. */
export type AddAccountTarget =
  { kind: 'picker' } | { kind: 'oauth'; id: string } | { kind: 'vertex' } | { kind: 'siwc' };

/** Subscriptions people actually run through prox first; regional and niche sign-ins after. */
const OAUTH_ORDER = [
  'anthropic',
  'codex',
  'antigravity',
  'xai',
  'meta',
  'devin',
  'kimi',
  'kimi-ai',
];

export interface AddAccountFlowProps {
  target: AddAccountTarget | null;
  onTargetChange: (target: AddAccountTarget | null) => void;
  /** Opens the API key form for a family; the form lives with the page's editing sheet. */
  onPickApiKey: (brand: ProviderBrand) => void;
  /** Uploads credential JSON files exported from prox or another CLI Proxy API. */
  onImportFiles: (files: File[]) => void;
}

/**
 * One entry point for every way an account joins prox: sign in with a subscription, paste an API
 * key, or import a credential. Sign-ins keep running in the background when their dialog closes,
 * and the picker shows which ones are still waiting.
 */
export function AddAccountFlow({
  target,
  onTargetChange,
  onPickApiKey,
  onImportFiles,
}: AddAccountFlowProps) {
  const { t } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const theme = useThemeStore((state) => state.resolvedTheme);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The last dialog stays mounted through its exit animation.
  const [lastOAuth, setLastOAuth] = useState<string | null>(null);
  const [siwcKey, setSiwcKey] = useState(0);
  if (target?.kind === 'oauth' && target.id !== lastOAuth) setLastOAuth(target.id);

  const pluginProviders = usePluginOAuthProviders(apiBase);
  const cards = useMemo<OAuthProviderCard[]>(() => {
    const builtIn = [...OAUTH_PROVIDERS].sort(
      (a, b) => OAUTH_ORDER.indexOf(a.id) - OAUTH_ORDER.indexOf(b.id)
    );
    return [...builtIn, ...pluginProviders];
  }, [pluginProviders]);

  // Background sign-ins notify only when their dialog is not the one being looked at.
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    focusedRef.current =
      target?.kind === 'oauth' ? target.id : target?.kind === 'vertex' ? '__vertex__' : null;
  }, [target]);
  const flows = useOAuthFlows({
    providerCards: cards,
    isFocused: (provider) => focusedRef.current === provider,
  });
  const vertexImport = useVertexImport({
    isFocused: () => focusedRef.current === '__vertex__',
    onCredentialAdded: flows.recordCredentialAdded,
  });

  const labelOf = (card: OAuthProviderCard) =>
    card.kind === 'plugin'
      ? card.title
      : typeof card.label === 'string'
        ? card.label
        : t(card.label.key);
  const iconOf = (card: OAuthProviderCard) =>
    card.kind === 'plugin' ? card.icon : resolveThemedIcon(card.icon, theme);
  const captionOf = (card: OAuthProviderCard) => {
    const status = flows.states[card.id]?.status;
    if (status === 'waiting') return t('auth_login.tile_waiting');
    if (status === 'success') return t('auth_login.tile_success');
    if (status === 'error') return t('auth_login.tile_error');
    if (card.kind === 'plugin') return t('auth_login.method_plugin');
    const method = t(
      card.flow === 'device' ? 'auth_login.method_device' : 'auth_login.method_browser'
    );
    return card.domain ? `${card.domain} · ${method}` : method;
  };

  const openOAuth = (card: OAuthProviderCard) => {
    onTargetChange({ kind: 'oauth', id: card.id });
    // A running, failed or just-finished attempt is reopened as is; otherwise start right away.
    if (!flows.states[card.id]?.status) void flows.startAuth(card.id);
  };

  const close = () => {
    if (target?.kind === 'oauth') flows.dismissSuccess(target.id);
    if (target?.kind === 'vertex' && vertexImport.vertex.result) vertexImport.resetForAnother();
    onTargetChange(null);
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    onTargetChange(null);
    onImportFiles(files);
  };

  const dialogCard = lastOAuth ? cards.find((card) => card.id === lastOAuth) : undefined;

  const brandLogo = (brand: ProviderBrand) => {
    const logo = PROVIDER_LOGOS[brand];
    return theme === 'dark' && logo.darkSrc ? logo.darkSrc : logo.src;
  };

  return (
    <>
      <Modal
        open={target?.kind === 'picker'}
        onClose={close}
        width={640}
        className={styles.modal}
        title={t('accounts.add_title')}
      >
        <div className={styles.sections}>
          <section className={styles.section} aria-labelledby="add-account-subscriptions">
            <header className={styles.sectionHead}>
              <h3 id="add-account-subscriptions">{t('accounts.add_subscriptions')}</h3>
              <p>{t('accounts.add_subscriptions_hint')}</p>
            </header>
            <div className={styles.grid}>
              {cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className={styles.tile}
                  data-status={flows.states[card.id]?.status ?? 'idle'}
                  onClick={() => openOAuth(card)}
                >
                  <span className={styles.glyph}>
                    <BrandGlyph src={iconOf(card)} size={18} />
                  </span>
                  <span className={styles.tileText}>
                    <span className={styles.tileLabel}>{labelOf(card)}</span>
                    <span className={styles.tileCaption}>{captionOf(card)}</span>
                  </span>
                  <IconChevronRight size={14} className={styles.chevron} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="add-account-keys">
            <header className={styles.sectionHead}>
              <h3 id="add-account-keys">{t('accounts.add_api_keys')}</h3>
              <p>{t('accounts.add_api_keys_hint')}</p>
            </header>
            <div className={styles.grid}>
              {API_KEY_BRANDS.map((brand) => (
                <button
                  key={brand}
                  type="button"
                  className={styles.tile}
                  onClick={() => {
                    onTargetChange(null);
                    onPickApiKey(brand);
                  }}
                >
                  <span className={styles.glyph}>
                    <BrandGlyph src={brandLogo(brand)} size={18} />
                  </span>
                  <span className={styles.tileText}>
                    <span className={styles.tileLabel}>
                      {t(`providersPage.providerNames.${brand}`)}
                    </span>
                    <span className={styles.tileCaption}>
                      {t(`accounts.api_key_caption.${brand}`)}
                    </span>
                  </span>
                  <IconChevronRight size={14} className={styles.chevron} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>

          <footer className={styles.other}>
            <span>{t('accounts.add_other')}</span>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              {t('accounts.add_import_file')}
            </button>
            <button type="button" onClick={() => onTargetChange({ kind: 'vertex' })}>
              {t('accounts.add_vertex')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSiwcKey((key) => key + 1);
                onTargetChange({ kind: 'siwc' });
              }}
            >
              {t('siwc.bind')}
            </button>
          </footer>
        </div>
      </Modal>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={handleFiles}
      />

      {dialogCard ? (
        <OAuthFlowDialog
          open={target?.kind === 'oauth'}
          providerId={dialogCard.id}
          heading={{
            title:
              dialogCard.kind === 'plugin'
                ? t('auth_login.plugin_oauth_title', { name: dialogCard.title })
                : t(dialogCard.titleKey),
            caption: captionOf(dialogCard),
            icon: iconOf(dialogCard),
          }}
          state={flows.states[dialogCard.id] ?? {}}
          text={(suffix) => flows.providerText(dialogCard.id, suffix)}
          supportsCallback={supportsManualCallback(dialogCard)}
          onStart={() => void flows.startAuth(dialogCard.id)}
          onCancel={() => void flows.cancelAuth(dialogCard.id)}
          onCallbackChange={(value) => flows.setCallbackInput(dialogCard.id, value)}
          onCallbackSubmit={() => void flows.submitCallback(dialogCard.id)}
          onViewAuthFiles={close}
          onClose={close}
        />
      ) : null}

      <VertexImportDialog
        open={target?.kind === 'vertex'}
        heading={{
          title: t('vertex_import.title'),
          caption: t('vertex_import.file_label'),
          icon: iconVertex,
        }}
        vertex={vertexImport.vertex}
        onPickFile={vertexImport.pickFile}
        onLocationChange={vertexImport.setLocation}
        onImport={() => void vertexImport.importCredential()}
        onImportAnother={vertexImport.resetForAnother}
        onViewAuthFiles={close}
        onClose={close}
      />

      {siwcKey > 0 ? (
        <SiwcBindDialog
          key={siwcKey}
          open={target?.kind === 'siwc'}
          onClose={close}
          onViewAuthFiles={close}
        />
      ) : null}
    </>
  );
}
