import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('shared header blocks underlying page content and mobile spacing follows its height', () => {
  const layout = source('../src/styles/layout.scss');
  const header = layout.slice(
    layout.indexOf('.main-header {'),
    layout.indexOf('.mobile-sidebar-actions,', layout.indexOf('.main-header {'))
  );
  expect(header).toContain('background: var(--bg-secondary)');
  expect(header).not.toContain('background: transparent');
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
