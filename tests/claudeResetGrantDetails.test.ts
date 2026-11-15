import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { ClaudeResetGrantDetails } from '@/features/quota/providers/claude/ClaudeResetGrantDetails';
import {
  groupResetGrants,
  resetGrantHint,
  resetGrantKind,
  resetGrantWindows,
  type ResetGrantGroup,
  type ResetGrantHint,
} from '@/features/quota/providers/claude/resetGrantSummary';
import { usableResetGrants } from '@/features/quota/providers/claude/selectResetGrant';
import { bindQuotaClasses, QUOTA_CLASS_KEYS } from '@/features/quota/types';
import type {
  AnthropicResetGrant,
  AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);
const day = 86400_000;
const soon = new Date(Date.now() + 25 * day + 3600_000).toISOString();
const later = new Date(Date.now() + 113 * day + 3600_000).toISOString();
// Shapes mirror a live cedar_ember response: full grants clear 5-hour + 7-day,
// Fable launch grants clear 5-hour + Fable and set gives_back_weekly.
const grant = (overrides: Partial<AnthropicResetGrant> = {}): AnthropicResetGrant => ({
  id: 'full',
  label: 'One full limit reset',
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: null,
  endsAt: soon,
  clears: ['five_hour', 'seven_day', 'seven_day_overage_included'],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  percentUsed: {},
  type: 'full',
  givesBackWeekly: false,
  ...overrides,
});
const fable = (id: string, label: string) =>
  grant({
    id,
    label,
    endsAt: later,
    clears: ['five_hour', 'seven_day_overage_included'],
    givesBackWeekly: true,
  });
const status = (overrides: Partial<AnthropicResetGrantStatus> = {}): AnthropicResetGrantStatus => ({
  eligible: true,
  ineligibleReason: null,
  atLimit: false,
  grants: [grant()],
  nextGrantId: 'full',
  weeklyResetsAt: null,
  cooldownUntil: null,
  ...overrides,
});
const render = (
  groups: ResetGrantGroup[],
  { hint = null, left = 1, useDisabled = false } = {} as {
    hint?: ResetGrantHint | null;
    left?: number | null;
    useDisabled?: boolean;
  }
) =>
  renderToStaticMarkup(
    createElement(ClaudeResetGrantDetails, {
      left,
      groups,
      hint,
      cooldownUntil: null,
      useDisabled,
      busy: false,
      onUse: () => {},
      classes,
    })
  );

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('Claude reset grant summary', () => {
  test('classifies grants the way Claude Code does', () => {
    expect(resetGrantKind(grant())).toBe('full');
    expect(resetGrantKind(fable('f', 'Fable'))).toBe('fable');
    expect(resetGrantKind(grant({ type: null, clears: ['five_hour'] }))).toBe('session');
    expect(resetGrantKind(grant({ type: null, clears: ['seven_day'] }))).toBe('weekly');
    expect(resetGrantKind(grant({ type: null }))).toBe('full');
    expect(resetGrantKind(grant({ type: 'session' }))).toBe('session');
    expect(resetGrantKind(grant({ type: null, clears: [] }))).toBe('other');
  });

  test('a Fable reset also touches the 7-day window it gives back to', () => {
    expect(resetGrantWindows(fable('f', 'F'))).toEqual([
      'five_hour',
      'seven_day',
      'seven_day_overage_included',
    ]);
    expect(resetGrantWindows(grant({ clears: ['five_hour'] }))).toEqual(['five_hour']);
  });

  test('merges same-kind grants, leads with the suggestion, and targets a usable grant', () => {
    const grants = [
      fable('fable-a', 'New model launch: one Fable reset'),
      fable('fable-b', 'one more Fable reset at 12 months'),
      grant({ id: 'free', label: 'Free limit reset', endsAt: later }),
      grant(),
      grant({ id: 'spent', resetsLeft: 0 }),
    ];
    const s = status({ grants, nextGrantId: 'free' });
    const usable = usableResetGrants(s, Date.now()).map((item) => item.id);
    const groups = groupResetGrants(grants, 'free', usable);
    expect(
      groups.map((group) => [group.kind, group.left, group.suggested, group.targetId])
    ).toEqual([
      ['full', 1, true, 'free'],
      ['full', 1, false, 'full'],
      ['fable', 2, false, 'fable-a'],
    ]);
    expect(groups[2].labels).toEqual([
      'New model launch: one Fable reset',
      'one more Fable reset at 12 months',
    ]);
    expect(groupResetGrants([grant({ paused: true })], null, [])[0].targetId).toBeUndefined();
  });

  test('explains why nothing can be spent', () => {
    const now = Date.now();
    expect(resetGrantHint(status(), true, now)).toBeNull();
    expect(resetGrantHint(status({ eligible: false }), false, now)).toBe('ineligible');
    expect(resetGrantHint(status({ grants: [grant({ resetsLeft: 0 })] }), false, now)).toBe('none');
    expect(
      resetGrantHint(status({ cooldownUntil: new Date(now + day).toISOString() }), false, now)
    ).toBe('cooldown');
    expect(
      resetGrantHint(status({ grants: [grant({ useRequiresLimit: true })] }), false, now)
    ).toBe('needs_limit');
    expect(resetGrantHint(status({ grants: [grant({ paused: true })] }), false, now)).toBe(
      'unavailable'
    );
  });
});

describe('Claude reset grant details', () => {
  const groups = () =>
    groupResetGrants([grant(), fable('a', 'Fable A'), fable('b', 'Fable B')], 'full', [
      'full',
      'a',
      'b',
    ]);

  test('names each kind by what it refills, with a Use button per row', () => {
    const markup = render(groups(), { left: 3 });
    expect(markup).toContain('Limit resets');
    expect(markup).toContain('3 left');
    expect(markup).toContain('Full reset');
    expect(markup).toContain('Refills the 5-hour and 7-day limits');
    expect(markup).toContain('Fable reset');
    expect(markup).toContain('×2');
    expect(markup).toContain('returns what Fable used this week to the 7-day limit');
    expect(markup).toContain('Expires in 25 days');
    expect(markup).toContain('Expires in 113 days');
    expect(markup).toContain('never moves your weekly reset day');
    expect(markup.match(/>Suggested</g)).toHaveLength(1);
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Use Fable reset (Expires in 113 days)"');
    expect(markup).not.toContain('disabled');
    expect(markup.indexOf('Full reset')).toBeLessThan(markup.indexOf('Fable reset'));
    // Upstream wording survives only as a tooltip.
    expect(markup).toContain('title="Fable A\nFable B"');
    expect(markup).not.toContain('>Fable A');
  });

  test('disables Use buttons without a usable grant or while blocked', () => {
    expect(render(groups(), { useDisabled: true }).match(/disabled=""/g)).toHaveLength(2);
    const markup = render(groupResetGrants([grant({ endsAt: null })], null, []), {
      hint: 'needs_limit',
    });
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Can’t be used right now');
    expect(markup).toContain('Expiry unknown');
    expect(markup).toContain('Available once this account hits a limit.');
  });

  test.each(['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr'])(
    'translates every label in %s',
    async (lng) => {
      await i18n.changeLanguage(lng);
      try {
        const all = groupResetGrants(
          [
            grant({ endsAt: null }),
            fable('f', 'F'),
            grant({ id: 's', type: 'session' }),
            grant({ id: 'w', type: 'weekly' }),
            grant({ id: 'o', type: null, clears: [] }),
          ],
          'f',
          []
        );
        for (const hint of ['ineligible', 'none', 'cooldown', 'needs_limit', 'unavailable']) {
          const markup = render(all, { hint: hint as ResetGrantHint });
          expect(markup).not.toContain('claude_reset.');
        }
      } finally {
        await i18n.changeLanguage('en');
      }
    }
  );
});
