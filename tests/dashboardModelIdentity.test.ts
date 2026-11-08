import { expect, test } from 'bun:test';
import { normalizeDashboardRoutes, normalizeDashboardSummary } from '../src/services/api/dashboard';
import { normalizeModelPins } from '../src/features/dashboard/modelPins';
import { modelIdentity, modelLabel } from '../src/utils/modelIdentity';

const now = '2026-11-07T12:00:00Z';
test('one Sonnet entry preserves both provider routes', () => {
  const models = normalizeDashboardRoutes({
    observed_at: now,
    runtime_known: true,
    models: ['claude-sonnet-5-5-high', 'claude-sonnet-5-5'].map((id, index) => ({
      id,
      label: id,
      routes: [
        { provider: `provider-${index}`, priority: index, ready_credentials: 1, status: 'ready' },
      ],
    })),
  }).models;
  expect(models).toHaveLength(1);
  expect(models[0].label).toBe('Claude Sonnet 5.5');
  expect(models[0].routes.map((route) => route.provider)).toEqual(['provider-0', 'provider-1']);
  expect(modelLabel('claude-sonnet-5-5-high', models)).toBe('Claude Sonnet 5.5');
});

test('usage and stored pins consolidate without losing counts', () => {
  const summary = normalizeDashboardSummary({
    supported: true,
    observed_at: now,
    coverage_start: now,
    partial: false,
    window: '8h',
    total: 3,
    success: 2,
    failed: 1,
    by_model: [
      { id: 'claude-sonnet-5-5', total: 2, success: 1, failed: 1 },
      { id: 'claude-sonnet-5-5-high', total: 1, success: 1, failed: 0 },
    ],
    by_provider: [],
  });
  expect(summary.byModel).toEqual([{ id: 'claude-sonnet-5-5', total: 3, success: 2, failed: 1 }]);
  expect(normalizeModelPins(['claude-sonnet-5-5-high', 'claude-sonnet-5-5'])).toEqual([
    'claude-sonnet-5-5',
  ]);
});

test('known equivalent variants merge while distinct models and namespaces stay separate', () => {
  for (const id of ['claude-opus-5-5', 'gemini-4-argon', 'gemini-3.8-flash']) {
    expect(modelIdentity(`${id}-high`).id).toBe(id);
  }
  for (const id of [
    'kimi-k2-thinking',
    'claude-opus-4-6-thinking',
    'custom-high',
    'devin/claude-sonnet-5-5-high',
  ]) {
    expect(modelIdentity(id).id).toBe(id);
  }
});
