import { expect, test } from 'bun:test';
import config from '../vite.config';

test('dev server forwards v8 management requests to the local backend without rewriting paths', () => {
  const proxy = config.server?.proxy?.['/v8/management'];
  expect(proxy).toEqual({
    target: 'http://127.0.0.1:8317',
    changeOrigin: true,
  });
  expect(config.server?.proxy?.['/v0/management']).toBeUndefined();
});
