import { getConfig } from './config.js';
import { getDatabase, closeDatabase } from './storage/database.js';
import { AccountRepository } from './storage/repositories/accounts.js';
import { TransactionRepository } from './storage/repositories/transactions.js';
import { ScraperService } from './scraper/index.js';
import { FinancialAnalysisAgent } from './analysis/agent.js';
import { createApp } from './api/index.js';

function main() {
  const config = getConfig();

  // Initialize storage
  const db = getDatabase(config.databasePath);
  const accountRepo = new AccountRepository(db, config.encryptionKey);
  const transactionRepo = new TransactionRepository(db);

  // Initialize services
  const scraperService = new ScraperService(accountRepo, transactionRepo);
  const analysisAgent = new FinancialAnalysisAgent(
    config.anthropicApiKey,
    accountRepo,
    transactionRepo,
  );

  // Create and start the HTTP server
  const app = createApp({
    accountRepo,
    transactionRepo,
    scraperService,
    analysisAgent,
  });

  const server = app.listen(config.port, () => {
    console.log(`money-monitor listening on http://localhost:${config.port}`);
    console.log(`  Database: ${config.databasePath}`);
    console.log(`  Endpoints:`);
    console.log(`    GET  /api/health`);
    console.log(`    CRUD /api/accounts`);
    console.log(`    GET  /api/transactions`);
    console.log(`    POST /api/scrape`);
    console.log(`    POST /api/analysis`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
