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

test('compact route badges retain status text and accessible mobile labels', () => {
  const page = source('../src/features/dashboard/DashboardPage.tsx');
  const styles = source('../src/features/dashboard/dashboard.module.scss');
  expect(page).toContain('data-status={status}');
  expect(page).toContain('t(`dashboard_live.route_${status}`)');
  expect(styles).toContain("[data-status='cooling']");
  expect(styles).toContain('clip-path: inset(50%)');
});
