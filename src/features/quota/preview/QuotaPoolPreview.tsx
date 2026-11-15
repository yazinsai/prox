/**
 * DEV-ONLY preview: quota pool panels across every outlook.
 *
 * Registered in App.tsx only when `import.meta.env.DEV` is true, outside the
 * auth guard, so it can be opened without a backend or real accounts:
 *   http://localhost:5173/#/__preview/quota-pools
 * Renders the real controls and QuotaPoolPanel over synthetic accounts. Copy
 * is intentionally not localized: this page never ships.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores';
import type { Theme } from '@/types';
import { QuotaControls } from '../components/QuotaControls';
import { QuotaPoolPanel } from '../components/QuotaPoolPanel';
import {
  DAY_MS,
  HOUR_MS,
  poolDays,
  poolSpan,
  summarizePool,
  type BurnWindowHours,
  type FutureUsage,
  type PoolAccount,
  type PoolPoint,
} from '../pool/poolModel';
import { POOL_ACCENTS, formatDateRange } from '../pool/poolFormat';
import type { QuotaProviderType } from '../providers/types';
import pageStyles from '../QuotaPage.module.scss';
import styles from './QuotaTierPreview.module.scss';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Hourly readings falling at `perHour` from `fromMs` to now, with a little texture. */
const usage = (now: number, fromMs: number, startValue: number, perHour: number): PoolPoint[] => {
  const points: PoolPoint[] = [];
  let value = startValue;
  for (let t = fromMs, i = 0; t <= now; t += HOUR_MS, i += 1) {
    points.push({ atMs: t, value });
    const night = new Date(t).getHours() < 7;
    value -= night ? 0 : perHour * (0.4 + ((i * 7919) % 13) / 10);
  }
  return points;
};

const account = (
  key: string,
  provider: QuotaProviderType,
  overrides: Partial<PoolAccount>
): PoolAccount => ({
  key,
  name: `${key}.json`,
  label: `${key}@example.com`,
  provider,
  remaining: 50,
  nextResetMs: null,
  periodMs: 7 * DAY_MS,
  history: [],
  source: 'live',
  ...overrides,
});

/** A recorded line ending exactly at `remaining` now. */
const withHistory = (
  now: number,
  remaining: number,
  perHour: number,
  hoursBack: number
): Pick<PoolAccount, 'remaining' | 'history'> => {
  const raw = usage(now, now - hoursBack * HOUR_MS, 0, perHour);
  const shift = remaining - raw[raw.length - 1].value;
  const history = raw.map((point) => ({
    atMs: point.atMs,
    value: Math.max(0, Math.min(100, point.value + shift)),
  }));
  // Keep the last few hours a straight, measurable burn.
  const tail = [3, 2, 1, 0].map((h) => ({
    atMs: now - h * HOUR_MS,
    value: remaining + h * perHour,
  }));
  return {
    remaining,
    history: [...history.filter((point) => point.atMs < now - 3 * HOUR_MS), ...tail],
  };
};

interface Scenario {
  title: string;
  provider: QuotaProviderType;
  accounts: PoolAccount[];
}

const buildScenarios = (now: number): Scenario[] => [
  {
    title: 'Tight: the screenshot case',
    provider: 'claude',
    accounts: [
      account('claude-main', 'claude', {
        ...withHistory(now, 42, 0.7, 70),
        nextResetMs: now + 61 * HOUR_MS,
      }),
    ],
  },
  {
    title: 'Runs out before the reset',
    provider: 'codex',
    accounts: [
      account('codex-main', 'codex', {
        ...withHistory(now, 31, 1.9, 60),
        nextResetMs: now + 2 * DAY_MS + 5 * HOUR_MS,
      }),
    ],
  },
  {
    title: 'Pool of four, comfortable',
    provider: 'claude',
    accounts: [0, 1, 2, 3].map((i) =>
      account(`claude-${i}`, 'claude', {
        ...withHistory(now, [88, 64, 71, 95][i], [0.5, 0.3, 0.4, 0.1][i], 72),
        nextResetMs: now + (14 + i * 31) * HOUR_MS,
      })
    ),
  },
  {
    title: 'Empty now',
    provider: 'antigravity',
    accounts: [
      account('ag', 'antigravity', {
        ...withHistory(now, 0, 0, 30),
        nextResetMs: now + 3 * DAY_MS + 2 * HOUR_MS,
      }),
    ],
  },
  {
    title: 'Idle',
    provider: 'codex',
    accounts: [
      account('codex-idle', 'codex', {
        ...withHistory(now, 78, 0, 30),
        nextResetMs: now + 4 * DAY_MS,
      }),
    ],
  },
  {
    title: 'No history recorded',
    provider: 'xai',
    accounts: [account('xai', 'xai', { remaining: 64, nextResetMs: now + 9 * DAY_MS })],
  },
];

export function QuotaPoolPreview() {
  const { i18n } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [burnWindowHours, setBurnWindowHours] = useState<BurnWindowHours>(3);
  const [futureUsage, setFutureUsage] = useState<FutureUsage>('same');
  const [rangeOffset, setRangeOffset] = useState(0);
  const [showAccounts, setShowAccounts] = useState(false);
  const [now] = useState(() => Date.now());
  const span = useMemo(() => poolSpan(rangeOffset, now), [rangeOffset, now]);
  const days = useMemo(() => poolDays(span), [span]);
  const scenarios = useMemo(() => buildScenarios(now), [now]);
  const locale = i18n.resolvedLanguage;

  return (
    <div className={styles.page}>
      <header className={styles.toolbar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Quota pools</h1>
          <p className={styles.subtitle}>Dev preview with synthetic accounts.</p>
        </div>
        <div className={styles.controls}>
          <div className={styles.segmented} role="group" aria-label="Theme">
            {THEMES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={styles.segment}
                aria-pressed={theme === option.value}
                onClick={() => setTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.replay}
            onClick={() => setShowAccounts((value) => !value)}
          >
            {showAccounts ? 'Hide accounts' : 'Show accounts'}
          </button>
        </div>
      </header>

      <QuotaControls
        burnWindowHours={burnWindowHours}
        futureUsage={futureUsage}
        rangeLabel={formatDateRange(span.startMs, span.endMs - 1, locale)}
        isCurrentRange={rangeOffset === 0}
        onBurnWindowChange={setBurnWindowHours}
        onFutureUsageChange={setFutureUsage}
        onPrevRange={() => setRangeOffset((value) => value - 1)}
        onNextRange={() => setRangeOffset((value) => value + 1)}
        onToday={() => setRangeOffset(0)}
      />

      <div className={pageStyles.pools}>
        {scenarios.map((scenario) => (
          <QuotaPoolPanel
            key={scenario.title}
            providerLabel={scenario.title}
            accent={POOL_ACCENTS[scenario.provider]}
            accountCount={scenario.accounts.length}
            summary={summarizePool(scenario.accounts, {
              now,
              span,
              burnWindowHours,
              futureUsage,
            })}
            burnWindowHours={burnWindowHours}
            span={span}
            days={days}
            now={now}
            showAccounts={showAccounts}
            showEmails={showAccounts}
          />
        ))}
      </div>
    </div>
  );
}
