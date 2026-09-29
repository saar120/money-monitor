import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const { fetchGetWithinPage } = createRequire(import.meta.url)(
  'israeli-bank-scrapers-core/lib/helpers/fetch.js',
);

describe('scraper patch', () => {
  it('falls back to navigation when an in-page request is intercepted', async () => {
    const page = {
      evaluate: vi.fn().mockRejectedValue(new Error('fetch intercepted')),
      goto: vi.fn().mockResolvedValue({
        status: () => 200,
        text: async () => '{"ok":true}',
      }),
    };

    await expect(fetchGetWithinPage(page, 'https://example.test/data')).resolves.toEqual({
      ok: true,
    });
    expect(page.goto).toHaveBeenCalledOnce();
  });
});
