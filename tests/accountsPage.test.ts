import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../src/i18n/index';
import { buildRoutingBoard } from '../src/services/api/routing';
import { draftFromBoard } from '../src/features/routing/logic';
import { TierLadder } from '../src/features/routing/components/TierLadder';
import {
  accountStatus,
  accountUsage,
  attentionCount,
} from '../src/features/accounts/accountStatus';
import { memberModels, resourceForMember } from '../src/features/accounts/resources';
import { AccountSheet } from '../src/features/accounts/components/AccountSheet';
import type { ProviderGroup, ProviderResource } from '../src/features/providers/types';
import type { AuthFileItem } from '../src/types/authFile';
import type { RoutingMember } from '../src/types/routing';

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

const NOW = 1_000_000;
const RAW = {
  'api-keys': {
    codex: [{ name: 'azure', priority: -20, keys: [{ 'api-key': 'sk-codex-aaaa' }] }],
    claude: [
      { name: 'claude-off', keys: [{ 'api-key': 'sk-claude-bbbb', 'excluded-models': ['*'] }] },
    ],
    'openai-compatibility': [
      { name: 'opencode', 'base-url': 'https://x.example/v1', keys: [{ 'api-key': 'k' }] },
    ],
  },
};
const cooldown = (scope: 'model' | 'credential', remainingSeconds: number, modelKey?: string) => ({
  scope,
  modelKey,
  reason: 'quota',
  retryAt: '',
  remainingSeconds,
});
const FILES: AuthFileItem[] = [
  {
    name: 'ready.json',
    type: 'claude',
    email: 'ready@example.com',
    successCount: 90,
    failureCount: 10,
  },
  {
    name: 'partial.json',
    type: 'antigravity',
    email: 'partial@example.com',
    cooldownSnapshot: {
      receivedAtMs: NOW,
      records: [cooldown('model', 7200, 'opus'), cooldown('model', 600, 'sonnet')],
    },
  },
  {
    name: 'cooling.json',
    type: 'codex',
    email: 'cooling@example.com',
    unavailable: true,
    cooldownSnapshot: { receivedAtMs: NOW, records: [cooldown('credential', 300)] },
  },
  {
    name: 'broken.json',
    type: 'codex',
    email: 'broken@example.com',
    unavailable: true,
    statusMessage: 'refresh token revoked',
    access_token: 'secret-token-never-rendered',
  },
];
const board = buildRoutingBoard(RAW, FILES);
const member = (key: string) => board.members.find((item) => item.key === key) as RoutingMember;
const file = (name: string) => FILES.find((item) => item.name === name);

describe('account status', () => {
  test('reads configuration for keys and runtime state for credentials', () => {
    expect(accountStatus(member('key:claude:0:0'), undefined, NOW)).toEqual({ kind: 'off' });
    // No runtime state exists for API keys, so they are on, never "ready".
    expect(accountStatus(member('key:codex:0:0'), undefined, NOW)).toEqual({ kind: 'on' });
    expect(accountStatus(member('cred:ready.json'), file('ready.json'), NOW)).toEqual({
      kind: 'ready',
    });
  });

  test('a whole-account cooldown wins over the unavailable flag it causes', () => {
    expect(accountStatus(member('cred:cooling.json'), file('cooling.json'), NOW)).toEqual({
      kind: 'cooling',
      seconds: 300,
      reason: 'quota',
    });
  });

  test('model cooldowns count models and report the soonest return, ticking down', () => {
    expect(accountStatus(member('cred:partial.json'), file('partial.json'), NOW + 100_000)).toEqual(
      { kind: 'partial', models: 2, seconds: 500, reason: 'quota' }
    );
    // Expired timers no longer count.
    expect(accountStatus(member('cred:partial.json'), file('partial.json'), NOW + 700_000)).toEqual(
      { kind: 'partial', models: 1, seconds: 6500, reason: 'quota' }
    );
  });

  test('unavailable without a cooldown needs attention and carries the server message', () => {
    const status = accountStatus(member('cred:broken.json'), file('broken.json'), NOW);
    expect(status).toEqual({ kind: 'problem', message: 'refresh token revoked' });
    expect(attentionCount([status, { kind: 'ready' }, { kind: 'on' }])).toBe(1);
  });

  test('usage is only shown for credentials that served something', () => {
    expect(accountUsage(file('ready.json'))).toEqual({ total: 100, failed: 10 });
    expect(accountUsage(file('partial.json'))).toBeNull();
    expect(accountUsage(undefined)).toBeNull();
  });
});

describe('account resources and models', () => {
  const resource = (patch: Partial<ProviderResource>) => ({ ...patch }) as ProviderResource;
  const groups: ProviderGroup[] = [
    {
      id: 'codex',
      resources: [
        resource({ id: 'a', brand: 'codex', apiKey: 'sk-other', name: 'azure' }),
        resource({ id: 'b', brand: 'codex', apiKey: 'sk-codex-aaaa', name: 'azure' }),
      ],
    },
    {
      id: 'openaiCompatibility',
      resources: [
        resource({ id: 'c', brand: 'openaiCompatibility', originalIndex: 0, name: 'opencode' }),
      ],
    },
  ];

  test('maps keys by key and compatible providers by position and name', () => {
    expect(resourceForMember(member('key:codex:0:0'), groups)?.id).toBe('b');
    expect(resourceForMember(member('compat:0'), groups)?.id).toBe('c');
    expect(resourceForMember(member('cred:ready.json'), groups)).toBeNull();
  });

  test('lists models from the catalog, sorted and unique, null while loading', () => {
    const catalog = { channels: {}, credentials: { 'ready.json': ['b', 'a', 'b'] } };
    expect(memberModels(member('cred:ready.json'), catalog)).toEqual(['a', 'b']);
    expect(memberModels(member('cred:partial.json'), catalog)).toBeNull();
  });
});

describe('account rendering', () => {
  test('rows report each account without a picked model', async () => {
    await i18n.changeLanguage('en');
    const draft = draftFromBoard(board);
    const statuses = new Map(
      board.members.map((item) => [
        item.key,
        accountStatus(
          item,
          file(item.location.kind === 'credential' ? item.location.name : ''),
          NOW
        ),
      ])
    );
    const html = renderToStaticMarkup(
      createElement(TierLadder, {
        members: new Map(board.members.map((item) => [item.key, item])),
        draft,
        priorities: {},
        model: null,
        preview: null,
        nowMs: NOW,
        theme: 'dark',
        entryControl: null,
        onMove: () => {},
        onStep: () => {},
        onEditWeights: () => {},
        statuses,
        usage: new Map([['cred:ready.json', { total: 100, failed: 10 }]]),
        onOpenMember: () => {},
      })
    );
    expect(html).toContain('Ready');
    expect(html).toContain('Needs attention');
    expect(html).toContain('2 models cooling');
    expect(html).toContain('Claude · Subscription');
    expect(html).toContain('Codex · API key');
    expect(html).toContain('100 requests');
    expect(html).toContain('10 failed');
    expect(html).toContain('aria-label="Open ready@example.com, Claude · Subscription"');
    expect(html).not.toContain('sk-codex-aaaa');
    expect(html).not.toContain('secret-token');
  });

  test('the account sheet leads with status and never shows credential contents', async () => {
    await i18n.changeLanguage('en');
    const target = member('cred:broken.json');
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(AccountSheet, {
          open: true,
          member: target,
          file: file('broken.json'),
          kindLabel: 'Codex · Subscription',
          icon: null,
          status: accountStatus(target, file('broken.json'), NOW),
          usage: null,
          tierIndex: 0,
          tierCount: 3,
          models: [],
          nowMs: NOW,
          actions: [
            { id: 'signin', label: 'Sign in again', onSelect: () => {} },
            { id: 'remove', label: 'Remove…', danger: true, onSelect: () => {} },
          ],
          onClose: () => {},
        })
      )
    );
    expect(html).toContain('Needs attention');
    expect(html).toContain('refresh token revoked');
    expect(html).toContain('Sign in again');
    expect(html).toContain('Group 1 of 3');
    expect(html).not.toContain('secret-token');
    expect(html).not.toContain('access_token');
  });

  test('styles respect reduced motion', () => {
    for (const path of [
      'src/features/accounts/AccountsPage.module.scss',
      'src/features/accounts/components/AccountSheet.module.scss',
      'src/features/accounts/components/AddAccountFlow.module.scss',
    ]) {
      expect(readFileSync(path, 'utf8')).toContain('@media (prefers-reduced-motion: reduce)');
    }
  });
});
