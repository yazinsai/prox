import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/features/quota/QuotaPage.tsx', 'utf8');
const styles = readFileSync('src/features/quota/QuotaPage.module.scss', 'utf8');

describe('quota toolbar presentation contracts', () => {
  test('uses a named, explicit clear action and restores input focus', () => {
    expect(source).toContain('type="search"');
    expect(source).toContain('ref={searchInputRef}');
    expect(source).toContain('{search && (');
    expect(source).toContain("aria-label={t('quota_management.search_clear')}");
    expect(source).toMatch(/handleSearchChange\(''\);\s*searchInputRef\.current\?\.focus\(\);/);
    expect(source).toContain('<IconX size={14} aria-hidden="true" />');
    expect(styles).toMatch(/&::-webkit-search-cancel-button,[\s\S]*?appearance: none;/);
  });

  test('keeps account search and sorting with the account cards, apart from provider navigation', () => {
    const accountsStart = source.indexOf('{showAccounts && !isTabEmpty && (');
    const toolbarStart = source.indexOf('<div className={styles.toolbar}>');
    const searchStart = source.indexOf('<div className={styles.search}>');
    const sortStart = source.indexOf('<div className={styles.sort}>');
    expect(accountsStart).toBeGreaterThan(source.indexOf('<QuotaProviderTabs'));
    expect(toolbarStart).toBeGreaterThan(accountsStart);
    expect(source.indexOf('<QuotaCard', toolbarStart)).toBeGreaterThan(sortStart);
    expect(searchStart).toBeGreaterThan(toolbarStart);
    expect(sortStart).toBeGreaterThan(searchStart);
    expect(styles).toMatch(/\.toolbar\s*\{[^}]*flex-wrap: wrap;/);
    expect(styles).toContain('&:focus-within');
    expect(styles).toContain('&:focus-visible');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
