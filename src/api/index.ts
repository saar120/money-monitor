import express from 'express';
import cors from 'cors';
import { createAccountRoutes } from './routes/accounts.js';
import { createTransactionRoutes } from './routes/transactions.js';
import { createScrapeRoutes } from './routes/scrape.js';
import { createAnalysisRoutes } from './routes/analysis.js';
import type { AccountRepository } from '../storage/repositories/accounts.js';
import type { TransactionRepository } from '../storage/repositories/transactions.js';
import type { ScraperService } from '../scraper/index.js';
import type { FinancialAnalysisAgent } from '../analysis/agent.js';

export interface AppDependencies {
  accountRepo: AccountRepository;
  transactionRepo: TransactionRepository;
  scraperService: ScraperService;
  analysisAgent: FinancialAnalysisAgent;
}

export function createApp(deps: AppDependencies): express.Application {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount routes
  app.use('/api/accounts', createAccountRoutes(deps.accountRepo));
  app.use('/api/transactions', createTransactionRoutes(deps.transactionRepo));
  app.use('/api/scrape', createScrapeRoutes(deps.scraperService));
  app.use('/api/analysis', createAnalysisRoutes(deps.analysisAgent));

  return app;
}
