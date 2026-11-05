import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import {
  normalizeRequestArchiveStats,
  type RequestArchiveStats,
} from '../src/services/api/requestArchive';
import { RequestArchivePanelContent } from '../src/features/dashboard/components/RequestArchivePanel';

const payload = {
  supported: true,
  enabled: true,
  status: 'healthy',
  runtime: { failures_since_start: 0 },
  build: { version: 'v8.0.56+archive', upstream_base: '585f97deac9aa57c700301221fb1a7085e1827cc' },
  index: {
    updated_at: '2026-11-05T12:00:00Z',
    records: 120,
    archive_files: 121,
    original_bytes: 1000000,
    archived_bytes: 200000,
    index_bytes: 10000,
    disk_free_bytes: 10000000,
    disk_total_bytes: 20000000,
    pending_plaintext_files: 0,
    latest_at: '2026-11-05T11:59:59Z',
    daily: [{ date: '2026-11-05', records: 120 }],
  },
};

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
function render(stats: RequestArchiveStats | null, state: 'ready' | 'unsupported' | 'error') {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: translator },
      createElement(MemoryRouter, null, createElement(RequestArchivePanelContent, { stats, state }))
    )
  );
}

describe('request archive contract', () => {
  test('normalizes backend metadata and UTC activity without exposing payloads', () => {
    const stats = normalizeRequestArchiveStats(payload);
    expect(stats.index?.records).toBe(120);
    expect(stats.index?.daily).toEqual([{ date: '2026-11-05', records: 120 }]);
    expect(stats.upstreamBase).toStartWith('585f97');
  });
  test('rejects unsupported or unknown contracts instead of implying healthy capture', () => {
    expect(() => normalizeRequestArchiveStats({})).toThrow();
    expect(() => normalizeRequestArchiveStats({ ...payload, index: null })).toThrow();
    expect(() =>
      normalizeRequestArchiveStats({ ...payload, index: { ...payload.index, records: -1 } })
    ).toThrow();
    expect(() => normalizeRequestArchiveStats({ ...payload, status: 'whatever' })).toThrow();
  });
  test('renders verified totals, comparison charts, snapshot time, and fork update guidance', () => {
    const markup = render(normalizeRequestArchiveStats(payload), 'ready');
    for (const text of [
      'Request archive',
      'Verified records',
      '120',
      'Before compression',
      'On disk',
      'last 7 days',
      '121 archive files',
      'Keeping your fork up to date',
    ]) {
      expect(markup).toContain(text);
    }
    expect(markup).toContain('sync-upstream.yml');
    expect(markup).toContain('585f97deac9a');
  });
  test('does not show healthy badges or fabricated zero totals when reporting is unavailable', () => {
    const unsupported = render(null, 'unsupported');
    expect(unsupported).toContain('Reporting unavailable');
    expect(unsupported).not.toContain('Verified records');
    const failed = render(null, 'error');
    expect(failed).toContain('Status unavailable');
    expect(failed).not.toContain('Recording</span>');
  });
  test('marks stale counts explicitly and supports zero-record healthy archives', () => {
    const stale = render(
      normalizeRequestArchiveStats({ ...payload, status: 'index_stale' }),
      'ready'
    );
    expect(stale).toContain('not live statistics');
    const empty = render(
      normalizeRequestArchiveStats({
        ...payload,
        index: {
          ...payload.index,
          records: 0,
          original_bytes: 0,
          archived_bytes: 0,
          latest_at: null,
          daily: [],
        },
      }),
      'ready'
    );
    expect(empty).not.toContain('NaN');
    expect(empty).not.toContain('Infinity');
    expect(empty).toContain('None yet');
  });
  test('all seven locales include the same archive keys and interpolation parameters', () => {
    const english = JSON.parse(
      readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8')
    ).request_archive;
    for (const locale of ['zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const translated = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      ).request_archive;
      expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english)) {
        expect([...translated[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()).toEqual(
          [...english[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
        );
      }
    }
  });
});
