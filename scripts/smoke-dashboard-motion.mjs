// Run against npm run dashboard:dev; all API responses use synthetic data.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const baseUrl = process.env.MM_DASHBOARD_URL ?? 'http://127.0.0.1:5173';
const errors = [];
try {
  for (const [width, language, motion] of [
    [1440, 'en', 'no-preference'],
    [390, 'he', 'no-preference'],
    [390, 'en', 'reduce'],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: motion }]);
    await page.evaluateOnNewDocument(
      (lang) => localStorage.setItem('money-monitor-language', lang),
      language,
    );
    await page.evaluateOnNewDocument(() => {
      window.motionTransitions = [];
      const start = document.startViewTransition?.bind(document);
      if (start)
        document.startViewTransition = (callback) => {
          const transition = start(callback);
          transition.ready.then(
            () => window.motionTransitions.push('ready'),
            (error) => window.motionTransitions.push(error.message),
          );
          return transition;
        };
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (!u.pathname.startsWith('/api/')) return req.continue();
      const row = {
        id: 1,
        accountId: 1,
        description: 'Sample market',
        reportingDate: '2026-09-25',
        date: '2026-09-25',
        chargedAmount: -125.5,
        chargedCurrency: 'ILS',
        category: 'groceries',
        expenseOwnerType: 'shared',
        ignored: false,
        needsReview: true,
        reviewReason: 'Check category',
      };
      let data = {};
      if (u.pathname === '/api/settings') data = { needsSetup: false, demoMode: true };
      else if (u.pathname === '/api/accounts')
        data = { accounts: [{ id: 1, displayName: 'Sample account', isActive: true }] };
      else if (u.pathname === '/api/categories')
        data = {
          categories: [
            { name: 'groceries', label: 'Groceries', color: '#377be9' },
            { name: 'dining', label: 'Dining', color: '#ea9865' },
          ],
        };
      else if (u.pathname === '/api/members') data = { members: [] };
      else if (u.pathname === '/api/transactions/summary') {
        const key = (u.searchParams.get('startDate') ?? '2026-09').slice(0, 7);
        const scale = (Number(key.slice(-2)) % 4) + 1;
        const group = u.searchParams.get('groupBy');
        const categories = [
          { category: 'groceries', totalAmount: -350 * scale, count: 4 },
          { category: 'dining', totalAmount: -240 * (5 - scale), count: 3 },
        ];
        data = {
          summary:
            group === 'cashflow'
              ? [{ income: 9000, expense: 1700 * scale }]
              : group === 'day'
                ? Array.from({ length: 25 }, (_, i) => ({
                    day: `${key}-${String(i + 1).padStart(2, '0')}`,
                    totalAmount: -((i % 5) + 1) * 12 * scale,
                  }))
                : group === 'month' || group === 'spending-category-month'
                  ? Array.from({ length: 12 }, (_, i) => ({
                      month: `2026-${String(i + 1).padStart(2, '0')}`,
                      totalAmount: -((i % 4) + 1) * 970,
                    }))
                  : categories,
        };
      } else if (u.pathname === '/api/transactions') {
        const transactions = Array.from({ length: 4 }, (_, index) => ({
          ...row,
          id: index + 1,
          description: ['Sample market', 'Sample cafe', 'Sample bakery', 'Sample restaurant'][
            index
          ],
          category: index % 2 ? 'dining' : 'groceries',
        })).filter(
          (item) =>
            !u.searchParams.get('category') || item.category === u.searchParams.get('category'),
        );
        data = { transactions, pagination: { total: transactions.length, hasMore: false } };
      } else if (u.pathname === '/api/budgets/progress') data = { progress: [] };
      else if (u.pathname === '/api/recurring-payments')
        data = {
          totals: [{ currencyCode: 'ILS', monthlyCost: 50, annualCost: 600 }],
          payments: [
            {
              accountId: 1,
              merchantKey: 'sample-stream',
              name: 'Sample streaming',
              accountName: 'Sample account',
              currencyCode: 'ILS',
              usualAmount: 50,
              monthlyCost: 50,
              annualCost: 600,
              frequency: 'monthly',
              occurrences: 6,
              lastChargeDate: '2026-09-20',
              nextExpectedDate: '2026-10-20',
              confidence: 'likely',
              kind: 'subscription',
              source: 'automatic',
            },
          ],
          suggestions: [],
          excluded: [],
        };
      else data = { count: 1, total: 25000 };
      req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(`${baseUrl}/transactions?month=2026-09`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.proto-table tbody tr[tabindex]');
    assert(
      await page.$eval(
        '.proto-table-scroll',
        (el) => el.clientWidth - el.querySelector('table').getBoundingClientRect().width >= 15,
      ),
      'Scrollbar has space outside transaction cells',
    );

    await page.click('.proto-filter-button');
    await new Promise((r) => setTimeout(r, 500));
    const filterBox = await page.$eval('.proto-filter-popover', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    assert(filterBox.left >= 0 && filterBox.right <= width + 1, 'Filter stays within viewport');
    await page.click('.proto-popover-head button');
    await page.waitForSelector('.proto-filter-popover', { hidden: true });
    if (await page.$('.proto-inspector-head button')) {
      await page.click('.proto-inspector-head button');
      await page.waitForSelector('.proto-inspector', { hidden: true });
    }
    await page.click('.proto-table tbody tr[tabindex]');
    await page.waitForSelector('.proto-inspector');
    assert.equal(
      await page.$$eval('.transaction-amount-flight', (els) => els.length),
      0,
      'No flying transaction amount',
    );
    await new Promise((r) => setTimeout(r, 280));
    const box = await page.$eval('.proto-inspector', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    assert(box.left >= 0 && box.right <= width + 1, 'Inspector stays in viewport');
    await page.click('.proto-inspector-head button');
    await page.waitForSelector('.proto-inspector', { hidden: true });
    assert.equal(
      await page.$$eval('.transaction-amount-flight', (els) => els.length),
      0,
      'No orphan amount after close',
    );
    // Open, close and reopen before the previous exit completes.
    await page.click('.proto-table tbody tr[tabindex]');
    await page.waitForSelector('.proto-inspector-head button');
    await page.evaluate(() => {
      document.querySelector('.proto-inspector-head button').click();
      document.querySelector('.proto-table tbody tr[tabindex]').click();
    });
    await new Promise((r) => setTimeout(r, 280));
    assert.equal(await page.$$eval('.proto-inspector', (els) => els.length), 1);
    await page.click('.proto-inspector-head button');
    await page.waitForSelector('.proto-inspector', { hidden: true });
    await page.$eval('#proto-row-3', (el) => {
      el.dataset.retained = 'yes';
    });
    await page.click('.proto-filter-button');
    await page.select('.proto-filter-popover select', 'groceries');
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '.proto-table tbody tr[tabindex]:not(.ledger-reflow-leave-active)',
        ).length === 2,
    );
    assert.equal(
      await page.$eval('#proto-row-3', (el) => el.dataset.retained),
      'yes',
      'Filtering preserves surviving row elements',
    );
    if (motion !== 'reduce')
      assert(
        await page.$eval('#proto-row-3', (el) => el.getAnimations().length > 0),
        'Remaining row moves into the gap',
      );
    await new Promise((r) => setTimeout(r, 550));
    assert.equal(await page.$$eval('.proto-table tbody tr[tabindex]', (els) => els.length), 2);
    await page.goto(`${baseUrl}/insights`, { waitUntil: 'networkidle0' });
    await page.click('.review-list tbody tr');
    await page.waitForSelector('.review-inspector');
    await page.click('.review-inspector-head button');
    await page.waitForSelector('.review-inspector', { hidden: true });
    await page.goto(`${baseUrl}/explore`, { waitUntil: 'networkidle0' });
    const before = await page.$eval('input[type=month]', (el) => el.value);
    await page.click('.month-stepper button:first-child');
    await page.waitForFunction(
      (old) => document.querySelector('input[type=month]').value !== old,
      {},
      before,
    );
    await new Promise((r) => setTimeout(r, 250));
    await page.waitForFunction(
      () => document.querySelectorAll('.month-stepper-current > span').length === 1,
    );
    await page.click('.nav-disclosure');
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(await page.$eval('.nav-reveal', (el) => el.inert), false);
    await page.click('.nav-disclosure');
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(await page.$eval('.nav-reveal', (el) => el.inert), true);
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'No horizontal page overflow',
    );
    await page.goto(`${baseUrl}/?month=2026-09`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.home-chart canvas');
    assert.equal(
      await page.$$eval('.chart-scrub-control', (els) => els.length),
      0,
      'No separate date slider',
    );
    const endAmount = await page.$eval('.home-chart-heading strong', (el) => el.textContent);
    await page.focus('.home-chart');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() =>
      document.querySelector('.home-chart-title').textContent.includes('2026-09-03'),
    );
    await new Promise((r) => setTimeout(r, 550));
    assert.notEqual(
      await page.$eval('.home-chart-heading strong', (el) => el.textContent),
      endAmount,
      'Scrubbing changes amount',
    );
    await page.$eval('.home-page', (el) => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerType: 'touch',
          clientX: 100,
          clientY: 180,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerType: 'touch',
          clientX: 280,
          clientY: 180,
          bubbles: true,
        }),
      );
    });
    const swipedMonth = language === 'he' ? '2026-10' : '2026-08';
    await page.waitForFunction(
      (expected) => document.querySelector('input[type=month]').value === expected,
      {},
      swipedMonth,
    );
    await page.$eval('.home-page', (el) => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerType: 'touch',
          clientX: 100,
          clientY: 100,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerType: 'touch',
          clientX: 110,
          clientY: 300,
          bubbles: true,
        }),
      );
    });
    assert.equal(
      await page.$eval('input[type=month]', (el) => el.value),
      swipedMonth,
      'Vertical scrolling does not change month',
    );
    await page.click('.category-ledger-row');
    await page.waitForSelector('.category-detail-hero');
    await new Promise((r) => setTimeout(r, 700));
    assert(
      await page.$eval('.category-detail-hero', (el) =>
        getComputedStyle(el).viewTransitionName.startsWith('category-'),
      ),
    );
    await page.click('.detail-back');
    await page.waitForSelector('.explore-row');
    await new Promise((r) => setTimeout(r, 750));
    const transitions = await page.evaluate(() => window.motionTransitions);
    assert.deepEqual(
      transitions,
      motion === 'reduce' ? [] : ['ready', 'ready'],
      'Forward and reverse card snapshots are valid',
    );

    await page.goto(`${baseUrl}/explore/monthly-comparison?month=2026-09`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForSelector('.comparison-bars button[data-month]');
    await page.click('.comparison-range button:last-child');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.comparison-bars button:not(.ledger-reflow-leave-active)')
          .length === 12,
    );
    await new Promise((r) => setTimeout(r, 550));
    const centers = await page.$$eval('.comparison-bars button', (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, key: el.dataset.month };
      }),
    );
    await page.mouse.move(centers[2].x, centers[2].y);
    await page.mouse.down();
    await page.mouse.move(centers[7].x, centers[7].y, { steps: 15 });
    await page.mouse.up();
    assert.equal(
      await page.$eval('.comparison-bars button.selected', (el) => el.dataset.month),
      centers[7].key,
      'Dragging selects the nearest bar',
    );
    assert(
      await page.$eval(
        '.comparison-bars button.selected .comparison-bar',
        (el) => getComputedStyle(el).transform === 'none' && getComputedStyle(el).filter === 'none',
      ),
      'Selected bar has no floating/glowing effect',
    );
    await page.click('.comparison-range button:first-child');
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await page.$$eval('.comparison-bars button', (els) => els.length), 3);
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Chart fits narrow viewport',
    );
    assert.equal(
      await page.$eval(
        '.comparison-bars button.selected',
        (el) => getComputedStyle(el).backgroundColor,
      ),
      'rgba(0, 0, 0, 0)',
      'No column selection background',
    );
    // Changing digit count/punctuation must not move the number when the old glyphs disappear.
    await page.click('.comparison-bars button:first-child');
    await new Promise((r) => setTimeout(r, 80));
    const beforeEnd = await page.$eval('.comparison-total .rolling-amount', (el) => ({
      width: el.getBoundingClientRect().width,
      x: el.getBoundingClientRect().x,
    }));
    await new Promise((r) => setTimeout(r, 600));
    const afterEnd = await page.$eval('.comparison-total .rolling-amount', (el) => ({
      width: el.getBoundingClientRect().width,
      x: el.getBoundingClientRect().x,
    }));
    assert.deepEqual(afterEnd, beforeEnd, 'Amount geometry stays stable when animation completes');
    await page.goto(`${baseUrl}/recurring-payments`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.subscription-total');
    assert.equal(
      await page.$eval('.subscription-total', (el) => getComputedStyle(el).backgroundColor),
      'rgba(0, 0, 0, 0)',
      'Subscription total is not a filled box',
    );
    console.log(
      `PASS ${width}px ${language} ${motion}: panels, reflow, scrub, morph navigation, month, range, overflow`,
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
