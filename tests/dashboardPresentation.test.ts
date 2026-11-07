import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { ArchiveSummary } from '../src/features/dashboard/components/ArchiveSummary';
import { DashboardRequests } from '../src/features/dashboard/components/DashboardRequests';
import {
  normalizeModelPins,
  pinStorageKey,
  readModelPins,
} from '../src/features/dashboard/modelPins';
import type { RequestArchiveStats } from '../src/services/api/requestArchive';
import type { DashboardRequests as RequestFeed } from '../src/services/api/dashboard';

const translator = i18next.createInstance();
await translator.init({
  lng: 'en',
  resources: {
    en: {
      translation: JSON.parse(
        readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8')
      ),
    },
  },
  interpolation: { escapeValue: false },
});

const stats: RequestArchiveStats = {
  enabled: true,
  status: 'healthy',
  failuresSinceStart: 0,
  lastFailureAt: null,
  startedAt: '2026-11-07T10:00:00Z',
  version: 'fixture-version',
  commit: 'fixture-commit',
  upstreamBase: 'fixture-base',
  index: {
    updatedAt: '2026-11-07T12:00:00Z',
    records: 12480,
    archiveFiles: 12480,
    originalBytes: 18_600_000_000,
    archivedBytes: 2_840_000_000,
    indexBytes: 18_000_000,
    diskFreeBytes: 138_000_000_000,
    diskTotalBytes: 256_000_000_000,
    pendingPlaintextFiles: 0,
    latestAt: '2026-11-07T11:59:59Z',
    oldestAt: '2026-11-01T00:00:00Z',
    daily: [],
  },
};

const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(
    createElement(I18nextProvider, { i18n: translator }, createElement(MemoryRouter, null, element))
  );
const renderArchive = (
  value: RequestArchiveStats | null,
  state: 'ready' | 'unsupported' | 'error'
) => render(createElement(ArchiveSummary, { stats: value, state, refresh: async () => {} }));

describe('dashboard archive presentation', () => {
  test('shows physical compressed bytes in decimal GB and excludes index overhead', () => {
    const markup = renderArchive(stats, 'ready');
    expect(markup).toContain('2.84');
    expect(markup).toContain('18.60 GB original');
    expect(markup).toContain('85% smaller');
    expect(markup).toContain('12,480');
    expect(markup).toContain('0 since restart');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('2.86');
    expect(markup).not.toContain('request_archive.');
  });

  test('missing reports show unknown size without invented records or savings', () => {
    for (const state of ['unsupported', 'error'] as const) {
      const markup = renderArchive(null, state);
      expect(markup).toContain('—');
      expect(markup).not.toContain('0.00');
      expect(markup).not.toContain('0 since restart');
      expect(markup).not.toContain('smaller');
      expect(markup).not.toContain('<dt>Records</dt>');
      expect(markup).toContain(
        state === 'unsupported' ? 'Reporting unavailable' : 'Status unavailable'
      );
    }
  });

  test('stale, disabled and degraded archives retain their real status and last-known size', () => {
    const stale = renderArchive({ ...stats, status: 'index_stale' }, 'ready');
    expect(stale).toContain('2.84');
    expect(stale).toContain('Indexer not reporting');
    expect(stale).toContain('not live statistics');
    const disabled = renderArchive({ ...stats, enabled: false, status: 'disabled' }, 'ready');
    expect(disabled).toContain('Capture off');
    expect(disabled).toContain('2.84');
    const degraded = renderArchive(
      { ...stats, status: 'degraded', failuresSinceStart: 4 },
      'ready'
    );
    expect(degraded).toContain('4 since restart');
    expect(degraded).toContain('Capture failures');
  });

  test('an empty healthy archive has a known zero size without NaN or artificial savings', () => {
    const index = stats.index;
    if (!index) throw new Error('Missing fixture index');
    const empty = renderArchive(
      {
        ...stats,
        index: { ...index, records: 0, archiveFiles: 0, originalBytes: 0, archivedBytes: 0 },
      },
      'ready'
    );
    expect(empty).toContain('0.00');
    expect(empty).toContain('<dd>0</dd>');
    expect(empty).not.toContain('smaller');
    expect(empty).not.toContain('NaN');
    expect(empty).not.toContain('Infinity');
  });
});

describe('dashboard request presentation', () => {
  const feed: RequestFeed = {
    observedAt: '2026-11-07T12:00:00Z',
    coverageStart: '2026-11-07T10:00:00Z',
    partial: true,
    window: '8h',
    nextCursor: null,
    requests: [
      {
        id: 'request-fixture',
        traceId: 'trace-fixture',
        model: 'exact-model-id',
        provider: 'public-group',
        startedAt: '2026-11-07T11:59:58Z',
        completedAt: '2026-11-07T12:00:00Z',
        statusCode: 200,
        outcome: 'interrupted',
        durationMs: 2000,
        reason: 'stream_interrupted',
        archiveRequestId: null,
      },
    ],
  };
  const renderFeed = (
    value: RequestFeed | null,
    state: 'ready' | 'unsupported',
    errorsOnly = false
  ) =>
    render(
      createElement(DashboardRequests, {
        feed: value,
        state,
        window: '8h',
        errorsOnly,
        onErrorsOnly: () => {},
      })
    );

  test('interrupted streams are labelled failures even after HTTP 200', () => {
    const markup = renderFeed(feed, 'ready');
    expect(markup).toContain('Interrupted');
    expect(markup).toContain('data-failed="true"');
    expect(markup).toContain('Open request request-fixture');
    expect(markup).toContain('2s');
    expect(markup).not.toContain('>200<');
  });

  test('unknown reporting differs from a known empty window or empty error filter', () => {
    const unknown = renderFeed(null, 'unsupported');
    expect(unknown).toContain('Dashboard reporting unavailable');
    expect(unknown).not.toContain('No requests in this window');
    const empty = renderFeed({ ...feed, requests: [] }, 'ready');
    expect(empty).toContain('No requests in this window');
    const noErrors = renderFeed({ ...feed, requests: [] }, 'ready', true);
    expect(noErrors).toContain('No failed requests in this window');
  });
});

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('model pins', () => {
  test('limits pins to four unique nonempty exact model IDs and rejects malformed records', () => {
    expect(normalizeModelPins([' a ', 'a', '', 'b', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd']);
    expect(normalizeModelPins(['alias-a', 'alias-b'])).toEqual(['alias-a', 'alias-b']);
    expect(normalizeModelPins([])).toEqual([]);
    for (const value of [null, {}, 'a', ['a', 1]]) expect(normalizeModelPins(value)).toBeNull();
  });

  test('reads pins per connection and distinguishes explicitly empty pins from no settings', () => {
    const records = new Map([
      [pinStorageKey('https://one.invalid/proxy'), '["model-one"]'],
      [pinStorageKey('https://two.invalid/proxy'), '[]'],
      [pinStorageKey('https://broken.invalid'), 'not-json'],
    ]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (key: string) => records.get(key) ?? null },
    });
    expect(readModelPins('https://one.invalid/proxy')).toEqual(['model-one']);
    expect(readModelPins('https://two.invalid/proxy')).toEqual([]);
    expect(readModelPins('https://missing.invalid')).toBeNull();
    expect(readModelPins('https://broken.invalid')).toBeNull();
    expect(pinStorageKey('https://one.invalid/proxy')).not.toBe(
      pinStorageKey('https://two.invalid/proxy')
    );
  });

  test('unavailable browser storage falls back to discovered models without throwing', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('Storage blocked');
      },
    });
    expect(readModelPins('https://one.invalid')).toBeNull();
  });
});
