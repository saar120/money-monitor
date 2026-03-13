import { install, Browser, detectBrowserPlatform } from '@puppeteer/browsers';
import { join } from 'node:path';
import { dataDir } from '../paths.js';

/**
 * Chrome for Testing build that matches puppeteer-core 22.15.0
 * (the version used by israeli-bank-scrapers-core 6.7.1).
 */
const CHROME_BUILD_ID = '127.0.6533.88';

const cacheDir = join(dataDir, 'puppeteer-cache');

let cachedPath: string | undefined;

/**
 * Ensure Chrome is downloaded and return its executable path.
 * Idempotent — skips the download if already cached.
 */
export async function ensureChromium(): Promise<string> {
  if (cachedPath) return cachedPath;

  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`);
  }

  const installed = await install({
    browser: Browser.CHROME,
    buildId: CHROME_BUILD_ID,
    cacheDir,
    platform,
  });

  const path = installed.executablePath;
  cachedPath = path;
  return path;
}
