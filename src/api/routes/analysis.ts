import { Router } from 'express';
import type { FinancialAnalysisAgent } from '../../analysis/agent.js';

export function createAnalysisRoutes(agent: FinancialAnalysisAgent): Router {
  const router = Router();

  /**
   * POST /api/analysis
   * Body: { "question": "Where am I spending the most?" }
   *
   * Sends the question to the Claude-powered analysis agent which has
   * tool access to query the transaction database, compute summaries,
   * and return a natural-language analysis.
   */
  router.post('/', async (req, res) => {
    const { question } = req.body;
    if (!question || typeof question !== 'string') {
      res
        .status(400)
        .json({ success: false, error: 'question is required' });
      return;
    }

    try {
      const analysis = await agent.analyze(question);
      res.json({ success: true, data: analysis });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Analysis failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  /**
   * POST /api/analysis/categorize
   *
   * Asks the agent to automatically categorize all uncategorized transactions
   * using LLM reasoning about the description field.
   */
  router.post('/categorize', async (_req, res) => {
    try {
      const result = await agent.autoCategorize();
      res.json({ success: true, data: result });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Categorization failed';
      res.status(500).json({ success: false, error: message });
    }
  });

  return router;
}
