import { beforeEach, describe, expect, it, vi } from 'vitest';
const { launch, ensure } = vi.hoisted(() => ({
  launch: vi.fn(),
  ensure: vi.fn(async () => '/synthetic/chrome'),
}));
vi.mock('puppeteer-core', () => ({ default: { launch } }));
vi.mock('../scraper/chromium.js', () => ({ ensureChromium: ensure }));
const { closeImageBrowser, renderHtmlToImage, setServerPort } = await import('./html-to-image.js');
describe('image browser ownership', () => {
  beforeEach(() => {
    setServerPort(1234);
    launch.mockReset();
    ensure.mockClear();
  });
  it('shares concurrent launch and closes a browser created after retirement', async () => {
    let created!: (browser: unknown) => void;
    launch.mockImplementation(
      () =>
        new Promise((resolve) => {
          created = resolve;
        }),
    );
    const first = renderHtmlToImage('<div/>');
    const second = renderHtmlToImage('<div/>');
    const failures = Promise.allSettled([first, second]);
    await Promise.resolve();
    await Promise.resolve();
    expect(launch).toHaveBeenCalledTimes(1);
    const closing = closeImageBrowser();
    const close = vi.fn(async () => {});
    created({ connected: true, close });
    await closing;
    expect((await failures).every((item) => item.status === 'rejected')).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledTimes(1);
  });
});
