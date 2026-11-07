import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = readFileSync(new URL('../scripts/sync-local.sh', import.meta.url), 'utf8');
const start = script.indexOf('wait_for_proxy() {');
const healthCheck = script.slice(start, script.indexOf('\n}', start) + 2);

function checkHealth(status: string, curlExit = '0') {
  const directory = mkdtempSync(join(tmpdir(), 'prox-sync-health-'));
  try {
    writeFileSync(
      join(directory, 'curl'),
      '#!/bin/sh\nprintf "%s" "$HEALTH_STATUS"\nexit "$HEALTH_CURL_EXIT"\n',
      { mode: 0o700 }
    );
    writeFileSync(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    return Bun.spawnSync({
      cmd: ['bash', '-c', `${healthCheck}\nwait_for_proxy`],
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        PROXY_URL: 'http://127.0.0.1:8317',
        HEALTH_STATUS: status,
        HEALTH_CURL_EXIT: curlExit,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }).exitCode;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('local sync readiness', () => {
  test('accepts a responding management endpoint without sending credentials', () => {
    expect(checkHealth('401')).toBe(0);
    expect(checkHealth('200')).toBe(0);
  });

  test('rejects unavailable endpoints and failed connections', () => {
    expect(checkHealth('503')).toBe(1);
    expect(checkHealth('404')).toBe(1);
    expect(checkHealth('000', '7')).toBe(1);
  });
});
