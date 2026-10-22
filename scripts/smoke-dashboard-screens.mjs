// Run with npm run dashboard:dev. Uses a disposable database and simulated desktop services.
import assert from 'node:assert/strict';

async function selectOption(page, trigger, value) {
  await page.click(trigger);
  await page.waitForSelector('[role="listbox"]', { visible: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option');
  await page.waitForFunction(() => {
    const rect = document.querySelector('[role="listbox"]').getBoundingClientRect();
    return (
      rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
    );
  });
  await page.click(`[role="option"][data-value="${value}"]`);
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="listbox"]') &&
      !document.querySelector('[role="combobox"][aria-expanded="true"]') &&
      getComputedStyle(document.body).pointerEvents !== 'none',
  );
}

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
  const { saveConfigFile } = await import(`${root}src/config.ts`);
  saveConfigFile({ ONBOARDING_COMPLETED: 'true' });
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
      page.on('pageerror', (error) =>
        errors.push(`${page.url()}: ${error.stack ?? error.message}`),
      );
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
      const advisorSessions = new Map();
      let advisorSessionCounter = 0;
      let advisorSends = 0;
      let advisorFailure = false;
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
        if (url.pathname.startsWith('/api/ai/sessions')) {
          const id = url.pathname.split('/')[4];
          let data;
          if (request.method() === 'POST') {
            const meta = {
              id: `synthetic-${++advisorSessionCounter}`,
              title: 'New conversation',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            advisorSessions.set(meta.id, { meta, messages: [] });
            data = { session: meta };
          } else if (request.method() === 'DELETE') {
            advisorSessions.delete(id);
            data = { deleted: true };
          } else
            data = id
              ? { session: advisorSessions.get(id) }
              : { sessions: [...advisorSessions.values()].map((item) => item.meta) };
          return request.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(data),
          });
        }
        if (url.pathname === '/api/ai/chat') {
          advisorSends++;
          const { sessionId, message } = JSON.parse(request.postData());
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (advisorFailure)
            return request.respond({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Synthetic provider unavailable' }),
            });
          const content =
            '## Spending review\n\nYour largest category is groceries.\n\n| Category | Amount |\n| --- | ---: |\n| Groceries | 320 |';
          const chart = {
            kind: 'bar',
            title: 'Sample spending',
            currencyCode: 'ILS',
            points: [
              { label: 'Groceries', value: 320 },
              { label: 'Dining', value: 180 },
            ],
          };
          const session = advisorSessions.get(sessionId);
          session.meta.title = 'Spending review';
          session.messages.push(
            { role: 'user', content: message },
            { role: 'assistant', content, chart },
          );
          const events = [
            { type: 'status', text: 'Reviewing sample data' },
            { type: 'text_delta', text: content },
            { type: 'chart', chart },
          ];
          return request.respond({
            status: 200,
            contentType: 'text/event-stream',
            body: events
              .map(({ type, ...data }) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
              .join(''),
          });
        }
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
        assert.equal(
          await page.$$eval('a[href*="/advanced"]', (links) => links.length),
          0,
          'No duplicate advanced destinations',
        );
        const sizes = await page.$$eval(
          '.ui-button, .category-add-button, .category-inspector-actions button, .proto-save, .proto-filter-button',
          (controls) =>
            controls
              .filter((el) => el.getClientRects().length)
              .map((el) => ({
                label: el.textContent.trim() || el.getAttribute('aria-label'),
                height: el.getBoundingClientRect().height,
              })),
        );
        assert.deepEqual(
          sizes.filter((item) => Math.abs(item.height - 36) > 1),
          [],
          `${route}: action heights are consistent`,
        );
        const unnamed = await page.$$eval('button', (controls) =>
          controls
            .filter(
              (el) =>
                el.getClientRects().length &&
                !el.textContent.trim() &&
                !el.getAttribute('aria-label') &&
                !el.getAttribute('aria-labelledby') &&
                !el.getAttribute('title') &&
                !['switch', 'combobox'].includes(el.getAttribute('role')),
            )
            .map((el) => el.outerHTML.slice(0, 250)),
        );
        assert.deepEqual(unnamed, [], `${route}: icon buttons have accessible names`);
        const fields = await page.$$eval('.ui-field', (controls) =>
          controls
            .filter((el) => el.getClientRects().length)
            .map((el) => ({
              label: el.getAttribute('aria-label') || el.id,
              height: el.getBoundingClientRect().height,
            })),
        );
        assert.deepEqual(
          fields.filter((item) => Math.abs(item.height - 36) > 1),
          [],
          `${route}: form heights are consistent`,
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
        for (const control of controls) {
          const visible = await control.evaluate(
            (el) => !!el.getClientRects().length && !el.disabled,
          );
          if (!visible) continue;
          await control.click();
          await page.waitForSelector('[role="listbox"]', { visible: true });
          await page.waitForFunction(
            () => document.activeElement?.getAttribute('role') === 'option',
          );
          const trigger = await control.boundingBox();
          const menu = await page.$eval('[role="listbox"]', (el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
          });
          assert(
            menu.top >= trigger.y + trigger.height + 3 || menu.bottom <= trigger.y - 3,
            'Dropdown opens outside its trigger, with a visible gap',
          );
          assert(
            await control.evaluate((el) => !el.matches(':focus-visible')),
            'Pointer opens do not show keyboard focus rings',
          );
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
          await page.waitForFunction(
            () =>
              !document.querySelector('[role="listbox"]') &&
              !document.querySelector('[role="combobox"][aria-expanded="true"]') &&
              getComputedStyle(document.body).pointerEvents !== 'none',
          );
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
        '/insights',
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
        '/categories',
        '/alerts',
        '/scraping',
        '/chat',
        '/settings',
      ];
      for (const route of routes) {
        await visit(`${route}?month=${month}`);
        for (const width of [1024, 1440]) {
          await page.setViewport({ width, height: 800 });
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            `${route}: fits ${width}px`,
          );
        }
        await page.setViewport({ width: 1280, height: 800 });
        if (route === '/') {
          await page.waitForSelector('.home-chart canvas');
          const geometry = () =>
            ['.home-chart', '.home-stats', '.home-section'].map((selector) => {
              const rect = document.querySelector(selector).getBoundingClientRect();
              return [rect.top, rect.height];
            });
          const before = await page.evaluate(geometry);
          const chart = await (await page.$('.home-chart canvas')).boundingBox();
          await page.mouse.move(chart.x + chart.width / 2, chart.y + chart.height / 2);
          await page.waitForFunction(
            () =>
              !document.querySelector('.home-chart-readout strong').classList.contains('invisible'),
          );
          assert.deepEqual(
            await page.evaluate(geometry),
            before,
            'Home stays fixed while hovering the chart',
          );
          await page.mouse.move(1, 1);
          await page.waitForFunction(() =>
            document.querySelector('.home-chart-readout strong').classList.contains('invisible'),
          );
          assert.deepEqual(
            await page.evaluate(geometry),
            before,
            'Home stays fixed when leaving the chart',
          );
          await inspectMenus('.toolbar-controls');
        }
        if (['/accounts', '/categories', '/insights'].includes(route))
          await inspectMenus('.content-inner');
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
      await page.click('[data-settings-tab="connections"]');
      await page.waitForSelector('#settings-ai input', { visible: true });
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
      await page.click('[data-settings-tab="advanced"]');
      assert(
        await page.$eval(
          '[data-household-section="rules"]',
          (el) => el.getClientRects().length > 0,
        ),
        'Ownership rules are available in Advanced',
      );
      await page.waitForSelector('#settings-sync input', { visible: true });
      assert(
        await page.$eval('#settings-ai', (el) => getComputedStyle(el).display === 'none'),
        'AI connection fields stay out of Advanced',
      );
      await page.click('[data-settings-tab="general"]');
      assert(
        await page.$eval(
          '[data-household-section="rules"]',
          (el) => el.getClientRects().length === 0,
        ),
        'Ownership rules stay out of General',
      );
      await inspectMenus('#settings-general');
      await page.click('.management-nav a[href="/categories"]');
      await page.waitForFunction(() => location.pathname === '/categories');
      assert.equal(
        await page.$eval('.management-nav a[href="/categories"]', (el) =>
          el.getAttribute('aria-current'),
        ),
        'page',
      );
      await clickText(language === 'he' ? 'סיווג מחדש' : 'Recategorize');
      await checkDialog();
      const colorInput = '.color-custom input';
      await page.click('.color-palette button:nth-child(3)');
      assert(
        await page.$eval(
          '.color-palette button:nth-child(3)',
          (el) => el.getAttribute('aria-pressed') === 'true',
        ),
      );
      await page.$eval(colorInput, (el) => {
        el.value = '#bad';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert(
        await page.$eval('.category-save', (el) => el.disabled),
        'Invalid colors cannot be saved',
      );
      await page.$eval(colorInput, (el) => {
        el.value = '#3478ab';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const colorSaved = page.waitForResponse(
        (response) =>
          response.url().includes('/api/categories/') && response.request().method() === 'PATCH',
      );
      await page.click('.category-save');
      const savedCategory = await (await colorSaved).json();
      assert.equal(savedCategory.category.color, '#3478ab', 'Custom category color persists');
      const colorRows = await page.$$('.category-list-row');
      await colorRows[1].click();
      await colorRows[0].click();
      assert.equal(
        await page.$eval(colorInput, (el) => el.value),
        '#3478ab',
        'Saved color survives inspector changes',
      );

      await visit('/chat');
      assert.equal(await page.$eval('.advisor-send', (el) => el.disabled), true);
      await page.type('.advisor-input', 'Review spending');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Shift');
      assert.equal(advisorSends, 0, 'Shift+Enter adds a line without sending');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.advisor-waiting');
      assert(
        await page.$eval('.history-actions button', (el) => el.disabled),
        'History cannot switch conversations during a reply',
      );
      await page.waitForSelector('.advisor-chart');
      assert.equal(advisorSends, 1);
      assert.equal(await page.$$eval('.advisor-message', (els) => els.length), 2);
      await page.waitForFunction(
        () => document.querySelector('.history-title')?.textContent === 'Spending review',
      );
      await page.click('.history-actions button');
      await page.waitForSelector('.advisor-welcome');
      await page.$$eval('.history-select', (els) =>
        els.find((el) => el.textContent.includes('Spending review')).click(),
      );
      await page.waitForSelector('.advisor-chart');
      assert(
        await page.$('.advisor-message-answer table'),
        'Saved replies retain formatted tables and charts',
      );
      await page.hover('.history-row-active');
      await page.click('.history-row-active .history-delete');
      await page.waitForSelector('.advisor-welcome');
      const createdBefore = advisorSessionCounter;
      await page.type('.advisor-input', 'Start again');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.advisor-chart');
      assert.equal(
        advisorSessionCounter,
        createdBefore + 1,
        'Sending after deleting the active conversation creates a fresh session',
      );
      advisorFailure = true;
      await page.type('.advisor-input', 'Try another request');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.advisor-message-answer')].some((el) =>
          el.textContent.includes('Synthetic provider unavailable'),
        ),
      );
      assert.equal(
        await page.$eval('.advisor-input', (el) => el.disabled),
        false,
        'Composer recovers after a provider error',
      );
      advisorFailure = false;

      await visit('/accounts');
      await clickText(language === 'he' ? 'עדכון פרטי כניסה' : 'Update sign-in details');
      await checkDialog();
      for (const legacy of ['transactions', 'accounts', 'categories', 'insights']) {
        await visit(`/${legacy}/advanced?month=${month}`);
        assert.equal(
          new URL(page.url()).pathname,
          `/${legacy}`,
          'Old bookmarks redirect to the canonical screen',
        );
      }
      const linked = (await (await fetch(api + '/api/transactions?limit=1&offset=70')).json())
        .transactions[0];
      assert(linked, 'Fixture provides a transaction beyond the first page');
      await visit(`/transactions/advanced?transactionId=${linked.id}`);
      assert.equal(
        await page.$eval('.proto-inspector h3', (el) => el.textContent.trim()),
        linked.description,
        'Legacy transaction links open the requested details',
      );
      await visit('/transactions');
      const filterTiming = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const start = performance.now();
            document.querySelector('.proto-filter-button').click();
            requestAnimationFrame(() => {
              const panel = document.querySelector('.proto-filter-popover');
              resolve({
                elapsed: performance.now() - start,
                visible: !!panel && getComputedStyle(panel).opacity === '1',
                delayed: panel?.getAnimations({ subtree: true }).length ?? 0,
              });
            });
          }),
      );
      assert(
        filterTiming.visible && !filterTiming.delayed,
        'Filter controls are visible on the first frame without staggered animations',
      );
      assert(filterTiming.elapsed < 150, `Filters open promptly (${filterTiming.elapsed}ms)`);
      console.log(`Filters ready in ${Math.round(filterTiming.elapsed)}ms (${theme}/${language})`);
      await inspectMenus('.proto-filter-popover');
      assert.equal(
        await page.$$eval('.proto-filter-popover [role=combobox]', (fields) => fields.length),
        7,
        'All transaction filters are available',
      );
      assert(
        await page.$('.proto-filter-popover input[type="date"]'),
        'Date range filter is available',
      );
      const direction = '.proto-filter-popover label:nth-of-type(6) [role=combobox]';
      const incomeResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/transactions?') &&
          new URL(response.url()).searchParams.get('minAmount') === '0.01',
      );
      await selectOption(page, direction, 'income');
      assert(await page.$('.proto-filter-popover'), 'Selecting a nested option keeps filters open');
      assert.equal((await incomeResponse).status(), 200);
      await page.waitForFunction(
        () =>
          document.querySelectorAll('.proto-amount').length > 0 &&
          [...document.querySelectorAll('.proto-amount')].every((el) =>
            el.classList.contains('positive'),
          ),
      );
      await page.click('.proto-clear');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.proto-filter-popover'));
      assert(
        await page.$eval('.proto-filter-button', (el) => el === document.activeElement),
        'Closing filters returns focus to its trigger',
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
      await page.$$eval(
        'button',
        (buttons, name) => buttons.find((button) => button.textContent.trim() === name).click(),
        assets[0].name,
      );
      await page.waitForFunction(
        (id) => location.pathname === `/net-worth/assets/${id}`,
        {},
        assets[0].id,
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
      await visit('/accounts');
      await page.$$eval('.account-list-row', (rows) =>
        rows.find((row) => row.textContent.includes('Sample One Zero')).click(),
      );
      await page.click('.account-import-link');
      await checkDialog();
      await page.click('.category-inspector-actions .ui-button');
      await page.waitForSelector('[role="alertdialog"]');
      await clickText(language === 'he' ? 'ביטול' : 'Cancel', '[role="alertdialog"] button');
      assert(
        await page.$('.account-inspector-balance'),
        'Cancel deletion preserves the selected account',
      );
      await visit('/accounts?add=1');
      await checkDialog();
      for (const route of ['/accounts', '/scraping']) {
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
        await clickText(language === 'he' ? 'המשך' : 'Continue');
        await page.waitForFunction(() => document.querySelector('.setup-step h2'));
        assert.equal(
          await page.$$eval('.setup-page input', (fields) => fields.length),
          0,
          'Onboarding does not ask for technical credentials',
        );
      }
      await page.setViewport({ width: 1280, height: 800 });
      await visit('/setup');
      await clickText(language === 'he' ? 'המשך' : 'Continue');
      await clickText(language === 'he' ? 'הוספת חשבון ראשון' : 'Add your first account');
      await page.waitForFunction(() => location.pathname === '/accounts');
      await page.waitForSelector('[role="dialog"]', { visible: true });
      await selectOption(page, '#account-manager-field-2', 'leumi');
      assert.equal(
        await page.$eval('#account-manager-field-3', (el) => el.value),
        language === 'he' ? 'בנק לאומי' : 'Bank Leumi',
        'Bank selection suggests an account name',
      );
      const saveLabel = language === 'he' ? 'שמירה' : 'Save';
      assert(
        await page.$$eval(
          '[role="dialog"] button',
          (buttons, label) =>
            buttons.find((button) => button.textContent.trim() === label)?.disabled,
          saveLabel,
        ),
        'Account cannot be saved without sign-in details',
      );
      await page.type(
        `[role="dialog"] input[aria-label="${language === 'he' ? 'שם משתמש' : 'Username'}"]`,
        'synthetic-user',
      );
      await page.type('[role="dialog"] input[type="password"]', 'synthetic-password');
      await clickText(saveLabel, '[role="dialog"] button');
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      await page.waitForSelector('.account-sync-button');
      assert(
        (await page.$eval('.category-inspector-body', (el) => el.textContent)).includes(
          language === 'he' ? 'החשבון נוסף.' : 'Your account is added.',
        ),
        'New account explains the next step',
      );
      await visit('/setup');
      await clickText(language === 'he' ? 'המשך' : 'Continue');
      await clickText(language === 'he' ? 'אחבר חשבון בהמשך' : 'I’ll do this later');
      await page.waitForFunction(() => location.pathname === '/');
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
