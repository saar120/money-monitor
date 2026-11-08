// Run against npm run dashboard:dev; all API responses use synthetic data.
import puppeteer from 'puppeteer-core';
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

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const baseUrl = process.env.MM_DASHBOARD_URL ?? 'http://localhost:5173';
const errors = [];
try {
  for (const [width, language, motion, theme] of [
    [1440, 'en', 'no-preference', 'light'],
    [1440, 'en', 'no-preference', 'dark'],
    [390, 'he', 'no-preference', 'light'],
    [390, 'en', 'reduce', 'dark'],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: motion }]);
    await page.evaluateOnNewDocument(
      (lang) => localStorage.setItem('money-monitor-language', lang),
      language,
    );
    await page.evaluateOnNewDocument(
      (choice) => localStorage.setItem('money-monitor-theme', choice),
      theme,
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
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error(`Browser error: ${e.message}`);
    });
    await page.setRequestInterception(true);
    const patches = [];
    const edits = new Map();
    let patchDelay = 0;
    let patchFails = false;
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (!u.pathname.startsWith('/api/')) return req.continue();
      const row = {
        id: 1,
        resourceVersion: 1,
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
      if (
        req.method() === 'POST' &&
        u.pathname.endsWith('/commands') &&
        u.pathname.startsWith('/api/transactions/')
      ) {
        const [id] = u.pathname.split('/').slice(3);
        const command = JSON.parse(req.postData());
        for (const field of Object.keys(command.patch))
          patches.push(
            `${id}:${field === 'effectiveDate' ? 'effective-date' : field === 'ignored' ? 'ignore' : field}`,
          );
        if (patchFails) return req.respond({ status: 500, body: '{"error":"Synthetic failure"}' });
        const updated = {
          ...row,
          ...edits.get(Number(id)),
          id: Number(id),
          description: ['Sample market', 'Sample cafe', 'Sample bakery', 'Sample restaurant'][
            id - 1
          ],
          ...command.patch,
          resourceVersion: command.expectedVersion + 1,
        };
        edits.set(Number(id), updated);
        const body = JSON.stringify({ transaction: updated });
        const respond = () => req.respond({ status: 200, contentType: 'application/json', body });
        return patchDelay ? void setTimeout(respond, patchDelay) : respond();
      }
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
          ...edits.get(index + 1),
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
    assert.equal(await page.$eval('html', (el) => el.dataset.theme), theme);
    if (width === 1440) {
      const category = '.proto-fields > label [role=combobox]';
      const dateInput = '.proto-more-details input[type="date"]';
      const patched = async (entry) => {
        for (let i = 0; i < 100 && !patches.includes(entry); i++)
          await new Promise((resolve) => setTimeout(resolve, 20));
        assert(patches.includes(entry), `${entry} was sent: ${patches.join(', ')}`);
      };
      // Autosave leaves a pending date alone; leaving the row saves it.
      await page.click('#proto-row-1 .proto-row-open');
      await page.waitForSelector(dateInput);
      await page.waitForFunction(
        () =>
          !document
            .querySelector('.proto-inspector')
            .classList.contains('detail-panel-enter-active'),
      );
      await page.$eval(dateInput, (el) => {
        el.value = '2026-09-20';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await selectOption(page, category, 'dining');
      await patched('1:category');
      assert(!patches.includes('1:effective-date'), 'Autosave does not commit a pending date');
      await page.click('#proto-row-2 .proto-row-open');
      await patched('1:effective-date');
      // A second edit made during a slow save survives moving to another row.
      patchDelay = 300;
      await selectOption(page, category, 'groceries');
      await page.click('.proto-include [role=switch]');
      await page.click('#proto-row-3 .proto-row-open');
      await patched('2:ignore');
      // Changing back during a slow save sends the correction too.
      patches.length = 0;
      await selectOption(page, category, 'dining');
      await selectOption(page, category, 'groceries');
      for (let i = 0; i < 100 && patches.length < 2; i++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(patches, ['3:category', '3:category'], 'A correction is saved');
      patchDelay = 0;
      await new Promise((resolve) => setTimeout(resolve, 350));
      // A failed save stays visible on other rows and Retry resends it.
      patchFails = true;
      patches.length = 0;
      await selectOption(page, category, 'dining');
      await page.waitForSelector('.proto-inspector .proto-error');
      await page.click('#proto-row-4 .proto-row-open');
      await page.waitForSelector('.proto-ledger-column > .proto-error');
      assert.match(
        await page.$eval('.proto-ledger-column > .proto-error', (el) => el.textContent),
        /bakery/,
      );
      patchFails = false;
      patches.length = 0;
      await page.click('.proto-ledger-column > .proto-error button');
      await page.waitForSelector('.proto-error', { hidden: true });
      assert.deepEqual(patches, ['3:category'], 'Retry resends the failed edit, not another row');
      edits.clear();
      await page.goto(`${baseUrl}/transactions?month=2026-09`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.proto-table tbody tr[tabindex]');
    }
    await page.click('.proto-table tbody tr[tabindex] .proto-row-open');
    await page.waitForSelector('.proto-inspector');
    await page.waitForFunction(
      () =>
        !document.querySelector('.proto-inspector').classList.contains('detail-panel-enter-active'),
    );
    assert(!(await page.$('.proto-save')), 'Category and owner save without a Save button');
    assert(
      await page.$('.proto-secondary-fields [role=combobox]'),
      'Owner is available directly in the inspector',
    );
    assert(
      await page.$('.proto-more-details input[type="date"]'),
      'Effective date is available directly',
    );
    await selectOption(page, '.proto-fields > label [role=combobox]', 'dining');
    await page.waitForSelector('.proto-saved');
    assert.equal(
      await page.$eval('#proto-row-1 .proto-category', (el) => el.textContent.trim()),
      language === 'he' ? 'מסעדות' : 'Dining',
    );
    await selectOption(page, '.proto-fields > label [role=combobox]', 'groceries');
    await page.waitForFunction(
      (label) =>
        document.querySelector('#proto-row-1 .proto-category').textContent.trim() === label,
      {},
      language === 'he' ? 'מצרכים' : 'Groceries',
    );
    if (width === 1440)
      assert.equal(
        await page.$eval('.proto-mobile-date', (el) => getComputedStyle(el).display),
        'none',
        'Desktop rows do not repeat their date',
      );
    await page.click('.proto-inspector-head button');
    await page.waitForSelector('.proto-inspector', { hidden: true });
    assert(
      await page.$eval(
        '.proto-table-scroll',
        (el) =>
          el.clientWidth >= el.querySelector('table').getBoundingClientRect().width - 1 ||
          el.scrollWidth > el.clientWidth,
      ),
      'Table fits or provides its own horizontal scroll',
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
    await page.click('.proto-table tbody tr[tabindex] .proto-row-open');
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
    await page.click('.proto-table tbody tr[tabindex] .proto-row-open');
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
    await selectOption(page, '.proto-filter-popover [role=combobox]', 'groceries');
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
    assert.equal(
      await page.$eval('#proto-row-3', (el) => el.getAnimations().length),
      0,
      'Ledger filtering keeps row navigation immediate',
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
    assert.equal(
      await page.$$eval('.secondary-nav .nav-link', (els) => els.length),
      8,
      'Planning and management destinations are directly available',
    );
    await page.waitForSelector('.explore-change');
    assert(
      (await page.$eval('.explore-change', (el) => el.textContent)).includes('Groceries'),
      'Explore highlights the largest category change from the fixture',
    );
    assert.equal(
      await page.$eval('.nav-link[href="/explore"]', (el) => el.getAttribute('aria-current')),
      'page',
      'Navigation identifies the active page',
    );
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
    assert.equal(
      await page.$$eval('.home-chart-legend .previous', (els) => els.length),
      1,
      'Previous month is visibly distinguished on the chart',
    );
    const endAmount = await page.$eval('.home-total', (el) => el.textContent);
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
          pointerId: 1,
          isPrimary: true,
          clientX: 100,
          clientY: 180,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerType: 'touch',
          pointerId: 1,
          isPrimary: true,
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
          pointerId: 1,
          isPrimary: true,
          clientX: 100,
          clientY: 100,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerType: 'touch',
          pointerId: 1,
          isPrimary: true,
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
    await page.waitForSelector('.proto-table');
    assert(
      new URL(page.url()).searchParams.get('category'),
      'Home category opens filtered Activity',
    );
    await page.goto(`${baseUrl}/explore?month=2026-09`, { waitUntil: 'networkidle0' });
    await page.click('.explore-row');
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
      `PASS ${width}px ${language} ${theme} ${motion}: save, disclosure, panels, reflow, scrub, morph navigation, month, range, overflow`,
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
