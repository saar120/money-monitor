// Run with npm run dashboard:dev. Uses a disposable database and simulated desktop services.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import puppeteer from 'puppeteer-core';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.env.MM_DESKTOP_SMOKE_SERVER === '1') {
  // No external financial providers, bank syncs, AI, Telegram, or Tailscale are contacted.
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith('https://www.boi.org.il/'))
      return Response.json({
        exchangeRates: [
          { key: 'USD', currentExchangeRate: 3.6 },
          { key: 'EUR', currentExchangeRate: 3.9 },
        ],
      });
    if (target.startsWith('https://api.coingecko.com/'))
      return Response.json({ bitcoin: { ils: 220000 } });
    throw new Error(`External requests are disabled in desktop smoke QA: ${target}`);
  };
  const connection = await import(`${root}src/db/connection.ts`);
  connection.swapToDemo();
  const { seedDemoData } = await import(`${root}src/db/demo-seed.ts`);
  seedDemoData(connection.db, connection.sqlite);
  const { createServer } = await import(`${root}src/server.ts`);
  const { app } = await createServer();
  const create = async (url, payload, method = 'POST') => {
    const result = await app.inject({ method, url: `/api${url}`, payload });
    assert(result.statusCode < 300, result.body);
    return result.json();
  };
  const crypto = await create('/assets', {
    name: 'Sample digital assets',
    type: 'crypto',
    currency: 'ILS',
    liquidity: 'liquid',
  });
  await create(`/assets/${crypto.id}/holdings`, {
    name: 'Sample Bitcoin',
    type: 'crypto',
    currency: 'BTC',
    quantity: 0.15,
    costBasis: 18000,
    lastPrice: 220000,
  });
  const pension = await create('/assets', {
    name: 'Sample pension',
    type: 'pension',
    currency: 'ILS',
    liquidity: 'locked',
  });
  await create(`/assets/${pension.id}/value`, { currentValue: 125500, contribution: 500 }, 'PUT');
  await create('/accounts', {
    companyId: 'oneZero',
    displayName: 'Sample One Zero',
    memberId: 1,
    credentials: { email: 'sample@example.invalid', password: 'synthetic-only' },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  process.send({ port: app.server.address().port });
} else {
  const dir = await mkdtemp(join(tmpdir(), 'money-monitor-screen-smoke-'));
  const child = fork(fileURLToPath(import.meta.url), [], {
    execArgv: ['--import', 'tsx'],
    env: {
      ...process.env,
      MM_DESKTOP_SMOKE_SERVER: '1',
      MONEY_MONITOR_DATA_DIR: dir,
      CREDENTIALS_MASTER_KEY: 'synthetic-desktop-qa-key',
      API_TOKEN: '',
      TELEGRAM_BOT_TOKEN: '',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_OAUTH_TOKEN: '',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      TYPESAFE_API_KEY: '',
      MOBILE_ACCESS_ENABLED: 'false',
    },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  let browser;
  const errors = [];
  const coverage = [];
  try {
    const [ready] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(([code]) => {
        throw new Error(`Fixture server exited: ${code}`);
      }),
    ]);
    const api = `http://127.0.0.1:${ready.port}`;
    const base = process.env.MM_DASHBOARD_URL ?? 'http://127.0.0.1:5173';
    browser = await puppeteer.launch({
      executablePath:
        process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
    });
    for (const [theme, language] of [
      ['light', 'en'],
      ['dark', 'he'],
    ]) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.evaluateOnNewDocument(
        (themeChoice, lang) => {
          localStorage.setItem('money-monitor-theme', themeChoice);
          localStorage.setItem('money-monitor-language', lang);
          let updateListener;
          let state = {
            enabled: true,
            transport: {
              status: 'running',
              diagnostic: 'ready',
              publicUrl: 'https://sample.invalid',
            },
            pairingAvailable: true,
            pendingRequests: [
              {
                pairingId: 'sample-request',
                status: 'pending_approval',
                deviceName: 'Sample iPhone',
                createdAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 300000).toISOString(),
              },
            ],
            devices: [
              {
                id: 'sample-phone',
                name: 'Sample paired iPhone',
                capabilities: ['read'],
                protocolVersion: 1,
                tokenVersion: 1,
                createdAt: new Date().toISOString(),
                lastUsedAt: null,
                revokedAt: null,
              },
            ],
          };
          window.electronAPI = {
            getAuthToken: () => '',
            getAppVersion: () => '0.6.0-qa',
            onOpenSettings: () => () => {},
            getAutoUpdateEnabled: async () => true,
            setAutoUpdateEnabled: async () => ({ success: true }),
            onUpdateStatus: (callback) => {
              updateListener = callback;
              return () => {};
            },
            checkForUpdates: async () => {
              updateListener?.({ status: 'up-to-date' });
              return { updateAvailable: false };
            },
            getMobileAccessState: async () => state,
            setMobileAccessEnabled: async (enabled) => {
              state = { ...state, enabled };
              return state;
            },
            retryMobileAccess: async () => state,
            createMobilePairing: async () => ({
              status: 'created',
              encodedPayload: 'synthetic-pairing-code',
              expiresAt: new Date(Date.now() + 300000).toISOString(),
            }),
            approveMobilePairing: async () => {
              state = { ...state, pendingRequests: [] };
              return { status: 'approved' };
            },
            rejectMobilePairing: async () => {
              state = { ...state, pendingRequests: [] };
              return { status: 'rejected' };
            },
            revokeMobileDevice: async () => state,
          };
        },
        theme,
        language,
      );
      let fixtureEvent = '';
      await page.setRequestInterception(true);
      page.on('request', async (request) => {
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/')) return request.continue();
        if (url.pathname === '/api/scrape/events')
          return request.respond({
            status: 200,
            contentType: 'text/event-stream',
            body: fixtureEvent
              ? `data: ${JSON.stringify({ type: fixtureEvent, accountId: 1, message: 'Synthetic sign-in prompt' })}\n\n`
              : ': synthetic QA\n\n',
          });
        if (url.pathname === '/api/scrape/otp' || url.pathname === '/api/scrape/manual-action')
          return request.respond({
            status: 200,
            contentType: 'application/json',
            body: '{"success":true}',
          });
        try {
          const response = await fetch(api + url.pathname + url.search, {
            method: request.method(),
            headers: { 'Content-Type': 'application/json' },
            ...(request.postData() ? { body: request.postData() } : {}),
            signal: AbortSignal.timeout(15000),
          });
          return request.respond({
            status: response.status,
            contentType: response.headers.get('content-type') ?? 'application/json',
            body: await response.text(),
          });
        } catch (error) {
          errors.push(`${url.pathname}: ${error.message}`);
          if (!request.isInterceptResolutionHandled()) await request.abort();
        }
      });
      const visit = async (route) => {
        await page.goto(base + route, { waitUntil: 'networkidle2' });
        assert(await page.$('h1'), `${route} has a page title`);
        assert.equal(await page.$eval('html', (el) => el.dataset.theme), theme);
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${route} does not overflow the window`,
        );
        coverage.push(`${theme}/${language} ${route}`);
      };
      const clickText = async (text, selector = 'button') => {
        const controls = await page.$$(selector);
        for (const control of controls) {
          if ((await control.evaluate((el) => el.textContent.trim())) === text) {
            await control.click();
            return;
          }
        }
        throw new Error(`Control missing: ${text}`);
      };
      const inspectMenus = async (scope) => {
        const controls = await page.$$(scope + ' button[role="combobox"]');
        for (const control of controls.slice(0, 8)) {
          const visible = await control.evaluate(
            (el) => !!el.getClientRects().length && !el.disabled,
          );
          if (!visible) continue;
          await control.click();
          await page.waitForSelector('[role="listbox"]');
          const within = await page.$eval('[role="listbox"]', (el) => {
            const rect = el.getBoundingClientRect();
            return (
              rect.left >= -1 &&
              rect.right <= innerWidth + 1 &&
              rect.top >= -1 &&
              rect.bottom <= innerHeight + 1
            );
          });
          assert(within, 'Dropdown remains within the viewport');
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.querySelector('[role="listbox"]'));
        }
      };
      const checkDialog = async () => {
        await page.waitForSelector('[role="dialog"]');
        const unnamed = await page.$$eval(
          '[role="dialog"] input:not([type="hidden"]):not([type="checkbox"]), [role="dialog"] textarea, [role="dialog"] [role="combobox"]',
          (fields) =>
            fields
              .filter(
                (field) =>
                  !field.disabled &&
                  !field.getAttribute('aria-label') &&
                  !field.getAttribute('aria-labelledby') &&
                  !field.labels?.length,
              )
              .map((field) => field.outerHTML),
        );
        assert.deepEqual(unnamed, [], 'Dialog fields have accessible labels');
        await inspectMenus('[role="dialog"]');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      };
      const month = new Date()
        .toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
        .slice(0, 7);
      const assets = await (await fetch(api + '/api/assets')).json();
      const routes = [
        '/',
        '/transactions',
        '/transactions/advanced',
        '/insights',
        '/insights/advanced',
        '/explore',
        '/explore/category/groceries',
        '/explore/merchant/AM%3APM',
        '/explore/monthly-comparison',
        '/cash-flow',
        '/recurring-payments',
        '/budgets',
        '/net-worth',
        ...assets.map((asset) => `/net-worth/assets/${asset.id}`),
        '/accounts',
        '/accounts/advanced',
        '/categories',
        '/categories/advanced',
        '/alerts',
        '/scraping',
        '/chat',
        '/settings',
      ];
      for (const route of routes) {
        await visit(`${route}?month=${month}`);
        if (route === '/transactions/advanced' || route === '/insights/advanced')
          await inspectMenus('main');
        if (route === '/accounts' || route === '/categories') {
          const editorActionsVisible = () => {
            const rect = document
              .querySelector('.category-inspector-actions')
              .getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight;
          };
          assert(await page.evaluate(editorActionsVisible), `${route} editor actions stay in view`);
          await page.$eval('.content-scroll', (el) => {
            el.scrollTop = 250;
          });
          assert(
            await page.evaluate(editorActionsVisible),
            `${route} editor actions remain visible while the list scrolls`,
          );
          await page.$eval('.category-inspector-body', (el) => {
            el.scrollTop = el.scrollHeight;
          });
          assert(
            await page.evaluate(editorActionsVisible),
            `${route} form scroll does not hide actions`,
          );
        }
      }
      await page.waitForSelector('#settings-ai input');
      const unnamedSettings = await page.$$eval(
        '.settings-page input:not([type="hidden"]):not([type="color"]), .settings-page [role="switch"], .settings-page [role="combobox"]',
        (fields) =>
          fields
            .filter(
              (field) =>
                !field.getAttribute('aria-label') &&
                !field.getAttribute('aria-labelledby') &&
                !field.labels?.length,
            )
            .map((field) => field.outerHTML),
      );
      assert.deepEqual(unnamedSettings, [], 'Settings fields are named');
      await inspectMenus('#settings-ai');
      await page.click('.management-toggle');
      await page.click('.management-links a[href="/categories"]');
      await page.waitForFunction(
        () =>
          location.pathname === '/categories' && !document.querySelector('.management-nav').open,
      );
      await page.click('.management-toggle');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.management-nav').open);
      assert(
        await page.$eval('.management-toggle', (el) => el === document.activeElement),
        'Escape restores Manage focus',
      );

      await visit(`/explore/category/groceries?month=${month}`);
      const historyLabels = await page.$$eval('.category-history button', (buttons) =>
        buttons.map((button) => button.textContent.trim()),
      );
      const next = new Date(`${month}-01T12:00:00`);
      next.setMonth(next.getMonth() + 1);
      const futureLabel = next.toLocaleDateString(language === 'he' ? 'he-IL' : 'en', {
        month: 'short',
      });
      assert(
        !historyLabels.at(-1).endsWith(futureLabel),
        'Category history ends with the selected month',
      );
      await visit('/net-worth');
      await clickText(language === 'he' ? 'הוספה' : 'Add');
      await page.waitForSelector('[role="menu"]');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await checkDialog();
      await visit('/budgets');
      await clickText(language === 'he' ? 'תקציב חדש' : 'New budget');
      await checkDialog();
      for (const asset of assets) {
        await visit(`/net-worth/assets/${asset.id}`);
        const text =
          asset.type === 'real_estate'
            ? language === 'he'
              ? 'עדכון שווי'
              : 'Update value'
            : asset.type === 'pension'
              ? language === 'he'
                ? 'עדכון שווי'
                : 'Update value'
              : asset.type === 'crypto'
                ? 'Add Coin'
                : language === 'he'
                  ? 'הוספת החזקה'
                  : 'Add holding';
        await clickText(text);
        await checkDialog();
      }
      await visit('/accounts/advanced?add=1');
      await checkDialog();
      for (const route of ['/accounts/advanced', '/scraping']) {
        for (const event of ['otp-required', 'manual-action-required']) {
          fixtureEvent = event;
          await visit(route);
          await checkDialog();
        }
      }
      fixtureEvent = '';
      for (const [width, height] of [
        [1280, 720],
        [800, 520],
        [390, 844],
      ]) {
        await page.setViewport({ width, height });
        await visit('/setup');
        const footerVisible = await page.$eval('.setup-footer', (el) => {
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight;
        });
        assert(footerVisible, `Setup actions fit ${width}×${height}`);
        if (width === 1280) {
          assert(
            await page.$eval('.setup-step', (el) => el.scrollHeight <= el.clientHeight + 1),
            'Desktop setup fits without an inner scroll',
          );
        }
        await page.click('.setup-token summary');
        await page.click('#setup-wizard-field-2');
        assert(
          await page.$eval('#setup-wizard-field-2', (el) => {
            const field = el.getBoundingClientRect();
            const body = el.closest('.setup-step').getBoundingClientRect();
            return field.top >= body.top - 1 && field.bottom <= body.bottom + 1;
          }),
          'The optional token field scrolls into view',
        );
      }
      await page.setViewport({ width: 1280, height: 800 });
      await visit('/setup');
      await clickText(language === 'he' ? 'דילוג' : 'Skip');
      await clickText(language === 'he' ? 'המשך' : 'Next');
      assert(
        (await page.content()).includes(language === 'he' ? 'הגדרות נוספות' : 'Optional settings'),
        'All setup steps are reachable',
      );
      coverage.push(`${theme}/${language} editors, keyboard menu, settings labels, setup steps`);
      console.log(
        `PASS ${theme}/${language}: ${routes.length + 1} screens, editor labels, keyboard menu, settings and setup`,
      );
      await page.close();
    }
    assert.deepEqual(errors, [], 'No browser or fixture errors');
    await writeFile(join(dir, 'coverage.json'), JSON.stringify(coverage, null, 2));
    console.log('All desktop screen smoke checks passed');
  } finally {
    await browser?.close();
    child.kill();
    await once(child, 'exit').catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}
