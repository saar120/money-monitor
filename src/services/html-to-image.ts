import puppeteer, { type Browser } from 'puppeteer-core';
import { ensureChromium } from '../scraper/chromium.js';
import { config } from '../config.js';

let browser: Browser | null = null;
let serverPort: number | null = null;

/** Set the actual bound server port (called from server.ts after listen). */
export function setServerPort(port: number): void {
  serverPort = port;
}

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser;
  const executablePath = await ensureChromium();
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  return browser;
}

/**
 * Render a self-contained HTML string to a PNG buffer.
 * Screenshots the `#content` element for a tight crop.
 */
export async function renderHtmlToImage(html: string): Promise<Buffer> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: 800, height: 600 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const element = await page.$('#content');
    if (!element) {
      throw new Error('No #content element found in HTML template');
    }
    const screenshot = await element.screenshot({ type: 'png' });
    return Buffer.from(screenshot);
  } finally {
    await page.close();
  }
}

/**
 * Navigate to the running dashboard and screenshot a specific element.
 * Uses the same server port and API token from config.
 *
 * @param route - Dashboard route path (e.g. "/" or "/net-worth")
 * @param selector - CSS selector for the element to screenshot
 * @param viewportWidth - Viewport width (default 1280 to match desktop layout)
 */
export async function screenshotDashboard(
  route: string,
  selector: string,
  opts: { viewportWidth?: number; startDate?: string; endDate?: string } = {},
): Promise<Buffer> {
  const viewportWidth = opts.viewportWidth ?? 1280;
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width: viewportWidth, height: 900, deviceScaleFactor: 2 });

    // Set auth token in localStorage before navigating
    const port = serverPort ?? config.PORT;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[screenshotDashboard] Navigating to ${baseUrl}${route} selector=${selector}`);
    if (config.API_TOKEN) {
      await page.evaluateOnNewDocument((token: string) => {
        localStorage.setItem('money_monitor_api_token', token);
      }, config.API_TOKEN);
    }

    // Append date query params if provided (dashboard components read these)
    const url = new URL(`${baseUrl}${route}`);
    if (opts.startDate) url.searchParams.set('startDate', opts.startDate);
    if (opts.endDate) url.searchParams.set('endDate', opts.endDate);

    // Use domcontentloaded instead of networkidle0 because the dashboard keeps
    // an SSE connection open (/api/scrape/events) which prevents network idle.
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wait for charts to finish rendering (ECharts canvas elements appear)
    await page
      .waitForSelector(`${selector} canvas, ${selector} svg`, { timeout: 10000 })
      .catch(() => {
        // Some sections (like summary cards) don't have canvas — that's OK
      });

    // Wait for ECharts animations to complete
    await new Promise((r) => setTimeout(r, 1500));

    const element = await page.$(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }
    const screenshot = await element.screenshot({ type: 'png' });
    return Buffer.from(screenshot);
  } finally {
    await page.close();
  }
}

/** Close the image-renderer browser (call during server shutdown). */
export async function closeImageBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
