import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('every quota list load schedules fresh quota for all supported credentials', () => {
  const quota = source('features/quota/QuotaPage.tsx');
  const loadFiles = quota.slice(
    quota.indexOf('const loadFiles ='),
    quota.indexOf('/* ---------- 额度缓存')
  );
  expect(loadFiles).toContain('pendingRefreshRef.current = sessionGeneration');
  expect(quota).toContain('void loadTabQuota(entries)');
  expect(quota).not.toContain('useDevinQuotaAutoLoad(');
});

test('dashboard and system bypass configuration and model TTLs on entry', () => {
  const dashboard = source('features/dashboard/hooks/useDashboardOverview.ts');
  const system = source('pages/SystemPage.tsx');
  expect(dashboard).toContain('void fetchConfig(true).catch');
  expect(dashboard).toContain('fetchModelsFromStore(apiBase, apiKeys[0], true)');
  expect(system).toContain('fetchConfig(true).catch');
  expect(system).toContain('fetchModels({ forceRefresh: true });');
});
