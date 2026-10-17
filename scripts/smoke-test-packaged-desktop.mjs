// Launch the real packaged app; never use the developer's financial data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const executable = process.argv[2];
assert.ok(executable, 'Packaged desktop executable path is required');
// Spaces and Unicode catch common Windows user-profile path regressions.
const dataDir = await mkdtemp(join(tmpdir(), 'Money Monitor QA שלום '));
await writeFile(join(dataDir, 'config.json'), JSON.stringify({ AUTO_UPDATE_ENABLED: 'false' }));
if (process.platform === 'darwin') {
  await writeFile(join(dataDir, '.move-to-applications-declined'), '');
}
const errors = [];
let child;
let browser;
let output = '';

async function launch() {
  const env = { ...process.env, MONEY_MONITOR_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(resolve(executable), ['--remote-debugging-port=0'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('error', (error) => errors.push(error.message));
  output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      output += chunk.toString();
    });
  }
  let endpoint;
  for (let attempt = 0; attempt < 240; attempt++) {
    endpoint = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    if (endpoint) break;
    assert.equal(child.exitCode, null, `App exited during startup:\n${output}`);
    assert.equal(errors.length, 0, errors.join('\n'));
    await delay(250);
  }
  assert.ok(endpoint, `App did not expose its renderer:\n${output}`);
  browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
  const target = await browser.waitForTarget(
    (candidate) => candidate.type() === 'page' && candidate.url().startsWith('http://localhost:'),
    { timeout: 60_000 },
  );
  const page = await target.page();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => window.electronAPI?.getAuthToken());
  await page.waitForSelector('main h1');
  assert.equal(await page.evaluate(() => window.electronAPI.getDataPath()), dataDir);
  return page;
}

async function stop() {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
      await exited;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function api(page, path, method = 'GET', body) {
  const response = await page.evaluate(
    async (path, method, body) => {
      const result = await fetch(`/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${window.electronAPI.getAuthToken()}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: result.status, data: await result.json() };
    },
    path,
    method,
    body,
  );
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${method} ${path}: ${response.status} ${JSON.stringify(response.data)}`,
  );
  return response.data;
}

try {
  let page = await launch();
  const origin = new URL(page.url()).origin;
  assert.equal((await fetch(`${origin}/api/accounts`)).status, 401);
  assert.equal((await api(page, '/accounts')).accounts.length, 0);
  await api(page, '/settings', 'POST', { SCRAPE_TIMEZONE: 'UTC' });
  if (process.platform === 'win32') {
    const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'));
    assert.ok(
      config.CREDENTIALS_MASTER_KEY.startsWith('enc:'),
      'Windows DPAPI must encrypt secrets',
    );
    const mobile = await page.evaluate(() => window.electronAPI.getMobileAccessState());
    assert.equal(mobile.transport.diagnostic, 'platformUnsupported');
  }
  await api(page, '/demo/toggle', 'POST', { enabled: true });
  assert.ok((await api(page, '/accounts')).accounts.length > 0, 'Demo SQLite seed is readable');
  assert.ok((await api(page, '/transactions?limit=5')).transactions.length > 0);

  await page.setViewport({ width: 1000, height: 720 });
  await page.reload({ waitUntil: 'networkidle2' });
  const attentionTextWidths = await page.$$eval('.attention-row > span', (spans) =>
    spans.map((span) => span.getBoundingClientRect().width),
  );
  assert.ok(attentionTextWidths.length > 0, 'Home attention rows are present');
  assert.ok(
    attentionTextWidths.every((width) => width >= 100),
    'Home attention text must remain readable at Windows desktop scaling',
  );

  for (const [language, theme] of [
    ['en', 'light'],
    ['he', 'dark'],
  ]) {
    await page.evaluate(
      (language, theme) => {
        localStorage.setItem('money-monitor-language', language);
        localStorage.setItem('money-monitor-theme', theme);
      },
      language,
      theme,
    );
    for (const route of [
      '/',
      '/transactions',
      '/explore',
      '/net-worth',
      '/budgets',
      '/accounts',
      '/settings',
      '/chat',
    ]) {
      // The live scrape-event stream intentionally keeps a connection open.
      await page.goto(`${origin}${route}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('main h1');
      assert.ok(await page.$eval('main', (main) => main.innerText.trim().length > 0), route);
      assert.equal(await page.$eval('html', (html) => html.dir), language === 'he' ? 'rtl' : 'ltr');
      assert.equal(await page.$eval('html', (html) => html.dataset.theme), theme);
    }
  }
  await api(page, '/demo/toggle', 'POST', { enabled: false });
  assert.equal(
    (await api(page, '/accounts')).accounts.length,
    0,
    'Demo leaves the real database empty',
  );
  await stop();

  page = await launch();
  assert.equal((await api(page, '/settings')).settings.SCRAPE_TIMEZONE, 'UTC');
  assert.equal((await api(page, '/accounts')).accounts.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    'Packaged desktop verified: startup, SQLite, authentication, demo, EN/HE, light/dark, settings persistence.',
  );
} catch (error) {
  console.error(output.replace(/token=[a-f0-9]+/g, 'token=<REDACTED>'));
  throw error;
} finally {
  await stop();
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
