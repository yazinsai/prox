import { expect, test } from 'bun:test';

// Separate processes keep timezone changes out of the other rendering suites.
const cases: { zone: string; date: number[]; hours: number; startHour?: number }[] = [
  { zone: 'Europe/Paris', date: [2026, 9, 25], hours: 25 },
  { zone: 'Europe/Paris', date: [2026, 2, 29], hours: 23 },
  { zone: 'America/New_York', date: [2026, 10, 1], hours: 25 },
  { zone: 'America/New_York', date: [2026, 2, 8], hours: 23 },
  { zone: 'Australia/Lord_Howe', date: [2026, 3, 5], hours: 24.5 },
  { zone: 'Australia/Lord_Howe', date: [2026, 9, 4], hours: 23.5 },
  { zone: 'UTC', date: [2026, 9, 25], hours: 24 },
  { zone: 'America/Santiago', date: [2026, 8, 6], hours: 23, startHour: 1 },
];

for (const { zone, date, hours, startHour = 0 } of cases) {
  test(`pool span, day columns and labels across ${zone} ${date.join('-')}`, () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        '--eval',
        `
          import { createElement } from 'react';
          import { renderToStaticMarkup } from 'react-dom/server';
          import './src/i18n/index';
          import { QuotaPoolChart } from './src/features/quota/components/QuotaPoolChart';
          import { poolSpan, poolDays, POOL_DAYS_BEFORE_TODAY, HOUR_MS }
            from './src/features/quota/pool/poolModel';
          // "Now" sits on the DST-transition day; the span starts a few days earlier,
          // so place the transition day at the span start by offsetting now.
          const transition = new Date(${date.join(',')}, 12);
          const now = new Date(transition);
          now.setDate(now.getDate() + POOL_DAYS_BEFORE_TODAY);
          const span = poolSpan(0, now.getTime());
          const days = poolDays(span);
          const markup = renderToStaticMarkup(createElement(QuotaPoolChart, {
            span, days, now: now.getTime(), yMax: 100, accent: '#000',
            recorded: [], projected: [{ atMs: now.getTime(), value: 50 }, { atMs: span.endMs, value: 50 }],
            jumps: [], formatAxis: String, formatDay: (ms) => 'D' + new Date(ms).getDate(),
            describe: () => '', nowLabel: 'Now', ariaLabel: 'chart',
          }));
          console.log(JSON.stringify({
            hours: days.map((day, index) => ((days[index + 1] ?? span.endMs) - day) / HOUR_MS),
            localHours: days.map((day) => new Date(day).getHours()),
            dates: days.map((day) => new Date(day).getDate()),
            endHour: new Date(span.endMs).getHours(),
            offsetHours: [-1, 1].map((offset) => new Date(poolSpan(offset, now.getTime()).startMs).getHours()),
            labels: [...markup.matchAll(/>D(\\d+)</g)].map((match) => match[1]),
          }));
        `,
      ],
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TZ: zone },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout.toString());

    expect(output.hours).toHaveLength(14);
    expect(output.hours[0]).toBe(hours);
    expect(output.localHours).toEqual([startHour, ...Array(13).fill(0)]);
    expect(new Set(output.dates).size).toBe(14);
    expect(output.endHour).toBe(0);
    expect(output.offsetHours).toEqual([0, 0]);
    expect(output.labels).toHaveLength(14);
    expect(new Set(output.labels).size).toBe(14);
  });
}
