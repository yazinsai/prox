import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the top bar blocks underlying page content and pages start below it', () => {
  const layout = source('../src/styles/layout.scss');
  const bar = layout.slice(layout.indexOf('.topbar {'), layout.indexOf('.topbar-inner {'));
  expect(bar).toContain('background: color-mix(in srgb, var(--bg-secondary) 86%, transparent)');
  expect(bar).toContain('backdrop-filter');
  expect(layout).toContain('padding: calc(var(--header-height) + 24px) var(--frame-pad) 40px');
  expect(layout).toContain('padding: calc(var(--header-height) + 12px) 8px 24px');
});

test('route chips keep their status as text, not colour alone', () => {
  const chips = source('../src/features/dashboard/components/RouteChips.tsx');
  const styles = source('../src/features/dashboard/dashboard.module.scss');
  expect(chips).toContain('data-state={state}');
  expect(chips).toContain('t(`dashboard_live.chip_${state}`)');
  expect(styles).toContain("[data-state='cooling']");
  expect(styles).toContain('clip-path: inset(50%)');
});
