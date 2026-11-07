import { describe, expect, test } from 'bun:test';
import { LANGUAGE_ORDER } from '@/utils/constants';

describe('document branding', () => {
  test('uses the prox title, app name, and favicon', async () => {
    const html = await Bun.file('index.html').text();

    expect(html).toContain('<title>prox · CLI Proxy API Management Center</title>');
    expect(html).toContain('<meta name="application-name" content="prox" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="prox" />');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('type="image/svg+xml"');
    expect(html).toContain("href=\"data:image/svg+xml,%3Csvg");
    expect(html).toContain("fill='%23171717'");
    expect(html).not.toContain('iconify--logos');
  });

  test('keeps the runtime title in sync with the static document title', async () => {
    const html = await Bun.file('index.html').text();
    const main = await Bun.file('src/main.tsx').text();
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];

    expect(title).toBe('prox · CLI Proxy API Management Center');
    expect(main).toContain(`document.title = '${title}'`);
  });

  test('surfaces prox in every locale title and management label', async () => {
    for (const language of LANGUAGE_ORDER) {
      const copy = await Bun.file(`src/i18n/locales/${language}.json`).json();

      expect(copy.title.login).toContain('prox');
      expect(copy.title.abbr).toBe('prox');
      expect(copy.splash.title).toBe('prox');
      expect(copy.system_info.about_title).toContain('prox');
    }
  });
});
