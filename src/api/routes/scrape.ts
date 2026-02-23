import { Router } from 'express';
import type { ScraperService } from '../../scraper/index.js';

export function createScrapeRoutes(scraperService: ScraperService): Router {
  const router = Router();

  /** POST /api/scrape/:accountId — scrape a single account */
  router.post('/:accountId', async (req, res) => {
    try {
      const result = await scraperService.scrapeAccount(req.params.accountId);
      const status = result.success ? 200 : 502;
      res.status(status).json({ success: result.success, data: result });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Scrape failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  /** POST /api/scrape — scrape all configured accounts */
  router.post('/', async (_req, res) => {
    try {
      const results = await scraperService.scrapeAll();
      const allSuccess = results.every((r) => r.success);
      res.json({ success: allSuccess, data: results });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Scrape failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  return router;
}
